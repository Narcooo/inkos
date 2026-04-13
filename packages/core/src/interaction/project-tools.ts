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
  Platform,
} from "../index.js";
import { chatCompletion } from "../index.js";
import { parseDraftDirectives, createDirectiveStreamFilter } from "./draft-directive-parser.js";
import { executeEditTransaction } from "./edit-controller.js";
import type { InteractionRuntimeTools } from "./runtime.js";
import type { BookCreationDraft } from "./session.js";

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

function normalizePlatform(platform?: string): Platform {
  switch (platform) {
    case "tomato":
    case "feilu":
    case "qidian":
      return platform;
    default:
      return "other";
  }
}

function deriveBookId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 30);
}

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
    id: deriveBookId(input.title),
    title: input.title,
    platform: normalizePlatform(input.platform),
    genre: input.genre ?? "other",
    status: "outlining",
    targetChapters: input.targetChapters ?? 200,
    chapterWordCount: input.chapterWordCount ?? 3000,
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
  const format = options.format ?? "txt";
  const index = await state.loadChapterIndex(bookId);
  const book = await state.loadBookConfig(bookId);
  const chapters = options.approvedOnly
    ? index.filter((chapter) => chapter.status === "approved")
    : index;

  if (chapters.length === 0) {
    throw new Error("No chapters to export.");
  }

  const bookDir = state.bookDir(bookId);
  const chaptersDir = join(bookDir, "chapters");
  const projectRoot = dirname(dirname(bookDir));
  const outputPath = options.outputPath ?? join(projectRoot, `${bookId}_export.${format}`);
  const chapterFiles = buildChapterFileLookup(await readdir(chaptersDir));

  if (format === "epub") {
    const sections: string[] = [
      "<!DOCTYPE html>",
      `<html><head><meta charset="utf-8"><title>${book.title}</title><style>body{font-family:serif;max-width:40em;margin:auto;padding:2em;line-height:1.8}h2{margin-top:3em}</style></head><body>`,
      `<h1>${book.title}</h1>`,
    ];

    for (const chapter of chapters) {
      const match = chapterFiles.get(chapter.number);
      if (!match) {
        continue;
      }
      const markdown = await readFile(join(chaptersDir, match), "utf-8");
      const title = markdown.match(/^#\s+(.+)/m)?.[1] ?? match.replace(/\.md$/, "");
      const htmlBody = markdown
        .split("\n")
        .filter((line) => !line.startsWith("#"))
        .map((line) => line.trim() ? `<p>${line}</p>` : "")
        .join("\n");
      sections.push(`<h2>${title}</h2>`);
      sections.push(htmlBody);
    }
    sections.push("</body></html>");
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, sections.join("\n"), "utf-8");
  } else {
    const parts: string[] = [];
    parts.push(format === "md" ? `# ${book.title}\n\n---\n` : `${book.title}\n\n`);
    for (const chapter of chapters) {
      const match = chapterFiles.get(chapter.number);
      if (!match) {
        continue;
      }
      parts.push(await readFile(join(chaptersDir, match), "utf-8"));
      parts.push("\n\n");
    }
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, parts.join(format === "md" ? "\n---\n\n" : "\n"), "utf-8");
  }

  return {
    outputPath,
    chaptersExported: chapters.length,
    totalWords: chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
    format,
  };
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

