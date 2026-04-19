import { chatWithTools, type AgentMessage, type ToolDefinition } from "../llm/provider.js";
import { PipelineRunner, type PipelineConfig } from "./runner.js";
import type { Platform, Genre } from "../models/book.js";
import { DEFAULT_REVISE_MODE, type ReviseMode } from "../agents/reviser.js";

/** Tool definitions for the agent loop. */
const TOOLS: ReadonlyArray<ToolDefinition> = [
  {
    name: "write_draft",
    description: "写【下一章】草稿。只能续写最新章之后的下一章，不能指定章节号，不能补历史空章。生成正文、更新状态卡/账本/伏笔池、保存章节文件。",
    parameters: {
      type: "object",
      properties: {
        bookId: { type: "string", description: "书籍ID" },
        guidance: { type: "string", description: "本章创作指导（可选，自然语言）" },
      },
      required: ["bookId"],
    },
  },
  {
    name: "plan_chapter",
    description: "为下一章生成 chapter intent（章节目标、必须保留、冲突说明）。适合在正式写作前检查当前控制输入是否正确。",
    parameters: {
      type: "object",
      properties: {
        bookId: { type: "string", description: "书籍ID" },
        guidance: { type: "string", description: "本章额外指导（可选，自然语言）" },
      },
      required: ["bookId"],
    },
  },
  {
    name: "compose_chapter",
    description: "为下一章生成 context/rule-stack/trace 运行时产物。适合在写作前确认系统实际会带哪些上下文和优先级。",
    parameters: {
      type: "object",
      properties: {
        bookId: { type: "string", description: "书籍ID" },
        guidance: { type: "string", description: "本章额外指导（可选，自然语言）" },
      },
      required: ["bookId"],
    },
  },
  {
    name: "audit_chapter",
    description: "审计指定章节。检查连续性、OOC、数值、伏笔等问题。",
    parameters: {
      type: "object",
      properties: {
        bookId: { type: "string", description: "书籍ID" },
        chapterNumber: { type: "number", description: "章节号（不填则审计最新章）" },
      },
      required: ["bookId"],
    },
  },
  {
    name: "revise_chapter",
    description: "修订指定章节的文字质量。根据审计问题做局部修正，不改变剧情走向。默认 spot-fix（定点修复最小改动）；也支持 polish(润色)、rewrite(改写)、rework(重写)、anti-detect。注意：不能用来补缺失章节、不能改章节号、不能替代 write_draft。",
    parameters: {
      type: "object",
      properties: {
        bookId: { type: "string", description: "书籍ID" },
        chapterNumber: { type: "number", description: "章节号（不填则修订最新章）" },
        mode: { type: "string", enum: ["polish", "rewrite", "rework", "spot-fix", "anti-detect"], description: `修订模式（默认${DEFAULT_REVISE_MODE}）` },
      },
      required: ["bookId"],
    },
  },
  {
    name: "scan_market",
    description: "扫描市场趋势。从平台排行榜获取实时数据并分析。",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "create_book",
    description: "创建一本新书。生成世界观、卷纲、文风指南等基础设定。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "书名" },
        genre: { type: "string", enum: ["xuanhuan", "xianxia", "urban", "horror", "other"], description: "题材" },
        platform: { type: "string", enum: ["tomato", "feilu", "qidian", "other"], description: "目标平台" },
        brief: { type: "string", description: "创作简述/需求（自然语言）" },
      },
      required: ["title", "genre", "platform"],
    },
  },
  {
    name: "update_author_intent",
    description: "更新书级长期意图文档 author_intent.md。用于修改这本书长期想成为什么。",
    parameters: {
      type: "object",
      properties: {
        bookId: { type: "string", description: "书籍ID" },
        content: { type: "string", description: "author_intent.md 的完整新内容" },
      },
      required: ["bookId", "content"],
    },
  },
  {
    name: "update_current_focus",
    description: "更新当前关注点文档 current_focus.md。用于把最近几章的注意力拉回某条主线或冲突。",
    parameters: {
      type: "object",
      properties: {
        bookId: { type: "string", description: "书籍ID" },
        content: { type: "string", description: "current_focus.md 的完整新内容" },
      },
      required: ["bookId", "content"],
    },
  },
  {
    name: "get_book_status",
    description: "获取书籍状态概览：章数、字数、最近章节审计情况。",
    parameters: {
      type: "object",
      properties: {
        bookId: { type: "string", description: "书籍ID" },
      },
      required: ["bookId"],
    },
  },
  {
    name: "read_truth_files",
    description: "读取书籍的长期记忆（状态卡、资源账本、伏笔池）+ 世界观和卷纲。",
    parameters: {
      type: "object",
      properties: {
        bookId: { type: "string", description: "书籍ID" },
      },
      required: ["bookId"],
    },
  },
  {
    name: "list_books",
    description: "列出所有书籍。",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "write_full_pipeline",
    description: "完整管线：写草稿 → 审计 → 自动修订（如需要）。一键完成。",
    parameters: {
      type: "object",
      properties: {
        bookId: { type: "string", description: "书籍ID" },
        count: { type: "number", description: "连续写几章（默认1）" },
      },
      required: ["bookId"],
    },
  },
  {
    name: "web_fetch",
    description: "抓取指定URL的文本内容。用于读取搜索结果中的详细页面。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "要抓取的URL" },
        maxChars: { type: "number", description: "最大返回字符数（默认8000）" },
      },
      required: ["url"],
    },
  },
  {
    name: "import_style",
    description: "从参考文本生成文风指南（统计 + LLM定性分析）。生成 style_profile.json 和 style_guide.md。",
    parameters: {
      type: "object",
      properties: {
        bookId: { type: "string", description: "目标书籍ID" },
        referenceText: { type: "string", description: "参考文本（至少2000字）" },
      },
      required: ["bookId", "referenceText"],
    },
  },
  {
    name: "import_canon",
    description: "从正传导入正典参照，生成 parent_canon.md，启用番外写作和审计模式。",
    parameters: {
      type: "object",
      properties: {
        targetBookId: { type: "string", description: "番外书籍ID" },
        parentBookId: { type: "string", description: "正传书籍ID" },
      },
      required: ["targetBookId", "parentBookId"],
    },
  },
  {
    name: "import_chapters",
    description: "【整书重导】导入已有章节。从完整文本中自动分割所有章节，逐章分析并重建全部真相文件。这是整书级操作，不是补某一章的工具。导入后可用 write_draft 续写。",
    parameters: {
      type: "object",
      properties: {
        bookId: { type: "string", description: "目标书籍ID" },
        text: { type: "string", description: "包含多章的完整文本" },
        splitPattern: { type: "string", description: "章节分割正则（可选，默认匹配'第X章'）" },
      },
      required: ["bookId", "text"],
    },
  },
  {
    name: "write_truth_file",
    description: "【整文件覆盖】直接替换书的真相文件内容。用于扩展大纲、修改世界观、调整规则。注意：这是整文件覆盖写入，不是追加；不要用来改 current_state.md 的章节进度指针或 hack 章节号；不要用来补空章节。",
    parameters: {
      type: "object",
      properties: {
        bookId: { type: "string", description: "书籍ID" },
        fileName: { type: "string", description: "文件名（如 volume_outline.md、story_bible.md、book_rules.md、current_state.md、pending_hooks.md）" },
        content: { type: "string", description: "新的完整文件内容" },
      },
      required: ["bookId", "fileName", "content"],
    },
  },
];

