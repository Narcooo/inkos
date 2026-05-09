import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  InteractionEvent,
  Logger,
  PipelineRunner,
  StateManager,
  ReviseMode,
  LLMClient,
  BookConfig,
  ToolDefinition,
} from "../index.js";
import { chatCompletion, chatWithTools } from "../index.js";
import { executeEditTransaction } from "./edit-controller.js";
import type { InteractionRuntimeTools } from "./runtime.js";
import type { BookCreationDraft } from "./session.js";
import { writeExportArtifact } from "./export-artifact.js";
import { safeChildPath } from "../utils/path-safety.js";
import { deriveBookIdFromTitle } from "../utils/book-id.js";
import { normalizePlatformOrOther } from "../models/book.js";

const SAFE_TRUTH_FLAT_FILE_NAMES = new Set([
  "author_intent.md",
  "current_focus.md",
  "story_bible.md",
  "volume_outline.md",
  "book_rules.md",
  "particle_ledger.md",
  "subplot_board.md",
  "emotional_arcs.md",
  "style_guide.md",
  "parent_canon.md",
  "fanfic_canon.md",
  "character_matrix.md",
  "current_state.md",
  "pending_hooks.md",
  "chapter_summaries.md",
]);

const SAFE_TRUTH_OUTLINE_FILE_NAMES = new Set([
  "outline/story_frame.md",
  "outline/volume_map.md",
  "outline/节奏原则.md",
  "outline/rhythm_principles.md",
]);

const SAFE_ROLE_TRUTH_FILE_RE = /^roles\/(主要角色|次要角色|major|minor|주요인물|보조인물)\/[^/\\]+\.md$/u;

export function assertSafeTruthFileName(fileName: string): string {
  const trimmed = fileName.trim();
  const withExtension = trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
  const lower = withExtension.toLowerCase();
  if (
    !trimmed ||
    withExtension.startsWith("/") ||
    withExtension.includes("\\") ||
    withExtension.includes("\0") ||
    withExtension.includes("..")
  ) {
    throw new Error(`Invalid truth file name: ${JSON.stringify(fileName)}`);
  }
  if (SAFE_TRUTH_FLAT_FILE_NAMES.has(lower)) return lower;
  if (SAFE_TRUTH_OUTLINE_FILE_NAMES.has(lower)) return lower;
  if (SAFE_ROLE_TRUTH_FILE_RE.test(withExtension)) return withExtension;
  throw new Error(`Invalid truth file name: ${JSON.stringify(fileName)}`);
}

type PipelineLike = Pick<PipelineRunner, "writeNextChapter" | "reviseDraft"> & {
  readonly initBook?: (
    book: BookConfig,
    options?: {
      readonly externalContext?: string;
      readonly authorIntent?: string;
      readonly currentFocus?: string;
    },
  ) => Promise<void>;
};
type StateLike = Pick<StateManager, "ensureControlDocuments" | "bookDir" | "loadBookConfig" | "loadChapterIndex" | "saveChapterIndex" | "listBooks">;
type InstrumentablePipelineLike = PipelineLike & {
  readonly config?: {
    logger?: Logger;
    client?: LLMClient;
    model?: string;
  };
};

