import { readFile, stat, writeFile, mkdir, access } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { createInterface } from "node:readline";
import { createLLMClient, StateManager, createLogger, createStderrSink, createJsonLineSink, loadProjectConfig, GLOBAL_CONFIG_DIR, GLOBAL_ENV_PATH, type ProjectConfig, type PipelineConfig, type LogSink } from "@actalk/inkos-core";
import { formatSqliteMemorySupportWarning } from "./runtime-requirements.js";

export { GLOBAL_CONFIG_DIR, GLOBAL_ENV_PATH };

let sqliteMemorySupportWarned = false;

export async function resolveContext(opts: {
  readonly context?: string;
  readonly contextFile?: string;
}): Promise<string | undefined> {
  if (opts.context) return opts.context;
  if (opts.contextFile) {
    return readFile(resolve(opts.contextFile), "utf-8");
  }
  // Read from stdin if piped (non-TTY)
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const text = Buffer.concat(chunks).toString("utf-8").trim();
    if (text.length > 0) return text;
  }
  return undefined;
}

export function findProjectRoot(): string {
  return process.cwd();
}

export async function loadConfig(options?: { readonly requireApiKey?: boolean; readonly projectRoot?: string }): Promise<ProjectConfig> {
  const root = options?.projectRoot ?? findProjectRoot();
  try {
    return await loadProjectConfig(root, options);
  } catch (e) {
    if (e instanceof Error && e.message.includes("inkos.json not found") && process.stdin.isTTY) {
      const confirmed = await promptYesNo("当前目录还没有初始化 InkOS 项目，要在这里创建一个吗？");
      if (confirmed) {
        await autoInit(root);
        return loadProjectConfig(root, options);
      }
    }
    throw e;
  }
}

