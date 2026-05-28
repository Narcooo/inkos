/* ── Auto-init & environment detection for TUI ── */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import readline from "node:readline/promises";
import { parse as parseEnv } from "dotenv";
import { CODEX_OAUTH_BASE_URL, CODEX_OAUTH_SERVICE_ID, getCodexOAuthStatus } from "@actalk/inkos-core";
import {
  c, bold, dim, italic,
  cyan, green, yellow, gray, red,
  brightCyan, brightGreen, brightWhite,
} from "./ansi.js";
import { resolveTuiLocale, type TuiLocale } from "./i18n.js";
import { GLOBAL_ENV_PATH, loadConfig } from "../utils.js";
import { ensureProjectGitignore } from "../project-bootstrap.js";

const PROVIDERS = ["openai", "anthropic", "kkaiapi", "codexOAuth", "custom"] as const;
const KKAIAPI_BASE_URL = "https://api.kkaiapi.com/v1";
const CODEX_OAUTH_DEFAULT_MODEL = "gpt-5.5";
type SetupProvider = typeof PROVIDERS[number];
type RuntimeProvider = "openai" | "anthropic" | "custom";

function normalizeSetupProvider(provider: string): SetupProvider {
  const normalized = provider.trim().toLowerCase();
  return PROVIDERS.find((candidate) => candidate.toLowerCase() === normalized) ?? "openai";
}

export function resolveSetupProvider(provider: string, baseUrl: string): RuntimeProvider {
  const normalizedProvider = normalizeSetupProvider(provider);
  const normalizedUrl = baseUrl.trim().toLowerCase();
  if (normalizedUrl.includes("api.kimi.com/coding")) {
    return "anthropic";
  }
  if (normalizedProvider === CODEX_OAUTH_SERVICE_ID) {
    return "openai";
  }
  if (normalizedProvider === "anthropic" || normalizedProvider === "custom") {
    return normalizedProvider;
  }
  return "openai";
}

export function resolveSetupService(provider: string, baseUrl: string): string | undefined {
  const normalizedProvider = provider.trim().toLowerCase();
  const normalizedUrl = baseUrl.trim().toLowerCase();
  if (normalizedProvider === CODEX_OAUTH_SERVICE_ID.toLowerCase() || normalizedUrl.includes("chatgpt.com/backend-api/codex")) {
    return CODEX_OAUTH_SERVICE_ID;
  }
  if (normalizedProvider === "kkaiapi" || normalizedUrl.includes("api.kkaiapi.com")) {
    return "kkaiapi";
  }
  return undefined;
}

export function resolveSetupBaseUrl(provider: string, baseUrl: string): string {
  const normalizedProvider = normalizeSetupProvider(provider);
  if (normalizedProvider === CODEX_OAUTH_SERVICE_ID) {
    return CODEX_OAUTH_BASE_URL;
  }
  if (normalizedProvider === "kkaiapi") {
    return baseUrl.trim() || KKAIAPI_BASE_URL;
  }
  return baseUrl.trim();
}

export function resolveSetupModel(provider: string, model: string): string {
  if (normalizeSetupProvider(provider) === CODEX_OAUTH_SERVICE_ID) {
    return model.trim() || CODEX_OAUTH_DEFAULT_MODEL;
  }
  return model.trim();
}

export function buildSetupEnvContent(options: {
  readonly provider: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}): string {
  const effectiveBaseUrl = resolveSetupBaseUrl(options.provider, options.baseUrl);
  const finalProvider = resolveSetupProvider(options.provider, effectiveBaseUrl);
  const finalService = resolveSetupService(options.provider, effectiveBaseUrl);
  const isCodexOAuth = finalService === CODEX_OAUTH_SERVICE_ID;
  const envLines = [
    `INKOS_LLM_PROVIDER=${finalProvider}`,
    ...(finalService ? [`INKOS_LLM_SERVICE=${finalService}`] : []),
    `INKOS_LLM_BASE_URL=${effectiveBaseUrl}`,
    ...(isCodexOAuth ? [] : [`INKOS_LLM_API_KEY=${options.apiKey.trim()}`]),
    `INKOS_LLM_MODEL=${resolveSetupModel(options.provider, options.model)}`,
    ...(isCodexOAuth ? [
      "INKOS_LLM_API_FORMAT=responses",
      "INKOS_LLM_STREAM=true",
    ] : []),
  ];
  return envLines.join("\n");
}