function buildBookConfig(input: {
  readonly title: string;
  readonly genre?: string;
  readonly platform?: string;
  readonly language?: "zh" | "en" | "ko";
  readonly chapterWordCount?: number;
  readonly targetChapters?: number;
}): BookConfig {
  const now = new Date().toISOString();
  const inferredLanguage = input.language ?? (input.genre?.startsWith("ko-") ? "ko" : undefined);
  return {
    id: deriveBookIdFromTitle(input.title) || `book-${Date.now().toString(36)}`,
    title: input.title,
    platform: normalizePlatformOrOther(input.platform),
    genre: input.genre ?? "other",
    status: "outlining",
    targetChapters: input.targetChapters ?? 200,
    chapterWordCount: input.chapterWordCount ?? 3000,
    ...(inferredLanguage ? { language: inferredLanguage } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

function buildCreationExternalContext(input: {
  readonly genre?: string;
  readonly language?: "zh" | "en" | "ko";
  readonly blurb?: string;
  readonly worldPremise?: string;
  readonly settingNotes?: string;
  readonly protagonist?: string;
  readonly supportingCast?: string;
  readonly conflictCore?: string;
  readonly volumeOutline?: string;
  readonly constraints?: string;
}): string | undefined {
  const isKorean = input.genre?.startsWith("ko-")
    || input.language === "ko"
    || /[가-힣]/u.test([
      input.blurb,
      input.worldPremise,
      input.settingNotes,
      input.protagonist,
      input.supportingCast,
      input.conflictCore,
      input.volumeOutline,
      input.constraints,
    ].filter(Boolean).join("\n"));
  const labels = isKorean
    ? {
        worldPremise: "세계관과 핵심 설정",
        settingNotes: "보충 설정",
        protagonist: "주인공 설정",
        supportingCast: "주요 인물과 세력",
        conflictCore: "핵심 갈등",
        volumeOutline: "권/1부 방향",
        blurb: "소개와 판매 포인트",
        constraints: "창작 제약",
      }
    : input.language === "en"
      ? {
          worldPremise: "World and core premise",
          settingNotes: "Additional setting notes",
          protagonist: "Protagonist",
          supportingCast: "Key cast and factions",
          conflictCore: "Core conflict",
          volumeOutline: "Volume direction",
          blurb: "Blurb and selling points",
          constraints: "Creative constraints",
        }
      : {
          worldPremise: "世界观与核心设定",
          settingNotes: "补充设定",
          protagonist: "主角设定",
          supportingCast: "关键角色与势力",
          conflictCore: "核心冲突",
          volumeOutline: "卷纲方向",
          blurb: "简介卖点",
          constraints: "创作约束",
        };
  const sections = [
    input.worldPremise ? `## ${labels.worldPremise}\n${input.worldPremise}` : undefined,
    input.settingNotes ? `## ${labels.settingNotes}\n${input.settingNotes}` : undefined,
    input.protagonist ? `## ${labels.protagonist}\n${input.protagonist}` : undefined,
    input.supportingCast ? `## ${labels.supportingCast}\n${input.supportingCast}` : undefined,
    input.conflictCore ? `## ${labels.conflictCore}\n${input.conflictCore}` : undefined,
    input.volumeOutline ? `## ${labels.volumeOutline}\n${input.volumeOutline}` : undefined,
    input.blurb ? `## ${labels.blurb}\n${input.blurb}` : undefined,
    input.constraints ? `## ${labels.constraints}\n${input.constraints}` : undefined,
  ].filter((section): section is string => Boolean(section?.trim()));

  if (sections.length === 0) {
    return undefined;
  }

  return sections.join("\n\n");
}

export function buildChapterFileLookup(files: ReadonlyArray<string>): ReadonlyMap<number, string> {
  const lookup = new Map<number, string>();
  for (const file of files) {
    if (!file.endsWith(".md") || !/^\d{4}/.test(file)) {
      continue;
    }
    const chapterNumber = parseInt(file.slice(0, 4), 10);
    if (!lookup.has(chapterNumber)) {
      lookup.set(chapterNumber, file);
    }
  }
  return lookup;
}

async function exportBookToPath(state: StateLike, bookId: string, options: {
  readonly format?: "txt" | "md" | "epub";
  readonly approvedOnly?: boolean;
  readonly outputPath?: string;
}) {
  return writeExportArtifact(state, bookId, options);
}

function mapStageMessageToStatus(message: string): InteractionEvent["status"] | undefined {
  const lower = message.trim().toLowerCase();
  if (
    lower.includes("planning next chapter")
    || lower.includes("generating foundation")
    || lower.includes("reviewing foundation")
    || lower.includes("preparing chapter inputs")
    || message.includes("챕터 입력 준비")
    || message.includes("기초 설정")
    || message.includes("작품 초안")
    || message.includes("작품 기초")
    || message.includes("规划下一章意图")
    || message.includes("生成基础设定")
    || message.includes("审核基础设定")
    || message.includes("准备章节输入")
  ) {
    return "planning";
  }
  if (
    lower.includes("composing chapter runtime context")
    || message.includes("챕터 런타임 컨텍스트 구성")
    || message.includes("组装章节运行时上下文")
  ) {
    return "composing";
  }
  if (
    lower.includes("writing chapter draft")
    || message.includes("챕터 초안 작성")
    || message.includes("撰写章节草稿")
  ) {
    return "writing";
  }
  if (
    lower.includes("auditing draft")
    || message.includes("초안 검토")
    || message.includes("장 검토")
    || message.includes("审计草稿")
  ) {
    return "assessing";
  }
  if (
    lower.includes("fixing")
    || lower.includes("revising chapter")
    || lower.includes("rewrite")
    || lower.includes("repair")
    || message.includes("수정")
    || message.includes("복구")
    || message.includes("自动修复")
    || message.includes("整章改写")
    || message.includes("修订第")
  ) {
    return "repairing";
  }
  if (
    lower.includes("persist")
    || lower.includes("saving")
    || lower.includes("snapshot")
    || lower.includes("rebuilding final truth files")
    || lower.includes("validating truth file updates")
    || lower.includes("syncing memory indexes")
    || message.includes("저장")
    || message.includes("스냅샷")
    || message.includes("최종 기준 문서")
    || message.includes("기준 문서 변경 검증")
    || message.includes("기억 색인 동기화")
    || message.includes("챕터 색인")
    || message.includes("落盘")
    || message.includes("保存")
    || message.includes("快照")
    || message.includes("校验真相文件变更")
    || message.includes("生成最终真相文件")
    || message.includes("同步记忆索引")
  ) {
    return "persisting";
  }
  return undefined;
}

function extractStageDetail(message: string): string | undefined {
  if (message.startsWith("Stage: ")) {
    return message.slice("Stage: ".length).trim();
  }
  if (message.startsWith("阶段：")) {
    return message.slice("阶段：".length).trim();
  }
  if (message.startsWith("단계: ")) {
    return message.slice("단계: ".length).trim();
  }
  return undefined;
}

function createInteractionLogger(
  original: Logger | undefined,
  events: InteractionEvent[],
  bookId: string,
): Logger {
  const emit = (level: "debug" | "info" | "warn" | "error", message: string): void => {
    const stageDetail = extractStageDetail(message);
    const stageStatus = stageDetail ? mapStageMessageToStatus(stageDetail) : undefined;

    if (stageDetail && stageStatus) {
      events.push({
        kind: "stage.changed",
        timestamp: Date.now(),
        status: stageStatus,
        bookId,
        detail: stageDetail,
      });
      return;
    }

    if (level === "warn") {
      events.push({
        kind: "task.warning",
        timestamp: Date.now(),
        status: "blocked",
        bookId,
        detail: message,
      });
      return;
    }

    if (level === "error") {
      events.push({
        kind: "task.failed",
        timestamp: Date.now(),
        status: "failed",
        bookId,
        detail: message,
      });
    }
  };

  const wrap = (base: Logger | undefined): Logger => ({
    debug: (msg, ctx) => {
      emit("debug", msg);
      base?.debug(msg, ctx);
    },
    info: (msg, ctx) => {
      emit("info", msg);
      base?.info(msg, ctx);
    },
    warn: (msg, ctx) => {
      emit("warn", msg);
      base?.warn(msg, ctx);
    },
    error: (msg, ctx) => {
      emit("error", msg);
      base?.error(msg, ctx);
    },
    child: (tag, extraCtx) => wrap(base?.child(tag, extraCtx)),
  });

  return wrap(original);
}

async function withPipelineInteractionTelemetry<T extends { chapterNumber?: number }>(
  pipeline: InstrumentablePipelineLike,
  bookId: string,
  executor: () => Promise<T>,
): Promise<T & {
  __interaction: {
    events: ReadonlyArray<InteractionEvent>;
    activeChapterNumber?: number;
  };
}> {
  const events: InteractionEvent[] = [];
  const originalLogger = pipeline.config?.logger;
  if (pipeline.config) {
    pipeline.config.logger = createInteractionLogger(originalLogger, events, bookId);
  }

  try {
    const result = await executor();
    return {
      ...result,
      __interaction: {
        events,
        ...(typeof result.chapterNumber === "number"
          ? { activeChapterNumber: result.chapterNumber }
          : {}),
      },
    };
  } finally {
    if (pipeline.config) {
      pipeline.config.logger = originalLogger;
    }
  }
}

const CREATE_BOOK_TOOL: ToolDefinition = {
  name: "create_book",
  description: "根据用户描述或 Studio 建书表单生成建书参数。系统会将参数渲染为可编辑表单，用户确认后建书。",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "书名" },
      genre: { type: "string", description: "题材标识，如 xuanhuan, urban, romance, scifi, mystery, cozy, ko-cozy" },
      platform: { type: "string", description: "发布平台，如 tomato, qidian, feilu, royal-road, kakao-page, naver-series, munpia, other" },
      targetChapters: { type: "number", description: "目标章数，默认 200" },
      chapterWordCount: { type: "number", description: "每章字数，默认 3000" },
      language: { type: "string", enum: ["zh", "en", "ko"], description: "写作语言：zh、en、ko。韩国语项目必须使用 ko。" },
      brief: { type: "string", description: "创意简述，会传给 Architect 智能体生成完整的世界观、主角、冲突等 foundation 文件。把用户提到的所有创意要素都写进这里。" },
    },
    required: ["title", "genre", "platform", "brief"],
  },
};

