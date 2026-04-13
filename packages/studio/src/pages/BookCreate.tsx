import { useEffect, useRef, useState, useCallback } from "react";
import type { BookCreationDraft, DraftRound } from "@actalk/inkos-core";
import { fetchJson } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import type { SSEMessage } from "../hooks/use-sse";
import { useColors } from "../hooks/use-colors";
import { StreamMessage } from "../components/book-create/StreamMessage";
import { RoundSummary } from "../components/book-create/RoundSummary";
import { DraftReadyBar } from "../components/book-create/DraftReadyBar";
import { ComposerBar } from "../components/book-create/ComposerBar";

// ---------------------------------------------------------------------------
// Exported utilities (kept for tests)
// ---------------------------------------------------------------------------

interface Nav {
  toDashboard: () => void;
  toBook: (id: string) => void;
}

interface PlatformOption {
  readonly value: string;
  readonly label: string;
}

export interface DraftSummaryRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

interface AgentResponse {
  readonly response?: string;
  readonly error?: string;
  readonly session?: {
    readonly activeBookId?: string;
    readonly creationDraft?: BookCreationDraft;
    readonly draftRounds?: DraftRound[];
  };
}

interface InteractionSessionResponse {
  readonly session?: {
    readonly activeBookId?: string;
    readonly creationDraft?: BookCreationDraft;
    readonly draftRounds?: DraftRound[];
  };
  readonly activeBookId?: string;
}

const PLATFORMS_ZH: ReadonlyArray<PlatformOption> = [
  { value: "tomato", label: "\u756A\u8304\u5C0F\u8BF4" },
  { value: "qidian", label: "\u8D77\u70B9\u4E2D\u6587\u7F51" },
  { value: "feilu", label: "\u98DE\u5362" },
  { value: "other", label: "\u5176\u4ED6" },
];

const PLATFORMS_EN: ReadonlyArray<PlatformOption> = [
  { value: "royal-road", label: "Royal Road" },
  { value: "kindle-unlimited", label: "Kindle Unlimited" },
  { value: "scribble-hub", label: "Scribble Hub" },
  { value: "other", label: "Other" },
];

export function pickValidValue(current: string, available: ReadonlyArray<string>): string {
  if (current && available.includes(current)) {
    return current;
  }
  return available[0] ?? "";
}

export function defaultChapterWordsForLanguage(language: "zh" | "en"): string {
  return language === "en" ? "2000" : "3000";
}

export function platformOptionsForLanguage(language: "zh" | "en"): ReadonlyArray<PlatformOption> {
  return language === "en" ? PLATFORMS_EN : PLATFORMS_ZH;
}

export function resolveDraftInstruction(input: string, hasDraft: boolean): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }
  return hasDraft ? trimmed : `/new ${trimmed}`;
}

export function canCreateFromDraft(draft?: BookCreationDraft): boolean {
  if (!draft) {
    return false;
  }
  if (draft.readyToCreate) {
    return true;
  }
  return Boolean(
    draft.title?.trim()
      && draft.genre?.trim()
      && typeof draft.targetChapters === "number"
      && typeof draft.chapterWordCount === "number",
  );
}

export function buildCreationDraftSummary(
  draft: BookCreationDraft,
  language: "zh" | "en",
): ReadonlyArray<DraftSummaryRow> {
  const rows = language === "en"
    ? [
        draft.title ? { key: "title", label: "Title", value: draft.title } : undefined,
        draft.worldPremise ? { key: "worldPremise", label: "World", value: draft.worldPremise } : undefined,
        draft.protagonist ? { key: "protagonist", label: "Protagonist", value: draft.protagonist } : undefined,
        draft.conflictCore ? { key: "conflictCore", label: "Core Conflict", value: draft.conflictCore } : undefined,
        draft.volumeOutline ? { key: "volumeOutline", label: "Volume Direction", value: draft.volumeOutline } : undefined,
        draft.blurb ? { key: "blurb", label: "Blurb", value: draft.blurb } : undefined,
        draft.nextQuestion ? { key: "nextQuestion", label: "Next", value: draft.nextQuestion } : undefined,
      ]
    : [
        draft.title ? { key: "title", label: "\u4E66\u540D", value: draft.title } : undefined,
        draft.worldPremise ? { key: "worldPremise", label: "\u4E16\u754C\u89C2", value: draft.worldPremise } : undefined,
        draft.protagonist ? { key: "protagonist", label: "\u4E3B\u89D2", value: draft.protagonist } : undefined,
        draft.conflictCore ? { key: "conflictCore", label: "\u6838\u5FC3\u51B2\u7A81", value: draft.conflictCore } : undefined,
        draft.volumeOutline ? { key: "volumeOutline", label: "\u5377\u7EB2\u65B9\u5411", value: draft.volumeOutline } : undefined,
        draft.blurb ? { key: "blurb", label: "\u7B80\u4ECB", value: draft.blurb } : undefined,
        draft.nextQuestion ? { key: "nextQuestion", label: "\u4E0B\u4E00\u6B65", value: draft.nextQuestion } : undefined,
      ];

  return rows.filter((row): row is DraftSummaryRow => Boolean(row));
}

