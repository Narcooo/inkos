import { useEffect, useMemo, useState } from "react";
import type { BookCreationDraft } from "@actalk/inkos-core";
import { fetchJson, useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";

interface Nav {
  toDashboard: () => void;
  toBook: (id: string) => void;
}

interface GenreInfo {
  readonly id: string;
  readonly name: string;
  readonly source: "project" | "builtin";
  readonly language: "zh" | "en";
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

interface InteractionSessionResponse {
  readonly session?: {
    readonly activeBookId?: string;
    readonly creationDraft?: BookCreationDraft;
  };
  readonly activeBookId?: string;
}

interface AgentResponse {
  readonly response?: string;
  readonly error?: string;
  readonly session?: {
    readonly activeBookId?: string;
    readonly creationDraft?: BookCreationDraft;
  };
}

interface PlatformCopy {
  readonly idleTitle: string;
  readonly idleBody: string;
  readonly promptLabel: string;
  readonly promptPlaceholder: string;
  readonly promptPlaceholderFollowup: string;
  readonly submit: string;
  readonly submitting: string;
  readonly create: string;
  readonly creating: string;
  readonly discard: string;
  readonly draftHeading: string;
  readonly missingHeading: string;
  readonly missingHint: string;
  readonly syncedHint: string;
  readonly helperTitle: string;
  readonly helperBody: string;
}

const PLATFORMS_ZH: ReadonlyArray<PlatformOption> = [
  { value: "tomato", label: "番茄小说" },
  { value: "qidian", label: "起点中文网" },
  { value: "feilu", label: "飞卢" },
  { value: "other", label: "其他" },
];

const PLATFORMS_EN: ReadonlyArray<PlatformOption> = [
  { value: "royal-road", label: "Royal Road" },
  { value: "kindle-unlimited", label: "Kindle Unlimited" },
  { value: "scribble-hub", label: "Scribble Hub" },
  { value: "other", label: "Other" },
];

const PAGE_COPY: Record<"zh" | "en", PlatformCopy> = {
  zh: {
    idleTitle: "从一句模糊想法开始",
    idleBody: "直接描述题材、世界观、主角、核心冲突，或告诉我你想先改哪一块。共享草案会在 TUI 和 Studio Chat 之间同步。",
    promptLabel: "继续打磨这本书",
    promptPlaceholder: "例如：我想写个港风商战悬疑，主角先做灰产再洗白。",
    promptPlaceholderFollowup: "例如：世界观改成近未来港口城；女主不要太早出场；卷一先查账再砸场。",
    submit: "更新草案",
    submitting: "处理中…",
    create: "按当前草案建书",
    creating: "创建中…",
    discard: "丢弃草案",
    draftHeading: "当前 foundation 草案",
    missingHeading: "还缺这些关键信息",
    missingHint: "这些字段未必都要一次填满，但缺得太多时不要急着建书。",
    syncedHint: "这份草案和 TUI / Studio Chat 共享。",
    helperTitle: "建议这样推进",
    helperBody: "先定世界观和主角，再定核心冲突、简介和卷一方向。想看当前草案时，可以在 TUI 里用 /draft。",
  },
  en: {
    idleTitle: "Start from a rough idea",
    idleBody: "Describe the genre, world, protagonist, and core conflict. The shared draft stays in sync across TUI and Studio Chat.",
    promptLabel: "Refine this book",
    promptPlaceholder: "Example: I want a harbor-noir business thriller about a fixer trying to go legit.",
    promptPlaceholderFollowup: "Example: move the world to a near-future port city; delay the heroine; make volume one about chasing ledgers first.",
    submit: "Update draft",
    submitting: "Working…",
    create: "Create book from draft",
    creating: "Creating…",
    discard: "Discard draft",
    draftHeading: "Current foundation draft",
    missingHeading: "Still missing",
    missingHint: "You do not need every field immediately, but do not create the book while the foundation is still vague.",
    syncedHint: "This draft is shared with TUI and Studio Chat.",
    helperTitle: "Recommended flow",
    helperBody: "Lock the world and protagonist first, then settle the conflict, blurb, and volume-one direction. In TUI, use /draft to inspect the same draft.",
  },
};

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
        draft.title ? { key: "title", label: "书名", value: draft.title } : undefined,
        draft.worldPremise ? { key: "worldPremise", label: "世界观", value: draft.worldPremise } : undefined,
        draft.protagonist ? { key: "protagonist", label: "主角", value: draft.protagonist } : undefined,
        draft.conflictCore ? { key: "conflictCore", label: "核心冲突", value: draft.conflictCore } : undefined,
        draft.volumeOutline ? { key: "volumeOutline", label: "卷纲方向", value: draft.volumeOutline } : undefined,
        draft.blurb ? { key: "blurb", label: "简介", value: draft.blurb } : undefined,
        draft.nextQuestion ? { key: "nextQuestion", label: "下一步", value: draft.nextQuestion } : undefined,
      ];

  return rows.filter((row): row is DraftSummaryRow => Boolean(row));
}

interface WaitForBookReadyOptions {
  readonly fetchBook?: (bookId: string) => Promise<unknown>;
  readonly fetchStatus?: (bookId: string) => Promise<{ status: string; error?: string }>;
  readonly maxAttempts?: number;
  readonly delayMs?: number;
  readonly waitImpl?: (ms: number) => Promise<void>;
}

const DEFAULT_BOOK_READY_MAX_ATTEMPTS = 120;
const DEFAULT_BOOK_READY_DELAY_MS = 250;
const CREATION_DRAFT_SYNC_INTERVAL_MS = 2500;

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

