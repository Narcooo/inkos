import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createInkosMcpService } from "./mcp-service.js";
import type {
  AgentCommitBookInput,
  AgentCommitChapterInput,
  AgentContinuePlanInput,
  AgentCreateBookPlanInput,
  AgentImportPlanInput,
  ContextBundleInput,
  ExportBookInput,
  ImportCommitInput,
  ImportPreviewInput,
  InkosMcpService,
  UpdateControlDocInput,
  WriteAgentChapterInput,
} from "./types.js";

export function createInkosMcpServer(options: { readonly cwd?: string } = {}): McpServer {
  const service = createInkosMcpService({ cwd: options.cwd });
  const server = new McpServer({
    name: "inkos-mcp",
    version: "1.5.0",
  });

  registerTools(server, service);
  registerResources(server, service);
  registerPrompts(server);

  return server;
}

export async function runStdioServer(options: { readonly cwd?: string } = {}): Promise<void> {
  const server = createInkosMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function registerTools(server: McpServer, service: InkosMcpService): void {
  tool(server, "inkos_get_started", "Return InkOS MCP external-agent mode instructions, current project status, and recommended next actions.", {}, () => service.getStarted());
  tool(server, "inkos_project_status", "Read current InkOS project status without writes or LLM calls.", {}, () => service.projectStatus());
  tool(server, "inkos_list_books", "List books in the current InkOS project without LLM calls.", {}, () => service.listBooks());
  tool(
    server,
    "inkos_agent_create_book_plan",
    "Prepare a book-foundation task for the external agent LLM. Does not call InkOS internal LLM.",
    {
      title: z.string(),
      bookId: z.string().optional(),
      brief: z.string().optional(),
      genre: z.string().optional(),
      language: z.enum(["zh", "en"]).optional(),
      platform: z.enum(["tomato", "feilu", "qidian", "other"]).optional(),
    },
    (input) => service.agentCreateBookPlan(input as unknown as AgentCreateBookPlanInput),
  );
  tool(
    server,
    "inkos_agent_commit_book",
    "Create an InkOS book from external-agent generated foundation files. Does not call InkOS internal LLM.",
    {
      title: z.string(),
      bookId: z.string().optional(),
      genre: z.string().optional(),
      language: z.enum(["zh", "en"]).optional(),
      platform: z.enum(["tomato", "feilu", "qidian", "other"]).optional(),
      targetChapters: z.number().int().min(1).optional(),
      chapterWordCount: z.number().int().min(1).optional(),
      foundationFiles: z.object({
        authorIntent: z.string().optional(),
        currentFocus: z.string().optional(),
        notes: z.string().optional(),
        storyBible: z.string().optional(),
        bookRules: z.string().optional(),
        styleNotes: z.string().optional(),
        currentState: z.string().optional(),
        pendingHooks: z.string().optional(),
      }).optional(),
      dryRun: z.boolean().optional(),
    },
    (input) => service.agentCommitBook(input as unknown as AgentCommitBookInput),
  );
  tool(
    server,
    "inkos_agent_import_plan",
    "Prepare an import settlement task for the external agent LLM. Does not call InkOS internal LLM.",
    {
      sourcePath: z.string(),
      bookId: z.string().optional(),
      splitPattern: z.string().optional(),
      encoding: z.string().optional(),
      resumeFrom: z.number().int().min(1).optional(),
      importMode: z.enum(["continuation", "series"]).optional(),
      maxChars: z.number().int().min(500).max(100_000).optional(),
    },
    (input) => service.agentImportPlan(input as unknown as AgentImportPlanInput),
  );
  tool(
    server,
    "inkos_agent_continue_plan",
    "Prepare a continuation task and bounded context bundle for the external agent LLM.",
    {
      bookId: z.string().optional(),
      chapterWindow: z.number().int().min(1).max(20).optional(),
      maxChars: z.number().int().min(500).max(100_000).optional(),
    },
    (input) => service.agentContinuePlan(input as unknown as AgentContinuePlanInput),
  );
  tool(
    server,
    "inkos_agent_commit_chapter",
    "Commit external-agent generated chapter text and truth/state updates. Does not call InkOS internal LLM.",
    {
      bookId: z.string().optional(),
      chapterNumber: z.number().int().min(1).optional(),
      title: z.string().optional(),
      content: z.string(),
      summary: z.string().optional(),
      notes: z.string().optional(),
      approve: z.boolean().optional(),
      truthFiles: z.object({
        currentState: z.string().optional(),
        pendingHooks: z.string().optional(),
        authorIntent: z.string().optional(),
        currentFocus: z.string().optional(),
        notes: z.string().optional(),
        styleNotes: z.string().optional(),
        chapterSummaries: z.string().optional(),
      }).optional(),
    },
    (input) => service.agentCommitChapter(input as unknown as AgentCommitChapterInput),
  );
  tool(
    server,
    "inkos_inspect_book",
    "Inspect one book's metadata, chapter index, recent snippets, control docs, and import risks.",
    {
      bookId: z.string().optional(),
      maxChars: z.number().int().min(500).max(50_000).optional(),
    },
    (input) => service.inspectBook(input),
  );
  tool(
    server,
    "inkos_import_preview",
    "Preview deterministic no-LLM import from a .txt/.md file or directory. Does not write files.",
    {
      sourcePath: z.string(),
      bookId: z.string().optional(),
      splitPattern: z.string().optional(),
      encoding: z.string().optional(),
    },
    (input) => service.importPreview(input as unknown as ImportPreviewInput),
  );
  tool(
    server,
    "inkos_import_commit",
    "Commit deterministic no-LLM import into an InkOS book and write an import report.",
    {
      sourcePath: z.string(),
      bookId: z.string().optional(),
      title: z.string().optional(),
      splitPattern: z.string().optional(),
      encoding: z.string().optional(),
      mode: z.enum(["append", "replace", "new-book"]),
      dryRun: z.boolean().optional(),
    },
    (input) => service.importCommit(input as unknown as ImportCommitInput),
  );
  tool(
    server,
    "inkos_get_context_bundle",
    "Build a budgeted context bundle for an external agent. Does not call InkOS internal LLM.",
    {
      bookId: z.string().optional(),
      purpose: z.enum(["continue", "revise", "summarize", "inspect"]),
      chapterWindow: z.number().int().min(1).max(20).optional(),
      maxChars: z.number().int().min(500).max(100_000).optional(),
    },
    (input) => service.getContextBundle(input as unknown as ContextBundleInput),
  );
  tool(
    server,
    "inkos_update_control_doc",
    "Update author intent, current focus, or notes with a traceable backup.",
    {
      bookId: z.string().optional(),
      doc: z.enum(["author_intent", "current_focus", "notes"]),
      content: z.string(),
      append: z.boolean().optional(),
    },
    (input) => service.updateControlDoc(input as unknown as UpdateControlDocInput),
  );
  tool(
    server,
    "inkos_write_agent_chapter",
    "Write a chapter generated by an external agent into InkOS and update the chapter index.",
    {
      bookId: z.string().optional(),
      title: z.string().optional(),
      chapterNumber: z.number().int().min(1).optional(),
      content: z.string(),
      summary: z.string().optional(),
      notes: z.string().optional(),
      approve: z.boolean().optional(),
    },
    (input) => service.writeAgentChapter(input as unknown as WriteAgentChapterInput),
  );
  tool(
    server,
    "inkos_export_book",
    "Export an InkOS book through existing export artifact logic without LLM calls.",
    {
      bookId: z.string().optional(),
      format: z.enum(["md", "txt", "epub"]),
      outputPath: z.string().optional(),
    },
    (input) => service.exportBook(input as unknown as ExportBookInput),
  );
  tool(
    server,
    "inkos_diagnose_import",
    "Diagnose import/read failures such as missing chapter index entries or control docs.",
    { bookId: z.string().optional() },
    (input) => service.diagnoseImport(input),
  );
  tool(
    server,
    "inkos_repair_project_index",
    "Repair chapter index entries for existing chapter files. Dry run defaults to true.",
    {
      bookId: z.string().optional(),
      dryRun: z.boolean().optional(),
    },
    (input) => service.repairProjectIndex(input),
  );
}

function registerResources(server: McpServer, service: InkosMcpService): void {
  server.registerResource(
    "inkos_project_manifest",
    "inkos://project/manifest",
    {
      title: "InkOS project manifest",
      description: "Current project inkos.json. Secrets and .env files are not exposed.",
      mimeType: "application/json",
    },
    async (uri) => resourceResult(uri.href, await service.readResource("inkos://project/manifest")),
  );
  server.registerResource(
    "inkos_books",
    "inkos://books",
    {
      title: "InkOS books",
      description: "List of books in the current InkOS project.",
      mimeType: "application/json",
    },
    async (uri) => resourceResult(uri.href, await service.readResource("inkos://books")),
  );
  server.registerResource(
    "inkos_book_manifest",
    new ResourceTemplate("inkos://book/{bookId}/manifest", { list: undefined }),
    {
      title: "InkOS book manifest",
      description: "A book's book.json manifest.",
      mimeType: "application/json",
    },
    async (uri) => resourceResult(uri.href, await service.readResource(uri.href)),
  );
  server.registerResource(
    "inkos_book_chapters",
    new ResourceTemplate("inkos://book/{bookId}/chapters", { list: undefined }),
    {
      title: "InkOS book chapters",
      description: "A book's chapters/index.json metadata.",
      mimeType: "application/json",
    },
    async (uri) => resourceResult(uri.href, await service.readResource(uri.href)),
  );
  server.registerResource(
    "inkos_book_chapter",
    new ResourceTemplate("inkos://book/{bookId}/chapter/{chapterNumber}", { list: undefined }),
    {
      title: "InkOS chapter markdown",
      description: "Exact chapter markdown by chapter number.",
      mimeType: "text/markdown",
    },
    async (uri) => resourceResult(uri.href, await service.readResource(uri.href)),
  );
  server.registerResource(
    "inkos_book_context_continue",
    new ResourceTemplate("inkos://book/{bookId}/context/continue", { list: undefined }),
    {
      title: "InkOS continue context",
      description: "Budgeted default continuation context bundle.",
      mimeType: "application/json",
    },
    async (uri) => resourceResult(uri.href, await service.readResource(uri.href)),
  );
}

function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "inkos_start",
    {
      title: "Start InkOS MCP",
      description: "Guide an external agent to start with project status and a Studio-style operation menu.",
    },
    () => promptText([
      "你正在通过 InkOS MCP external-agent mode 操作项目。",
      "先调用 inkos_project_status，再调用 inkos_list_books。",
      "然后用中文列出 Studio 风格的可用操作：创建书籍、导入已有小说、继续写作、查看项目、读取上下文、更新控制文档、写回章节、导出、诊断和修复。",
      "需要 LLM 的生成、分析、settlement 都由当前外部 agent 自己完成；不要要求用户配置 InkOS LLM API Key。",
      "Agent-mediated 工具可用：inkos_agent_create_book_plan、inkos_agent_commit_book、inkos_agent_import_plan、inkos_agent_continue_plan、inkos_agent_commit_chapter。",
      "确定性读写工具可用：inkos_import_preview、inkos_import_commit、inkos_get_context_bundle、inkos_update_control_doc、inkos_write_agent_chapter、inkos_export_book、inkos_diagnose_import、inkos_repair_project_index。",
      "不要一上来调用写作或写入工具；先询问用户下一步要做什么。",
    ].join("\n")),
  );
  server.registerPrompt(
    "inkos_import_existing_novel",
    {
      title: "Import Existing Novel",
      description: "Guide agent-mediated import preview, commit, and settlement for an existing novel.",
    },
    () => promptText([
      "询问用户 sourcePath、目标 bookId、导入模式，以及是否需要你整理 truth/state。",
      "先调用 inkos_import_preview 展示章节数量、标题、异常和建议。",
      "用户确认后调用 inkos_import_commit，把章节确定性注册进 InkOS 项目。",
      "如果需要 Studio 风格的导入整理，调用 inkos_agent_import_plan 获取 settlement 任务；由外部 agent 读取上下文并生成 truth/state 文档内容。",
      "生成后用 inkos_update_control_doc 或 inkos_agent_commit_chapter 的 truthFiles 写回必要控制文档；不要调用 InkOS 内部 LLM。",
      "导入后调用 inkos_inspect_book，确认章节索引和控制文档可读。",
    ].join("\n")),
  );
  server.registerPrompt(
    "inkos_continue_existing_book",
    {
      title: "Continue Existing Book",
      description: "Guide external-agent chapter continuation with context bundle and write-back.",
    },
    () => promptText([
      "先调用 inkos_agent_continue_plan 或 inkos_get_context_bundle 获取预算内上下文。",
      "外部 agent 基于 context bundle 自己生成下一章正文、摘要和必要 truth/state 增量。",
      "调用 inkos_agent_commit_chapter 写回章节和 agent 生成的 truth/state；不要调用 InkOS 内部 LLM。",
      "如果需要全文，优先读取精确 chapter resource，不要一次加载整本书。",
    ].join("\n")),
  );
}

function tool<T extends Record<string, unknown>>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: Record<string, z.ZodTypeAny>,
  handler: (input: T) => Promise<unknown>,
): void {
  server.registerTool(
    name,
    { description, inputSchema },
    async (input) => {
      const result = await handler(input as T);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );
}

function resourceResult(uri: string, resource: { readonly mimeType: string; readonly text: string }): { contents: Array<{ uri: string; mimeType: string; text: string }> } {
  return {
    contents: [
      {
        uri,
        mimeType: resource.mimeType,
        text: resource.text,
      },
    ],
  };
}

function promptText(text: string): { messages: Array<{ role: "user"; content: { type: "text"; text: string } }> } {
  return {
    messages: [
      {
        role: "user",
        content: { type: "text", text },
      },
    ],
  };
}
