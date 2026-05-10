import {
  appendManualSessionMessages,
  type PipelineRunner,
  type ProjectConfig,
} from "@actalk/inkos-core";
import type { ServiceConfigEntry } from "../services/service-config.js";
import { PIPELINE_STAGES } from "./execution.js";
import type { AgentRouteResult } from "./route-types.js";
import type { AgentSessionContext } from "./session-context.js";

export async function runDirectWriteNext(args: {
  readonly agentBookId: string;
  readonly broadcast: (event: string, data: unknown) => void;
  readonly config: ProjectConfig;
  readonly configuredEntry?: ServiceConfigEntry;
  readonly instruction: string;
  readonly pipeline: PipelineRunner;
  readonly requestedModel?: string;
  readonly requestedService?: string;
  readonly root: string;
  readonly sessionContext: AgentSessionContext;
}): Promise<AgentRouteResult> {
  const toolCallId = `direct-writer-${Date.now().toString(36)}`;
  const toolArgs = { agent: "writer", bookId: args.agentBookId };
  args.broadcast("tool:start", {
    sessionId: args.sessionContext.streamSessionId,
    id: toolCallId,
    tool: "sub_agent",
    args: toolArgs,
    stages: PIPELINE_STAGES.writer,
  });

  try {
    const writeResult = await args.pipeline.writeNextChapter(args.agentBookId);
    const responseText = [
      `已为 ${args.agentBookId} 完成第 ${writeResult.chapterNumber} 章`,
      writeResult.title ? `《${writeResult.title}》` : "",
      `，字数 ${writeResult.wordCount}，状态 ${writeResult.status}。`,
    ].join("");
    const toolResult = {
      content: [{ type: "text", text: responseText }],
      details: {
        kind: "chapter_written",
        bookId: args.agentBookId,
        chapterNumber: writeResult.chapterNumber,
        title: writeResult.title,
        wordCount: writeResult.wordCount,
        status: writeResult.status,
      },
    };
    args.broadcast("tool:end", {
      sessionId: args.sessionContext.streamSessionId,
      id: toolCallId,
      tool: "sub_agent",
      result: toolResult,
      isError: false,
    });
    await appendManualSessionMessages(args.root, args.sessionContext.bookSession.sessionId, [{
      role: "assistant",
      content: [{ type: "text", text: responseText }],
      api: "anthropic-messages",
      provider: args.configuredEntry?.service ?? args.requestedService ?? args.config.llm.provider,
      model: args.requestedModel ?? args.config.llm.model,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      timestamp: Date.now(),
    }], args.instruction);
    await args.sessionContext.refreshBookSessionFromTranscript();
    args.broadcast("agent:complete", {
      instruction: args.instruction,
      activeBookId: args.agentBookId,
      sessionId: args.sessionContext.bookSession.sessionId,
    });
    return {
      body: {
        response: responseText,
        session: {
          sessionId: args.sessionContext.bookSession.sessionId,
          activeBookId: args.agentBookId,
        },
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const toolResult = { content: [{ type: "text", text: message }] };
    args.broadcast("tool:end", {
      sessionId: args.sessionContext.streamSessionId,
      id: toolCallId,
      tool: "sub_agent",
      result: toolResult,
      isError: true,
    });
    args.broadcast("agent:error", {
      instruction: args.instruction,
      activeBookId: args.agentBookId,
      sessionId: args.sessionContext.bookSession.sessionId,
      error: message,
    });
    return {
      body: {
        error: { code: "AGENT_ACTION_FAILED", message },
        response: message,
      },
      status: 502,
    };
  }
}