export function hasUsableLlmEnv(content: string): boolean {
  const env = parseEnv(content);
  const apiKey = env.INKOS_LLM_API_KEY?.trim() ?? "";
  if (apiKey.length > 0 && !apiKey.includes("your-api-key")) {
    return true;
  }

  const service = env.INKOS_LLM_SERVICE?.trim().toLowerCase();
  const model = env.INKOS_LLM_MODEL?.trim() ?? "";
  return service === CODEX_OAUTH_SERVICE_ID.toLowerCase() && model.length > 0;
}

interface SetupResult {
  readonly projectRoot: string;
  readonly hasLlmConfig: boolean;
}

export interface InteractiveSetupCopy {
  readonly title: string;
  readonly subtitle: string;
  readonly steps: {
    readonly provider: string;
    readonly baseUrl: string;
    readonly apiKey: string;
    readonly model: string;
    readonly scope: string;
  };
  readonly hints: {
    readonly provider: string;
    readonly baseUrl: string;
    readonly apiKey: string;
    readonly model: string;
    readonly scope: string;
  };
  readonly defaults: {
    readonly provider: string;
    readonly baseUrl: string;
    readonly scope: string;
  };
  readonly scopeChoices: {
    readonly global: string;
    readonly project: string;
  };
  readonly savedTo: string;
}

export function buildInteractiveSetupCopy(locale: TuiLocale): InteractiveSetupCopy {
  if (locale === "en") {
    return {
      title: "LLM Setup",
      subtitle: "Configure your model provider to start writing.",
      steps: {
        provider: "Provider",
        baseUrl: "Base URL",
        apiKey: "API Key",
        model: "Model",
        scope: "Save scope",
      },
      hints: {
        provider: "openai / anthropic / kkaiapi / codexOAuth / custom (OpenAI-compatible proxy)",
        baseUrl: "Your API endpoint",
        apiKey: "Paste an API key, or use the local Codex ChatGPT OAuth login for codexOAuth.",
        model: "e.g. gpt-4o, claude-sonnet-4-20250514, deepseek-chat",
        scope: "global = all projects, project = this directory only",
      },
      defaults: {
        provider: "openai",
        baseUrl: "(default)",
        scope: "[global]",
      },
      scopeChoices: {
        global: "all projects",
        project: "this directory",
      },
      savedTo: "Saved to",
    };
  }

  return {
    title: "模型配置",
    subtitle: "配置模型服务后即可开始使用。",
    steps: {
      provider: "服务提供方",
      baseUrl: "接口地址",
      apiKey: "API 密钥",
      model: "模型",
      scope: "保存范围",
    },
    hints: {
      provider: "openai / anthropic / kkaiapi / codexOAuth / custom（兼容 OpenAI 的代理）",
      baseUrl: "你的 API 入口地址",
      apiKey: "粘贴 API Key；codexOAuth 使用本机 Codex ChatGPT OAuth 登录",
      model: "例如 gpt-5.4、claude-sonnet-4-20250514、deepseek-chat",
      scope: "global = 所有项目，project = 仅当前目录",
    },
    defaults: {
      provider: "openai",
      baseUrl: "（默认）",
      scope: "[global]",
    },
    scopeChoices: {
      global: "所有项目",
      project: "当前目录",
    },
    savedTo: "已保存到",
  };
}

export function buildAutoInitMessages(projectName: string, locale: TuiLocale): {
  readonly initializing: string;
  readonly initialized: string;
  readonly envTemplateHeader: string;
} {
  if (locale === "en") {
    return {
      initializing: `Initializing project in ${projectName}/ ...`,
      initialized: "Project initialized",
      envTemplateHeader: "# LLM Configuration — run inkos tui to configure interactively",
    };
  }

  return {
    initializing: `正在初始化项目：${projectName}/ ...`,
    initialized: "项目已初始化",
    envTemplateHeader: "# LLM 配置 —— 运行 inkos tui 进行交互式配置",
  };
}

