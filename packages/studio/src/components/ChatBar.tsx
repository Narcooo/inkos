import { useState, useRef, useEffect, useMemo } from "react";
import type { TFunction } from "../hooks/use-i18n";
import type { SSEMessage } from "../hooks/use-sse";
import { cn } from "../lib/utils";
import { fetchJson, postApi } from "../hooks/use-api";
import {
  // Panel controls
  Sparkles,
  Trash2,
  PanelRightClose,
  ArrowUp,
  Loader2,
  MessageSquare,
  Lightbulb,
  // Message avatars
  User,
  CheckCircle2,
  XCircle,
  BotMessageSquare,
  // Message content badges
  BadgeCheck,
  CircleAlert,
  // Status phase icons
  Brain,
  PenTool,
  Shield,
  Wrench,
  AlertTriangle,
  // Quick command chips
  Zap,
  Search,
  FileOutput,
  TrendingUp,
} from "lucide-react";

// ── Types ──

interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly timestamp: number;
}

interface BookRef {
  readonly id: string;
}

export function resolveDirectWriteTarget(
  activeBookId: string | undefined,
  books: ReadonlyArray<BookRef>,
): { bookId: string | null; reason: "active" | "single" | "missing" | "ambiguous" } {
  if (activeBookId && books.some((book) => book.id === activeBookId)) {
    return { bookId: activeBookId, reason: "active" };
  }
  if (books.length === 1) {
    return { bookId: books[0]!.id, reason: "single" };
  }
  if (books.length === 0) {
    return { bookId: null, reason: "missing" };
  }
  return { bookId: null, reason: "ambiguous" };
}

// ── Sub-components ──

function StatusIcon({ phase }: { readonly phase: string }) {
  const lower = phase.toLowerCase();

  if (lower.includes("think") || lower.includes("plan"))
    return <Brain size={14} className="text-purple-500 animate-pulse" />;
  if (lower.includes("writ") || lower.includes("draft") || lower.includes("stream"))
    return <PenTool size={14} className="text-blue-500 chat-icon-write" />;
  if (lower.includes("audit") || lower.includes("review"))
    return <Shield size={14} className="text-amber-500 animate-pulse" />;
  if (lower.includes("revis") || lower.includes("fix") || lower.includes("spot"))
    return <Wrench size={14} className="text-orange-500 chat-icon-spin-slow" />;
  if (lower.includes("complet") || lower.includes("done") || lower.includes("success"))
    return <CheckCircle2 size={14} className="text-emerald-500 chat-icon-pop" />;
  if (lower.includes("error") || lower.includes("fail"))
    return <AlertTriangle size={14} className="text-destructive animate-pulse" />;
  return <Loader2 size={14} className="text-primary animate-spin" />;
}

