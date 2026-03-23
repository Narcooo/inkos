import { readFile, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ProjectConfigSchema, type ProjectConfig } from "../models/project.js";

export const GLOBAL_CONFIG_DIR = join(homedir(), ".inkos");
export const GLOBAL_ENV_PATH = join(GLOBAL_CONFIG_DIR, ".env");

/**
 * Load project config from inkos.json with .env overrides.
 * Shared by CLI and Studio — single source of truth for config loading.
 */
export async function loadProjectConfig(root: string): Promise<ProjectConfig> {
  // Load global ~/.inkos/.env first, then project .env overrides
  const { config: loadEnv } = await import("dotenv");
  loadEnv({ path: GLOBAL_ENV_PATH });
  loadEnv({ path: join(root, ".env"), override: true });

  const configPath = join(root, "inkos.json");

  try {
    await access(configPath);
  } catch {
    throw new Error(
      `inkos.json not found in ${root}.\nMake sure you are inside an InkOS project directory (cd into the project created by 'inkos init').`,
    );
  }

  const raw = await readFile(configPath, "utf-8");

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(raw);
  } catch {
    throw new Error(`inkos.json in ${root} is not valid JSON. Check the file for syntax errors.`);
  }

  // .env overrides inkos.json for LLM settings
  const env = process.env;
  const llm = (config.llm ?? {}) as Record<string, unknown>;
  if (env.INKOS_LLM_PROVIDER) llm.provider = env.INKOS_LLM_PROVIDER;
  if (env.INKOS_LLM_BASE_URL) llm.baseUrl = env.INKOS_LLM_BASE_URL;
  if (env.INKOS_LLM_MODEL) llm.model = env.INKOS_LLM_MODEL;
  if (env.INKOS_LLM_TEMPERATURE) llm.temperature = parseFloat(env.INKOS_LLM_TEMPERATURE);
  if (env.INKOS_LLM_MAX_TOKENS) llm.maxTokens = parseInt(env.INKOS_LLM_MAX_TOKENS, 10);
  if (env.INKOS_LLM_THINKING_BUDGET) llm.thinkingBudget = parseInt(env.INKOS_LLM_THINKING_BUDGET, 10);
  if (env.INKOS_LLM_REASONING_EFFORT) llm.reasoningEffort = env.INKOS_LLM_REASONING_EFFORT;
  // Extra params from env: INKOS_LLM_EXTRA_<key>=<value>
  const extraFromEnv: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("INKOS_LLM_EXTRA_") && value) {
      const paramName = key.slice("INKOS_LLM_EXTRA_".length);
      // Auto-coerce: numbers, booleans, JSON objects
      if (/^\d+(\.\d+)?$/.test(value)) extraFromEnv[paramName] = parseFloat(value);
      else if (value === "true") extraFromEnv[paramName] = true;
      else if (value === "false") extraFromEnv[paramName] = false;
      else if (value.startsWith("{") || value.startsWith("[")) {
        try { extraFromEnv[paramName] = JSON.parse(value); } catch { extraFromEnv[paramName] = value; }
      }
      else extraFromEnv[paramName] = value;
    }
  }
  if (Object.keys(extraFromEnv).length > 0) {
    llm.extra = { ...(llm.extra as Record<string, unknown> ?? {}), ...extraFromEnv };
  }
  if (env.INKOS_LLM_API_FORMAT) llm.apiFormat = env.INKOS_LLM_API_FORMAT;
  config.llm = llm;

  // Global language override
  if (env.INKOS_DEFAULT_LANGUAGE) config.language = env.INKOS_DEFAULT_LANGUAGE;

  // API key ONLY from env — never stored in inkos.json
  const apiKey = env.INKOS_LLM_API_KEY;
  if (!apiKey) {
    throw new Error(
      "INKOS_LLM_API_KEY not set. Run 'inkos config set-global' or add it to project .env file.",
    );
  }
  llm.apiKey = apiKey;

  return ProjectConfigSchema.parse(config);
}