export interface AgentLoopOptions {
  readonly onToolCall?: (name: string, args: Record<string, unknown>) => void;
  readonly onToolResult?: (name: string, result: string) => void;
  readonly onMessage?: (content: string) => void;
  readonly maxTurns?: number;
}

export async function runAgentLoop(
  config: PipelineConfig,
  instruction: string,
  options?: AgentLoopOptions,
): Promise<string> {
  const pipeline = new PipelineRunner(config);
  const { StateManager } = await import("../state/manager.js");
  const state = new StateManager(config.projectRoot);

  const messages: AgentMessage[] = [
    {
      role: "system",
      content: `你是 InkOS 小说写作 Agent。用户是小说作者，你帮他管理从建书到成稿的全过程。

## 工具

| 工具 | 作用 |
|------|------|
| list_books | 列出所有书 |
| get_book_status | 查看书的章数、字数、审计状态 |
| read_truth_files | 读取长期记忆（状态卡、资源账本、伏笔池）和设定（世界观、卷纲、本书规则） |
| create_book | 建书，生成世界观、卷纲、本书规则（自动加载题材 genre profile） |
| plan_chapter | 先生成 chapter intent，确认本章目标/冲突/优先级 |
| compose_chapter | 再生成 runtime context/rule stack，确认实际输入 |
| write_draft | 写【下一章】草稿（只能续写最新章之后，不能补历史章） |
| audit_chapter | 审计章节（32维度，按题材条件启用，含AI痕迹+敏感词检测） |
| revise_chapter | 修订章节文字质量（不能补空章/改章号，五种模式） |
| update_author_intent | 更新书级长期意图 author_intent.md |
| update_current_focus | 更新当前关注点 current_focus.md |
| write_full_pipeline | 完整管线：写 → 审 → 改（如需要） |
| scan_market | 扫描平台排行榜，分析市场趋势 |
| web_fetch | 抓取指定URL的文本内容 |
| import_style | 从参考文本生成文风指南（统计+LLM分析） |
| import_canon | 从正传导入正典参照，启用番外模式 |
| import_chapters | 【整书重导】导入全部已有章节并重建真相文件 |
| write_truth_file | 【整文件覆盖】替换真相文件内容，不能用来改章节进度 |

## 长期记忆

每本书有两层控制面：
- **author_intent.md** — 这本书长期想成为什么
- **current_focus.md** — 最近 1-3 章要把注意力拉回哪里

以及七个长期记忆文件，是 Agent 写作和审计的事实依据：
- **current_state.md** — 角色位置、关系、已知信息、当前冲突
- **particle_ledger.md** — 物品/资源账本，每笔增减有据可查
- **pending_hooks.md** — 已埋伏笔、推进状态、预期回收时机
- **chapter_summaries.md** — 每章压缩摘要（人物、事件、伏笔、情绪）
- **subplot_board.md** — 支线进度板
- **emotional_arcs.md** — 角色情感弧线
- **character_matrix.md** — 角色交互矩阵与信息边界

## 管线逻辑

- audit 返回 passed=true → 不需要 revise
- audit 返回 passed=false 且有 critical → 调 revise，改完可以再 audit
- write_full_pipeline 会自动走完 写→审→改，适合不需要中间干预的场景

## 规则

- 用户提供了题材/创意但没说要扫描市场 → 跳过 scan_market，直接 create_book
- 用户说了书名/bookId → 直接操作，不需要先 list_books
- 每完成一步，简要汇报进展
- 当用户要求“先把注意力拉回某条线”时，优先 update_current_focus，然后 plan_chapter / compose_chapter，再决定是否 write_draft 或 write_full_pipeline
- 仿写流程：用户提供参考文本 → import_style → 生成 style_guide.md，后续写作自动参照
- 番外流程：先 create_book 建番外书 → import_canon 导入正传正典 → 然后正常 write_draft
- 续写流程：用户提供已有章节 → import_chapters → 然后 write_draft 续写

## 禁止事项（严格遵守）

- 不要用 write_draft 补历史中间章节。write_draft 只能写【当前最新章之后的下一章】
- 不要用 import_chapters 修补某一个空章。import_chapters 是整书级重导工具
- 不要用 write_truth_file 修改 current_state.md 的章节进度来"骗"系统跳到某一章
- 不要用 revise_chapter 补缺失章节或改章节号。revise 只做文字质量修订
- 用户说"补第 N 章"或"第 N 章是空的"时，先用 get_book_status 和 read_truth_files 判断真实状态，再决定用哪个工具
- 不要在没有确认书籍状态的情况下直接调用写作工具`,
    },
    { role: "user", content: instruction },
  ];

  const maxTurns = options?.maxTurns ?? 20;
  let lastAssistantMessage = "";

  for (let turn = 0; turn < maxTurns; turn++) {
    const result = await chatWithTools(config.client, config.model, messages, TOOLS);

    // Push assistant message to history
    messages.push({
      role: "assistant" as const,
      content: result.content || null,
      ...(result.toolCalls.length > 0 ? { toolCalls: result.toolCalls } : {}),
    });

    if (result.content) {
      lastAssistantMessage = result.content;
      options?.onMessage?.(result.content);
    }

    // If no tool calls, we're done
    if (result.toolCalls.length === 0) break;

    // Execute tool calls
    for (const toolCall of result.toolCalls) {
      let toolResult: string;
      try {
        const args = JSON.parse(toolCall.arguments) as Record<string, unknown>;
        options?.onToolCall?.(toolCall.name, args);
        toolResult = await executeTool(pipeline, state, config, toolCall.name, args);
      } catch (e) {
        toolResult = JSON.stringify({ error: String(e) });
      }

      options?.onToolResult?.(toolCall.name, toolResult);
      messages.push({ role: "tool" as const, toolCallId: toolCall.id, content: toolResult });
    }
  }

  return lastAssistantMessage;
}

