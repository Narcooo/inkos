import type { BookCreationDraft } from "@actalk/inkos-core";
import { fetchJson } from "../hooks/use-api";
import {
  clearBookCreateSessionId,
  getBookCreateSessionId,
  setBookCreateSessionId,
} from "./chat-page-state";

export interface PlatformOption {
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

export interface InteractionSessionResponse {
  readonly session?: {
    readonly activeBookId?: string;
    readonly creationDraft?: BookCreationDraft;
  };
  readonly activeBookId?: string;
}

export interface AgentResponse {
  readonly response?: string;
  readonly error?: string;
  readonly session?: {
    readonly sessionId?: string;
    readonly activeBookId?: string;
    readonly creationDraft?: BookCreationDraft;
  };
}

export interface SessionResponse {
  readonly session?: {
    readonly sessionId?: string;
    readonly bookId?: string | null;
  };
}

export interface PlatformCopy {
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

export const PAGE_COPY: Record<"zh" | "en", PlatformCopy> = {
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
export const CREATION_DRAFT_SYNC_INTERVAL_MS = 2500;

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
