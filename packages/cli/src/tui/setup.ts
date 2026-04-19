/* ── Auto-init & environment detection for TUI ── */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import readline from "node:readline/promises";
import {
  c, bold, dim, italic,
  cyan, green, yellow, gray, red,
  brightCyan, brightGreen, brightWhite,
} from "./ansi.js";
import { resolveTuiLocale, type TuiLocale } from "./i18n.js";
import { GLOBAL_ENV_PATH } from "../utils.js";

const PROVIDERS = ["openai", "anthropic", "custom"] as const;

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
        provider: "openai / anthropic / custom (OpenAI-compatible proxy)",
        baseUrl: "Your API endpoint",
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
      provider: "openai / anthropic / custom（兼容 OpenAI 的代理）",
      baseUrl: "你的 API 入口地址",
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
    const provider = PROVIDERS.includes(providerInput.trim() as typeof PROVIDERS[number])
      ? providerInput.trim()
      : copy.defaults.provider;
    console.log(`     ${c("✓", brightGreen)} ${provider}`);
    console.log();

    // Base URL
    console.log(`  ${c("2", cyan)}  ${c(copy.steps.baseUrl, gray)}`);
    console.log(c(`     ${copy.hints.baseUrl}`, dim));
    const baseUrl = await rl.question(`     ${c("❯", cyan)} `);
    console.log(`     ${c("✓", brightGreen)} ${baseUrl.trim() || copy.defaults.baseUrl}`);
    console.log();

    // API Key
    console.log(`  ${c("3", cyan)}  ${c(copy.steps.apiKey, gray)}`);
    const apiKey = await rl.question(`     ${c("❯", cyan)} `);
    const maskedKey = apiKey.trim().length > 8
      ? apiKey.trim().slice(0, 4) + "···" + apiKey.trim().slice(-4)
      : "···";
    console.log(`     ${c("✓", brightGreen)} ${maskedKey}`);
    console.log();

    // Model
    console.log(`  ${c("4", cyan)}  ${c(copy.steps.model, gray)}`);
    console.log(c(`     ${copy.hints.model}`, dim));
    const model = await rl.question(`     ${c("❯", cyan)} `);
    console.log(`     ${c("✓", brightGreen)} ${model.trim()}`);
    console.log();

    // Scope
    console.log(`  ${c("5", cyan)}  ${c(copy.steps.scope, gray)}`);
    console.log(c(`     ${copy.hints.scope}`, dim));
    const scope = await rl.question(`     ${c("❯", cyan)} ${c(copy.defaults.scope, dim)} `);
    const useGlobal = scope.trim().toLowerCase() !== "project";

    const envContent = [
      `INKOS_LLM_PROVIDER=${provider}`,
      `INKOS_LLM_BASE_URL=${baseUrl.trim()}`,
      `INKOS_LLM_API_KEY=${apiKey.trim()}`,
      `INKOS_LLM_MODEL=${model.trim()}`,
    ].join("\n");

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

  await writeFile(
    join(cwd, ".gitignore"),
    [".env", "node_modules/", ".DS_Store"].join("\n"),
    "utf-8",
  );

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
    const match = content.match(/INKOS_LLM_API_KEY=(.+)/);
    return !!match && match[1]!.trim().length > 0 && !match[1]!.includes("your-api-key");
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
    const get = (key: string) => {
      const m = content.match(new RegExp(`^${key}=(.+)$`, "m"));
      return m?.[1]?.trim() ?? "";
    };
    const key = get("INKOS_LLM_API_KEY");
    if (!key || key.includes("your-api-key")) return undefined;
    return {
      provider: get("INKOS_LLM_PROVIDER") || "openai",
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
