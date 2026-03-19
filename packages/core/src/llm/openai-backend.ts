import OpenAI from "openai";
import type {
  LLMResponse, LLMMessage, AgentMessage, ToolDefinition, ToolCall,
  ChatWithToolsResult, OnStreamProgress, ResolvedOptions,
} from "./llm-types.js";
import { createStreamMonitor, PartialResponseError, MIN_SALVAGEABLE_CHARS } from "./llm-types.js";

// ---------------------------------------------------------------------------
// Chat Completions API — streaming
// ---------------------------------------------------------------------------

export async function chatCompletionOpenAIChat(
  client: OpenAI,
  model: string,
  messages: ReadonlyArray<LLMMessage>,
  options: ResolvedOptions,
  webSearch?: boolean,
  onStreamProgress?: OnStreamProgress,
): Promise<LLMResponse> {
  const stream = await client.chat.completions.create({
    model,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    temperature: options.temperature,
    max_tokens: options.maxTokens,
    stream: true,
    ...(webSearch ? { web_search_options: { search_context_size: "medium" as const } } : {}),
  });

  const chunks: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  const monitor = createStreamMonitor(onStreamProgress);

  try {
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        chunks.push(delta);
        monitor.onChunk(delta);
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? 0;
        outputTokens = chunk.usage.completion_tokens ?? 0;
      }
    }
  } catch (streamError) {
    monitor.stop();
    const partial = chunks.join("");
    if (partial.length >= MIN_SALVAGEABLE_CHARS) {
      throw new PartialResponseError(partial, streamError);
    }
    throw streamError;
  } finally {
    monitor.stop();
  }

  const content = chunks.join("");
  if (!content) throw new Error("LLM returned empty response");

  return {
    content,
    usage: {
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
  };
}

// ---------------------------------------------------------------------------
// Chat Completions API — sync
// ---------------------------------------------------------------------------

export async function chatCompletionOpenAIChatSync(
  client: OpenAI,
  model: string,
  messages: ReadonlyArray<LLMMessage>,
  options: ResolvedOptions,
  _webSearch?: boolean,
): Promise<LLMResponse> {
  const response = await client.chat.completions.create({
    model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: options.temperature,
    max_tokens: options.maxTokens,
    stream: false,
  });

  const content = response.choices[0]?.message?.content ?? "";
  if (!content) throw new Error("LLM returned empty response");

  return {
    content,
    usage: {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Chat Completions API — tool calling
// ---------------------------------------------------------------------------

export async function chatWithToolsOpenAIChat(
  client: OpenAI,
  model: string,
  messages: ReadonlyArray<AgentMessage>,
  tools: ReadonlyArray<ToolDefinition>,
  options: ResolvedOptions,
): Promise<ChatWithToolsResult> {
  const openaiMessages = agentMessagesToOpenAIChat(messages);
  const openaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  const stream = await client.chat.completions.create({
    model,
    messages: openaiMessages,
    tools: openaiTools,
    temperature: options.temperature,
    max_tokens: options.maxTokens,
    stream: true,
  });

  let content = "";
  const toolCallMap = new Map<number, { id: string; name: string; arguments: string }>();

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (delta?.content) content += delta.content;
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const existing = toolCallMap.get(tc.index);
        if (existing) {
          existing.arguments += tc.function?.arguments ?? "";
        } else {
          toolCallMap.set(tc.index, {
            id: tc.id ?? "",
            name: tc.function?.name ?? "",
            arguments: tc.function?.arguments ?? "",
          });
        }
      }
    }
  }

  const toolCalls: ToolCall[] = [...toolCallMap.values()];
  return { content, toolCalls };
}

// ---------------------------------------------------------------------------
// Responses API — streaming
// ---------------------------------------------------------------------------

export async function chatCompletionOpenAIResponses(
  client: OpenAI,
  model: string,
  messages: ReadonlyArray<LLMMessage>,
  options: ResolvedOptions,
  webSearch?: boolean,
  onStreamProgress?: OnStreamProgress,
): Promise<LLMResponse> {
  const input: OpenAI.Responses.ResponseInputItem[] = messages.map((m) => ({
    role: m.role as "system" | "user" | "assistant",
    content: m.content,
  }));

  const tools: OpenAI.Responses.Tool[] | undefined = webSearch
    ? [{ type: "web_search_preview" as const }]
    : undefined;

  const stream = await client.responses.create({
    model,
    input,
    temperature: options.temperature,
    max_output_tokens: options.maxTokens,
    stream: true,
    ...(tools ? { tools } : {}),
  });

  const chunks: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  const monitor = createStreamMonitor(onStreamProgress);

  try {
    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        chunks.push(event.delta);
        monitor.onChunk(event.delta);
      }
      if (event.type === "response.completed") {
        inputTokens = event.response.usage?.input_tokens ?? 0;
        outputTokens = event.response.usage?.output_tokens ?? 0;
      }
    }
  } catch (streamError) {
    monitor.stop();
    const partial = chunks.join("");
    if (partial.length >= MIN_SALVAGEABLE_CHARS) {
      throw new PartialResponseError(partial, streamError);
    }
    throw streamError;
  } finally {
    monitor.stop();
  }

  const content = chunks.join("");
  if (!content) throw new Error("LLM returned empty response");

  return {
    content,
    usage: {
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
  };
}