const BOOK_DRAFT_SYSTEM_PROMPT = [
  "你是 InkOS 的建书助手。用户会描述想写的书，你需要调用 create_book 工具来生成建书参数。",
  "",
  "规则：",
  "1. 从用户描述中推断所有字段，大胆预填合理默认值。",
  "2. brief 字段要详细——它会传给 Architect 智能体生成完整的世界观、主角、冲突等 foundation 文件。把用户提到的所有创意要素都写进 brief。",
  "3. 如果用户后续要求修改某些字段，重新调用 create_book 工具，只更新被提到的字段，其余保持不变。",
  "4. 不要只回复文字讨论——必须调用 create_book 工具输出结构化参数。",
  "5. 如果用户输入来自 Studio 表单，已经包含书名、题材、平台、目标章数、每章字数、故事简介/核心设定，不要再追问这些字段；直接基于它们生成完整草案。",
].join("\n");

/** Map directive field keys to BookCreationDraft property names. */
function applyFieldsToDraft(
  existing: BookCreationDraft | undefined,
  fields: Readonly<Record<string, string>>,
  concept: string,
): BookCreationDraft {
  const draft: BookCreationDraft = {
    concept,
    missingFields: [],
    readyToCreate: false,
    ...(existing ?? {}),
  };

  for (const [key, value] of Object.entries(fields)) {
    if (!value) continue;

    switch (key) {
      case "title":
        draft.title = value;
        break;
      case "genre":
        draft.genre = value;
        break;
      case "platform":
        draft.platform = value;
        break;
      case "language":
        if (value === "zh" || value === "en") draft.language = value;
        break;
      case "targetChapters": {
        const n = parseInt(value, 10);
        if (!Number.isNaN(n) && n > 0) draft.targetChapters = n;
        break;
      }
      case "chapterWordCount":
      case "chapterLength": {
        const n = parseInt(value, 10);
        if (!Number.isNaN(n) && n > 0) draft.chapterWordCount = n;
        break;
      }
      case "blurb":
        draft.blurb = value;
        break;
      case "worldPremise":
        draft.worldPremise = value;
        break;
      case "settingNotes":
        draft.settingNotes = value;
        break;
      case "protagonist":
        draft.protagonist = value;
        break;
      case "supportingCast":
        draft.supportingCast = value;
        break;
      case "conflictCore":
        draft.conflictCore = value;
        break;
      case "volumeOutline":
        draft.volumeOutline = value;
        break;
      case "constraints":
        draft.constraints = value;
        break;
      case "authorIntent":
        draft.authorIntent = value;
        break;
      case "currentFocus":
        draft.currentFocus = value;
        break;
      // Unknown keys are silently ignored — the LLM may emit
      // application-level keys we don't map to the draft struct.
    }
  }

  return draft;
}

