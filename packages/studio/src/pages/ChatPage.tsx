import { useState, useRef, useEffect, useCallback } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import type { SSEMessage } from "../hooks/use-sse";
import { fetchJson } from "../hooks/use-api";
import { ChatMessage } from "../components/chat/ChatMessage";
import { QuickActions } from "../components/chat/QuickActions";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "../components/ai-elements/prompt-input";
import {
  Loader2,
  BotMessageSquare,
} from "lucide-react";

// -- Types --

interface Nav {
  toDashboard: () => void;
  toBook: (id: string) => void;
}

interface ToolCall {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

interface Message {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly timestamp: number;
  readonly toolCall?: ToolCall;
}

interface AgentResponse {
  readonly response?: string;
  readonly error?: string | { code?: string; message?: string };
  readonly details?: {
    readonly draftRaw?: string;
    readonly toolCall?: { readonly name: string; readonly arguments: Record<string, unknown> };
  };
  readonly session?: {
    readonly activeBookId?: string;
    readonly creationDraft?: unknown;
    readonly messages?: ReadonlyArray<{
      role: "user" | "assistant" | "system";
      content: string;
      timestamp: number;
    }>;
  };
  readonly request?: unknown;
}

interface SessionResponse {
  readonly session?: {
    readonly activeBookId?: string;
    readonly messages?: ReadonlyArray<{
      role: "user" | "assistant" | "system";
      content: string;
      timestamp: number;
    }>;
  };
  readonly activeBookId?: string;
}

export interface ChatPageProps {
  readonly activeBookId?: string;
  readonly nav: Nav;
  readonly theme: Theme;
  readonly t: TFunction;
  readonly sse: { messages: ReadonlyArray<SSEMessage>; connected: boolean };
}

// -- Helpers --

function coerceSessionMessages(
  messages: ReadonlyArray<{ role: "user" | "assistant" | "system"; content: string; timestamp: number }>,
): ReadonlyArray<Message> {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content, timestamp: m.timestamp }));
}

function extractErrorMessage(error: string | { code?: string; message?: string }): string {
  if (typeof error === "string") return error;
  return error.message ?? "Unknown error";
}

// -- Component --