// ---------------------------------------------------------------------------
// Responses API — sync
// ---------------------------------------------------------------------------

export async function chatCompletionOpenAIResponsesSync(
  client: OpenAI,
  model: string,
  messages: ReadonlyArray<LLMMessage>,
  options: ResolvedOptions,
  _webSearch?: boolean,
): Promise<LLMResponse> {
  const input: OpenAI.Responses.ResponseInputItem[] = messages.map((m) => ({
    role: m.role as "system" | "user" | "assistant",
    content: m.content,
  }));

  const response = await client.responses.create({
    model,
    input,
    temperature: options.temperature,
    max_output_tokens: options.maxTokens,
    stream: false,
  });

  const content = response.output
    .filter((item): item is OpenAI.Responses.ResponseOutputMessage => item.type === "message")
    .flatMap((item) => item.content)
    .filter((block): block is OpenAI.Responses.ResponseOutputText => block.type === "output_text")
    .map((block) => block.text)
    .join("");

  if (!content) throw new Error("LLM returned empty response");

  return {
    content,
    usage: {
      promptTokens: response.usage?.input_tokens ?? 0,
      completionTokens: response.usage?.output_tokens ?? 0,
      totalTokens: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Responses API — tool calling
// ---------------------------------------------------------------------------

export async function chatWithToolsOpenAIResponses(
  client: OpenAI,
  model: string,
  messages: ReadonlyArray<AgentMessage>,
  tools: ReadonlyArray<ToolDefinition>,
  options: ResolvedOptions,
): Promise<ChatWithToolsResult> {
  const input = agentMessagesToResponsesInput(messages);
  const responsesTools: OpenAI.Responses.Tool[] = tools.map((t) => ({
    type: "function" as const,
    name: t.name,
    description: t.description,
    parameters: t.parameters as OpenAI.Responses.FunctionTool["parameters"],
    strict: false,
  }));

  const stream = await client.responses.create({
    model,
    input,
    tools: responsesTools,
    temperature: options.temperature,
    max_output_tokens: options.maxTokens,
    stream: true,
  });

  let content = "";
  const toolCalls: ToolCall[] = [];

  for await (const event of stream) {
    if (event.type === "response.output_text.delta") {
      content += event.delta;
    }
    if (event.type === "response.output_item.done" && event.item.type === "function_call") {
      toolCalls.push({
        id: event.item.call_id,
        name: event.item.name,
        arguments: event.item.arguments,
      });
    }
  }

  return { content, toolCalls };
}

// ---------------------------------------------------------------------------
// Message conversion helpers
// ---------------------------------------------------------------------------

function agentMessagesToOpenAIChat(
  messages: ReadonlyArray<AgentMessage>,
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      result.push({ role: "system", content: msg.content });
      continue;
    }
    if (msg.role === "user") {
      result.push({ role: "user", content: msg.content });
      continue;
    }
    if (msg.role === "assistant") {
      const assistantMsg: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
        role: "assistant",
        content: msg.content ?? null,
      };
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        assistantMsg.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        }));
      }
      result.push(assistantMsg);
      continue;
    }
    if (msg.role === "tool") {
      result.push({
        role: "tool",
        tool_call_id: msg.toolCallId,
        content: msg.content,
      });
    }
  }

  return result;
}

function agentMessagesToResponsesInput(
  messages: ReadonlyArray<AgentMessage>,
): OpenAI.Responses.ResponseInputItem[] {
  const result: OpenAI.Responses.ResponseInputItem[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      result.push({ role: "system", content: msg.content });
      continue;
    }
    if (msg.role === "user") {
      result.push({ role: "user", content: msg.content });
      continue;
    }
    if (msg.role === "assistant") {
      if (msg.content) {
        result.push({ role: "assistant", content: msg.content });
      }
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          result.push({
            type: "function_call" as const,
            call_id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          });
        }
      }
      continue;
    }
    if (msg.role === "tool") {
      result.push({
        type: "function_call_output" as const,
        call_id: msg.toolCallId,
        output: msg.content,
      });
    }
  }

  return result;
}
