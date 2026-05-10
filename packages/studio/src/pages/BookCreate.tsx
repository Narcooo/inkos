import { useEffect, useMemo, useState } from "react";
import type { BookCreationDraft } from "@actalk/inkos-core";
import { fetchJson, useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { BookCreateAssistantPanel } from "./book-create/BookCreateAssistantPanel";
import { BookCreateBasicForm } from "./book-create/BookCreateBasicForm";
import { BookCreateDraftSummaryPanel } from "./book-create/BookCreateDraftSummaryPanel";
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
        <BookCreateBasicForm
          canSubmitForm={canSubmitForm}
          colors={c}
          copy={copy}
          creating={creating}
          form={form}
          onCreate={handleFormCreate}
          platformChoices={platformChoices}
          submitting={submitting}
          updateForm={updateForm}
        />

        <aside className="space-y-4">
          <BookCreateAssistantPanel
            colors={c}
            copy={copy}
            creating={creating}
            draft={draft}
            input={input}
            onDiscard={handleDiscard}
            onInputChange={setInput}
            onSubmit={handleDraftSubmit}
            submitting={submitting}
          />

          <BookCreateDraftSummaryPanel
            copy={copy}
            creating={creating}
            draft={draft}
            loadingDraft={loadingDraft}
            onApplyDraft={applyDraftToForm}
            onCreate={handleCreate}
            projectLang={projectLang}
            submitting={submitting}
            summaryRows={summaryRows}
          />
        </aside>
      </div>
    </div>
  );
}