function parsePositiveIntegerField(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.match(/\d+/);
  if (!match) return undefined;
  const parsed = parseInt(match[0]!, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function readLabeledBlock(input: string, labels: ReadonlyArray<string>): string | undefined {
  const escapedLabels = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const labelPattern = escapedLabels.join("|");
  const re = new RegExp(`(?:^|\\n)\\s*(?:${labelPattern})\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*[^\\n:：]{1,40}\\s*[:：]|$)`, "u");
  const match = re.exec(input);
  return match?.[1]?.trim() || undefined;
}

function readInlineField(input: string, labels: ReadonlyArray<string>): string | undefined {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*[:：]\\s*([^\\n]+)`, "u");
    const match = re.exec(input);
    const value = match?.[1]?.trim();
    if (value) return value;
  }
  return undefined;
}

function stripIdFromLabeledValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/\s*\([^)]+\)\s*$/u, "").trim() || value.trim();
}

function extractStudioFormDraft(input: string, concept: string): BookCreationDraft | undefined {
  const title = readInlineField(input, ["제목", "Title", "书名"]);
  const genreRaw = readInlineField(input, ["장르", "Genre", "题材"]);
  const platformRaw = readInlineField(input, ["목표 플랫폼", "Target platform", "目标平台"]);
  const targetChapters = parsePositiveIntegerField(readInlineField(input, ["목표 장수", "Target chapters", "目标章数"]));
  const chapterWordCount = parsePositiveIntegerField(readInlineField(input, ["장당 분량", "Words per chapter", "每章字数"]));
  const blurb = readLabeledBlock(input, [
    "이야기 소개 / 핵심 설정",
    "Story brief / core premise",
    "故事简介 / 核心设定",
  ]);

  if (!title && !genreRaw && !platformRaw && !targetChapters && !chapterWordCount && !blurb) {
    return undefined;
  }

  const draft: BookCreationDraft = {
    concept,
    missingFields: [],
    readyToCreate: false,
  };
  if (title) draft.title = title;
  if (genreRaw) {
    const idMatch = /\(([^)]+)\)\s*$/u.exec(genreRaw);
    draft.genre = idMatch?.[1]?.trim() || stripIdFromLabeledValue(genreRaw);
  }
  if (platformRaw) draft.platform = stripIdFromLabeledValue(platformRaw);
  if (targetChapters) draft.targetChapters = targetChapters;
  if (chapterWordCount) draft.chapterWordCount = chapterWordCount;
  if (blurb) {
    draft.blurb = blurb;
    draft.worldPremise = blurb;
  }
  if (/[가-힣]/u.test(input)) {
    draft.language = "ko";
  } else if (/Title|Story brief|Target chapters/u.test(input)) {
    draft.language = "en";
  } else {
    draft.language = "zh";
  }
  return finalizeCreationDraft(draft);
}

function finalizeCreationDraft(draft: BookCreationDraft): BookCreationDraft {
  const missingFields: string[] = [];
  if (!draft.title?.trim()) missingFields.push("title");
  if (!draft.genre?.trim()) missingFields.push("genre");
  if (!draft.platform?.trim()) missingFields.push("platform");
  if (typeof draft.targetChapters !== "number") missingFields.push("targetChapters");
  if (typeof draft.chapterWordCount !== "number") missingFields.push("chapterWordCount");
  if (!draft.blurb?.trim() && !draft.worldPremise?.trim()) missingFields.push("blurb");
  return {
    ...draft,
    missingFields,
    readyToCreate: missingFields.length === 0,
  };
}

function stripMarkdown(value: string): string {
  return value
    .replace(/\*\*/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .trim();
}

function firstTitleCandidate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = stripMarkdown(value)
    .split(/\s*\/\s*|\n|,|，/u)
    .map((part) => part.trim())
    .filter(Boolean);
  return cleaned[0];
}

function extractMarkdownDraftFields(raw: string | undefined): Partial<BookCreationDraft> {
  if (!raw?.trim()) return {};

  const fields: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const match = /^\s*\|\s*(?:\*\*)?([^|*]+?)(?:\*\*)?\s*\|\s*([^|]+?)\s*\|\s*$/u.exec(line);
    if (!match) continue;
    const key = stripMarkdown(match[1] ?? "");
    const value = stripMarkdown(match[2] ?? "");
    if (!key || !value || /^:?-+:?$/u.test(key) || /^:?-+:?$/u.test(value)) continue;
    fields[key] = value;
  }

  const get = (...keys: string[]) => {
    for (const key of keys) {
      const value = fields[key];
      if (value?.trim()) return value.trim();
    }
    return undefined;
  };

  const title = firstTitleCandidate(get("제목 후보", "제목", "Title candidates", "Title", "书名候选", "书名"));
  const worldPremise = get("세계관", "World", "世界观");
  const protagonist = get("주인공", "Protagonist", "主角");
  const conflictCore = get("핵심 갈등", "Core Conflict", "核心冲突");
  const volumeOutline = get("1부 방향", "Volume Direction", "卷一方向", "卷纲方向");
  const blurb = get("소개문", "Blurb", "简介", "介绍文");

  return {
    ...(title ? { title } : {}),
    ...(worldPremise ? { worldPremise } : {}),
    ...(protagonist ? { protagonist } : {}),
    ...(conflictCore ? { conflictCore } : {}),
    ...(volumeOutline ? { volumeOutline } : {}),
    ...(blurb ? { blurb } : {}),
  };
}

function formatDraftForUserMessage(
  existingDraft: BookCreationDraft | undefined,
  userMessage: string,
): string {
  const parts: string[] = [];

  if (existingDraft) {
    parts.push("## 当前草案状态");
    const entries = Object.entries(existingDraft).filter(
      ([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0),
    );
    for (const [key, value] of entries) {
      parts.push(`- **${key}**: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
    }
    parts.push("");
  }

  parts.push("## 用户输入");
  parts.push(userMessage);

  return parts.join("\n");
}