// ---------------------------------------------------------------------------
// waitForBookReady
// ---------------------------------------------------------------------------

interface WaitForBookReadyOptions {
  readonly fetchBook?: (bookId: string) => Promise<unknown>;
  readonly fetchStatus?: (bookId: string) => Promise<{ status: string; error?: string }>;
  readonly maxAttempts?: number;
  readonly delayMs?: number;
  readonly waitImpl?: (ms: number) => Promise<void>;
}

const DEFAULT_BOOK_READY_MAX_ATTEMPTS = 120;
const DEFAULT_BOOK_READY_DELAY_MS = 250;

export async function waitForBookReady(
  bookId: string,
  options: WaitForBookReadyOptions = {},
): Promise<void> {
  const fetchBook = options.fetchBook ?? ((id: string) => fetchJson(`/books/${id}`));
  const fetchStatus = options.fetchStatus ?? ((id: string) => fetchJson<{ status: string; error?: string }>(`/books/${id}/create-status`));
  const maxAttempts = options.maxAttempts ?? DEFAULT_BOOK_READY_MAX_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_BOOK_READY_DELAY_MS;
  const waitImpl = options.waitImpl ?? ((ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  }));

  let lastError: unknown;
  let lastKnownStatus: string | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await fetchBook(bookId);
      return;
    } catch (error) {
      lastError = error;
      try {
        const status = await fetchStatus(bookId);
        lastKnownStatus = status.status;
        if (status.status === "error") {
          throw new Error(status.error ?? `Book "${bookId}" failed to create`);
        }
      } catch (statusError) {
        if (statusError instanceof Error && statusError.message !== "404 Not Found") {
          throw statusError;
        }
      }
      if (attempt === maxAttempts - 1) {
        if (lastKnownStatus === "creating") {
          break;
        }
        throw error;
      }
      await waitImpl(delayMs);
    }
  }

  if (lastKnownStatus === "creating") {
    throw new Error(`Book "${bookId}" is still being created. Wait a moment and refresh.`);
  }

  throw lastError instanceof Error ? lastError : new Error(`Book "${bookId}" was not ready`);
}

// ---------------------------------------------------------------------------
// BookCreate component
// ---------------------------------------------------------------------------

