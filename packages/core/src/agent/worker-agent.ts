import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type Context,
  type Message,
  type Model,
  type Provider,
  type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import type { Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  chatCompletion,
  createStreamMonitor,
  type LLMClient,
  type LLMMessage,
  type LLMResponse,
  type OnStreamProgress,
} from "../llm/provider.js";
import { guardedPiNonStreaming, guardedPiStream } from "./pi-stream.js";
import { toPiApi } from "../llm/api-format.js";
import { recordExecutionEvidence } from "../harness/execution-evidence.js";
import {decodeStructuredFields} from './structured-arguments.js';
import { preserveToolArgumentTypes, toolArgumentIssues } from "./tool-arguments.js";

export interface WorkerAgentOptions {
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly webSearch?: boolean;
  readonly onStreamProgress?: OnStreamProgress;
  readonly onTextDelta?: (text: string) => void;
  readonly signal?: AbortSignal;
  readonly onUsage?: (usage: LLMResponse["usage"]) => void;
}

export interface WorkerResultTool<TParameters extends TSchema> {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: TParameters;
  readonly validate?: (parameters: Static<TParameters>) => Static<TParameters> | Promise<Static<TParameters>>;
  readonly supportingTools?: ReadonlyArray<AgentTool>;
  readonly maxTurns?: number;
}

const EMPTY_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function workerModel(client: LLMClient, modelId: string, maxTokens?: number): Model<Api> {
  const base = client._piModel;
  if (base) {
    return base.id === modelId ? base : { ...base, id: modelId, name: modelId };
  }

  // Test doubles and embedders may provide only the public LLMClient surface.
  // The actual transport still runs through chatCompletion; this model is Pi
  // lifecycle metadata rather than a second provider configuration.
  return {
    id: modelId,
    name: modelId,
    api: toPiApi(client.apiFormat),
    provider: client.provider as Provider,
    baseUrl: "",
    reasoning: false,
    input: ["text"],
    cost: EMPTY_COST,
    contextWindow: 200_000,
    maxTokens: maxTokens ?? client.defaults?.maxTokens ?? 32_768,
  };
}

function emptyUsage(): AssistantMessage["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { ...EMPTY_COST, total: 0 },
  };
}