function EmptyState() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center opacity-40 select-none fade-in">
      <div className="w-14 h-14 rounded-2xl border border-dashed border-border flex items-center justify-center mb-4 bg-secondary/30">
        <BotMessageSquare size={24} className="text-muted-foreground" />
      </div>
      <p className="text-sm italic font-serif mb-1">How shall we proceed today?</p>
      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-widest">Type a command below</p>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex gap-2.5 chat-msg-assistant">
      <div className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center shrink-0 chat-thinking-glow">
        <Brain size={14} className="text-primary animate-pulse" />
      </div>
      <div className="bg-card border border-border/50 px-3.5 py-2.5 rounded-2xl rounded-tl-sm flex gap-1.5 items-center">
        <span className="w-1.5 h-1.5 bg-primary/50 rounded-full chat-typing-dot" />
        <span className="w-1.5 h-1.5 bg-primary/50 rounded-full chat-typing-dot" />
        <span className="w-1.5 h-1.5 bg-primary/50 rounded-full chat-typing-dot" />
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { readonly msg: ChatMessage }) {
  const isUser = msg.role === "user";
  const isStatus = msg.content.startsWith("⋯");
  const isSuccess = msg.content.startsWith("✓");
  const isError = msg.content.startsWith("✗");

  return (
    <div className={cn(
      "flex gap-2.5",
      isUser ? "flex-row-reverse chat-msg-user" : "chat-msg-assistant",
    )}>
      {/* Avatar */}
      <div className={cn(
        "w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 transition-colors",
        isUser ? "bg-primary/10" : "bg-secondary",
      )}>
        {isUser ? (
          <User size={14} className="text-primary" />
        ) : isSuccess ? (
          <CheckCircle2 size={14} className="text-emerald-500 chat-icon-pop" />
        ) : isError ? (
          <XCircle size={14} className="text-destructive" />
        ) : isStatus ? (
          <Loader2 size={14} className="text-primary animate-spin" />
        ) : (
          <Sparkles size={14} className="text-primary" />
        )}
      </div>

      {/* Bubble */}
      <div className={cn(
        "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm",
        isUser
          ? "bg-primary text-primary-foreground font-medium rounded-tr-sm"
          : isStatus
            ? "bg-secondary/50 border border-border/30 text-muted-foreground font-mono text-xs rounded-tl-sm"
            : "bg-card border border-border/50 text-foreground font-serif rounded-tl-sm",
      )}>
        {/* Status badge */}
        {isSuccess && (
          <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-sans font-medium text-[10px] mb-1 uppercase tracking-wider">
            <BadgeCheck size={11} />
            Complete
          </span>
        )}
        {isError && (
          <span className="flex items-center gap-1.5 text-destructive font-sans font-medium text-[10px] mb-1 uppercase tracking-wider">
            <CircleAlert size={11} />
            Error
          </span>
        )}

        <div>{msg.content}</div>

        {/* Timestamp */}
        <div className={cn(
          "text-[9px] mt-1.5 font-mono",
          isUser ? "text-primary-foreground/40" : "text-muted-foreground/40",
        )}>
          {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
    </div>
  );
}

function QuickChip({ icon, label, onClick }: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-secondary/50 border border-border/30 text-[10px] font-medium text-muted-foreground hover:text-primary hover:border-primary/30 hover:bg-primary/5 transition-all group"
    >
      <span className="group-hover:scale-110 transition-transform">{icon}</span>
      {label}
    </button>
  );
}

// ── Main Component ──

