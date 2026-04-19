import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { GLOBAL_ENV_PATH } from "./utils.js";

export interface ProjectBootstrapOptions {
  readonly language?: "zh" | "en";
  readonly overwriteSupportFiles?: boolean;
}

async function hasGlobalConfig(): Promise<boolean> {
  try {
    const content = await readFile(GLOBAL_ENV_PATH, "utf-8");
    return content.includes("INKOS_LLM_API_KEY=") && !content.includes("your-api-key-here");
  } catch {
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeMaybe(path: string, content: string, overwrite: boolean): Promise<void> {
  if (!overwrite && await exists(path)) {
    return;
  }
  await writeFile(path, content, "utf-8");
}

function buildProjectConfig(projectDir: string, language: "zh" | "en") {
  return {
    name: basename(projectDir),
    version: "0.1.0" as const,
    language,
    llm: {
      provider: "openai" as const,
      service: "custom",
      configSource: "studio" as const,
      baseUrl: "",
      model: "",
      apiFormat: "chat" as const,
      stream: true,
    },
    notify: [],
    inputGovernanceMode: "v2" as const,
    daemon: {
      schedule: {
        radarCron: "0 */6 * * *",
        writeCron: "*/15 * * * *",
      },
      maxConcurrentBooks: 3,
    },
  };
}

function buildProjectEnvTemplate(globalConfigured: boolean): string {
  if (globalConfigured) {
    return [
      "# Project-level LLM overrides (optional)",
      "# Global config at ~/.inkos/.env will be used by default.",
      "# Switch Studio to '使用 Studio 配置' if you want per-project service settings.",
      "# Uncomment below to override for this project only:",
      "# INKOS_LLM_PROVIDER=openai",
      "# INKOS_LLM_BASE_URL=",
      "# INKOS_LLM_API_KEY=",
      "# INKOS_LLM_MODEL=",
      "",
      "# Web search (optional):",
      "# TAVILY_API_KEY=tvly-xxxxx",
      "",
    ].join("\n");
  }

  return [
    "# Optional project-level LLM overrides",
    "# Studio can manage provider / model / key without editing this file.",
    "# Uncomment only if you want this directory to force env-based config:",
    "# INKOS_LLM_PROVIDER=openai",
    "# INKOS_LLM_BASE_URL=",
    "# INKOS_LLM_API_KEY=",
    "# INKOS_LLM_MODEL=",
    "# INKOS_LLM_API_FORMAT=chat",
    "# INKOS_LLM_STREAM=true",
    "",
    "# Web search (optional):",
    "# TAVILY_API_KEY=tvly-xxxxx",
    "",
  ].join("\n");
}

export async function initializeProjectDirectory(
  projectDir: string,
  options: ProjectBootstrapOptions = {},
): Promise<void> {
  const language = options.language ?? "zh";
  const overwriteSupportFiles = options.overwriteSupportFiles ?? true;
  const configPath = join(projectDir, "inkos.json");

  if (await exists(configPath)) {
    throw new Error(`inkos.json already exists in ${projectDir}. Use a different directory or delete the existing project.`);
  }

  await mkdir(projectDir, { recursive: true });
  await mkdir(join(projectDir, "books"), { recursive: true });
  await mkdir(join(projectDir, "radar"), { recursive: true });

  await writeFile(
    configPath,
    JSON.stringify(buildProjectConfig(projectDir, language), null, 2),
    "utf-8",
  );

  const globalConfigured = await hasGlobalConfig();

  await Promise.all([
    writeMaybe(join(projectDir, ".env"), buildProjectEnvTemplate(globalConfigured), overwriteSupportFiles),
    writeMaybe(join(projectDir, ".gitignore"), [".env", "node_modules/", ".DS_Store"].join("\n"), overwriteSupportFiles),
    writeMaybe(join(projectDir, ".nvmrc"), "22\n", overwriteSupportFiles),
    writeMaybe(join(projectDir, ".node-version"), "22\n", overwriteSupportFiles),
  ]);
}

export async function ensureProjectDirectoryInitialized(
  projectDir: string,
  options: Omit<ProjectBootstrapOptions, "overwriteSupportFiles"> = {},
): Promise<boolean> {
  const configPath = join(projectDir, "inkos.json");
  if (await exists(configPath)) {
    return false;
  }

  await initializeProjectDirectory(projectDir, {
    language: options.language,
    overwriteSupportFiles: false,
  });
  return true;
}