function draftResponseText(input: string, fallback: string): string {
  if (/[가-힣]/u.test(input)) {
    return "입력된 작품 정보를 바탕으로 초안을 업데이트했습니다. 아래 초안 영역을 확인하고 필요하면 추가로 다듬어 주세요.";
  }
  if (/Title|Story brief|Target chapters/u.test(input)) {
    return "Updated the book draft from the provided book basics. Review the draft below and refine it if needed.";
  }
  return fallback;
}

export function createInteractionToolsFromDeps(
  pipeline: PipelineLike,
  state: StateLike,
  hooks?: {
    readonly onChatTextDelta?: (text: string) => void;
    readonly onDraftTextDelta?: (text: string) => void;
    readonly onDraftRawDelta?: (text: string) => void;
    readonly getChatRequestOptions?: () => {
      readonly temperature?: number;
      readonly maxTokens?: number;
    };
  },
): InteractionRuntimeTools {
  const instrumentedPipeline = pipeline as InstrumentablePipelineLike;

  return {
    listBooks: () => state.listBooks(),
    developBookDraft: async (input, existingDraft) => {
      const concept = existingDraft?.concept ?? input;
      const formDraft = extractStudioFormDraft(input, concept);

      if (!instrumentedPipeline.config?.client || !instrumentedPipeline.config?.model) {
        // Fallback: no LLM configured
        return {
          __interaction: {
            responseText: "请先配置 LLM 模型，然后再创建书籍。",
            details: {
              creationDraft: {
                concept,
                missingFields: ["title", "genre", "targetChapters"],
                readyToCreate: false,
              },
            },
          },
        };
      }

      // Build messages - include existing draft context if present
      const userContent = existingDraft
        ? `当前草案参数：${JSON.stringify(existingDraft, null, 2)}\n\n用户输入：${input}`
        : input;

      const result = await chatWithTools(
        instrumentedPipeline.config.client,
        instrumentedPipeline.config.model,
        [
          { role: "system", content: BOOK_DRAFT_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        [CREATE_BOOK_TOOL],
        { temperature: 0.4 },
      );

      // Extract tool call if present
      const toolCall = result.toolCalls[0];
      let parsedArgs: Record<string, unknown> = {};
      if (toolCall) {
        try {
          parsedArgs = JSON.parse(toolCall.arguments);
        } catch {
          // If parsing fails, use empty args
        }
      }

      const contentDraft = extractMarkdownDraftFields(result.content);

      // Build a draft from tool call arguments
      const draft: BookCreationDraft = finalizeCreationDraft({
        concept,
        missingFields: [],
        readyToCreate: false,
        ...(existingDraft ?? {}),
        ...(formDraft ?? {}),
        ...contentDraft,
        title: (parsedArgs.title as string) ?? contentDraft.title ?? formDraft?.title ?? existingDraft?.title,
        genre: (parsedArgs.genre as string) ?? formDraft?.genre ?? existingDraft?.genre,
        platform: (parsedArgs.platform as string) ?? formDraft?.platform ?? existingDraft?.platform,
        language: (parsedArgs.language as "zh" | "en" | "ko") ?? formDraft?.language ?? existingDraft?.language,
        targetChapters: (parsedArgs.targetChapters as number) ?? formDraft?.targetChapters ?? existingDraft?.targetChapters ?? 200,
        chapterWordCount: (parsedArgs.chapterWordCount as number) ?? formDraft?.chapterWordCount ?? existingDraft?.chapterWordCount ?? 3000,
        blurb: (parsedArgs.brief as string) ?? contentDraft.blurb ?? formDraft?.blurb ?? existingDraft?.blurb,
        worldPremise: (parsedArgs.worldPremise as string) ?? contentDraft.worldPremise ?? formDraft?.worldPremise ?? existingDraft?.worldPremise,
        protagonist: contentDraft.protagonist ?? existingDraft?.protagonist,
        conflictCore: contentDraft.conflictCore ?? existingDraft?.conflictCore,
        volumeOutline: contentDraft.volumeOutline ?? existingDraft?.volumeOutline,
      });

      return {
        __interaction: {
          responseText: toolCall
            ? (result.content || draftResponseText(input, "已生成建书参数，请确认或修改。"))
            : draftResponseText(input, result.content || "已生成建书参数，请确认或修改。"),
          details: {
            creationDraft: draft,
            draftRaw: result.content,
            toolCall: toolCall ? { name: toolCall.name, arguments: parsedArgs } : undefined,
          },
        },
      };
    },
    createBook: async (input) => {
      const book = buildBookConfig(input);
      if (!pipeline.initBook) {
        throw new Error("Pipeline does not support shared book creation.");
      }
      await pipeline.initBook(book, {
        externalContext: buildCreationExternalContext(input),
        authorIntent: input.authorIntent,
        currentFocus: input.currentFocus,
      });
      return {
        bookId: book.id,
        title: book.title,
        __interaction: {
          responseText: `Created ${book.title} (${book.id}).`,
          details: {
            bookId: book.id,
            title: book.title,
          },
        },
      };
    },
    exportBook: async (bookId, options) => {
      const result = await exportBookToPath(state, bookId, options);
      return {
        ...result,
        __interaction: {
          responseText: `Exported ${bookId} to ${result.outputPath} (${result.chaptersExported} chapters).`,
          details: {
            outputPath: result.outputPath,
            chaptersExported: result.chaptersExported,
            totalWords: result.totalWords,
            format: result.format,
          },
        },
      };
    },
    chat: async (input, options) => {
      const bookLabel = options.bookId ?? "none";
      const chatRequestOptions = hooks?.getChatRequestOptions?.() ?? {};
      let response: Awaited<ReturnType<typeof chatCompletion>> | undefined;
      if (instrumentedPipeline.config?.client && instrumentedPipeline.config?.model) {
        try {
          response = await chatCompletion(
            instrumentedPipeline.config.client,
            instrumentedPipeline.config.model,
            [
              {
                role: "system",
                content: [
                  "You are InkOS inside the terminal workbench.",
                  "Respond conversationally and briefly.",
                  "If there is no active book, help the user decide what to write next.",
                  "If there is an active book, keep the answer grounded in that book context.",
                ].join(" "),
              },
              {
                role: "user",
                content: `activeBook=${bookLabel}\nautomationMode=${options.automationMode}\nmessage=${input}`,
              },
            ],
            {
              temperature: chatRequestOptions.temperature ?? 0.4,
              ...(chatRequestOptions.maxTokens !== undefined && { maxTokens: chatRequestOptions.maxTokens }),
              onTextDelta: hooks?.onChatTextDelta,
            },
          );
        } catch (err) {
          // Thinking models (e.g. kimi-k2.5) may return empty content for simple inputs.
          // Only swallow empty-content errors; re-throw everything else (network, auth, etc.)
          const msg = err instanceof Error ? err.message : "";
          if (!msg.includes("empty") && !msg.includes("content")) {
            throw err;
          }
        }
      }

      return {
        __interaction: {
          responseText: response?.content?.trim()
            || (options.bookId
              ? `I’m here. Active book is ${options.bookId}.`
              : "I’m here. No active book yet."),
        },
      };
    },
    writeNextChapter: (bookId) => withPipelineInteractionTelemetry(
      instrumentedPipeline,
      bookId,
      () => pipeline.writeNextChapter(bookId),
    ),
    reviseDraft: (bookId, chapterNumber, mode) => withPipelineInteractionTelemetry(
      instrumentedPipeline,
      bookId,
      () => pipeline.reviseDraft(bookId, chapterNumber, mode as ReviseMode),
    ),
    patchChapterText: async (bookId, chapterNumber, targetText, replacementText) => {
      const execution = await executeEditTransaction(
        {
          bookDir: (targetBookId) => state.bookDir(targetBookId),
          loadChapterIndex: (targetBookId) => state.loadChapterIndex(targetBookId),
          saveChapterIndex: (targetBookId, index) => state.saveChapterIndex(targetBookId, index),
        },
        {
          kind: "chapter-local-edit",
          bookId,
          chapterNumber,
          instruction: `Replace ${targetText} with ${replacementText}`,
          targetText,
          replacementText,
        },
      );
      return {
        __interaction: {
          activeChapterNumber: chapterNumber,
          responseText: execution.summary,
        },
      };
    },
    renameEntity: async (bookId, oldValue, newValue) => {
      const execution = await executeEditTransaction(
        {
          bookDir: (targetBookId) => state.bookDir(targetBookId),
          loadChapterIndex: (targetBookId) => state.loadChapterIndex(targetBookId),
          saveChapterIndex: (targetBookId, index) => state.saveChapterIndex(targetBookId, index),
        },
        {
          kind: "entity-rename",
          bookId,
          entityType: "character",
          oldValue,
          newValue,
        },
      );
      return {
        __interaction: {
          responseText: execution.summary,
        },
      };
    },
    updateCurrentFocus: async (bookId, content) => {
      await state.ensureControlDocuments(bookId);
      await writeFile(join(state.bookDir(bookId), "story", "current_focus.md"), content, "utf-8");
    },
    updateAuthorIntent: async (bookId, content) => {
      await state.ensureControlDocuments(bookId);
      await writeFile(join(state.bookDir(bookId), "story", "author_intent.md"), content, "utf-8");
    },
    writeTruthFile: async (bookId, fileName, content) => {
      await state.ensureControlDocuments(bookId);
      const storyDir = join(state.bookDir(bookId), "story");
      const safeFileName = assertSafeTruthFileName(fileName);
      const targetPath = safeChildPath(storyDir, safeFileName);
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, content, "utf-8");
    },
  };
}