export function ChatPanel({ open, onClose, t, sse, activeBookId }: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly t: TFunction;
  readonly sse: { messages: ReadonlyArray<SSEMessage>; connected: boolean };
  readonly activeBookId?: string;
}) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ReadonlyArray<ChatMessage>>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, sse.messages.length]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [open]);

  // SSE events → assistant messages
  useEffect(() => {
    const recent = sse.messages.slice(-1)[0];
    if (!recent || recent.event === "ping") return;

    const d = recent.data as Record<string, unknown>;

    if (recent.event === "write:complete" || recent.event === "draft:complete") {
      setLoading(false);
      const title = d.title ?? `Chapter ${d.chapterNumber}`;
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: `✓ ${title} (${(d.wordCount as number)?.toLocaleString() ?? "?"} chars)`,
        timestamp: Date.now(),
      }]);
    }
    if (recent.event === "write:error" || recent.event === "draft:error") {
      setLoading(false);
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: `✗ ${d.error ?? "Unknown error"}`,
        timestamp: Date.now(),
      }]);
    }
    if (recent.event === "log" && loading) {
      const msg = d.message as string;
      if (msg && (msg.includes("Phase") || msg.includes("streaming") || msg.includes("Writing") || msg.includes("Audit") || msg.includes("Revis"))) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last.content.startsWith("⋯")) {
            return [...prev.slice(0, -1), { role: "assistant", content: `⋯ ${msg}`, timestamp: Date.now() }];
          }
          return [...prev, { role: "assistant", content: `⋯ ${msg}`, timestamp: Date.now() }];
        });
      }
    }
  }, [sse.messages.length]);

  // Current phase for status bar
  const currentPhase = useMemo(() => {
    const lastStatus = [...messages].reverse().find((m) => m.role === "assistant" && m.content.startsWith("⋯"));
    return lastStatus?.content.replace("⋯ ", "") ?? "Initializing...";
  }, [messages]);

  const handleSubmit = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text, timestamp: Date.now() }]);
    setLoading(true);

    const lower = text.toLowerCase();

    try {
      if (lower.match(/^(写下一章|write next)/)) {
        const { books } = await fetchJson<{ books: ReadonlyArray<BookRef> }>("/books");
        const target = resolveDirectWriteTarget(activeBookId, books);

        if (target.bookId) {
          setMessages((prev) => [...prev, {
            role: "assistant",
            content: isZh ? `⋯ 开始处理《${target.bookId}》...` : `⋯ Starting ${target.bookId}...`,
            timestamp: Date.now(),
          }]);
          await postApi(`/books/${target.bookId}/write-next`, {});
          return;
        }

        setLoading(false);
        setMessages((prev) => [...prev, {
          role: "assistant",
          content:
            target.reason === "missing"
              ? (isZh ? "✗ 还没有书，先创建一本再写。" : "✗ No books yet. Create one first.")
              : (isZh ? "✗ 当前有多本书，请先打开目标书籍后再执行“写下一章”。" : '✗ Multiple books found. Open the target book first, then run "write next".'),
          timestamp: Date.now(),
        }]);
        return;
      }

      const data = await fetchJson<{ response?: string; error?: string }>("/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: text }),
      });
      setLoading(false);
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: data.response ?? data.error ?? "Acknowledged.",
        timestamp: Date.now(),
      }]);
    } catch (e) {
      setLoading(false);
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: `✗ ${e instanceof Error ? e.message : String(e)}`,
        timestamp: Date.now(),
      }]);
    }
  };

  const handleQuickCommand = async (command: string) => {
    if (loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: command, timestamp: Date.now() }]);
    setLoading(true);

    const lower = command.toLowerCase();
    try {
      if (lower.match(/^(写下一章|write next)/)) {
        const { books } = await fetchJson<{ books: ReadonlyArray<BookRef> }>("/books");
        const target = resolveDirectWriteTarget(activeBookId, books);

        if (target.bookId) {
          setMessages((prev) => [...prev, {
            role: "assistant",
            content: isZh ? `⋯ 开始处理《${target.bookId}》...` : `⋯ Starting ${target.bookId}...`,
            timestamp: Date.now(),
          }]);
          await postApi(`/books/${target.bookId}/write-next`, {});
          return;
        }

        setLoading(false);
        setMessages((prev) => [...prev, {
          role: "assistant",
          content:
            target.reason === "missing"
              ? (isZh ? "✗ 还没有书，先创建一本再写。" : "✗ No books yet. Create one first.")
              : (isZh ? "✗ 当前有多本书，请先打开目标书籍后再执行\u201C写下一章\u201D。" : '✗ Multiple books found. Open the target book first, then run "write next".'),
          timestamp: Date.now(),
        }]);
        return;
      }

      const data = await fetchJson<{ response?: string; error?: string }>("/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: command }),
      });
      setLoading(false);
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: data.response ?? data.error ?? "Acknowledged.",
        timestamp: Date.now(),
      }]);
    } catch (e) {
      setLoading(false);
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: `✗ ${e instanceof Error ? e.message : String(e)}`,
        timestamp: Date.now(),
      }]);
    }
  };

  const isZh = t("nav.connected") === "已连接";

  // Rotating tips
  const TIPS_ZH = [
    "写下一章", "审计第5章", "帮我创建一本都市修仙小说",
    "扫描市场趋势", "导出全书为 epub", "分析文风 → 导入到我的书",
    "导入已有章节续写", "创建一个玄幻题材的同人", "修订第5章，spot-fix",
  ];
  const TIPS_EN = [
    "write next chapter", "audit chapter 5", "create a LitRPG novel",
    "scan market trends", "export book as epub", "analyze style → import",
    "import chapters to continue", "create a progression fantasy fanfic", "revise chapter 5, spot-fix",
  ];
  const tips = isZh ? TIPS_ZH : TIPS_EN;
  const [tipIndex, setTipIndex] = useState(() => Math.floor(Math.random() * tips.length));

  useEffect(() => {
    if (input) return;
    const timer = setInterval(() => setTipIndex((i) => (i + 1) % tips.length), 8000);
    return () => clearInterval(timer);
  }, [input, tips.length]);

  return (
    <aside
      className={cn(
        "h-full flex flex-col border-l border-border/40 bg-background/80 backdrop-blur-md chat-panel-enter shrink-0 overflow-hidden",
        open ? "w-[380px] opacity-100" : "w-0 opacity-0",
      )}
    >
      {open && (
        <>
          {/* ── Section 1: Header ── */}
          <div className="h-12 shrink-0 px-4 flex items-center justify-between border-b border-border/40">
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <Sparkles size={15} className="text-primary chat-icon-glow" />
                {loading && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-primary rounded-full animate-ping" />
                )}
              </div>
              <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground">
                InkOS Assistant
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setMessages([])}
                className="p-1.5 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors group"
                title="Clear conversation"
              >
                <Trash2 size={14} className="group-hover:animate-[shake_0.3s_ease-in-out]" />
              </button>
              <button
                onClick={onClose}
                className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary transition-colors group"
                title="Close panel"
              >
                <PanelRightClose size={14} className="group-hover:translate-x-0.5 transition-transform" />
              </button>
            </div>
          </div>

          {/* ── Section 2: Status Bar (when loading) ── */}
          {loading && (
            <div className="shrink-0 px-4 py-2 border-b border-border/30 bg-primary/[0.03] fade-in">
              <div className="flex items-center gap-2.5">
                <StatusIcon phase={currentPhase} />
                <span className="text-xs font-medium text-primary truncate flex-1">
                  {currentPhase}
                </span>
                <div className="flex gap-1">
                  <span className="w-1 h-1 bg-primary/40 rounded-full chat-typing-dot" />
                  <span className="w-1 h-1 bg-primary/40 rounded-full chat-typing-dot" />
                  <span className="w-1 h-1 bg-primary/40 rounded-full chat-typing-dot" />
                </div>
              </div>
            </div>
          )}

          {/* ── Section 3: Messages ── */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
          >
            {messages.length === 0 && !loading && <EmptyState />}

            {messages.map((msg, i) => (
              <MessageBubble key={`${msg.timestamp}-${i}`} msg={msg} />
            ))}

            {loading && !messages.some((m) => m.content.startsWith("⋯")) && (
              <ThinkingBubble />
            )}
          </div>

          {/* ── Section 4: Quick Commands ── */}
          <div className="shrink-0 px-3 py-2 border-t border-border/30 flex gap-1.5 overflow-x-auto">
            <QuickChip
              icon={<Zap size={11} />}
              label={t("dash.writeNext")}
              onClick={() => void handleQuickCommand(isZh ? "写下一章" : "write next")}
            />
            <QuickChip
              icon={<Search size={11} />}
              label={t("book.audit")}
              onClick={() => void handleQuickCommand(isZh ? "审计第1章" : "audit chapter 1")}
            />
            <QuickChip
              icon={<FileOutput size={11} />}
              label={t("book.export")}
              onClick={() => void handleQuickCommand(isZh ? "导出全书" : "export book as epub")}
            />
            <QuickChip
              icon={<TrendingUp size={11} />}
              label={t("nav.radar")}
              onClick={() => void handleQuickCommand(isZh ? "扫描市场趋势" : "scan market trends")}
            />
          </div>

          {/* ── Section 5: Input ── */}
          <div className="shrink-0 p-3 border-t border-border/40">
            <div className="flex items-center gap-2 rounded-xl bg-secondary/30 border border-border/40 px-3 py-1.5 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 transition-all">
              <MessageSquare size={14} className="text-muted-foreground/50 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                placeholder={t("common.enterCommand")}
                disabled={loading}
                className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground/50 outline-none ring-0 shadow-none disabled:opacity-50"
                style={{ outline: "none", boxShadow: "none" }}
              />
              <button
                onClick={handleSubmit}
                disabled={!input.trim() || loading}
                className="w-7 h-7 rounded-lg bg-primary text-primary-foreground flex items-center justify-center hover:scale-105 active:scale-95 transition-all disabled:opacity-20 disabled:scale-100 shadow-sm shadow-primary/20"
              >
                {loading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <ArrowUp size={14} strokeWidth={2.5} />
                )}
              </button>
            </div>

            {/* Rotating tip */}
            {!input && (
              <div className="mt-1.5 px-1 flex items-center gap-1.5">
                <Lightbulb size={10} className="text-muted-foreground/30 shrink-0" />
                <span className="text-[9px] text-muted-foreground/40 truncate fade-in" key={tipIndex}>
                  {tips[tipIndex]}
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
