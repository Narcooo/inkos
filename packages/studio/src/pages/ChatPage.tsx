import { useState, useRef, useEffect, useCallback } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import type { SSEMessage } from "../hooks/use-sse";
import { fetchJson } from "../hooks/use-api";
import { cn } from "../lib/utils";
import { ChatMessage } from "../components/chat/ChatMessage";
import { QuickActions } from "../components/chat/QuickActions";
import {
  ArrowUp,
  Loader2,
  BotMessageSquare,
} from "lucide-react";

// ── Types ──

interface Nav {
  toDashboard: () => void;
  toBook: (id: string) => void;
}

interface Message {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly timestamp: number;
}

interface AgentResponse {
  readonly response?: string;
  readonly error?: string | { code?: string; message?: string };
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

// ── Helpers ──

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

// ── Component ──

export function ChatPage({ activeBookId, nav: _nav, theme, t, sse: _sse }: ChatPageProps) {
  const [messages, setMessages] = useState<ReadonlyArray<Message>>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isZh = t("nav.connected") === "已连接";
  const hasBook = Boolean(activeBookId);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

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
        // Session load failed — start with empty state
      });
    return () => { cancelled = true; };
  }, []);

  // Auto-resize textarea
  const adjustTextareaHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [input, adjustTextareaHeight]);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    // In no-book mode, prefix with /new
    const instruction = hasBook ? trimmed : `/new ${trimmed}`;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: trimmed, timestamp: Date.now() }]);
    setLoading(true);

    try {
      const data = await fetchJson<AgentResponse>("/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction, activeBookId }),
      });

      if (data.error) {
        setMessages((prev) => [...prev, {
          role: "assistant",
          content: `\u2717 ${extractErrorMessage(data.error!)}`,
          timestamp: Date.now(),
        }]);
      } else {
        const content = data.response ?? "Acknowledged.";
        setMessages((prev) => [...prev, {
          role: "assistant",
          content,
          timestamp: Date.now(),
        }]);
      }
    } catch (e) {
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: `\u2717 ${e instanceof Error ? e.message : String(e)}`,
        timestamp: Date.now(),
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = () => {
    void sendMessage(input);
  };

  const handleQuickAction = (command: string) => {
    void sendMessage(command);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const emptyGuidance = isZh
    ? "告诉我你想写什么——题材、世界观、主角、核心冲突"
    : "Tell me what you want to write — genre, world, protagonist, core conflict";

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
          <div
            className={cn(
              "flex items-end gap-2 rounded-xl bg-secondary/30 border border-border/40 px-3 py-2",
              "focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 transition-all",
            )}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isZh ? "输入指令..." : "Enter command..."}
              disabled={loading}
              rows={1}
              className="flex-1 bg-transparent text-sm leading-6 placeholder:text-muted-foreground/50 outline-none ring-0 shadow-none resize-none disabled:opacity-50 max-h-[200px]"
              style={{ outline: "none", boxShadow: "none" }}
            />
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || loading}
              className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shrink-0 hover:scale-105 active:scale-95 transition-all disabled:opacity-20 disabled:scale-100 shadow-sm shadow-primary/20"
            >
              {loading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ArrowUp size={14} strokeWidth={2.5} />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
