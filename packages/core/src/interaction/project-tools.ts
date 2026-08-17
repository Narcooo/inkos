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
} from "../index.js";
import { runWorkerAgent } from "../agent/worker-agent.js";
import { executeEditTransaction } from "./edit-controller.js";
import { defaultChapterLength } from "../utils/length-metrics.js";
import type { InteractionRuntimeTools } from "./runtime.js";
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

const SAFE_ROLE_TRUTH_FILE_RE = /^roles\/(主要角色|次要角色|major|minor)\/[^/\\]+\.md$/u;

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
type StateLike = Pick<StateManager, "ensureControlDocuments" | "bookDir" | "loadBookConfig" | "loadChapterIndex" | "saveChapterIndex" | "listBooks" | "acquireBookLock">;
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
  readonly language?: "zh" | "en";
  readonly chapterWordCount?: number;
  readonly targetChapters?: number;
}): BookConfig {
  const now = new Date().toISOString();
  return {
    id: deriveBookIdFromTitle(input.title) || `book-${Date.now().toString(36)}`,
    title: input.title,
    platform: normalizePlatformOrOther(input.platform),
    genre: input.genre ?? "other",
    status: "outlining",
    targetChapters: input.targetChapters ?? 200,
    chapterWordCount: input.chapterWordCount ?? defaultChapterLength(input.language === "en" ? "en" : "zh"),
    ...(input.language ? { language: input.language } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

function buildCreationExternalContext(input: {
  readonly blurb?: string;
  readonly worldPremise?: string;
  readonly settingNotes?: string;
  readonly protagonist?: string;
  readonly supportingCast?: string;
  readonly conflictCore?: string;
  readonly volumeOutline?: string;
  readonly constraints?: string;
}): string | undefined {
  const sections = [
    input.worldPremise ? `## 世界观与核心设定\n${input.worldPremise}` : undefined,
    input.settingNotes ? `## 补充设定\n${input.settingNotes}` : undefined,
    input.protagonist ? `## 主角设定\n${input.protagonist}` : undefined,
    input.supportingCast ? `## 关键角色与势力\n${input.supportingCast}` : undefined,
    input.conflictCore ? `## 核心冲突\n${input.conflictCore}` : undefined,
    input.volumeOutline ? `## 卷纲方向\n${input.volumeOutline}` : undefined,
    input.blurb ? `## 简介卖点\n${input.blurb}` : undefined,
    input.constraints ? `## 创作约束\n${input.constraints}` : undefined,
  ].filter((section): section is string => Boolean(section?.trim()));

  if (sections.length === 0) {
    return undefined;
  }

  return sections.join("\n\n");
}

async function withBookMutationLock<T>(
  state: StateLike,
  bookId: string,
  task: () => Promise<T>,
): Promise<T> {
  const releaseLock = await state.acquireBookLock(bookId);
  try {
    return await task();
  } finally {
    await releaseLock();
  }
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
    || message.includes("规划下一章意图")
    || message.includes("生成基础设定")
    || message.includes("审核基础设定")
    || message.includes("准备章节输入")
  ) {
    return "planning";
  }
  if (
    lower.includes("composing chapter runtime context")
    || message.includes("组装章节运行时上下文")
  ) {
    return "composing";
  }
  if (
    lower.includes("writing chapter draft")
    || message.includes("撰写章节草稿")
  ) {
    return "writing";
  }
  if (
    lower.includes("auditing draft")
    || message.includes("审计草稿")
  ) {
    return "assessing";
  }
  if (
    lower.includes("fixing")
    || lower.includes("revising chapter")
    || lower.includes("rewrite")
    || lower.includes("repair")
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
            kind: "book_created",
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
      let response: Awaited<ReturnType<typeof runWorkerAgent>> | undefined;
      if (instrumentedPipeline.config?.client && instrumentedPipeline.config?.model) {
        try {
          response = await runWorkerAgent(
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
    patchChapterText: async (bookId, chapterNumber, targetText, replacementText) => withBookMutationLock(state, bookId, async () => {
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
    }),
    replaceChapterText: async (bookId, chapterNumber, fullText) => withBookMutationLock(state, bookId, async () => {
      const execution = await executeEditTransaction(
        {
          bookDir: (targetBookId) => state.bookDir(targetBookId),
          loadChapterIndex: (targetBookId) => state.loadChapterIndex(targetBookId),
          saveChapterIndex: (targetBookId, index) => state.saveChapterIndex(targetBookId, index),
        },
        {
          kind: "chapter-replace",
          bookId,
          chapterNumber,
          fullText,
        },
      );
      return {
        __interaction: {
          activeChapterNumber: chapterNumber,
          responseText: execution.summary,
        },
      };
    }),
    renameEntity: async (bookId, oldValue, newValue) => withBookMutationLock(state, bookId, async () => {
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
    }),
    updateCurrentFocus: async (bookId, content) => withBookMutationLock(state, bookId, async () => {
      await state.ensureControlDocuments(bookId);
      await writeFile(join(state.bookDir(bookId), "story", "current_focus.md"), content, "utf-8");
    }),
    updateAuthorIntent: async (bookId, content) => withBookMutationLock(state, bookId, async () => {
      await state.ensureControlDocuments(bookId);
      await writeFile(join(state.bookDir(bookId), "story", "author_intent.md"), content, "utf-8");
    }),
    writeTruthFile: async (bookId, fileName, content) => withBookMutationLock(state, bookId, async () => {
      await state.ensureControlDocuments(bookId);
      const storyDir = join(state.bookDir(bookId), "story");
      const safeFileName = assertSafeTruthFileName(fileName);
      const targetPath = safeChildPath(storyDir, safeFileName);
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, content, "utf-8");
    }),
  };
}
