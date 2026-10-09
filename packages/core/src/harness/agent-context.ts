import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { UserMessage } from "@mariozechner/pi-ai";
import { estimateTextTokens } from "../llm/provider.js";
import type { ContextCompressionCallback } from "../models/context-compression.js";
import {
  compileContext,
  ContextSourceRegistry,
  ProtectedContextOverflowError,
  type ContextFragment,
  type SemanticContextCompiler,
} from "./context-compiler.js";
import type { WorkManifest, WorkProfile, RequestDeliveryState } from "./contracts.js";
import { loadWorkManifest } from "./work-store.js";
import {executionProgress} from './execution-progress.js';

export interface ConversationCompactionRequest {
  readonly history: string;
  readonly intent: string;
  readonly maxTokens: number;
  readonly signal?: AbortSignal;
}

export type ConversationCompactor = (request: ConversationCompactionRequest) => Promise<string>;

export function createHarnessContextTransform(input: {
  readonly projectRoot: string;
  readonly work: WorkManifest | null;
  readonly profile: WorkProfile;
  readonly budgetTokens: number;
  readonly semanticCompiler?: SemanticContextCompiler;
  readonly conversationCompactor?: ConversationCompactor;
  readonly onContextCompression?: ContextCompressionCallback;
  readonly requestDelivery?: ()=>Omit<RequestDeliveryState,'authorRequest'|'version'>;
}): (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]> {
  const sources = new ContextSourceRegistry();
  sources.register({id:'request-delivery',async load(){return input.requestDelivery?[{
    id:'request-delivery',source:'Current request delivery record; older requests do not add obligations',
    protection:'protected' as const,priority:100,content:JSON.stringify(input.requestDelivery()),
  }]:[];}});
  sources.register({
    id: "work-current",
    async load(request) {
      const work = request.work;
      if (!work) return [];
      return [{
        id: "work-identity",
        source: "current Work",
        protection: "protected",
        priority: 100,
        pointer: `works/${work.id}/work.json`,
        content: JSON.stringify({
          id: work.id,
          title: work.title,
          profileId: work.profileId,
          language: work.language,
          status: work.status,
          lineage: work.lineage,
          metadata: work.metadata,
          artifacts: work.artifacts.map((artifact) => ({
            id: artifact.id,
            kind: artifact.kind,
            path: artifact.revisions.find(revision=>revision.id===artifact.currentRevisionId)?.path,
            schema: input.profile.artifactSchemas[artifact.revisions.find(revision=>revision.id===artifact.currentRevisionId)?.path ?? ""],
            currentRevisionId: artifact.currentRevisionId,
            read: { artifactId: artifact.id },
          })),
        }),
      }];
    },
  });

  let cached: {frames:string[];summary:string} | undefined;
  return async (messages, signal) => {
    const lastUserIndex = findLastUserIndex(messages);
    let historicalMessages = lastUserIndex > 0 ? messages.slice(0, lastUserIndex) : [];
    let protectedTail = lastUserIndex >= 0 ? messages.slice(lastUserIndex) : messages;
    // Completed reads in the current tool loop can exceed a model window even
    // with a short user request. Preserve the request; compact the complete
    // closed tool exchanges, keeping their full evidence in the transcript.
    if (lastUserIndex >= 0 && estimateAgentMessages(protectedTail) > input.budgetTokens * 0.6
      && input.conversationCompactor && closedToolExchanges(protectedTail.slice(1))) {
      let boundary=protectedTail.length;
      for(let i=protectedTail.length-1;i>=1;i--){
        if(protectedTail[i]?.role==='assistant'&&closedToolExchanges(protectedTail.slice(i))
          &&estimateAgentMessages(protectedTail.slice(i))<input.budgetTokens*0.2)boundary=i;
      }
      historicalMessages = [...historicalMessages, ...protectedTail.slice(1,boundary)];
      protectedTail = [messages[lastUserIndex]!,...protectedTail.slice(boundary)];
    }
    const tailTokens = estimateAgentMessages(protectedTail);
    const workBudget = input.budgetTokens - tailTokens;
    if (workBudget <= 0) throw new ProtectedContextOverflowError(tailTokens, input.budgetTokens);

    const currentWork = input.work ? await loadWorkManifest(input.projectRoot, input.work.id) : null;
    const compiled = await compileContext({
      recipe: { id: `${input.profile.id}-agent`, sourceIds: ["work-current","request-delivery"] },
      sources,
      request: {
        projectRoot: input.projectRoot,
        work: currentWork,
        profile: input.profile,
        actionId: "agent-turn",
        intent: latestUserText(messages),
        signal,
      },
      budgetTokens: workBudget,
      compiler: input.semanticCompiler,
    });
    const contextMessage: UserMessage | null = compiled.markdown
      ? {
          role: "user",
          content: `<current_work_context>\n${compiled.markdown}\n</current_work_context>`,
          timestamp: Date.now(),
        }
      : null;
    const progress=executionProgress(messages.slice(lastUserIndex>=0?lastUserIndex+1:0),Math.max(100,Math.min(8000,Math.floor(input.budgetTokens*0.6))));
    const progressMessage:UserMessage|undefined=progress?{role:'user',content:`<host_execution_progress>\n${progress}\n</host_execution_progress>`,timestamp:Date.now()}:undefined;
    const withContext = [...(contextMessage ? [contextMessage as AgentMessage] : []),
      ...(progressMessage ? [progressMessage] : []), ...messages];
    if (estimateAgentMessages(withContext) <= input.budgetTokens) return withContext;

    if (!input.conversationCompactor || historicalMessages.length === 0) {
      throw new ProtectedContextOverflowError(
        estimateAgentMessages(contextMessage ? [contextMessage as AgentMessage, ...protectedTail] : protectedTail),
        input.budgetTokens,
      );
    }

    const workTokens = contextMessage ? estimateAgentMessages([contextMessage as AgentMessage]) : 0;
    const progressTokens=progressMessage?estimateAgentMessages([progressMessage]):0;
    const summaryBudget = input.budgetTokens - workTokens - tailTokens-progressTokens;
    if (summaryBudget <= 0) {
      throw new ProtectedContextOverflowError(workTokens + tailTokens, input.budgetTokens);
    }
    const frames=historicalMessages.map(m=>renderAgentMessages([m]));
    const extendsCache=cached&&cached.frames.length<=frames.length&&cached.frames.every((frame,i)=>frame===frames[i]);
    const delta=extendsCache?historicalMessages.slice(cached!.frames.length):[];
    const cachedTokens=extendsCache?estimateTextTokens(cached!.summary)+estimateAgentMessages(delta):Infinity;
    let summary:string;
    let retainedDelta:AgentMessage[]=[];
    if(extendsCache&&cachedTokens<summaryBudget*0.7){summary=cached!.summary;retainedDelta=delta;}
    else {
    input.onContextCompression?.({ category: "session_context", phase: "start", sources: ["session transcript"] });
    summary = (await input.conversationCompactor({
      history: extendsCache?`Previous notes (not execution authority):\n${cached!.summary}\n\nNew completed exchanges:\n${renderAgentMessages(delta)}`:renderAgentMessages(historicalMessages),
      intent: latestUserText(messages),
      maxTokens: summaryBudget,
      signal,
    })).trim();
    if (!summary) throw new Error("Conversation compactor returned empty content");
    cached={frames,summary};
    input.onContextCompression?.({ category: "session_context", phase: "end", sources: ["session transcript"] });
    }
    const summaryMessage: UserMessage = {
      role: "user",
      content: `<conversation_summary>\n${summary}\n</conversation_summary>`,
      timestamp: Date.now(),
    };
    const finalMessages = [
      ...(contextMessage ? [contextMessage as AgentMessage] : []),
      summaryMessage,
      ...retainedDelta,
      ...(progressMessage?[progressMessage]:[]),
      ...protectedTail,
    ];
    const finalTokens = estimateAgentMessages(finalMessages);
    if (finalTokens > input.budgetTokens) {
      throw new Error(`Compacted conversation still exceeds budget: ${finalTokens}/${input.budgetTokens} tokens`);
    }
    return finalMessages;
  };
}

