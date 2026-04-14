import { useRef, useEffect, useState } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import type { SSEMessage } from "../hooks/use-sse";
import { useChatStore } from "../store/chat";
import { fetchJson } from "../hooks/use-api";
import {
  PromptInputSelect,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSelectContent,
  PromptInputSelectItem,
} from "../components/ai-elements/prompt-input";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "../components/ai-elements/reasoning";
import { ChatMessage } from "../components/chat/ChatMessage";
import { QuickActions } from "../components/chat/QuickActions";
import {
  Loader2,
  BotMessageSquare,
  ArrowUp,
} from "lucide-react";
import { Shimmer } from "../components/ai-elements/shimmer";
import {
  Message,
  MessageContent,
} from "../components/ai-elements/message";

// -- Types --

interface Nav {
  toDashboard: () => void;
  toBook: (id: string) => void;
  toServices: () => void;
}

export interface ChatPageProps {
  readonly activeBookId?: string;
  readonly nav: Nav;
  readonly theme: Theme;
  readonly t: TFunction;
  readonly sse: { messages: ReadonlyArray<SSEMessage>; connected: boolean };
}

// -- Component --

export function ChatPage({ activeBookId, nav, theme, t, sse: _sse }: ChatPageProps) {
  // -- Store selectors --
  const messages = useChatStore((s) => s.messages);
  const input = useChatStore((s) => s.input);
  const loading = useChatStore((s) => s.loading);
  const pendingBookArgs = useChatStore((s) => s.pendingBookArgs);
  const bookCreating = useChatStore((s) => s.bookCreating);
  const createProgress = useChatStore((s) => s.createProgress);
  const selectedModel = useChatStore((s) => s.selectedModel);
  const selectedService = useChatStore((s) => s.selectedService);
  const thinkingText = useChatStore((s) => s.thinkingText);
  const thinkingStreaming = useChatStore((s) => s.thinkingStreaming);

  // -- Store actions --
  const setInput = useChatStore((s) => s.setInput);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const setPendingBookArgs = useChatStore((s) => s.setPendingBookArgs);
  const handleCreateBook = useChatStore((s) => s.handleCreateBook);
  const setCreateProgress = useChatStore((s) => s.setCreateProgress);
  const setSelectedModel = useChatStore((s) => s.setSelectedModel);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isZh = t("nav.connected") === "\u5DF2\u8FDE\u63A5";
  const hasBook = Boolean(activeBookId);

  // -- Available models grouped by service --
  const [availableModels, setAvailableModels] = useState<Array<{
    service: string;
    label: string;
    models: Array<{ id: string; name?: string }>;
  }>>([]);

  useEffect(() => {
    void fetchJson<{ services: Array<{ service: string; label: string; connected: boolean }> }>("/services")
      .then(async (data) => {
        const connected = data.services.filter((s) => s.connected);
        const grouped = await Promise.all(
          connected.map(async (svc) => {
            try {
              const res = await fetchJson<{ models: Array<{ id: string; name?: string }> }>(
                `/services/${encodeURIComponent(svc.service)}/models`
              );
              return { service: svc.service, label: svc.label, models: res.models ?? [] };
            } catch {
              return { service: svc.service, label: svc.label, models: [] };
            }
          })
        );
        setAvailableModels(grouped.filter((g) => g.models.length > 0));
      })
      .catch(() => {});
  }, []);

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
    const es = new EventSource("/api/v1/events");
    es.addEventListener("log", (e: MessageEvent) => {
      try {
        const data = e.data ? JSON.parse(e.data) : null;
        const msg = data?.message as string | undefined;
        if (msg) setCreateProgress(msg);
      } catch { /* ignore */ }
    });
    return () => { es.close(); };
  }, [bookCreating, setCreateProgress]);

  // Load session messages on mount or when activeBookId changes
  useEffect(() => {
    useChatStore.getState().loadSession(activeBookId);
  }, [activeBookId]);

  const onSend = (text: string) => {
    void sendMessage(text, activeBookId);
  };

  const onCreateBook = async () => {
    const newBookId = await handleCreateBook(activeBookId);
    if (newBookId) nav.toBook(newBookId);
  };

  const handleQuickAction = (command: string) => {
    void sendMessage(command, activeBookId);
  };

  const emptyGuidance = isZh
    ? "\u544A\u8BC9\u6211\u4F60\u60F3\u5199\u4EC0\u4E48\u2014\u2014\u9898\u6750\u3001\u4E16\u754C\u89C2\u3001\u4E3B\u89D2\u3001\u6838\u5FC3\u51B2\u7A81"
    : "Tell me what you want to write \u2014 genre, world, protagonist, core conflict";

  return (
    <div className="flex flex-col h-full flex-1 min-w-0">
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
                  ? () => void onCreateBook()
                  : undefined}
                confirming={msg.toolCall?.name === "create_book" ? bookCreating : undefined}
              />
            ))}

            {/* Reasoning / Thinking */}
            {(thinkingStreaming || thinkingText) && (
              <div className="max-w-3xl mx-auto">
                <Reasoning isStreaming={thinkingStreaming}>
                  <ReasoningTrigger />
                  <ReasoningContent>{thinkingText}</ReasoningContent>
                </Reasoning>
              </div>
            )}

            {/* Loading indicator (no thinking content) */}
            {loading && !thinkingStreaming && !thinkingText && (
              <Message from="assistant">
                <MessageContent>
                  <Shimmer className="text-sm" duration={1.5}>
                    {isZh ? "思考中..." : "Thinking..."}
                  </Shimmer>
                </MessageContent>
              </Message>
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
          {pendingBookArgs && !loading ? (
            /* create_book tool call pending — show action buttons */
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void onCreateBook()}
                disabled={bookCreating}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                {bookCreating && <Loader2 size={14} className="animate-spin" />}
                {bookCreating ? "创建中…" : "开始写这本书"}
              </button>
              <div className="flex-1 flex items-center gap-2 rounded-xl border border-border/40 bg-secondary/30 px-3 py-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(input); } }}
                  placeholder={isZh ? "或输入修改要求…" : "Or type changes..."}
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
                />
                {input.trim() && (
                  <button
                    type="button"
                    onClick={() => onSend(input)}
                    className="w-7 h-7 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shrink-0 hover:scale-105 active:scale-95 transition-all"
                  >
                    <ArrowUp size={12} strokeWidth={2.5} />
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* Normal input */
            <div className="rounded-xl bg-secondary/30 border border-border/40 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 transition-all">
              <div className="flex items-end gap-2 px-3 py-2">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(input); } }}
                  placeholder={isZh ? "输入指令..." : "Enter command..."}
                  disabled={loading}
                  rows={1}
                  className="flex-1 bg-transparent text-sm leading-6 placeholder:text-muted-foreground/50 outline-none resize-none disabled:opacity-50 max-h-[200px]"
                />
                <button
                  type="button"
                  onClick={() => onSend(input)}
                  disabled={!input.trim() || loading}
                  className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shrink-0 hover:scale-105 active:scale-95 transition-all disabled:opacity-20 disabled:scale-100 shadow-sm shadow-primary/20"
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={14} strokeWidth={2.5} />}
                </button>
              </div>
              {availableModels.length > 0 && (
                <div className="flex items-center gap-2 px-3 pb-2 border-t border-border/20 pt-1.5">
                  <PromptInputSelect
                    value={selectedModel && selectedService ? `${selectedService}:${selectedModel}` : ""}
                    onValueChange={(v) => {
                      const value = String(v);
                      const colonIdx = value.indexOf(":");
                      if (colonIdx > 0) {
                        setSelectedModel(value.slice(colonIdx + 1), value.slice(0, colonIdx));
                      }
                    }}
                  >
                    <PromptInputSelectTrigger className="h-7 text-xs">
                      <PromptInputSelectValue placeholder="选择模型" />
                    </PromptInputSelectTrigger>
                    <PromptInputSelectContent>
                      {availableModels.map((group) =>
                        group.models.map((m) => (
                          <PromptInputSelectItem
                            key={`${group.service}:${m.id}`}
                            value={`${group.service}:${m.id}`}
                          >
                            <span className="text-muted-foreground text-[10px] mr-1">{group.label}</span>
                            {m.name ?? m.id}
                          </PromptInputSelectItem>
                        ))
                      )}
                      <div
                        className="px-2 py-1.5 text-xs text-primary cursor-pointer hover:underline border-t border-border/30"
                        onClick={() => nav.toServices()}
                      >
                        管理服务商 →
                      </div>
                    </PromptInputSelectContent>
                  </PromptInputSelect>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
