import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";
import { streamSimple, getModel, getEnvApiKey } from "@mariozechner/pi-ai";
import type { Model, Api, AssistantMessage, UserMessage } from "@mariozechner/pi-ai";
import type { PipelineRunner } from "../pipeline/runner.js";
import { buildAgentSystemPrompt } from "./agent-system-prompt.js";
import {
  createPatchChapterTextTool,
  createRenameEntityTool,
  createSubAgentTool,
  createReadTool,
  createEditTool,
  createWriteFileTool,
  createGrepTool,
  createLsTool,
  createWriteTruthFileTool,
} from "./agent-tools.js";
import { createBookContextTransform } from "./context-transform.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentSessionConfig {
  /** Unique session identifier (typically the BookSession id). */
  sessionId: string;
  /** Book ID, or null if in "new book" mode. */
  bookId: string | null;
  /** Language for the system prompt. */
  language: string;
  /** PipelineRunner for sub-agent tool delegation. */
  pipeline: PipelineRunner;
  /** Project root directory (books/ lives under this). */
  projectRoot: string;
  /** pi-ai Model to use, or provider+modelId to resolve via getModel. */
  model: Model<Api> | { provider: string; modelId: string };
  /** Optional API key. When omitted, falls back to env-based key lookup. */
  apiKey?: string;
  /** Optional listener for streaming events (for SSE forwarding). */
  onEvent?: (event: AgentEvent) => void;
}

