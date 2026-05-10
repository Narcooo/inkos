import { useEffect, useMemo, useState } from "react";
import type { BookCreationDraft } from "@actalk/inkos-core";
import { BookPlus, CheckCircle2, RotateCcw, Sparkles } from "lucide-react";
import { fetchJson, useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import {
  CREATION_DRAFT_SYNC_INTERVAL_MS,
  PAGE_COPY,
  type AgentResponse,
  type BookCreateFormState,
  type InteractionSessionResponse,
  buildBookCreateAgentRequest,
  buildBookCreatePayload,
  buildCreationDraftSummary,
  canCreateFromDraft,
  defaultBookCreateForm,
  defaultChapterWordsForLanguage,
  ensureBookCreateSessionId,
  isBookCreateFormReady,
  platformOptionsForLanguage,
  pickValidValue,
  resolveDraftInstruction,
  waitForBookReady,
} from "./book-create-state";

export {
  buildBookCreateAgentRequest,
  buildBookCreatePayload,
  buildCreationDraftSummary,
  canCreateFromDraft,
  defaultBookCreateForm,
  defaultChapterWordsForLanguage,
  ensureBookCreateSessionId,
  isBookCreateFormReady,
  platformOptionsForLanguage,
  pickValidValue,
  resolveDraftInstruction,
  waitForBookReady,
} from "./book-create-state";

interface Nav {
  toDashboard: () => void;
  toBook: (id: string) => void;
}

export function BookCreate({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data: project } = useApi<{ language: string }>("/project");
  const projectLang = (project?.language ?? "zh") as "zh" | "en";
  const copy = PAGE_COPY[projectLang];
  const platformChoices = platformOptionsForLanguage(projectLang);

  const [draft, setDraft] = useState<BookCreationDraft | undefined>();
  const [form, setForm] = useState<BookCreateFormState>(() => defaultBookCreateForm(projectLang));
  const [input, setInput] = useState("");
  const [loadingDraft, setLoadingDraft] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [bookCreateSessionId, setBookCreateSessionIdState] = useState<string | null>(null);

  const summaryRows = useMemo(
    () => (draft ? buildCreationDraftSummary(draft, projectLang) : []),
    [draft, projectLang],
  );
  const canSubmitForm = isBookCreateFormReady(form);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      platform: pickValidValue(
        current.platform,
        platformOptionsForLanguage(projectLang).map((option) => option.value),
      ),
      chapterWordCount: current.chapterWordCount || defaultChapterWordsForLanguage(projectLang),
      targetChapters: current.targetChapters || "200",
    }));
  }, [projectLang]);

  const updateForm = (patch: Partial<BookCreateFormState>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const applyDraftToForm = () => {
    if (!draft) {
      return;
    }
    const draftBrief = [
      draft.blurb,
      draft.worldPremise,
      draft.protagonist,
      draft.conflictCore,
      draft.volumeOutline,
    ].filter((part): part is string => Boolean(part?.trim())).join("\n\n");
    const platformValues = platformChoices.map((option) => option.value);
    setForm((current) => ({
      title: draft.title?.trim() || current.title,
      genre: draft.genre?.trim() || current.genre,
      platform: pickValidValue(draft.platform ?? current.platform, platformValues),
      targetChapters: draft.targetChapters ? String(draft.targetChapters) : current.targetChapters,
      chapterWordCount: draft.chapterWordCount ? String(draft.chapterWordCount) : current.chapterWordCount,
      brief: draftBrief || current.brief,
    }));
  };

  const refreshDraft = async (): Promise<BookCreationDraft | undefined> => {
    const data = await fetchJson<InteractionSessionResponse>("/interaction/session");
    const nextDraft = data.session?.creationDraft;
    setDraft(nextDraft);
    return nextDraft;
  };

  useEffect(() => {
    let cancelled = false;
    setLoadingDraft(true);
    void Promise.all([
      ensureBookCreateSessionId(),
      refreshDraft(),
    ])
      .then(([sessionId]) => {
        if (!cancelled) {
          setBookCreateSessionIdState(sessionId);
        }
      })
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
    const sessionId = bookCreateSessionId ?? await ensureBookCreateSessionId();
    if (!bookCreateSessionId) {
      setBookCreateSessionIdState(sessionId);
    }
    return fetchJson<AgentResponse>("/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildBookCreateAgentRequest(instruction, sessionId)),
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
      const createdBookId = data.session?.activeBookId;
      if (createdBookId) {
        setStatus(data.response ?? null);
        setDraft(undefined);
        await waitForBookReady(createdBookId);
        nav.toBook(createdBookId);
        return;
      }
      setInput("");
      setStatus(data.response ?? null);
      setDraft(data.session?.creationDraft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const handleFormCreate = async () => {
    if (!canSubmitForm) {
      return;
    }

    setCreating(true);
    setError(null);
    setStatus(copy.creationStatus);
    try {
      const payload = buildBookCreatePayload(form, projectLang);
      const data = await fetchJson<{ status?: string; bookId?: string }>("/books/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!data.bookId) {
        throw new Error(projectLang === "zh" ? "创建请求没有返回书籍 ID。" : "Create request did not return a book id.");
      }
      await waitForBookReady(data.bookId);
      nav.toBook(data.bookId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus(null);
    } finally {
      setCreating(false);
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
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.books")}</button>
        <span className="text-border">/</span>
        <span>{t("bread.newBook")}</span>
      </div>

      <div className="space-y-3">
        <h1 className="font-serif text-4xl">{t("create.title")}</h1>
        <p className="text-sm text-muted-foreground leading-7 max-w-2xl">{copy.idleBody}</p>
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
        <section className="rounded-lg border border-border/60 bg-card/80 p-5 space-y-5">
          <div className="space-y-1">
            <div className="text-[11px] uppercase text-muted-foreground font-bold">
              {copy.formHeading}
            </div>
            <p className="text-xs text-muted-foreground leading-6">{copy.formHint}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">{copy.titleLabel}</span>
              <input
                value={form.title}
                onChange={(event) => updateForm({ title: event.target.value })}
                className={`w-full ${c.input} rounded-md px-3 py-2.5 focus:outline-none text-sm`}
                placeholder={copy.titlePlaceholder}
              />
            </label>
            <label className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">{copy.genreLabel}</span>
              <input
                value={form.genre}
                onChange={(event) => updateForm({ genre: event.target.value })}
                className={`w-full ${c.input} rounded-md px-3 py-2.5 focus:outline-none text-sm`}
                placeholder={copy.genrePlaceholder}
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">{copy.platformLabel}</span>
              <select
                value={form.platform}
                onChange={(event) => updateForm({ platform: event.target.value })}
                className={`w-full ${c.input} rounded-md px-3 py-2.5 focus:outline-none text-sm bg-background`}
              >
                {platformChoices.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">{copy.targetChaptersLabel}</span>
              <input
                type="number"
                min={1}
                value={form.targetChapters}
                onChange={(event) => updateForm({ targetChapters: event.target.value })}
                className={`w-full ${c.input} rounded-md px-3 py-2.5 focus:outline-none text-sm`}
              />
            </label>
            <label className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">{copy.chapterWordCountLabel}</span>
              <input
                type="number"
                min={1000}
                value={form.chapterWordCount}
                onChange={(event) => updateForm({ chapterWordCount: event.target.value })}
                className={`w-full ${c.input} rounded-md px-3 py-2.5 focus:outline-none text-sm`}
              />
            </label>
          </div>

          <label className="space-y-2 block">
            <span className="text-xs font-medium text-muted-foreground">{copy.briefLabel}</span>
            <textarea
              value={form.brief}
              onChange={(event) => updateForm({ brief: event.target.value })}
              rows={9}
              className={`w-full ${c.input} rounded-md px-3 py-3 focus:outline-none text-sm leading-7 resize-y`}
              placeholder={copy.briefPlaceholder}
            />
          </label>

          {creating && (
            <div className="grid gap-2 sm:grid-cols-3">
              {copy.creationSteps.map((step) => (
                <div key={step} className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
                  <CheckCircle2 size={14} />
                  <span>{step}</span>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={handleFormCreate}
            disabled={!canSubmitForm || creating || submitting}
            className={`inline-flex items-center gap-2 px-5 py-3 ${c.btnPrimary} rounded-md disabled:opacity-50 font-medium text-sm`}
          >
            <BookPlus size={16} />
            {creating ? copy.creatingBook : copy.createBook}
          </button>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-border/60 bg-card/80 p-5 space-y-4">
            <div className="space-y-1">
              <div className="text-[11px] uppercase text-muted-foreground font-bold">
                {copy.assistantHeading}
              </div>
              <p className="text-xs text-muted-foreground leading-6">{copy.assistantHint}</p>
            </div>

            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              rows={7}
              className={`w-full ${c.input} rounded-md px-3 py-3 focus:outline-none text-sm leading-7 resize-y`}
              placeholder={draft ? copy.promptPlaceholderFollowup : copy.promptPlaceholder}
            />

            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleDraftSubmit}
                disabled={submitting || creating || !input.trim()}
                className={`inline-flex items-center gap-2 px-3 py-2 ${c.btnPrimary} rounded-md disabled:opacity-50 font-medium text-xs`}
              >
                <Sparkles size={14} />
                {submitting ? copy.submitting : copy.submit}
              </button>
              <button
                onClick={handleDiscard}
                disabled={!draft || submitting || creating}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 disabled:opacity-50 font-medium text-xs"
              >
                <RotateCcw size={14} />
                {copy.discard}
              </button>
            </div>
          </section>

          <section className="rounded-lg border border-border/60 bg-card/80 p-5 space-y-4">
            <div className="space-y-1">
              <div className="text-[11px] uppercase text-muted-foreground font-bold">
                {copy.draftHeading}
              </div>
              <p className="text-xs text-muted-foreground leading-6">{copy.syncedHint}</p>
            </div>

            {loadingDraft ? (
              <div className="text-sm text-muted-foreground">{projectLang === "zh" ? "读取草案中…" : "Loading draft…"}</div>
            ) : draft ? (
              <div className="space-y-4">
                {summaryRows.length > 0 ? (
                  <div className="space-y-2">
                    {summaryRows.map((row) => (
                      <div key={row.key} className="rounded-md border border-border/50 bg-background/70 px-3 py-2">
                        <div className="text-[10px] uppercase text-muted-foreground font-semibold">{row.label}</div>
                        <div className="mt-1 text-sm leading-6 whitespace-pre-wrap">{row.value}</div>
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
                          className="rounded-md border border-border/70 bg-secondary/50 px-2 py-1 text-xs text-muted-foreground"
                        >
                          {field}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground leading-6">{copy.missingHint}</p>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={applyDraftToForm}
                    className="px-3 py-2 rounded-md border border-border bg-secondary text-secondary-foreground font-medium text-xs"
                  >
                    {copy.applyDraft}
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={!canCreateFromDraft(draft) || creating || submitting}
                    className="px-3 py-2 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 disabled:opacity-50 font-medium text-xs"
                  >
                    {creating ? copy.creating : copy.create}
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border/70 bg-background/50 px-4 py-5">
                <div className="font-medium">{copy.idleTitle}</div>
                <p className="mt-2 text-sm text-muted-foreground leading-7">
                  {copy.helperBody}
                </p>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
