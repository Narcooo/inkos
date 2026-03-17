import { readFile, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import {
  createLLMClient,
  StateManager,
  type ProjectConfig,
  ProjectConfigSchema,
  type PipelineConfig,
} from "@actalk/inkos-core";

export const GLOBAL_CONFIG_DIR = join(homedir(), ".inkos");
export const GLOBAL_ENV_PATH = join(GLOBAL_CONFIG_DIR, ".env");

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

export async function loadConfig(): Promise<ProjectConfig> {
  const root = findProjectRoot();

  // Load global ~/.inkos/.env first, then project .env overrides
  loadEnv({ path: GLOBAL_ENV_PATH });
  loadEnv({ path: join(root, ".env"), override: true });

  const configPath = join(root, "inkos.json");

  // Step 1: Check file exists — give a clear message if not
  try {
    await access(configPath);
  } catch {
    throw new Error(
      `inkos.json not found in ${root}.\nMake sure you are inside an InkOS project directory (cd into the project created by 'inkos init').`,
    );
  }

  // Step 2: Read and parse — surface real errors instead of swallowing them
  const raw = await readFile(configPath, "utf-8");

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(raw);
  } catch {
    throw new Error(
      `inkos.json in ${root} is not valid JSON.\nCheck the file for syntax errors.`,
    );
  }

  // .env overrides inkos.json for LLM settings
  const env = process.env;
  const llm = (config.llm ?? {}) as Record<string, unknown>;

  if (env.INKOS_LLM_PROVIDER) llm.provider = env.INKOS_LLM_PROVIDER;
  if (env.INKOS_LLM_BASE_URL) llm.baseUrl = env.INKOS_LLM_BASE_URL;
  if (env.INKOS_LLM_MODEL) llm.model = env.INKOS_LLM_MODEL;
  if (env.INKOS_LLM_TEMPERATURE) {
    llm.temperature = parseFloat(env.INKOS_LLM_TEMPERATURE);
  }
  if (env.INKOS_LLM_MAX_TOKENS) {
    llm.maxTokens = parseInt(env.INKOS_LLM_MAX_TOKENS, 10);
  }
  if (env.INKOS_LLM_THINKING_BUDGET) {
    llm.thinkingBudget = parseInt(env.INKOS_LLM_THINKING_BUDGET, 10);
  }
  if (env.INKOS_LLM_API_FORMAT) llm.apiFormat = env.INKOS_LLM_API_FORMAT;

  config.llm = llm;

  // API key ONLY from env — never stored in inkos.json
  const apiKey = env.INKOS_LLM_API_KEY;
  if (!apiKey) {
    throw new Error(
      "INKOS_LLM_API_KEY not set.\nRun 'inkos config set-global' or add it to project .env file.",
    );
  }
  llm.apiKey = apiKey;

  // Build notify channels from env and append them to inkos.json notify[]
  const envNotify: unknown[] = [];

  if (env.INKOS_SERVERCHAN_SEND_URL) {
    envNotify.push({
      type: "serverchan",
      sendUrl: env.INKOS_SERVERCHAN_SEND_URL,
    });
  }

  if (env.INKOS_BARK_DEVICE_KEY) {
    envNotify.push({
      type: "bark",
      serverUrl: env.INKOS_BARK_SERVER_URL ?? "https://api.day.app",
      deviceKey: env.INKOS_BARK_DEVICE_KEY,
      group: env.INKOS_BARK_GROUP || "InkOS",
      level: env.INKOS_BARK_LEVEL ?? "active",
      sound: env.INKOS_BARK_SOUND || undefined,
      icon: env.INKOS_BARK_ICON || undefined,
      url: env.INKOS_BARK_URL || undefined,
    });
  }

  config.notify = [
    ...(((config.notify ?? []) as unknown[]) || []),
    ...envNotify,
  ];

  return ProjectConfigSchema.parse(config);
}

export function createClient(config: ProjectConfig) {
  return createLLMClient(config.llm);
}

export function buildPipelineConfig(
  config: ProjectConfig,
  root: string,
  extra?: Partial<PipelineConfig>,
): PipelineConfig {
  return {
    client: createLLMClient(config.llm),
    model: config.llm.model,
    projectRoot: root,
    defaultLLMConfig: config.llm,
    modelOverrides: config.modelOverrides,
    notifyChannels: extra?.notifyChannels ?? config.notify,
    radarSources: extra?.radarSources,
    externalContext: extra?.externalContext,
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
      "No books found.\nCreate one first:\n  inkos book create --title '...' --genre xuanhuan",
    );
  }

  if (books.length === 1) {
    return books[0]!;
  }

  throw new Error(
    `Multiple books found: ${books.join(", ")}\nPlease specify a book-id.`,
  );
}
