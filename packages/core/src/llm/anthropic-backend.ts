import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMResponse, LLMMessage, AgentMessage, ToolDefinition, ToolCall,
  ChatWithToolsResult, OnStreamProgress, ResolvedOptions,
} from "./llm-types.js";
import { createStreamMonitor, PartialResponseError, MIN_SALVAGEABLE_CHARS } from "./llm-types.js";

// ---------------------------------------------------------------------------
// Chat — streaming
// ---------------------------------------------------------------------------

export async function chatCompletionAnthropic(
  client: Anthropic,
  model: string,
  messages: ReadonlyArray<LLMMessage>,
  options: ResolvedOptions,
  thinkingBudget: number = 0,
  onStreamProgress?: OnStreamProgress,
): Promise<LLMResponse> {
  const systemText = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const nonSystem = messages.filter((m) => m.role !== "system");

  const stream = await client.messages.create({
    model,
    ...(systemText ? { system: systemText } : {}),
    messages: nonSystem.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    ...(thinkingBudget > 0
      ? { thinking: { type: "enabled" as const, budget_tokens: thinkingBudget } }
      : { temperature: options.temperature }),
    max_tokens: options.maxTokens,
    stream: true,
  });

  const chunks: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  const monitor = createStreamMonitor(onStreamProgress);

  try {
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        chunks.push(event.delta.text);
        monitor.onChunk(event.delta.text);
      }
      if (event.type === "message_start") {
        inputTokens = event.message.usage?.input_tokens ?? 0;
      }
      if (event.type === "message_delta") {
        outputTokens = ((event as unknown as { usage?: { output_tokens?: number } }).usage?.output_tokens) ?? 0;
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
// Chat — sync
// ---------------------------------------------------------------------------

export async function chatCompletionAnthropicSync(
  client: Anthropic,
  model: string,
  messages: ReadonlyArray<LLMMessage>,
  options: ResolvedOptions,
  thinkingBudget: number = 0,
): Promise<LLMResponse> {
  const systemText = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const nonSystem = messages.filter((m) => m.role !== "system");

  const response = await client.messages.create({
    model,
    ...(systemText ? { system: systemText } : {}),
    messages: nonSystem.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    ...(thinkingBudget > 0
      ? { thinking: { type: "enabled" as const, budget_tokens: thinkingBudget } }
      : { temperature: options.temperature }),
    max_tokens: options.maxTokens,
  });

  const content = response.content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === "text")
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
// Tool calling — streaming
// ---------------------------------------------------------------------------

export async function chatWithToolsAnthropic(
  client: Anthropic,
  model: string,
  messages: ReadonlyArray<AgentMessage>,
  tools: ReadonlyArray<ToolDefinition>,
  options: ResolvedOptions,
  thinkingBudget: number = 0,
): Promise<ChatWithToolsResult> {
  const systemText = messages
    .filter((m) => m.role === "system")
    .map((m) => (m as { content: string }).content)
    .join("\n\n");
  const nonSystem = messages.filter((m) => m.role !== "system");

  const anthropicMessages = agentMessagesToAnthropic(nonSystem);
  const anthropicTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Messages.Tool.InputSchema,
  }));

  const stream = await client.messages.create({
    model,
    ...(systemText ? { system: systemText } : {}),
    messages: anthropicMessages,
    tools: anthropicTools,
    ...(thinkingBudget > 0
      ? { thinking: { type: "enabled" as const, budget_tokens: thinkingBudget } }
      : { temperature: options.temperature }),
    max_tokens: options.maxTokens,
    stream: true,
  });

  let content = "";
  const toolCalls: ToolCall[] = [];
  let currentBlock: { id: string; name: string; input: string } | null = null;

  for await (const event of stream) {
    if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
      currentBlock = {
        id: event.content_block.id,
        name: event.content_block.name,
        input: "",
      };
    }
    if (event.type === "content_block_delta") {
      if (event.delta.type === "text_delta") {
        content += event.delta.text;
      }
      if (event.delta.type === "input_json_delta" && currentBlock) {
        currentBlock.input += event.delta.partial_json;
      }
    }
    if (event.type === "content_block_stop" && currentBlock) {
      toolCalls.push({
        id: currentBlock.id,
        name: currentBlock.name,
        arguments: currentBlock.input,
      });
      currentBlock = null;
    }
  }

  return { content, toolCalls };
}

// ---------------------------------------------------------------------------
// Message conversion
// ---------------------------------------------------------------------------

function agentMessagesToAnthropic(
  messages: ReadonlyArray<AgentMessage>,
): Anthropic.Messages.MessageParam[] {
  const result: Anthropic.Messages.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "system") continue;

    if (msg.role === "user") {
      result.push({ role: "user", content: msg.content });
      continue;
    }

    if (msg.role === "assistant") {
      const blocks: Anthropic.Messages.ContentBlockParam[] = [];
      if (msg.content) {
        blocks.push({ type: "text", text: msg.content });
      }
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: JSON.parse(tc.arguments),
          });
        }
      }
      if (blocks.length === 0) {
        blocks.push({ type: "text", text: "" });
      }
      result.push({ role: "assistant", content: blocks });
      continue;
    }

    if (msg.role === "tool") {
      const toolResult: Anthropic.Messages.ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: msg.toolCallId,
        content: msg.content,
      };
      // Merge consecutive tool results into one user message (Anthropic requires alternating roles)
      const prev = result[result.length - 1];
      if (prev && prev.role === "user" && Array.isArray(prev.content)) {
        (prev.content as Anthropic.Messages.ToolResultBlockParam[]).push(toolResult);
      } else {
        result.push({ role: "user", content: [toolResult] });
      }
    }
  }

  return result;
}
