import { useEffect, useMemo, useRef, useState } from "react";
import type { BookCreationDraft } from "@actalk/inkos-core";
import { BookPlus, CheckCircle2, FileText, RotateCcw, Sparkles, Upload, X } from "lucide-react";
import { fetchJson, useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import {
  clearBookCreateSessionId,
  getBookCreateSessionId,
  setBookCreateSessionId,
} from "./chat-page-state";

interface Nav {
  toDashboard: () => void;
  toBook: (id: string) => void;
}

interface PlatformOption {
  readonly value: string;
  readonly label: string;
}

export interface BookCreateFormState {
  readonly title: string;
  readonly genre: string;
  readonly platform: string;
  readonly targetChapters: string;
  readonly chapterWordCount: string;
  readonly brief: string;
}

export interface BookCreatePayload {
  readonly title: string;
  readonly genre: string;
  readonly platform: string;
  readonly language: "zh" | "en";
  readonly targetChapters: number;
  readonly chapterWordCount: number;
  readonly blurb: string;
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
    readonly sessionId?: string;
    readonly activeBookId?: string;
    readonly creationDraft?: BookCreationDraft;
  };
}

interface SessionResponse {
  readonly session?: {
    readonly sessionId?: string;
    readonly bookId?: string | null;
  };
}