function assistantMessage(
  model: Model<Api>,
  content: string,
  response: LLMResponse | undefined,
  stopReason: AssistantMessage["stopReason"],
  errorMessage?: string,
): AssistantMessage {
  return {
    role: "assistant",
    content: content ? [{ type: "text", text: content }] : [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: response?.usage
      ? {
          input: response.usage.promptTokens,
          output: response.usage.completionTokens,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: response.usage.totalTokens,
          cost: { ...EMPTY_COST, total: 0 },
        }
      : emptyUsage(),
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: Date.now(),
  };
}

function localStopStream(model: Model<Api>) {
  const stream = createAssistantMessageEventStream();
  const message = assistantMessage(model, "", undefined, "stop");
  queueMicrotask(() => {
    stream.push({ type: "done", reason: "stop", message });
    stream.end(message);
  });
  return stream;
}

function textFromContent(content: Message["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part): part is Extract<(typeof content)[number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function contextMessages(context: Context): LLMMessage[] {
  const messages: LLMMessage[] = [];
  if (context.systemPrompt?.trim()) {
    messages.push({ role: "system", content: context.systemPrompt });
  }
  for (const message of context.messages) {
    if (message.role === "user") {
      messages.push({ role: "user", content: textFromContent(message.content) });
      continue;
    }
    if (message.role === "assistant") {
      messages.push({
        role: "assistant",
        content: message.content
          .filter((part): part is Extract<(typeof message.content)[number], { type: "text" }> => part.type === "text")
          .map((part) => part.text)
          .join("\n"),
      });
      continue;
    }
    messages.push({
      role: "user",
      content: `[Tool result: ${message.toolName}]\n${textFromContent(message.content)}`,
    });
  }
  return messages;
}

function combineSignals(primary: AbortSignal | undefined, secondary: AbortSignal | undefined): AbortSignal | undefined {
  if (!primary) return secondary;
  if (!secondary) return primary;
  return AbortSignal.any([primary, secondary]);
}

/**
 * Pi stream adapter backed by the existing InkOS provider boundary.
 *
 * Pi owns the worker lifecycle and cancellation. The provider remains the sole
 * transport implementation so custom endpoints, retries, context guards and
 * stream deadlines behave exactly like the rest of InkOS.
 */
function providerWorkerStream(
  client: LLMClient,
  model: Model<Api>,
  context: Context,
  streamOptions: SimpleStreamOptions | undefined,
  options: WorkerAgentOptions,
  onFailure: (error: unknown) => void,
) {
  const stream = createAssistantMessageEventStream();
  let streamedText = "";
  let started = false;

  const partial = (): AssistantMessage => assistantMessage(model, streamedText, undefined, "stop");
  const emitDelta = (delta: string): void => {
    if (!delta) return;
    options.onTextDelta?.(delta);
    if (!started) {
      stream.push({ type: "start", partial: partial() });
      stream.push({ type: "text_start", contentIndex: 0, partial: partial() });
      started = true;
    }
    streamedText += delta;
    stream.push({ type: "text_delta", contentIndex: 0, delta, partial: partial() });
  };

  queueMicrotask(() => {
    void (async () => {
      try {
        const signal = combineSignals(streamOptions?.signal, options.signal);
        const response = await chatCompletion(client, model.id, contextMessages(context), {
          ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
          ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
          ...(options.webSearch !== undefined ? { webSearch: options.webSearch } : {}),
          ...(options.onStreamProgress ? { onStreamProgress: options.onStreamProgress } : {}),
          onTextDelta: emitDelta,
          ...(signal ? { signal } : {}),
        });
        if (started) {
          streamedText = response.content;
          stream.push({ type: "text_end", contentIndex: 0, content: response.content, partial: partial() });
        }
        const message = assistantMessage(model, response.content, response, "stop");
        stream.push({ type: "done", reason: "stop", message });
        stream.end(message);
      } catch (error) {
        onFailure(error);
        const aborted = streamOptions?.signal?.aborted || options.signal?.aborted;
        const message = assistantMessage(
          model,
          streamedText,
          undefined,
          aborted ? "aborted" : "error",
          error instanceof Error ? error.message : String(error),
        );
        stream.push({ type: "error", reason: aborted ? "aborted" : "error", error: message });
        stream.end(message);
      }
    })();
  });

  return stream;
}

function toAgentMessages(messages: ReadonlyArray<LLMMessage>, model: Model<Api>): Message[] {
  return messages
    .filter((message) => message.role !== "system")
    .map((message): Message => {
      if (message.role === "user") {
        return { role: "user", content: message.content, timestamp: Date.now() };
      }
      return assistantMessage(model, message.content, undefined, "stop");
    });
}

export async function runWorkerAgent(
  client: LLMClient,
  modelId: string,
  messages: ReadonlyArray<LLMMessage>,
  options: WorkerAgentOptions = {},
): Promise<LLMResponse> {
  options.signal?.throwIfAborted();
  const model = workerModel(client, modelId, options.maxTokens);
  const systemPrompt = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const promptMessages = toAgentMessages(messages, model);
  if (promptMessages.length === 0) {
    throw new Error("Worker Agent requires at least one non-system message");
  }

  let streamFailure: unknown;
  const agent = new Agent({
    initialState: { model, systemPrompt, tools: [], messages: [] },
    toolExecution: "sequential",
    streamFn: (streamModel, context, streamOptions) => providerWorkerStream(
      client,
      streamModel,
      context,
      streamOptions,
      options,
      (error) => { streamFailure = error; },
    ),
  });
  const abortAgent = () => agent.abort();
  options.signal?.addEventListener("abort", abortAgent, { once: true });

  try {
    await agent.prompt(promptMessages);
    options.signal?.throwIfAborted();
    if (streamFailure !== undefined) throw streamFailure;
    const final = [...agent.state.messages].reverse().find(
      (message): message is AssistantMessage => message.role === "assistant",
    );
    if (!final) throw new Error("Worker Agent completed without an assistant response");
    if (final.stopReason === "error" || final.stopReason === "aborted") {
      throw Object.assign(new Error(final.errorMessage ?? `Worker Agent stopped: ${final.stopReason}`), {
        code: (final as AssistantMessage & { errorCode?: string }).errorCode ?? "WORKER_MODEL_ERROR",
      });
    }
    return {
      content: final.content
        .filter((part): part is Extract<(typeof final.content)[number], { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join(""),
      usage: {
        promptTokens: final.usage.input,
        completionTokens: final.usage.output,
        totalTokens: final.usage.totalTokens,
      },
    };
  } finally {
    options.signal?.removeEventListener("abort", abortAgent);
  }
}

/**
 * Run a worker whose result is host-consumed state rather than prose.
 * The model must submit validated arguments through one Pi tool; the host owns
 * the tool result and never scrapes JSON out of assistant text.
 */
export async function runWorkerAgentTool<TParameters extends TSchema>(
  client: LLMClient,
  modelId: string,
  messages: ReadonlyArray<LLMMessage>,
  resultTool: WorkerResultTool<TParameters>,
  options: WorkerAgentOptions = {},
): Promise<Static<TParameters>> {
  options.signal?.throwIfAborted();
  if (!client._piModel) {
    throw new Error("Structured worker tools require a resolved Pi model");
  }
  const model = workerModel(client, modelId, options.maxTokens);
  const systemPrompt = [
    ...messages.filter((message) => message.role === "system").map((message) => message.content),
    `Finish by calling ${resultTool.name} exactly once. Do not print the result as prose or JSON.`,
  ].join("\n\n");
  const promptMessages = toAgentMessages(messages, model);
  if (promptMessages.length === 0) {
    throw new Error("Structured Worker Agent requires at least one non-system message");
  }

  let submitted: Static<TParameters> | undefined;
  let modelTurns = 0;
  let lastSupportingTurn = -1;
  let resultAttemptsExhausted = false;
  let lastValidationError: (Error & {code?:string}) | undefined;
  const maxResultTurns = resultTool.maxTurns ?? 3;
  const temperature = options.temperature ?? client.defaults.temperature;
  const { validate, supportingTools = [], maxTurns: _maxTurns, ...toolDefinition } = resultTool;
  const prepareArguments = (schema: TSchema, toolName: string, params: unknown) => {
      const decodedPaths:string[]=[];
      params=decodeStructuredFields(schema,params,decodedPaths);
      if(decodedPaths.length)recordExecutionEvidence('worker-arguments-decoded',{resultTool:toolName,paths:decodedPaths});
      const issues = toolArgumentIssues(schema, params);
      if (issues.length) {
        const failure={code:'WORKER_SCHEMA_INVALID',resultTool:toolName,issues};
        recordExecutionEvidence('worker-result-invalid',failure);
        lastValidationError=undefined;
        throw new Error(JSON.stringify(failure));
      }
      return params;
  };
  const tool: AgentTool<TParameters, Static<TParameters>> = {
    ...toolDefinition,
    prepareArguments: params => prepareArguments(resultTool.parameters, resultTool.name, params) as Static<TParameters>,
    execute: async (_toolCallId, params): Promise<AgentToolResult<Static<TParameters>>> => {
      if (submitted !== undefined) throw Object.assign(new Error('The final result is already recorded; later tool calls cannot change it.'),{code:'WORKER_RESULT_ALREADY_FINALIZED'});
      const parsed = Value.Parse(resultTool.parameters, params) as Static<TParameters>;
      try {
        if (lastSupportingTurn === modelTurns) throw Object.assign(new Error(JSON.stringify({
          code:'WORKER_RESULT_READBACK_REQUIRED',
          instruction:'Read the supporting tool results before finalizing in a later response. Correct or omit unsupported findings, then submit the final result.',
        })),{code:'WORKER_RESULT_READBACK_REQUIRED'});
        submitted = validate ? await validate(parsed) : parsed;
      } catch(error) {
        lastValidationError=error instanceof Error?error:new Error(String(error));
        recordExecutionEvidence('worker-result-invalid',{
          code:lastValidationError.code??'WORKER_DOMAIN_INVALID',
          resultTool:resultTool.name,
          message:lastValidationError.message,
        });
        throw error;
      }
      return {
        content: [{ type: "text", text: "Structured result received by the host." }],
        details: submitted,
      };
    },
  };
  const agent = new Agent({
    initialState: { model, systemPrompt, tools: [tool, ...supportingTools.map(supporting => ({
      ...supporting,
      prepareArguments: (params: unknown) => prepareArguments(supporting.parameters, supporting.name, params),
      execute: async (...args: Parameters<AgentTool['execute']>) => {
        if (submitted !== undefined) throw Object.assign(new Error('The final result is already recorded; later tool calls cannot change it.'),{code:'WORKER_RESULT_ALREADY_FINALIZED'});
        const result=await supporting.execute(...args);
        lastSupportingTurn=modelTurns;
        return result;
      },
    }))], messages: [] },
    beforeToolCall: preserveToolArgumentTypes,
    toolExecution: "sequential",
    streamFn: (streamModel, context, streamOptions) => {
      if (submitted) return localStopStream(streamModel);
      if (modelTurns >= maxResultTurns) {
        resultAttemptsExhausted = true;
        return localStopStream(streamModel);
      }
      modelTurns++;
      const resultOptions = {
          ...streamOptions,
          ...(temperature !== undefined ? { temperature } : {}),
          ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
          signal: combineSignals(streamOptions?.signal, options.signal),
          // The host requires a typed result; transport uses default tool
          // selection and gives bounded feedback when that result is missing.
          toolChoice: "required" as const,
          onPayload: (payload: unknown) => payload && typeof payload === "object" ? { ...client.defaults.extra, ...payload } : payload,
        };
      return client.stream === false
        ? guardedPiNonStreaming(streamModel, context, resultOptions, client.proxyUrl)
        : guardedPiStream(streamModel, context, resultOptions, 1, {firstEventTimeoutMs:300_000,idleTimeoutMs:300_000});
    },
    getApiKey: () => client._apiKey,
  });
  const abortAgent = () => agent.abort();
  options.signal?.addEventListener("abort", abortAgent, { once: true });
  const monitor = createStreamMonitor(progress => {
    options.onStreamProgress?.(progress);
    recordExecutionEvidence("model-stream-progress", { resultTool: resultTool.name, ...progress });
  });
  const unsubscribeProgress = agent.subscribe(event => {
    if (event.type !== "message_update") return;
    const update = event.assistantMessageEvent;
    if (update.type === "text_delta" || update.type === "toolcall_delta") monitor.onChunk(update.delta);
  });

  try {
    await agent.prompt(promptMessages);
    options.signal?.throwIfAborted();
    if (resultAttemptsExhausted) throw Object.assign(new Error(lastValidationError?.message??'Structured result remained invalid after bounded correction attempts'), {
      code:lastValidationError?.code??'WORKER_RESULT_INVALID',resultTool:resultTool.name,attempts:modelTurns,
      lastToolError:[...agent.state.messages].reverse().find(message=>message.role==='toolResult'&&message.isError),
    });
    const initialResult = agent.state.messages.at(-1);
    if (!submitted && initialResult?.role === "assistant" && initialResult.stopReason === "length") {
      throw Object.assign(new Error("Worker output reached the configured model output limit"), {
        code: "MODEL_OUTPUT_LIMIT", resultTool: resultTool.name, stopReason: initialResult.stopReason,
      });
    }
    if (!submitted && initialResult?.role === "assistant" && initialResult.stopReason === "error") {
      throw Object.assign(new Error(initialResult.errorMessage ?? "Worker model request failed"), {
        code: (initialResult as AssistantMessage & { errorCode?: string }).errorCode ?? "WORKER_MODEL_ERROR",
        resultTool: resultTool.name, stopReason: initialResult.stopReason, attempts: modelTurns,
      });
    }
    if (!submitted) {
      await agent.prompt(`You did not call ${resultTool.name}. Call it now with the complete result.`);
      options.signal?.throwIfAborted();
    }
    if (!submitted) {
      const last = [...agent.state.messages].reverse().find(
        (message): message is AssistantMessage => message.role === "assistant",
      );
      throw Object.assign(new Error(last?.errorMessage || `Worker Agent completed without calling ${resultTool.name}`), {
        code: (last as (AssistantMessage & { errorCode?: string }) | undefined)?.errorCode
          ?? (resultAttemptsExhausted ? "WORKER_RESULT_INVALID" : last?.stopReason === "length" ? "MODEL_OUTPUT_LIMIT" : "WORKER_RESULT_MISSING"),
        attempts: modelTurns,
        resultTool: resultTool.name,
        stopReason: last?.stopReason,
        lastToolError: [...agent.state.messages].reverse().find((message)=>message.role==="toolResult"&&message.isError),
        lastAssistantText: last?.content.filter((part)=>part.type==="text").map((part)=>part.text).join(""),
      });
    }
    const usage = agent.state.messages.reduce((total,message) => message.role === "assistant" ? {
      promptTokens: total.promptTokens + message.usage.input,
      completionTokens: total.completionTokens + message.usage.output,
      totalTokens: total.totalTokens + message.usage.totalTokens,
    } : total, {promptTokens:0,completionTokens:0,totalTokens:0});
    if (usage.totalTokens > 0) options.onUsage?.(usage);
    return submitted;
  } finally {
    unsubscribeProgress();
    monitor.stop();
    options.signal?.removeEventListener("abort", abortAgent);
  }
}
