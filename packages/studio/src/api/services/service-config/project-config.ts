import { resolveServicePreset } from "@actalk/inkos-core";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  isCustomServiceId,
  serviceConfigKey,
} from "../service-config-models.js";
import { normalizeServiceConfig } from "./normalize.js";
import type { ServiceConfigEntry } from "./types.js";

export async function loadRawConfig(root: string): Promise<Record<string, unknown>> {
  const configPath = join(root, "inkos.json");
  const raw = await readFile(configPath, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

export async function saveRawConfig(root: string, config: Record<string, unknown>): Promise<void> {
  await writeFile(join(root, "inkos.json"), JSON.stringify(config, null, 2), "utf-8");
}

export async function resolveConfiguredServiceBaseUrl(
  root: string,
  serviceId: string,
  inlineBaseUrl?: string,
): Promise<string | undefined> {
  if (inlineBaseUrl?.trim()) return inlineBaseUrl.trim();

  if (!isCustomServiceId(serviceId)) {
    return resolveServicePreset(serviceId)?.baseUrl;
  }

  try {
    const config = await loadRawConfig(root);
    const services = normalizeServiceConfig((config.llm as Record<string, unknown> | undefined)?.services);
    const matched = services.find((entry) => serviceConfigKey(entry) === serviceId);
    return matched?.baseUrl;
  } catch {
    return undefined;
  }
}

export async function resolveConfiguredServiceEntry(
  root: string,
  serviceId: string,
): Promise<ServiceConfigEntry | undefined> {
  try {
    const config = await loadRawConfig(root);
    const services = normalizeServiceConfig((config.llm as Record<string, unknown> | undefined)?.services);
    return services.find((entry) => serviceConfigKey(entry) === serviceId);
  } catch {
    return undefined;
  }
}