interface PlatformCopy {
  readonly idleTitle: string;
  readonly idleBody: string;
  readonly formHeading: string;
  readonly formHint: string;
  readonly titleLabel: string;
  readonly titlePlaceholder: string;
  readonly genreLabel: string;
  readonly genrePlaceholder: string;
  readonly platformLabel: string;
  readonly targetChaptersLabel: string;
  readonly chapterWordCountLabel: string;
  readonly briefLabel: string;
  readonly briefPlaceholder: string;
  readonly createBook: string;
  readonly creatingBook: string;
  readonly creationStatus: string;
  readonly creationSteps: ReadonlyArray<string>;
  readonly assistantHeading: string;
  readonly assistantHint: string;
  readonly applyDraft: string;
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
  readonly uploadOutline: string;
  readonly uploadHint: string;
  readonly uploadedFile: string;
  readonly clearUpload: string;
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
    idleBody: "先填清楚书名、题材和故事核心，系统会生成基础设定并进入新书工作台。",
    formHeading: "书籍基础信息",
    formHint: "这些字段会直接进入建书流程。简介写得越具体，后续基础设定越稳定。",
    titleLabel: "书名",
    titlePlaceholder: "例如：夜港账本",
    genreLabel: "题材 / 类型",
    genrePlaceholder: "例如：都市悬疑、玄幻、科幻、女频情感",
    platformLabel: "目标平台",
    targetChaptersLabel: "目标章数",
    chapterWordCountLabel: "每章字数",
    briefLabel: "故事简介 / 核心设定",
    briefPlaceholder: "写清世界观、主角、目标、核心冲突和第一阶段方向。例如：近未来港口城，主角是水货账房，想洗白却被旧账拖回港口旧案。",
    createBook: "创建书籍",
    creatingBook: "创建中…",
    creationStatus: "正在创建书籍，完成后会自动进入工作台。",
    creationSteps: ["写入书籍配置", "生成基础设定", "准备工作台"],
    assistantHeading: "需要先让 AI 帮你补设定？",
    assistantHint: "这块是辅助草案，不是必须步骤。已有草案可以一键套用到左侧表单。",
    applyDraft: "套用草案",
    promptLabel: "继续打磨这本书",
    promptPlaceholder: "例如：我想写个港风商战悬疑，主角先做灰产再洗白。",
    promptPlaceholderFollowup: "例如：世界观改成近未来港口城；女主不要太早出场；卷一先查账再砸场。",
    submit: "更新草案",
    submitting: "处理中…",
    create: "按当前草案建书",
    creating: "创建中…",
    discard: "丢弃草案",
    draftHeading: "当前基础设定草案",
    missingHeading: "还缺这些关键信息",
    missingHint: "这些字段未必都要一次填满，但缺得太多时不要急着建书。",
    syncedHint: "这份草案和 TUI / Studio Chat 共享。",
    helperTitle: "建议这样推进",
    helperBody: "先定世界观和主角，再定核心冲突、简介和卷一方向。想看当前草案时，可以在 TUI 里用 /draft。",
    uploadOutline: "上传大纲文件",
    uploadHint: "支持 .txt 和 .md 格式",
    uploadedFile: "已上传",
    clearUpload: "清除",
  },
  en: {
    idleTitle: "Start from a rough idea",
    idleBody: "Fill in the title, genre, and story core first. InkOS will generate the foundation and open the new workspace.",
    formHeading: "Book basics",
    formHint: "These fields go straight into creation. A concrete brief gives the foundation generator better material.",
    titleLabel: "Title",
    titlePlaceholder: "Example: Ledger of the Night Port",
    genreLabel: "Genre",
    genrePlaceholder: "Example: mystery, urban fantasy, sci-fi, romance",
    platformLabel: "Target platform",
    targetChaptersLabel: "Target chapters",
    chapterWordCountLabel: "Words per chapter",
    briefLabel: "Story brief / core premise",
    briefPlaceholder: "Include the world, protagonist, goal, core conflict, and first arc direction.",
    createBook: "Create book",
    creatingBook: "Creating…",
    creationStatus: "Creating the book. The workspace will open automatically when it is ready.",
    creationSteps: ["Saving config", "Generating foundation", "Preparing workspace"],
    assistantHeading: "Want AI to shape the idea first?",
    assistantHint: "This draft area is optional. If a draft looks useful, apply it to the form.",
    applyDraft: "Apply draft",
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
    uploadOutline: "Upload outline file",
    uploadHint: "Supports .txt and .md files",
    uploadedFile: "Uploaded",
    clearUpload: "Clear",
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

export function defaultBookCreateForm(language: "zh" | "en"): BookCreateFormState {
  return {
    title: "",
    genre: "",
    platform: platformOptionsForLanguage(language)[0]?.value ?? "other",
    targetChapters: "200",
    chapterWordCount: defaultChapterWordsForLanguage(language),
    brief: "",
  };
}

export function platformOptionsForLanguage(language: "zh" | "en"): ReadonlyArray<PlatformOption> {
  return language === "en" ? PLATFORMS_EN : PLATFORMS_ZH;
}

function parsePositiveInteger(value: string): number | null {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function isBookCreateFormReady(form: BookCreateFormState): boolean {
  return Boolean(
    form.title.trim()
      && form.genre.trim()
      && form.brief.trim()
      && parsePositiveInteger(form.targetChapters)
      && parsePositiveInteger(form.chapterWordCount),
  );
}

export function buildBookCreatePayload(
  form: BookCreateFormState,
  language: "zh" | "en",
): BookCreatePayload {
  const targetChapters = parsePositiveInteger(form.targetChapters);
  const chapterWordCount = parsePositiveInteger(form.chapterWordCount);
  if (!targetChapters || !chapterWordCount || !isBookCreateFormReady(form)) {
    throw new Error(language === "zh" ? "请先补齐建书表单。" : "Complete the book creation form first.");
  }
  return {
    title: form.title.trim(),
    genre: form.genre.trim(),
    platform: form.platform,
    language,
    targetChapters,
    chapterWordCount,
    blurb: form.brief.trim(),
  };
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

interface BookCreateSessionOptions {
  readonly fetchSession?: (sessionId: string) => Promise<SessionResponse>;
  readonly createSession?: () => Promise<SessionResponse>;
  readonly getStoredSessionId?: () => string | null;
  readonly setStoredSessionId?: (sessionId: string) => void;
  readonly clearStoredSessionId?: () => void;
}

let pendingDefaultBookCreateSessionId: Promise<string> | null = null;

function readSessionId(response: SessionResponse): string | null {
  const sessionId = response.session?.sessionId?.trim();
  return sessionId || null;
}

export function buildBookCreateAgentRequest(
  instruction: string,
  sessionId: string,
): { instruction: string; sessionId: string } {
  const trimmedSessionId = sessionId.trim();
  if (!trimmedSessionId) {
    throw new Error("Book create session is not ready.");
  }
  return { instruction, sessionId: trimmedSessionId };
}

export async function ensureBookCreateSessionId(
  options: BookCreateSessionOptions = {},
): Promise<string> {
  const usesDefaultDeps = Object.keys(options).length === 0;
  if (usesDefaultDeps && pendingDefaultBookCreateSessionId) {
    return pendingDefaultBookCreateSessionId;
  }

  const fetchSession = options.fetchSession
    ?? ((sessionId: string) => fetchJson<SessionResponse>(`/sessions/${encodeURIComponent(sessionId)}`));
  const createSession = options.createSession
    ?? (() => fetchJson<SessionResponse>("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId: null }),
    }));
  const getStoredSessionId = options.getStoredSessionId ?? getBookCreateSessionId;
  const setStoredSessionId = options.setStoredSessionId ?? setBookCreateSessionId;
  const clearStoredSessionId = options.clearStoredSessionId ?? clearBookCreateSessionId;

  const resolveSessionId = async (): Promise<string> => {
    const storedSessionId = getStoredSessionId()?.trim();
    if (storedSessionId) {
      try {
        const existing = await fetchSession(storedSessionId);
        if (existing.session?.bookId === null) {
          return storedSessionId;
        }
      } catch {
        // Stale localStorage entry; fall through and create a fresh orphan session.
      }
      clearStoredSessionId();
    }

    const createdSessionId = readSessionId(await createSession());
    if (!createdSessionId) {
      throw new Error("Failed to create book session");
    }
    setStoredSessionId(createdSessionId);
    return createdSessionId;
  };

  if (!usesDefaultDeps) {
    return resolveSessionId();
  }

  pendingDefaultBookCreateSessionId = resolveSessionId().finally(() => {
    pendingDefaultBookCreateSessionId = null;
  });
  return pendingDefaultBookCreateSessionId;
}

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
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleOutlineUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "txt" && ext !== "md") return;
    if (file.size > 500 * 1024) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text === "string") {
        updateForm({ brief: text });
        setUploadedFileName(file.name);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleClearUpload = () => {
    setUploadedFileName(null);
    updateForm({ brief: "" });
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

          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md"
              className="hidden"
              onChange={handleOutlineUpload}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 ${c.btnSecondary} rounded-md text-xs font-medium`}
            >
              <Upload size={12} />
              {copy.uploadOutline}
            </button>
            <span className="text-xs text-muted-foreground">{copy.uploadHint}</span>
            {uploadedFileName && (
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-primary/20 bg-primary/5 text-xs text-primary">
                <FileText size={12} />
                {uploadedFileName}
                <button
                  type="button"
                  onClick={handleClearUpload}
                  className="ml-1 hover:text-destructive"
                >
                  <X size={10} />
                </button>
              </span>
            )}
          </div>

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