export async function executeAgentTool(
  pipeline: PipelineRunner,
  state: import("../state/manager.js").StateManager,
  config: PipelineConfig,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "plan_chapter": {
      const result = await pipeline.planChapter(
        args.bookId as string,
        args.guidance as string | undefined,
      );
      return JSON.stringify(result);
    }

    case "compose_chapter": {
      const result = await pipeline.composeChapter(
        args.bookId as string,
        args.guidance as string | undefined,
      );
      return JSON.stringify(result);
    }

    case "write_draft": {
      const bookId = args.bookId as string;
      const writeGuardError = await getSequentialWriteGuardError(state, bookId, "write_draft");
      if (writeGuardError) {
        return JSON.stringify({ error: writeGuardError });
      }
      const result = await pipeline.writeDraft(
        bookId,
        args.guidance as string | undefined,
      );
      return JSON.stringify(result);
    }

    case "audit_chapter": {
      const result = await pipeline.auditDraft(
        args.bookId as string,
        args.chapterNumber as number | undefined,
      );
      return JSON.stringify(result);
    }

    case "revise_chapter": {
      // Guard: target chapter must exist and have content
      const bookId = args.bookId as string;
      const chapterNum = args.chapterNumber as number | undefined;
      if (chapterNum !== undefined) {
        const index = await state.loadChapterIndex(bookId);
        const chapter = index.find((ch) => ch.number === chapterNum);
        if (!chapter) {
          return JSON.stringify({ error: `第${chapterNum}章不存在。revise_chapter 只能修订已有章节，不能用来补写缺失章节。请用 get_book_status 确认。` });
        }
        if (chapter.wordCount === 0) {
          return JSON.stringify({ error: `第${chapterNum}章内容为空（0字）。revise_chapter 不能修订空章节。` });
        }
      }
      const result = await pipeline.reviseDraft(
        bookId,
        chapterNum,
        (args.mode as ReviseMode) ?? DEFAULT_REVISE_MODE,
      );
      return JSON.stringify(result);
    }

    case "scan_market": {
      const result = await pipeline.runRadar();
      return JSON.stringify(result);
    }

    case "create_book": {
      const now = new Date().toISOString();
      const title = args.title as string;
      const bookId = title
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff]/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 30);

      const book = {
        id: bookId,
        title,
        platform: ((args.platform as string) ?? "tomato") as Platform,
        genre: ((args.genre as string) ?? "xuanhuan") as Genre,
        status: "outlining" as const,
        targetChapters: 200,
        chapterWordCount: 3000,
        createdAt: now,
        updatedAt: now,
      };

      const brief = args.brief as string | undefined;
      if (brief) {
        const contextPipeline = new PipelineRunner({ ...config, externalContext: brief });
        await contextPipeline.initBook(book);
      } else {
        await pipeline.initBook(book);
      }

      return JSON.stringify({ bookId, title, status: "created" });
    }

    case "get_book_status": {
      const result = await pipeline.getBookStatus(args.bookId as string);
      return JSON.stringify(result);
    }

    case "update_author_intent": {
      await state.ensureControlDocuments(args.bookId as string);
      const { writeFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const storyDir = join(state.bookDir(args.bookId as string), "story");
      await writeFile(join(storyDir, "author_intent.md"), args.content as string, "utf-8");
      return JSON.stringify({ bookId: args.bookId, file: "story/author_intent.md", written: true });
    }

    case "update_current_focus": {
      await state.ensureControlDocuments(args.bookId as string);
      const { writeFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const storyDir = join(state.bookDir(args.bookId as string), "story");
      await writeFile(join(storyDir, "current_focus.md"), args.content as string, "utf-8");
      return JSON.stringify({ bookId: args.bookId, file: "story/current_focus.md", written: true });
    }

    case "read_truth_files": {
      const result = await pipeline.readTruthFiles(args.bookId as string);
      return JSON.stringify(result);
    }

    case "list_books": {
      const bookIds = await state.listBooks();
      const books = await Promise.all(
        bookIds.map(async (id) => {
          try {
            return await pipeline.getBookStatus(id);
          } catch {
            return { bookId: id, error: "failed to load" };
          }
        }),
      );
      return JSON.stringify(books);
    }

    case "write_full_pipeline": {
      const bookId = args.bookId as string;
      const writeGuardError = await getSequentialWriteGuardError(state, bookId, "write_full_pipeline");
      if (writeGuardError) {
        return JSON.stringify({ error: writeGuardError });
      }
      const count = (args.count as number) ?? 1;
      const results = [];
      for (let i = 0; i < count; i++) {
        const result = await pipeline.writeNextChapter(bookId);
        results.push(result);
      }
      return JSON.stringify(results);
    }

    case "web_fetch": {
      const { fetchUrl } = await import("../utils/web-search.js");
      const text = await fetchUrl(args.url as string, (args.maxChars as number) ?? 8000);
      return JSON.stringify({ url: args.url, content: text });
    }

    case "import_style": {
      const guide = await pipeline.generateStyleGuide(
        args.bookId as string,
        args.referenceText as string,
      );
      return JSON.stringify({
        bookId: args.bookId,
        statsProfile: "story/style_profile.json",
        styleGuide: "story/style_guide.md",
        guidePreview: guide.slice(0, 500),
      });
    }

    case "import_canon": {
      const canon = await pipeline.importCanon(
        args.targetBookId as string,
        args.parentBookId as string,
      );
      return JSON.stringify({
        targetBookId: args.targetBookId,
        parentBookId: args.parentBookId,
        output: "story/parent_canon.md",
        canonPreview: canon.slice(0, 500),
      });
    }

    case "import_chapters": {
      const { splitChapters } = await import("../utils/chapter-splitter.js");
      const chapters = splitChapters(
        args.text as string,
        args.splitPattern as string | undefined,
      );
      if (chapters.length === 0) {
        return JSON.stringify({ error: "No chapters found. Check text format or provide a splitPattern." });
      }
      // Guard: import_chapters is a whole-book reimport, not a single-chapter patch
      if (chapters.length === 1) {
        return JSON.stringify({ error: "import_chapters 是整书重导工具，需要至少 2 个章节。如果只想补一章，请用 write_draft 续写或 revise_chapter 修订。" });
      }
      const result = await pipeline.importChapters({
        bookId: args.bookId as string,
        chapters: [...chapters],
      });
      return JSON.stringify(result);
    }

    case "write_truth_file": {
      const bookId = args.bookId as string;
      const fileName = args.fileName as string;
      const content = args.content as string;

      // Whitelist allowed truth files
      const ALLOWED_FILES = [
        "story_bible.md", "volume_outline.md", "book_rules.md",
        "current_state.md", "particle_ledger.md", "pending_hooks.md",
        "chapter_summaries.md", "subplot_board.md", "emotional_arcs.md",
        "character_matrix.md", "style_guide.md",
      ];

      if (!ALLOWED_FILES.includes(fileName)) {
        return JSON.stringify({ error: `不允许修改文件 "${fileName}"。允许的文件：${ALLOWED_FILES.join(", ")}` });
      }

      // Guard: block chapter progress manipulation via current_state.md
      if (fileName === "current_state.md" && containsProgressManipulation(content)) {
        return JSON.stringify({ error: "不允许通过 write_truth_file 修改 current_state.md 中的章节进度。章节进度由系统自动管理。" });
      }

      const { writeFile, mkdir } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const bookDir = new (await import("../state/manager.js")).StateManager(config.projectRoot).bookDir(bookId);
      const storyDir = join(bookDir, "story");
      await mkdir(storyDir, { recursive: true });
      await writeFile(join(storyDir, fileName), content, "utf-8");

      return JSON.stringify({
        bookId,
        file: `story/${fileName}`,
        written: true,
        size: content.length,
      });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

async function executeTool(
  pipeline: PipelineRunner,
  state: import("../state/manager.js").StateManager,
  config: PipelineConfig,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  return executeAgentTool(pipeline, state, config, name, args);
}

async function getSequentialWriteGuardError(
  state: import("../state/manager.js").StateManager,
  bookId: string,
  toolName: "write_draft" | "write_full_pipeline",
): Promise<string | null> {
  const nextNum = await state.getNextChapterNumber(bookId);
  const index = await state.loadChapterIndex(bookId);
  if (index.length === 0) return null;
  const lastIndexedChapter = index[index.length - 1]!.number;
  if (lastIndexedChapter === nextNum - 1) return null;
  return `${toolName} 只能续写下一章（当前应写第${nextNum}章）。检测到章节索引与运行时进度不一致，请先用 get_book_status 确认状态。`;
}

function containsProgressManipulation(content: string): boolean {
  const patterns = [
    /\blastAppliedChapter\b/i,
    /\|\s*Current Chapter\s*\|\s*\d+\s*\|/i,
    /\|\s*当前章(?:节)?\s*\|\s*\d+\s*\|/,
    /\bCurrent Chapter\b\s*[:：]\s*\d+/i,
    /当前章(?:节)?\s*[:：]\s*\d+/,
    /\bprogress\b\s*[:：]\s*\d+/i,
    /进度\s*[:：]\s*\d+/,
  ];
  return patterns.some((pattern) => pattern.test(content));
}

/** Export tool definitions so external systems can reference them. */
export { TOOLS as AGENT_TOOLS };