const BOOK_DRAFT_SYSTEM_PROMPT = [
  "你是 InkOS 的建书引导员，负责帮用户从一句模糊想法出发，逐步打磨出一份可以开始写作的 foundation 草案。",
  "",
  "## 基础工作原则",
  "1. 请参考用户提供的已有草案内容，在此基础上推进，创作出具有延续性的设定。",
  "2. 你需要根据用户需求和创作情况维护草案内容，帮助用户管理和组织好书籍的基础结构。",
  "",
  "## 创作任务处理流程",
  "1. 在构建草案或执行复杂创作任务之前，请先输出你的构思计划，和用户确认后再推进。",
  "2. 当用户拒绝你的建议时，说明用户对当前方向不满意，请重新和用户沟通你的构思计划，不要直接继续。",
  "3. 先确立世界观和主角设定，确保用户确认满意后再推进核心冲突和卷纲方向。",
  "4. 每一步完成后，请主动和用户确认内容是否满意，如果用户不满意，请根据用户需求调整，直到用户确认满意后再推进下一步。",
  "",
  "## 草案应涵盖的要素",
  "",
  "### 1. 风格",
  "定义小说的文字气质和叙事基调：",
  "- **叙事视角**：主要视角（如第三人称有限视角）、视角切换规则",
  "- **语言基调**：整体气质（冷峻写实 / 华丽奇幻 / 轻松幽默 / 沉郁诗意）、时代感 / 地域感",
  "- **节奏偏好**：动作场景短句为主、日常场景长句铺陈",
  "- **对话风格**：对话功能（推进剧情 / 展现性格 / 蕴含潜台词）、口语化程度",
  "",
  "### 2. 世界观与设定",
  "记录小说中的设定信息，包括物品 / 场景 / 概念等，记录要包含创作内容所需要的各个方面信息。",
  "",
  "### 3. 角色",
  "记录小说中的角色信息，包括身份背景和经历、性格、外貌特征、能力和关系网络、内在驱动和成长弧光。主要角色需要详细设定，次要角色简要描述。",
  "",
  "### 4. 核心冲突与剧情方向",
  "明确小说的整体方向和核心矛盾。包含核心冲突、主线走向、卷一具体方向。",
  "",
  "### 5. 发布规划",
  "平台选择、目标章数、每章字数。不同平台的节奏和字数要求差别很大——番茄读者要节奏快、钩子密；起点读者能接受更重的设定铺垫。",
  "",
  "## 输出格式",
  "",
  "你的回复是 markdown 文本，中间穿插表单标记块。用户在流式对话界面中看到你的回复，表单块会渲染为可交互的输入控件。用户可以直接在控件中修改内容，修改会在下一轮对话时随草案一起发送给你。",
  "",
  "可用标记：",
  "",
  ':::field{key="字段名" label="显示标签"}',
  "预填内容",
  ":::",
  "",
  ':::field{key="字段名" label="显示标签" type="textarea"}',
  "多行预填内容",
  ":::",
  "",
  ':::pick{key="字段名" label="显示标签"}',
  "- 选项一",
  "- 选项二",
  "- 选项三",
  ":::",
  "",
  ':::number{key="字段名" label="显示标签"}',
  "默认值",
  ":::",
  "",
  ':::group{label="组标签"}',
  "（嵌套多个 field / number）",
  ":::",
  "",
  "### 输出规范",
  "1. 先输出你的思考和建议（自然的对话文本），再给出对应的表单块让用户确认或修改。",
  "2. 需要用户做选择时用 :::pick，需要用户填写或确认内容时用 :::field。",
  "3. 当信息足以推导出合理默认值时，大胆预填进表单——让用户改比让用户从零写更轻松。预填内容要体现你对该题材的理解，不要写泛泛的占位符。",
  "4. 每轮只推进一到两个焦点，不要一次铺开所有字段。",
  "5. 当核心要素（书名、题材、世界观、主角、核心冲突、平台、章节规划）都已有内容时，在回复末尾明确告知用户草案已就绪，可以开始写了。",
  "",
  "## 重要：你必须使用 ::: 标记块",
  "",
  "你的每一轮回复中必须包含至少一个 :::field、:::pick 或 :::number 标记块来固定草案字段。不要只输出纯文本讨论——讨论完毕后必须用标记块把结论写入草案。这些标记块会被系统解析并保存到草案中，如果你不输出标记块，用户的选择就会丢失。",
  "",
  "## 完整示例",
  "",
  "假设用户说「我想写一本港风商战悬疑」，你的回复应该是这样的：",
  "",
  "---示例开始---",
  "",
  "港风商战悬疑很有张力，我先帮你搭一个骨架。",
  "",
  ':::field{key="genre" label="题材"}',
  "港风商战悬疑",
  ":::",
  "",
  "世界观方面，商战悬疑需要一个权力交错的都市背景——",
  "",
  ':::field{key="worldPremise" label="世界观" type="textarea"}',
  "近未来港口城市，灰色产业链与金融精英交织的地下经济圈。城市表面繁荣但权力暗流涌动。",
  ":::",
  "",
  "接下来确定发布平台，不同平台节奏差异很大：",
  "",
  ':::pick{key="platform" label="目标平台"}',
  "- 番茄小说",
  "- 起点中文网",
  "- 飞卢",
  "- 其他",
  ":::",
  "",
  "你觉得这个世界观方向对吗？确认后我们来定主角。",
  "",
  "---示例结束---",
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

      if (!instrumentedPipeline.config?.client || !instrumentedPipeline.config?.model) {
        const fallbackText = "先把这本书的大概方向收住。你更想写长篇连载，还是十来章能收住的版本？";
        return {
          __interaction: {
            responseText: fallbackText,
            details: {
              creationDraft: {
                concept,
                title: existingDraft?.title,
                genre: existingDraft?.genre,
                platform: existingDraft?.platform,
                language: existingDraft?.language,
                targetChapters: existingDraft?.targetChapters,
                chapterWordCount: existingDraft?.chapterWordCount,
                blurb: existingDraft?.blurb,
                authorIntent: existingDraft?.authorIntent,
                currentFocus: existingDraft?.currentFocus,
                missingFields: existingDraft?.missingFields ?? ["title", "genre", "targetChapters"],
                readyToCreate: existingDraft?.readyToCreate ?? false,
              } satisfies BookCreationDraft,
              draftRaw: fallbackText,
              draftSummary: "",
              fieldsUpdated: [] as string[],
            },
          },
        };
      }

      const streamFilter = createDirectiveStreamFilter();
      const response = await chatCompletion(
        instrumentedPipeline.config.client,
        instrumentedPipeline.config.model,
        [
          {
            role: "system",
            content: BOOK_DRAFT_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: formatDraftForUserMessage(existingDraft, input),
          },
        ],
        {
          temperature: 0.4,
          onTextDelta: (hooks?.onDraftTextDelta || hooks?.onDraftRawDelta)
            ? (delta: string) => {
                if (hooks?.onDraftRawDelta) {
                  hooks.onDraftRawDelta(delta);
                }
                if (hooks?.onDraftTextDelta) {
                  const visible = streamFilter(delta);
                  if (visible) {
                    hooks.onDraftTextDelta(visible);
                  }
                }
              }
            : undefined,
        },
      );

      const parsed = parseDraftDirectives(response.content);
      const mergedDraft = applyFieldsToDraft(existingDraft, parsed.fields, concept);

      return {
        __interaction: {
          responseText: parsed.textContent,
          details: {
            creationDraft: mergedDraft,
            draftRaw: parsed.raw,
            draftSummary: parsed.summary,
            fieldsUpdated: Object.keys(parsed.fields),
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
      await writeFile(join(state.bookDir(bookId), "story", fileName), content, "utf-8");
    },
  };
}