export async function ensureProject(cwd: string): Promise<SetupResult> {
  const configPath = join(cwd, "inkos.json");
  const hasConfig = await fileExists(configPath);

  if (!hasConfig) {
    await autoInit(cwd);
  }

  const hasLlm = await hasLlmConfig(cwd);
  return { projectRoot: cwd, hasLlmConfig: hasLlm };
}

export async function interactiveLlmSetup(
  projectRoot: string,
): Promise<void> {
  const projectLanguage = await detectProjectLanguage(projectRoot);
  const locale = resolveTuiLocale(process.env, projectLanguage);
  const copy = buildInteractiveSetupCopy(locale);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log();
    console.log(`  ${c("◈", brightCyan)} ${c(copy.title, bold, brightWhite)}`);
    console.log(c(`  ${copy.subtitle}`, dim));
    console.log();

    // Provider
    console.log(`  ${c("1", cyan)}  ${c(copy.steps.provider, gray)}`);
    console.log(c(`     ${copy.hints.provider}`, dim));
    const providerInput = await rl.question(`     ${c("❯", cyan)} `);
    const provider = providerInput.trim() ? normalizeSetupProvider(providerInput) : copy.defaults.provider as SetupProvider;
    const isCodexOAuth = provider === CODEX_OAUTH_SERVICE_ID;
    const providerDefaultBaseUrl = isCodexOAuth ? CODEX_OAUTH_BASE_URL : provider === "kkaiapi" ? KKAIAPI_BASE_URL : copy.defaults.baseUrl;
    console.log(`     ${c("✓", brightGreen)} ${provider}`);
    console.log();

    // Base URL
    console.log(`  ${c("2", cyan)}  ${c(copy.steps.baseUrl, gray)}`);
    if (isCodexOAuth) {
      console.log(c(`     ${CODEX_OAUTH_BASE_URL}`, dim));
    }
    console.log(c(`     ${copy.hints.baseUrl}`, dim));
    const baseUrl = isCodexOAuth ? "" : await rl.question(`     ${c("❯", cyan)} `);
    console.log(`     ${c("✓", brightGreen)} ${resolveSetupBaseUrl(provider, baseUrl) || providerDefaultBaseUrl}`);
    console.log();

    // API Key
    console.log(`  ${c("3", cyan)}  ${c(copy.steps.apiKey, gray)}`);
    console.log(c(`     ${copy.hints.apiKey}`, dim));
    const apiKey = isCodexOAuth ? "" : await rl.question(`     ${c("❯", cyan)} `);
    if (isCodexOAuth) {
      const status = await getCodexOAuthStatus();
      const statusLabel = status.connected
        ? status.accountId ? `Codex OAuth ${status.accountId}` : "Codex OAuth"
        : status.message ?? "Run `codex login` and choose ChatGPT.";
      console.log(`     ${c(status.connected ? "✓" : "!", status.connected ? brightGreen : yellow)} ${statusLabel}`);
    } else {
      const maskedKey = apiKey.trim().length > 8
        ? apiKey.trim().slice(0, 4) + "···" + apiKey.trim().slice(-4)
        : "···";
      console.log(`     ${c("✓", brightGreen)} ${maskedKey}`);
    }
    console.log();

    // Model
    console.log(`  ${c("4", cyan)}  ${c(copy.steps.model, gray)}`);
    console.log(c(`     ${copy.hints.model}`, dim));
    const model = await rl.question(`     ${c("❯", cyan)} ${isCodexOAuth ? c(`[${CODEX_OAUTH_DEFAULT_MODEL}]`, dim) + " " : ""}`);
    console.log(`     ${c("✓", brightGreen)} ${resolveSetupModel(provider, model)}`);
    console.log();

    // Scope
    console.log(`  ${c("5", cyan)}  ${c(copy.steps.scope, gray)}`);
    console.log(c(`     ${copy.hints.scope}`, dim));
    const scope = await rl.question(`     ${c("❯", cyan)} ${c(copy.defaults.scope, dim)} `);
    const useGlobal = scope.trim().toLowerCase() !== "project";
    const envContent = buildSetupEnvContent({ provider, baseUrl, apiKey, model });

    if (useGlobal) {
      const globalDir = join(GLOBAL_ENV_PATH, "..");
      await mkdir(globalDir, { recursive: true });
      await writeFile(GLOBAL_ENV_PATH, envContent + "\n", "utf-8");
      console.log();
      console.log(`  ${c("✓", brightGreen, bold)} ${c(copy.savedTo, dim)} ${c(GLOBAL_ENV_PATH, gray)}`);
    } else {
      await writeFile(join(projectRoot, ".env"), envContent + "\n", "utf-8");
      console.log();
      console.log(`  ${c("✓", brightGreen, bold)} ${c(copy.savedTo, dim)} ${c(".env", gray)}`);
    }
    console.log();
  } finally {
    rl.close();
  }
}

