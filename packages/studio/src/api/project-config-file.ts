import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type RawProjectConfigFile = Record<string, unknown> & {
  llm?: Record<string, unknown>;
};

export async function readProjectConfigFile(root: string): Promise<RawProjectConfigFile> {
  const raw = await readFile(join(root, "inkos.json"), "utf-8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("inkos.json must contain a JSON object");
  }
  return parsed as RawProjectConfigFile;
}

export async function writeProjectConfigFile(
  root: string,
  config: RawProjectConfigFile,
): Promise<void> {
  await writeFile(join(root, "inkos.json"), JSON.stringify(config, null, 2), "utf-8");
}

export async function updateProjectConfigFile(
  root: string,
  updater: (config: RawProjectConfigFile) => void,
): Promise<RawProjectConfigFile> {
  const config = await readProjectConfigFile(root);
  updater(config);
  await writeProjectConfigFile(root, config);
  return config;
}

export function ensureRawLlmConfig(config: RawProjectConfigFile): Record<string, unknown> {
  if (!config.llm || typeof config.llm !== "object" || Array.isArray(config.llm)) {
    config.llm = {};
  }
  return config.llm;
}