export function BookCreate({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data: project } = useApi<{ language: string }>("/project");
  const projectLang = (project?.language ?? "zh") as "zh" | "en";
  const copy = PAGE_COPY[projectLang];

  const [draft, setDraft] = useState<BookCreationDraft | undefined>();
  const [input, setInput] = useState("");
  const [loadingDraft, setLoadingDraft] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const summaryRows = useMemo(
    () => (draft ? buildCreationDraftSummary(draft, projectLang) : []),
    [draft, projectLang],
  );

  const refreshDraft = async (): Promise<BookCreationDraft | undefined> => {
    const data = await fetchJson<InteractionSessionResponse>("/interaction/session");
    const nextDraft = data.session?.creationDraft;
    setDraft(nextDraft);
    return nextDraft;
  };

  useEffect(() => {
    let cancelled = false;
    setLoadingDraft(true);
    void refreshDraft()
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDraft(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (submitting || creating) {
      return;
    }

    const timer = setInterval(() => {
      void refreshDraft().catch(() => undefined);
    }, CREATION_DRAFT_SYNC_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [submitting, creating]);

  const runAgentInstruction = async (instruction: string): Promise<AgentResponse> => {
    return fetchJson<AgentResponse>("/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction }),
    });
  };

  const handleDraftSubmit = async () => {
    const instruction = resolveDraftInstruction(input, Boolean(draft));
    if (!instruction) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const data = await runAgentInstruction(instruction);
      setInput("");
      setStatus(data.response ?? null);
      setDraft(data.session?.creationDraft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreate = async () => {
    if (!canCreateFromDraft(draft)) {
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const data = await runAgentInstruction("/create");
      const bookId = data.session?.activeBookId;
      if (!bookId) {
        throw new Error(projectLang === "zh" ? "创建完成后没有返回书籍 ID。" : "Create succeeded but no book id was returned.");
      }
      setStatus(data.response ?? null);
      setDraft(undefined);
      await waitForBookReady(bookId);
      nav.toBook(bookId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreating(false);
    }
  };

  const handleDiscard = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const data = await runAgentInstruction("/discard");
      setStatus(data.response ?? null);
      setDraft(undefined);
      setInput("");
      await refreshDraft().catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.books")}</button>
        <span className="text-border">/</span>
        <span>{t("bread.newBook")}</span>
      </div>

      <div className="space-y-3">
        <h1 className="font-serif text-3xl">{t("create.title")}</h1>
        <p className="text-sm text-muted-foreground leading-7">{copy.idleBody}</p>
      </div>

      {error && (
        <div className={`border ${c.error} rounded-md px-4 py-3`}>
          {error}
        </div>
      )}

      {status && (
        <div className="border border-primary/20 bg-primary/5 rounded-md px-4 py-3 text-sm text-primary">
          {status}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="space-y-4">
          <div className="rounded-2xl border border-border/60 bg-card/70 p-5 space-y-4">
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">
                {copy.draftHeading}
              </div>
              <div className="text-xs text-muted-foreground">
                {copy.syncedHint}
              </div>
            </div>

            {loadingDraft ? (
              <div className="text-sm text-muted-foreground">{projectLang === "zh" ? "读取共享草案中…" : "Loading shared draft…"}</div>
            ) : draft ? (
              <div className="space-y-4">
                {summaryRows.length > 0 ? (
                  <div className="space-y-3">
                    {summaryRows.map((row) => (
                      <div key={row.key} className="rounded-xl border border-border/50 bg-background/70 px-4 py-3">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">{row.label}</div>
                        <div className="mt-1 text-sm leading-7 whitespace-pre-wrap">{row.value}</div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {draft.missingFields.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-foreground">{copy.missingHeading}</div>
                    <div className="flex flex-wrap gap-2">
                      {draft.missingFields.map((field) => (
                        <span
                          key={field}
                          className="rounded-full border border-border/70 bg-secondary/50 px-3 py-1 text-xs text-muted-foreground"
                        >
                          {field}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">{copy.missingHint}</p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border/70 bg-background/50 px-5 py-6">
                <div className="font-medium">{copy.idleTitle}</div>
                <p className="mt-2 text-sm text-muted-foreground leading-7">
                  {copy.helperBody}
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-2xl border border-border/60 bg-card/70 p-5 space-y-4">
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">
                {copy.promptLabel}
              </div>
              <div className="text-xs text-muted-foreground">
                {copy.helperTitle}
              </div>
            </div>

            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              rows={10}
              className={`w-full ${c.input} rounded-xl px-4 py-3 focus:outline-none text-sm leading-7 resize-y`}
              placeholder={draft ? copy.promptPlaceholderFollowup : copy.promptPlaceholder}
            />

            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleDraftSubmit}
                disabled={submitting || creating || !input.trim()}
                className={`px-4 py-3 ${c.btnPrimary} rounded-md disabled:opacity-50 font-medium text-sm`}
              >
                {submitting ? copy.submitting : copy.submit}
              </button>
              <button
                onClick={handleCreate}
                disabled={!canCreateFromDraft(draft) || creating || submitting}
                className={`px-4 py-3 rounded-md border border-border bg-secondary text-secondary-foreground disabled:opacity-50 font-medium text-sm`}
              >
                {creating ? copy.creating : copy.create}
              </button>
              <button
                onClick={handleDiscard}
                disabled={!draft || submitting || creating}
                className="px-4 py-3 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 disabled:opacity-50 font-medium text-sm"
              >
                {copy.discard}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