export function BookCreate({ nav, theme, t, sse }: {
  nav: Nav;
  theme: Theme;
  t: TFunction;
  sse: { messages: ReadonlyArray<SSEMessage>; connected: boolean };
}) {
  const c = useColors(theme);

  // ---- State ----
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [serverDraft, setServerDraft] = useState<BookCreationDraft | undefined>();
  const [rounds, setRounds] = useState<DraftRound[]>([]);
  const [currentContent, setCurrentContent] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [expandedRound, setExpandedRound] = useState<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll when streaming content changes
  useEffect(() => {
    if (scrollRef.current && streaming) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [currentContent, streaming]);

  // ---- Load existing session on mount ----
  useEffect(() => {
    let cancelled = false;
    void fetchJson<InteractionSessionResponse>("/interaction/session")
      .then((data) => {
        if (cancelled) return;
        setServerDraft(data.session?.creationDraft);
        if (data.session?.draftRounds?.length) {
          setRounds(data.session.draftRounds);
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  // ---- SSE draft:delta listener ----
  const sseProcessedRef = useRef(0);
  useEffect(() => {
    const msgs = sse.messages;
    if (msgs.length <= sseProcessedRef.current) return;

    for (let i = sseProcessedRef.current; i < msgs.length; i++) {
      const msg = msgs[i]!;
      if (msg.event === "draft:delta") {
        const data = msg.data as { text?: string } | null;
        if (data?.text) {
          setCurrentContent((prev) => prev + data.text);
        }
      }
    }
    sseProcessedRef.current = msgs.length;
  }, [sse.messages]);

  // ---- Handlers ----

  const runAgentInstruction = useCallback(async (instruction: string): Promise<AgentResponse> => {
    return fetchJson<AgentResponse>("/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction }),
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    const instruction = resolveDraftInstruction(input, Boolean(serverDraft) || rounds.length > 0);
    if (!instruction) return;

    // Build instruction with user field edits
    const editedFields = Object.entries(draft);
    let fullInstruction = instruction;
    if (editedFields.length > 0) {
      const editsBlock = editedFields
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      fullInstruction = `${instruction}\n\n[field edits]\n${editsBlock}`;
    }

    setStreaming(true);
    setCurrentContent("");
    setError(null);

    try {
      const data = await runAgentInstruction(fullInstruction);
      setInput("");
      setServerDraft(data.session?.creationDraft);

      // Push the completed round into history
      if (data.session?.draftRounds?.length) {
        setRounds(data.session.draftRounds);
      }
      // Reset local draft edits for next round
      setDraft({});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStreaming(false);
    }
  }, [input, draft, serverDraft, rounds.length, runAgentInstruction]);

  const handleCreate = useCallback(async () => {
    if (!canCreateFromDraft(serverDraft)) return;

    setCreating(true);
    setError(null);
    try {
      const data = await runAgentInstruction("/create");
      const bookId = data.session?.activeBookId;
      if (!bookId) {
        throw new Error("\u521B\u5EFA\u5B8C\u6210\u540E\u6CA1\u6709\u8FD4\u56DE\u4E66\u7C4D ID\u3002");
      }
      setServerDraft(undefined);
      await waitForBookReady(bookId);
      nav.toBook(bookId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreating(false);
    }
  }, [serverDraft, runAgentInstruction, nav]);

  const handleDiscard = useCallback(async () => {
    setStreaming(true);
    setError(null);
    try {
      await runAgentInstruction("/discard");
      setServerDraft(undefined);
      setRounds([]);
      setCurrentContent("");
      setDraft({});
      setInput("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStreaming(false);
    }
  }, [runAgentInstruction]);

  const handleFieldChange = useCallback((key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const isReady = canCreateFromDraft(serverDraft);
  const hasDraft = Boolean(serverDraft) || rounds.length > 0;
  const placeholder = hasDraft
    ? "\u4F8B\u5982\uFF1A\u4E16\u754C\u89C2\u6539\u6210\u8FD1\u672A\u6765\u6E2F\u53E3\u57CE\uFF1B\u5973\u4E3B\u4E0D\u8981\u592A\u65E9\u51FA\u573A\uFF1B\u5377\u4E00\u5148\u67E5\u8D26\u518D\u7838\u573A\u3002"
    : "\u4F8B\u5982\uFF1A\u6211\u60F3\u5199\u4E2A\u6E2F\u98CE\u5546\u6218\u60AC\u7591\uFF0C\u4E3B\u89D2\u5148\u505A\u7070\u4EA7\u518D\u6D17\u767D\u3002";

  return (
    <div className="max-w-2xl mx-auto flex flex-col min-h-[calc(100vh-4rem)]">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground pt-6 px-1">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.books")}</button>
        <span className="text-border">/</span>
        <span>{t("bread.newBook")}</span>
      </div>

      {/* Title */}
      <div className="space-y-2 pt-6 pb-4 px-1">
        <h1 className="font-serif text-3xl">{t("create.title")}</h1>
        <p className="text-sm text-muted-foreground leading-7">
          {"\u76F4\u63A5\u63CF\u8FF0\u9898\u6750\u3001\u4E16\u754C\u89C2\u3001\u4E3B\u89D2\u3001\u6838\u5FC3\u51B2\u7A81\uFF0C\u6216\u544A\u8BC9\u6211\u4F60\u60F3\u5148\u6539\u54EA\u4E00\u5757\u3002"}
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className={`border ${c.error} rounded-md px-4 py-3 mx-1 mb-4`}>
          {error}
        </div>
      )}

      {/* Scrollable content area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 px-1 pb-4">
        {/* History rounds */}
        {rounds.map((round) => (
          <RoundSummary
            key={round.roundId}
            round={round}
            expanded={expandedRound === round.roundId}
            onToggle={() => setExpandedRound(
              expandedRound === round.roundId ? null : round.roundId,
            )}
          />
        ))}

        {/* Current AI response with inline forms */}
        {currentContent && (
          <div className="rounded-2xl border border-border/60 bg-card/70 p-5">
            <StreamMessage
              content={currentContent}
              onFieldChange={handleFieldChange}
              fieldValues={draft}
              theme={theme}
            />
          </div>
        )}

        {/* Streaming indicator */}
        {streaming && !currentContent && (
          <div className="flex items-center gap-2 px-1 py-3 text-sm text-muted-foreground">
            <span className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-pulse" />
            <span className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-pulse" style={{ animationDelay: "150ms" }} />
            <span className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-pulse" style={{ animationDelay: "300ms" }} />
          </div>
        )}

        {/* Draft ready bar */}
        {isReady && !streaming && (
          <DraftReadyBar
            onConfirm={handleCreate}
            onContinue={() => {/* focus input - no-op, user just keeps typing */}}
            creating={creating}
            theme={theme}
          />
        )}

        {/* Discard button (only shown if there's an active draft) */}
        {hasDraft && !streaming && !creating && (
          <div className="flex justify-end px-1">
            <button
              type="button"
              onClick={handleDiscard}
              className="text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              {"\u4E22\u5F03\u8349\u6848"}
            </button>
          </div>
        )}
      </div>

      {/* Bottom composer */}
      <ComposerBar
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        disabled={streaming || creating}
        placeholder={placeholder}
        theme={theme}
      />
    </div>
  );
}
