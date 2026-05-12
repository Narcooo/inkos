import { getEndpoint } from "./index.js";
import { resolveServiceModelsBaseUrl } from "../service-presets.js";
import { fetchWithProxy } from "../../utils/proxy-fetch.js";

export interface VerifyResult {
  readonly recommendedTransport?: {
    readonly apiFormat?: "chat" | "responses";
    readonly stream?: boolean;
  };
  readonly probe: {
    readonly ok: boolean;
    readonly models: number;
    readonly error?: string;
  };
  readonly chat: {
    readonly ok: boolean;
    readonly latencyMs?: number;
    readonly error?: string;
  } | null;
}

/**
 * Step 1: 用 apikey 调 /models endpoint 探测。
 * 返回 models 条数 + ok 标志；失败原因落到 error 字段。
 */
async function probe(
  service: string,
  apiKey: string,
  baseUrl?: string,
  proxyUrl?: string,
): Promise<VerifyResult["probe"]> {
  const provider = getEndpoint(service);
  const probeBaseUrl = baseUrl || provider?.modelsBaseUrl || provider?.baseUrl || resolveServiceModelsBaseUrl(service);
  if (!probeBaseUrl) {
    return { ok: false, models: 0, error: "无 baseUrl 可探测（custom / newapi / higress 需要用户填）" };
  }
  try {
    // 尝试标准 OpenAI 路径 /v1/models，如果 404 则回退到 /models
    let url = probeBaseUrl.replace(/\/$/, "") + "/v1/models";
    let res = await fetchWithProxy(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    }, proxyUrl);
    
    // 如果 /v1/models 404，尝试旧版路径 /models
    if (!res.ok && res.status === 404) {
      url = probeBaseUrl.replace(/\/$/, "") + "/models";
      res = await fetchWithProxy(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      }, proxyUrl);
    }
    
    if (!res.ok) {
      return { ok: false, models: 0, error: `HTTP ${res.status} ${res.statusText}` };
    }
    const json = (await res.json()) as { data?: Array<{ id: string }> };
    const count = json.data?.length ?? 0;
    return { ok: count > 0, models: count };
  } catch (error) {
    return {
      ok: false,
      models: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * verifyService: 两步验证。
 * Step 1 probe /models。
 * Step 2 chat hello 到 checkModel（命中 provider.checkModel 才做；custom / newapi / higress 没有 checkModel，chat 字段返回 null）。
 */
export async function verifyService(
  service: string,
  apiKey: string,
  opts?: { checkModel?: string; baseUrl?: string; proxyUrl?: string },
): Promise<VerifyResult> {
  const probeResult = await probe(service, apiKey, opts?.baseUrl, opts?.proxyUrl);

  const provider = getEndpoint(service);
  const recommendedTransport = provider?.transportDefaults;
  const checkModel = opts?.checkModel ?? provider?.checkModel;
  if (!checkModel) {
    return { recommendedTransport, probe: probeResult, chat: null };
  }

  const start = Date.now();
  try {
    const { createLLMClient, chatCompletion } = await import("../provider.js");
    const { LLMConfigSchema } = await import("../../models/project.js");
    const client = createLLMClient(LLMConfigSchema.parse({
      provider: provider?.api === "anthropic-messages" ? "anthropic" : "openai",
      service,
      model: checkModel,
      apiKey,
      baseUrl: opts?.baseUrl ?? provider?.baseUrl ?? "",
      proxyUrl: opts?.proxyUrl,
      configSource: "studio",
      stream: false,
    }));
    await chatCompletion(client, checkModel, [{ role: "user", content: "hi" }], { maxTokens: 10 });
    return { recommendedTransport, probe: probeResult, chat: { ok: true, latencyMs: Date.now() - start } };
  } catch (error) {
    return {
      recommendedTransport,
      probe: probeResult,
      chat: {
        ok: false,
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
