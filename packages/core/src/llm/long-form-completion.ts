import {
  PartialResponseError,
  type LLMMessage,
  type LLMResponse,
} from "./provider.js";

export interface LongFormCompletionOptions {
  readonly messages: ReadonlyArray<LLMMessage>;
  readonly generate: (messages: ReadonlyArray<LLMMessage>) => Promise<LLMResponse>;
  readonly language?: "zh" | "en";
  readonly maxContinuations?: number;
  readonly onContinuation?: (pass: number) => void;
  readonly recoverAfterContinuation?: (fragments: string) => Promise<string>;
}

/**
 * Resume only a transport-confirmed output-limit response. Network interruption
 * remains a hard failure, and no partial document is ever returned as success.
 */
export async function completeLongForm(
  options: LongFormCompletionOptions,
): Promise<LLMResponse> {
  const maxContinuations = options.maxContinuations ?? 3;
  let accumulated = "";
  let messages = options.messages;

  for (let pass = 0; ; pass += 1) {
    try {
      const response = await options.generate(messages);
      const merged = mergeExactContinuation(accumulated, response.content);
      const content = pass > 0 && options.recoverAfterContinuation
        ? await options.recoverAfterContinuation(merged)
        : merged;
      return {
        ...response,
        content,
      };
    } catch (error) {
      if (
        !(error instanceof PartialResponseError)
        || error.reason !== "output-limit"
        || pass >= maxContinuations
      ) {
        throw error;
      }

      accumulated = mergeExactContinuation(accumulated, error.partialContent);
      if (!accumulated.trim()) throw error;
      options.onContinuation?.(pass + 1);
      messages = [
        ...options.messages,
        { role: "assistant", content: accumulated },
        {
          role: "user",
          content: continuationInstruction(options.language ?? "zh"),
        },
      ];
    }
  }
}

export function mergeExactContinuation(prefix: string, continuation: string): string {
  if (!prefix) return continuation;
  if (!continuation) return prefix;

  const maxOverlap = Math.min(prefix.length, continuation.length, 4096);
  for (let size = maxOverlap; size > 0; size -= 1) {
    if (prefix.endsWith(continuation.slice(0, size))) {
      return `${prefix}${continuation.slice(size)}`;
    }
  }
  const separator = prefix.endsWith("\n") || continuation.startsWith("\n") ? "" : "\n";
  return `${prefix}${separator}${continuation}`;
}

function continuationInstruction(language: "zh" | "en"): string {
  return language === "en"
    ? "Continue the same Markdown document exactly where the previous output stopped. Do not restart, summarize, repeat completed sections, or explain. Output only the missing continuation and finish the document."
    : "从上一段停止处继续完成同一份 Markdown 文档。不要重写开头、不要概括、不要重复已完成小节、不要解释过程；只输出缺失的后续内容，并把文档写完整。";
}