function closedToolExchanges(messages: ReadonlyArray<AgentMessage>): boolean {
  const calls = new Set<string>();
  const results = new Set<string>();
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const block of message.content) if (block.type === "toolCall") calls.add(block.id);
    } else if (message.role === "toolResult") results.add(message.toolCallId);
  }
  return calls.size > 0 && calls.size === results.size && [...calls].every((id) => results.has(id));
}

function findLastUserIndex(messages: ReadonlyArray<AgentMessage>): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if ((messages[index] as { role?: string }).role === "user") return index;
  }
  return -1;
}

function estimateAgentMessages(messages: ReadonlyArray<AgentMessage>): number {
  return estimateTextTokens(renderAgentMessages(messages));
}

function renderAgentMessages(messages: ReadonlyArray<AgentMessage>): string {
  // UI details often repeat the full tool payload. Pi sends content to the
  // model; counting details/cost/signature metadata can double the budget.
  return messages.map((message) => {
    const raw = message as {role:string;content?:unknown;toolCallId?:string;toolName?:string;isError?:boolean};
    return JSON.stringify({role:raw.role,content:raw.content,
      ...(raw.role === "toolResult" ? {toolCallId:raw.toolCallId,toolName:raw.toolName,isError:raw.isError} : {}),
    });
  }).join("\n");
}

function latestUserText(messages: ReadonlyArray<AgentMessage>): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as { role?: string; content?: unknown };
    if (message.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .filter((item): item is { type: "text"; text: string } => (
          Boolean(item) && typeof item === "object" && item.type === "text" && typeof item.text === "string"
        ))
        .map((item) => item.text)
        .join("\n");
    }
  }
  return "";
}