export function ChatPage({ activeBookId, nav, theme, t, sse: _sse }: ChatPageProps) {
  const [messages, setMessages] = useState<ReadonlyArray<Message>>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingBookArgs, setPendingBookArgs] = useState<Record<string, unknown> | null>(null);
  const [bookCreating, setBookCreating] = useState(false);
  const [createProgress, setCreateProgress] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const isZh = t("nav.connected") === "\u5DF2\u8FDE\u63A5";
  const hasBook = Boolean(activeBookId);

  // Auto-scroll on new messages or progress updates
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, createProgress]);

  // Listen for pipeline log events during book creation
  useEffect(() => {
    if (!bookCreating) {
      setCreateProgress("");
      return;
    }
    const es = new EventSource("/api/events");
    es.addEventListener("log", (e: MessageEvent) => {
      try {
        const data = e.data ? JSON.parse(e.data) : null;
        const msg = data?.message as string | undefined;
        if (msg) setCreateProgress(msg);
      } catch { /* ignore */ }
    });
    return () => { es.close(); };
  }, [bookCreating]);

  // Load session messages on mount
  useEffect(() => {
    let cancelled = false;
    void fetchJson<SessionResponse>("/interaction/session")
      .then((data) => {
        if (cancelled) return;
        const sessionMessages = data.session?.messages;
        if (sessionMessages && sessionMessages.length > 0) {
          setMessages((current) => {
            if (current.length > 0) return current;
            return coerceSessionMessages(sessionMessages);
          });
        }
      })
      .catch(() => {
        // Session load failed -- start with empty state
      });
    return () => { cancelled = true; };
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const instruction = hasBook ? trimmed : `/new ${trimmed}`;

    setInput("");
    const ts = Date.now();
    setMessages((prev) => [...prev, { role: "user", content: trimmed, timestamp: ts }]);
    setLoading(true);

    // Open a dedicated EventSource for streaming (bypasses shared 99-msg buffer)
    const streamEs = new EventSource("/api/events");
    const streamTs = ts + 1;
    let streamStarted = false;

    streamEs.addEventListener("draft:delta", (e: MessageEvent) => {
      try {
        const d = e.data ? JSON.parse(e.data) : null;
        if (!d?.text) return;
        if (!streamStarted) {
          // First chunk: add a streaming assistant message
          streamStarted = true;
          setMessages((prev) => [...prev, { role: "assistant", content: d.text, timestamp: streamTs }]);
        } else {
          // Append to the streaming message
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.timestamp === streamTs && last.role === "assistant") {
              return [...prev.slice(0, -1), { ...last, content: last.content + d.text }];
            }
            return prev;
          });
        }
      } catch { /* ignore */ }
    });

    try {
      const data = await fetchJson<AgentResponse>("/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction, activeBookId }),
      });

      streamEs.close();

      // Replace streaming message with final content (draftRaw has ::: directives)
      const finalContent = data.details?.draftRaw || data.response || "Acknowledged.";
      const toolCall = data.details?.toolCall ?? undefined;

      if (data.error) {
        setMessages((prev) => {
          const filtered = streamStarted ? prev.filter((m) => m.timestamp !== streamTs) : prev;
          return [...filtered, {
            role: "assistant" as const,
            content: `\u2717 ${extractErrorMessage(data.error!)}`,
            timestamp: Date.now(),
          }];
        });
      } else {
        setMessages((prev) => {
          const msg: Message = {
            role: "assistant" as const,
            content: finalContent,
            timestamp: Date.now(),
            toolCall,
          };
          if (streamStarted) {
            // Replace the streaming message
            return prev.map((m) => m.timestamp === streamTs ? { ...m, content: finalContent, toolCall } : m);
          }
          return [...prev, msg];
        });

        // Initialize editable form state for create_book tool calls
        if (toolCall?.name === "create_book") {
          setPendingBookArgs({ ...toolCall.arguments });
        }
      }
    } catch (e) {
      streamEs.close();
      setMessages((prev) => {
        const filtered = streamStarted ? prev.filter((m) => m.timestamp !== streamTs) : prev;
        return [...filtered, {
          role: "assistant" as const,
          content: `\u2717 ${e instanceof Error ? e.message : String(e)}`,
          timestamp: Date.now(),
        }];
      });
    } finally {
      setLoading(false);
    }
  }, [loading, hasBook, activeBookId]);

  const handleQuickAction = (command: string) => {
    void sendMessage(command);
  };

  const handleCreateBook = async () => {
    if (!pendingBookArgs) return;
    setBookCreating(true);
    try {
      const data = await fetchJson<AgentResponse>("/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: "/create", activeBookId }),
      });
      const newBookId = data.session?.activeBookId;
      if (newBookId) nav.toBook(newBookId);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant" as const,
          content: `\u2717 ${e instanceof Error ? e.message : String(e)}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setBookCreating(false);
    }
  };

  const handlePromptSubmit = useCallback(({ text }: { text: string }) => {
    void sendMessage(text);
  }, [sendMessage]);

  const emptyGuidance = isZh
    ? "\u544A\u8BC9\u6211\u4F60\u60F3\u5199\u4EC0\u4E48\u2014\u2014\u9898\u6750\u3001\u4E16\u754C\u89C2\u3001\u4E3B\u89D2\u3001\u6838\u5FC3\u51B2\u7A81"
    : "Tell me what you want to write \u2014 genre, world, protagonist, core conflict";

  return (
    <div className="flex flex-col h-full">
      {/* Message scroll area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-6"
      >
        {messages.length === 0 && !loading ? (
          <div className="h-full flex flex-col items-center justify-center text-center select-none">
            <div className="w-14 h-14 rounded-2xl border border-dashed border-border flex items-center justify-center mb-4 bg-secondary/30 opacity-40">
              <BotMessageSquare size={24} className="text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground/70 max-w-md leading-7">
              {emptyGuidance}
            </p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-4">
            {messages.map((msg, i) => (
              <ChatMessage
                key={`${msg.timestamp}-${i}`}
                role={msg.role}
                content={msg.content}
                timestamp={msg.timestamp}
                theme={theme}
                toolCall={msg.toolCall?.name === "create_book" && pendingBookArgs
                  ? { name: msg.toolCall.name, arguments: pendingBookArgs }
                  : msg.toolCall}
                onArgsChange={msg.toolCall?.name === "create_book"
                  ? (args) => setPendingBookArgs(args)
                  : undefined}
                onConfirm={msg.toolCall?.name === "create_book"
                  ? () => void handleCreateBook()
                  : undefined}
                confirming={msg.toolCall?.name === "create_book" ? bookCreating : undefined}
              />
            ))}

            {/* Thinking indicator */}
            {loading && (
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                  <Loader2 size={14} className="text-primary animate-spin" />
                </div>
                <div className="bg-card border border-border/50 px-4 py-2.5 rounded-2xl rounded-tl-sm flex gap-1.5 items-center">
                  <span className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-pulse" />
                  <span className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-pulse [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-pulse [animation-delay:300ms]" />
                </div>
              </div>
            )}

            {/* Book creation progress */}
            {bookCreating && (
              <div className="flex gap-3 items-start">
                <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Loader2 size={14} className="text-primary animate-spin" />
                </div>
                <div className="bg-card border border-border/50 px-4 py-3 rounded-2xl rounded-tl-sm text-sm space-y-1">
                  <div className="font-medium text-foreground">{isZh ? "\u6B63\u5728\u521B\u5EFA\u4E66\u7C4D..." : "Creating book..."}</div>
                  {createProgress && (
                    <div className="text-xs text-muted-foreground font-mono truncate max-w-md">
                      {createProgress}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quick actions (only when a book is active) */}
      {hasBook && (
        <div className="shrink-0 max-w-3xl mx-auto w-full px-4">
          <QuickActions
            onAction={handleQuickAction}
            disabled={loading}
            isZh={isZh}
          />
        </div>
      )}

      {/* Input area */}
      <div className="shrink-0 border-t border-border/40 px-4 py-3">
        <div className="max-w-3xl mx-auto">
          <PromptInput
            onSubmit={handlePromptSubmit}
          >
            <PromptInputTextarea
              placeholder={isZh ? "\u8F93\u5165\u6307\u4EE4..." : "Enter command..."}
              disabled={loading}
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
            />
            <PromptInputFooter>
              <div />
              <PromptInputSubmit
                disabled={!input.trim() || loading}
                status={loading ? "submitted" : "ready"}
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}