async function autoInit(cwd: string): Promise<void> {
  const projectName = basename(cwd);
  const locale = resolveTuiLocale();
  const messages = buildAutoInitMessages(projectName, locale);
  console.log();
  console.log(`  ${c("◌", cyan)} ${c(messages.initializing, dim)}`);

  await mkdir(join(cwd, "books"), { recursive: true });
  await mkdir(join(cwd, "radar"), { recursive: true });

  const config = {
    name: projectName,
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

  await writeFile(
    join(cwd, "inkos.json"),
    JSON.stringify(config, null, 2),
    "utf-8",
  );

  const hasGlobal = await hasGlobalConfig();
  if (!hasGlobal) {
    await writeFile(
      join(cwd, ".env"),
      [
        messages.envTemplateHeader,
        "INKOS_LLM_PROVIDER=openai",
        "INKOS_LLM_BASE_URL=",
        "INKOS_LLM_API_KEY=",
        "INKOS_LLM_MODEL=",
      ].join("\n"),
      "utf-8",
    );
  }

  await ensureProjectGitignore(cwd);

  console.log(`  ${c("✓", brightGreen, bold)} ${c(messages.initialized, dim)}`);
}

async function hasLlmConfig(projectRoot: string): Promise<boolean> {
  const projectEnv = join(projectRoot, ".env");
  if (await checkEnvForKey(projectEnv)) return true;
  return checkEnvForKey(GLOBAL_ENV_PATH);
}

async function hasGlobalConfig(): Promise<boolean> {
  return checkEnvForKey(GLOBAL_ENV_PATH);
}

async function checkEnvForKey(envPath: string): Promise<boolean> {
  try {
    const content = await readFile(envPath, "utf-8");
    return hasUsableLlmEnv(content);
  } catch {
    return false;
  }
}

export interface ModelInfo {
  readonly provider: string;
  readonly model: string;
  readonly baseUrl: string;
}

export async function detectModelInfo(projectRoot: string): Promise<ModelInfo | undefined> {
  try {
    const config = await loadConfig({ requireApiKey: false, projectRoot });
    const service = config.llm.service?.trim();
    const provider = service || config.llm.provider || "openai";
    const model = config.llm.model?.trim() || "unknown";
    return {
      provider,
      model,
      baseUrl: config.llm.baseUrl ?? "",
    };
  } catch {
    // Fall back to legacy env parsing below.
  }

  const paths = [join(projectRoot, ".env"), GLOBAL_ENV_PATH];
  for (const p of paths) {
    const info = await parseEnvModel(p);
    if (info) return info;
  }
  return undefined;
}

export async function detectProjectLanguage(projectRoot: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(projectRoot, "inkos.json"), "utf-8");
    const parsed = JSON.parse(raw) as { language?: string };
    return parsed.language;
  } catch {
    return undefined;
  }
}

async function parseEnvModel(envPath: string): Promise<ModelInfo | undefined> {
  try {
    const content = await readFile(envPath, "utf-8");
    const env = parseEnv(content);
    if (!hasUsableLlmEnv(content)) return undefined;
    const get = (key: string) => env[key]?.trim() ?? "";
    return {
      provider: get("INKOS_LLM_SERVICE") || get("INKOS_LLM_PROVIDER") || "openai",
      model: get("INKOS_LLM_MODEL") || "unknown",
      baseUrl: get("INKOS_LLM_BASE_URL") || "",
    };
  } catch {
    return undefined;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
