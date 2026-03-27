import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GLOBAL_ENV_PATH } from "../utils/config-loader.js";

export interface InitializeProjectOptions {
  readonly projectDir: string;
  readonly projectName: string;
  readonly language: "zh" | "en";
}

export interface InitializeProjectResult {
  readonly projectDir: string;
  readonly projectName: string;
  readonly language: "zh" | "en";
  readonly globalConfigFound: boolean;
}

async function hasGlobalConfig(): Promise<boolean> {
  try {
    const content = await readFile(GLOBAL_ENV_PATH, "utf-8");
    return content.includes("INKOS_LLM_API_KEY=") && !content.includes("your-api-key-here");
  } catch {
    return false;
  }
}

export async function initializeProject(options: InitializeProjectOptions): Promise<InitializeProjectResult> {
  await mkdir(options.projectDir, { recursive: true });

  const configPath = join(options.projectDir, "inkos.json");
  try {
    await access(configPath);
    throw new Error(`inkos.json already exists in ${options.projectDir}. Use a different directory or delete the existing project.`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already exists")) {
      throw error;
    }
  }

  await mkdir(join(options.projectDir, "books"), { recursive: true });
  await mkdir(join(options.projectDir, "radar"), { recursive: true });

  const config = {
    name: options.projectName,
    version: "0.1.0",
    language: options.language,
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

  await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  await Promise.all([
    writeFile(join(options.projectDir, ".nvmrc"), "22\n", "utf-8"),
    writeFile(join(options.projectDir, ".node-version"), "22\n", "utf-8"),
  ]);

  const globalConfigFound = await hasGlobalConfig();

  if (globalConfigFound) {
    await writeFile(
      join(options.projectDir, ".env"),
      [
        "# Project-level LLM overrides (optional)",
        "# Global config at ~/.inkos/.env will be used by default.",
        "# Uncomment below to override for this project only:",
        "# INKOS_LLM_PROVIDER=openai",
        "# INKOS_LLM_BASE_URL=",
        "# INKOS_LLM_API_KEY=",
        "# INKOS_LLM_MODEL=",
        "",
        "# Web search (optional):",
        "# TAVILY_API_KEY=tvly-xxxxx",
      ].join("\n"),
      "utf-8",
    );
  } else {
    await writeFile(
      join(options.projectDir, ".env"),
      [
        "# LLM Configuration",
        "# Tip: Run 'inkos config set-global' to set once for all projects.",
        "# Provider: openai (OpenAI / compatible proxy), anthropic (Anthropic native)",
        "INKOS_LLM_PROVIDER=openai",
        "INKOS_LLM_BASE_URL=",
        "INKOS_LLM_API_KEY=",
        "INKOS_LLM_MODEL=",
        "",
        "# Optional parameters (defaults shown):",
        "# INKOS_LLM_TEMPERATURE=0.7",
        "# INKOS_LLM_MAX_TOKENS=8192",
        "# INKOS_LLM_THINKING_BUDGET=0          # Anthropic extended thinking budget",
        "# INKOS_LLM_API_FORMAT=chat             # chat (default) or responses (OpenAI Responses API)",
        "",
        "# Web search (optional, for auditor era-research):",
        "# TAVILY_API_KEY=tvly-xxxxx              # Free at tavily.com (1000 searches/month)",
        "",
        "# Anthropic example:",
        "# INKOS_LLM_PROVIDER=anthropic",
        "# INKOS_LLM_PROVIDER=anthropic",
        "# INKOS_LLM_BASE_URL=",
        "# INKOS_LLM_MODEL=",
      ].join("\n"),
      "utf-8",
    );
  }

  await writeFile(join(options.projectDir, ".gitignore"), [".env", "node_modules/", ".DS_Store"].join("\n"), "utf-8");

  return {
    projectDir: options.projectDir,
    projectName: options.projectName,
    language: options.language,
    globalConfigFound,
  };
}
