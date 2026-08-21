import { fetchWithProxy } from "../../utils/proxy-fetch.js";

/**
 * 通用 OpenAI 兼容 /models 探针。
 * 任何失败（网络错、超时、非 JSON、非 2xx）一律返回空数组，不抛异常。
 */

export interface ProbedModel {
  readonly id: string;
  readonly name: string;
  readonly contextWindow: number;
  readonly inputPrice?: string;
  readonly outputPrice?: string;
  readonly inputModalities?: ReadonlyArray<string>;
  readonly outputModalities?: ReadonlyArray<string>;
  readonly supportedParameters?: ReadonlyArray<string>;
}

interface UpstreamModelRecord {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly context_length?: unknown;
  readonly architecture?: {
    readonly input_modalities?: unknown;
    readonly output_modalities?: unknown;
  };
  readonly pricing?: {
    readonly prompt?: unknown;
    readonly completion?: unknown;
  };
  readonly supported_parameters?: unknown;
}

function stringArray(value: unknown): ReadonlyArray<string> | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string");
  return items.length > 0 ? items : undefined;
}

export async function probeModelsFromUpstream(
  baseUrl: string,
  apiKey: string,
  timeoutMs = 10_000,
): Promise<ReadonlyArray<ProbedModel>> {
  if (!baseUrl) return [];
  try {
    const modelsUrl = baseUrl.replace(/\/$/, "") + "/models";
    const res = await fetchWithProxy(modelsUrl, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: Array<UpstreamModelRecord> };
    if (!Array.isArray(json.data)) return [];
    return json.data
      .filter((m): m is UpstreamModelRecord & { id: string } => typeof m.id === "string" && m.id.length > 0)
      .map((m) => {
        const inputModalities = stringArray(m.architecture?.input_modalities);
        const outputModalities = stringArray(m.architecture?.output_modalities);
        const supportedParameters = stringArray(m.supported_parameters);
        return {
          id: m.id,
          name: typeof m.name === "string" && m.name.length > 0 ? m.name : m.id,
          contextWindow: typeof m.context_length === "number" && Number.isFinite(m.context_length) ? m.context_length : 0,
          ...(typeof m.pricing?.prompt === "string" ? { inputPrice: m.pricing.prompt } : {}),
          ...(typeof m.pricing?.completion === "string" ? { outputPrice: m.pricing.completion } : {}),
          ...(inputModalities ? { inputModalities } : {}),
          ...(outputModalities ? { outputModalities } : {}),
          ...(supportedParameters ? { supportedParameters } : {}),
        };
      });
  } catch {
    return [];
  }
}