async function promptYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} (Y/n) `, (answer) => {
      rl.close();
      resolve(!answer || answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

async function autoInit(root: string): Promise<void> {
  await mkdir(join(root, "books"), { recursive: true });
  await mkdir(join(root, "radar"), { recursive: true });

  const config = {
    name: basename(root),
    version: "0.1.0",
    language: "zh",
    llm: {
      provider: process.env.INKOS_LLM_PROVIDER ?? "openai",
      baseUrl: process.env.INKOS_LLM_BASE_URL ?? "",
      model: process.env.INKOS_LLM_MODEL ?? "",
    },
    notify: [],
    daemon: {
      schedule: {
        radarCron: "0 */6 * * *",
        writeCron: "*/15 * * * *",
      },
      maxConcurrentBooks: 3,
    },
  };

  await writeFile(join(root, "inkos.json"), JSON.stringify(config, null, 2), "utf-8");

  // 如果已有全局配置，项目 .env 只留注释；否则引导填写
  let hasGlobal = false;
  try {
    const content = await readFile(join(GLOBAL_CONFIG_DIR, ".env"), "utf-8");
    hasGlobal = content.includes("INKOS_LLM_API_KEY=") && !content.includes("your-api-key-here");
  } catch { /* no global config */ }

  const envContent = hasGlobal
    ? [
        "# 项目级 LLM 覆盖（可选）",
        "# 全局配置 ~/.inkos/.env 会自动生效。",
        "# 如需单独覆盖，取消下面的注释：",
        "# INKOS_LLM_PROVIDER=openai",
        "# INKOS_LLM_BASE_URL=",
        "# INKOS_LLM_API_KEY=",
        "# INKOS_LLM_MODEL=",
      ].join("\n")
    : [
        "# LLM 配置",
        "# 推荐：运行 inkos config set-global 一次性设好全局配置。",
        "INKOS_LLM_PROVIDER=openai",
        "INKOS_LLM_BASE_URL=",
        "INKOS_LLM_API_KEY=",
        "INKOS_LLM_MODEL=",
      ].join("\n");

  await writeFile(join(root, ".env"), envContent, "utf-8");

  // 只在 .gitignore 不存在时写入
  try {
    await access(join(root, ".gitignore"));
  } catch {
    await writeFile(join(root, ".gitignore"), [".env", "node_modules/", ".DS_Store"].join("\n"), "utf-8");
  }

  log(`项目已初始化：${root}`);
  if (!hasGlobal) {
    log("下一步：运行 inkos config set-global 配置 LLM，或编辑 .env 文件。");
  }
}

export function createClient(config: ProjectConfig) {
  return createLLMClient(config.llm);
}

export function buildPipelineConfig(
  config: ProjectConfig,
  root: string,
  extra?: Partial<Pick<PipelineConfig, "notifyChannels" | "radarSources" | "externalContext" | "inputGovernanceMode">> & {
    readonly quiet?: boolean;
    readonly logFile?: NodeJS.WritableStream;
  },
): PipelineConfig {
  if (!extra?.quiet && !sqliteMemorySupportWarned) {
    const warning = formatSqliteMemorySupportWarning();
    if (warning) {
      sqliteMemorySupportWarned = true;
      process.stderr.write(`[WARN] ${warning}\n`);
    }
  }

  const sinks: LogSink[] = [];
  if (!extra?.quiet) {
    sinks.push(createStderrSink({ minLevel: "info" }));
  }
  if (extra?.logFile) {
    sinks.push(createJsonLineSink(extra.logFile));
  }

  const hasLogging = sinks.length > 0;
  const logger = hasLogging ? createLogger({ tag: "inkos", sinks }) : undefined;

  const onStreamProgress = hasLogging
    ? (progress: { readonly elapsedMs: number; readonly totalChars: number; readonly chineseChars: number; readonly status: string }) => {
        if (progress.status === "streaming") {
          logger?.info(
            `streaming ${Math.round(progress.elapsedMs / 1000)}s, ${progress.totalChars} chars (${progress.chineseChars} CJK)`,
          );
        }
      }
    : undefined;

  return {
    client: createLLMClient(config.llm),
    model: config.llm.model,
    projectRoot: root,
    defaultLLMConfig: config.llm,
    modelOverrides: config.modelOverrides,
    inputGovernanceMode: extra?.inputGovernanceMode ?? config.inputGovernanceMode,
    notifyChannels: extra?.notifyChannels ?? config.notify,
    radarSources: extra?.radarSources,
    externalContext: extra?.externalContext,
    logger,
    onStreamProgress,
  };
}

export function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function logError(message: string): void {
  process.stderr.write(`[ERROR] ${message}\n`);
}

/**
 * Resolve book-id: if provided use it, otherwise auto-detect when exactly one book exists.
 * Validates that the book actually exists.
 */
export async function resolveBookId(
  bookIdArg: string | undefined,
  root: string,
): Promise<string> {
  const state = new StateManager(root);
  const books = await state.listBooks();

  if (bookIdArg) {
    if (!books.includes(bookIdArg)) {
      const available = books.length > 0 ? books.join(", ") : "(none)";
      throw new Error(
        `Book "${bookIdArg}" not found. Available books: ${available}`,
      );
    }
    return bookIdArg;
  }

  if (books.length === 0) {
    throw new Error(
      "No books found. Create one first:\n  inkos book create --title '...' --genre xuanhuan",
    );
  }
  if (books.length === 1) {
    return books[0]!;
  }
  throw new Error(
    `Multiple books found: ${books.join(", ")}\nPlease specify a book-id.`,
  );
}

export async function getLegacyMigrationHint(
  root: string,
  bookId: string,
): Promise<string | null> {
  const state = new StateManager(root);
  const stateDir = join(state.bookDir(bookId), "story", "state");
  try {
    const info = await stat(stateDir);
    if (info.isDirectory()) {
      return null;
    }
  } catch {
    return `Book "${bookId}" uses legacy format (pre-v0.6). The next write will auto-migrate its state files.`;
  }
  return `Book "${bookId}" uses legacy format (pre-v0.6). The next write will auto-migrate its state files.`;
}