export interface AgentSessionResult {
  /** Extracted text from the final assistant message. */
  responseText: string;
  /** Full conversation history for persistence. */
  messages: Array<{ role: string; content: string; thinking?: string }>;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

// We only record fields that can realistically change between turns on the
// same sessionId and are captured into the Agent at construction time.
// `projectRoot`, `language`, and `pipeline` are also closure-captured by the
// Agent (into systemPrompt / tools / transformContext), but within a single
// server process they're treated as stable — we don't re-check them.
interface CachedAgent {
  agent: Agent;
  bookId: string | null;
  lastActive: number;
}

const agentCache = new Map<string, CachedAgent>();

/** TTL for cached agents: 5 minutes. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Cleanup interval handle (lazy-started). */
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of agentCache) {
      if (now - entry.lastActive > CACHE_TTL_MS) {
        agentCache.delete(id);
      }
    }
    // Stop the timer when nothing left to watch.
    if (agentCache.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }, 60_000); // run every 60 s
  // Allow the process to exit even if this timer is alive.
  if (cleanupTimer && typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveModel(spec: AgentSessionConfig["model"]): Model<Api> {
  if (!spec) {
    throw new Error("Model is required but was undefined. Check LLM configuration.");
  }
  if (typeof spec === "object" && "id" in spec && "api" in spec) {
    // Already a Model object.
    return spec as Model<Api>;
  }
  const { provider, modelId } = spec as { provider: string; modelId: string };
  if (!provider || !modelId) {
    throw new Error(`Invalid model spec: provider=${provider}, modelId=${modelId}`);
  }
  return getModel(provider as any, modelId as any);
}

/**
 * Extract readable text from an AssistantMessage's content array.
 * Filters out tool-call blocks; concatenates text blocks.
 */
function extractTextFromAssistant(msg: AssistantMessage): string {
  return msg.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");
}

/**
 * Extract thinking/reasoning text from an AssistantMessage's content array.
 */
function extractThinkingFromAssistant(msg: AssistantMessage): string {
  return msg.content
    .filter((c: any) => c.type === "thinking")
    .map((c: any) => c.thinking ?? "")
    .join("");
}

/**
 * Convert plain `{ role, content }` messages (from BookSession disk storage)
 * back into pi-agent AgentMessage format so they can be loaded into an Agent.
 */
function plainToAgentMessages(
  plain: Array<{ role: string; content: string }>,
): AgentMessage[] {
  return plain.map((m) => {
    const ts = Date.now();
    if (m.role === "user") {
      return { role: "user", content: m.content, timestamp: ts } satisfies UserMessage;
    }
    // For stored assistant messages we only have the text.
    // Re-wrap as a minimal AssistantMessage with a single TextContent.
    return {
      role: "assistant",
      content: [{ type: "text", text: m.content }],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "unknown",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: ts,
    } satisfies AssistantMessage;
  });
}

/**
 * Flatten the Agent's in-memory messages to plain `{ role, content }` pairs
 * suitable for BookSession persistence.
 */
function agentMessagesToPlain(
  messages: AgentMessage[],
): Array<{ role: string; content: string; thinking?: string }> {
  const out: Array<{ role: string; content: string; thinking?: string }> = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object" || !("role" in msg)) continue;

    const m = msg as { role: string; [k: string]: any };

    if (m.role === "user") {
      const content = typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text)
              .join("")
          : "";
      if (content) out.push({ role: "user", content });
    } else if (m.role === "assistant") {
      const text = extractTextFromAssistant(m as AssistantMessage);
      const thinking = extractThinkingFromAssistant(m as AssistantMessage);
      if (text || thinking) {
        const entry: { role: string; content: string; thinking?: string } = { role: "assistant", content: text };
        if (thinking) entry.thinking = thinking;
        out.push(entry);
      }
    }
    // ToolResult messages are internal; skip them for persistence.
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run a single conversation turn within a cached Agent session.
 *
 * If the session already exists in the cache, reuses the Agent (with its full
 * in-memory message history including tool calls). Otherwise creates a new
 * Agent, optionally restoring messages from `initialMessages`.
 */
export async function runAgentSession(
  config: AgentSessionConfig,
  userMessage: string,
  initialMessages?: Array<{ role: string; content: string }>,
): Promise<AgentSessionResult> {
  const { sessionId, language, pipeline, projectRoot, onEvent } = config;
  // Normalize at the entry point so downstream comparisons, closures, and
  // fs paths never see `undefined`. The type is already `string | null`, but
  // some callers may bypass the type system (e.g. `activeBookId ?? null` gets
  // skipped) and we don't want that to (a) throw in path.join or (b) trigger
  // a spurious cache eviction because `null !== undefined`.
  const bookId: string | null = config.bookId ?? null;

  // ----- Resolve or create Agent -----
  let cached = agentCache.get(sessionId);

  if (cached) {
    // Evict and rebuild if model OR bookId changed. Both are captured into the
    // Agent at construction time (model via initialState, bookId via closures
    // in systemPrompt / tools / transformContext), so a mismatch means the
    // cached Agent would keep using stale context — including reading truth
    // files from the wrong book's story/ directory.
    const currentModelId = (cached.agent.state.model as any)?.id;
    const newModelId = typeof config.model === 'object' && 'id' in config.model
      ? (config.model as any).id
      : undefined;
    const modelChanged = !!(currentModelId && newModelId && currentModelId !== newModelId);
    const bookChanged = cached.bookId !== bookId;

    if (modelChanged || bookChanged) {
      // Preserve conversation messages for re-injection
      const preservedMessages = agentMessagesToPlain(cached.agent.state.messages);
      agentCache.delete(sessionId);
      cached = undefined;
      // Pass preserved messages as initialMessages if none were provided
      if (!initialMessages || initialMessages.length === 0) {
        initialMessages = preservedMessages;
      }
    }
  }

  if (!cached) {
    const model = resolveModel(config.model);
    const agent = new Agent({
      initialState: {
        model,
        systemPrompt: buildAgentSystemPrompt(bookId, language),
        tools: [
          createSubAgentTool(pipeline, bookId, projectRoot),
          createReadTool(projectRoot),
          createWriteTruthFileTool(pipeline, projectRoot, bookId),
          createRenameEntityTool(pipeline, projectRoot, bookId),
          createPatchChapterTextTool(pipeline, projectRoot, bookId),
          createEditTool(projectRoot),
          createWriteFileTool(projectRoot),
          createGrepTool(projectRoot),
          createLsTool(projectRoot),
        ],
      },
      transformContext: createBookContextTransform(bookId, projectRoot),
      streamFn: streamSimple,
      getApiKey: (provider: string) => {
        if (config.apiKey) return config.apiKey;
        return getEnvApiKey(provider);
      },
    });

    // Restore prior conversation if provided.
    if (initialMessages && initialMessages.length > 0) {
      agent.state.messages = plainToAgentMessages(initialMessages);
    }

    cached = { agent, bookId, lastActive: Date.now() };
    agentCache.set(sessionId, cached);
    ensureCleanupTimer();
  }

  cached.lastActive = Date.now();
  const { agent } = cached;

  // ----- Subscribe to events (for SSE streaming to frontend) -----
  let unsubscribe: (() => void) | undefined;
  if (onEvent) {
    unsubscribe = agent.subscribe((event: AgentEvent) => {
      onEvent(event);
    });
  }

  // ----- Execute the turn -----
  try {
    await agent.prompt(userMessage);
  } finally {
    unsubscribe?.();
  }

  // ----- Extract result -----
  const allMessages = agent.state.messages;
  const responseText = extractResponseText(allMessages);
  const plainMessages = agentMessagesToPlain(allMessages);

  return { responseText, messages: plainMessages };
}

/**
 * Walk backward through messages to find the last assistant message and
 * extract its text content.
 */
function extractResponseText(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg && typeof msg === "object" && "role" in msg && (msg as any).role === "assistant") {
      return extractTextFromAssistant(msg as AssistantMessage);
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// Cache management
// ---------------------------------------------------------------------------

/** Manually evict a cached Agent session. */
export function evictAgentCache(sessionId: string): boolean {
  return agentCache.delete(sessionId);
}
