import { ProxyAgent } from "undici";

type ProxyEnv = Record<string, string | undefined>;
type FetchInitWithDispatcher = Omit<RequestInit, "dispatcher"> & { dispatcher?: unknown };

export function resolveProxyUrl(explicitProxyUrl?: string, env: ProxyEnv = process.env): string | undefined {
  const candidate = [
    explicitProxyUrl,
    env.INKOS_LLM_PROXY_URL,
    env.HTTPS_PROXY,
    env.https_proxy,
    env.HTTP_PROXY,
    env.http_proxy,
  ].find((value) => typeof value === "string" && value.trim().length > 0)?.trim();

  if (!candidate) return undefined;
  const parsed = new URL(candidate);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported proxy protocol: ${parsed.protocol}`);
  }
  return candidate;
}

export function buildProxyFetchInit(
  init: RequestInit = {},
  explicitProxyUrl?: string,
  env: ProxyEnv = process.env,
): FetchInitWithDispatcher {
  const proxyUrl = resolveProxyUrl(explicitProxyUrl, env);
  if (!proxyUrl) return init;
  return {
    ...init,
    dispatcher: new ProxyAgent(proxyUrl) as unknown,
  };
}

export function fetchWithProxy(
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
  explicitProxyUrl?: string,
  env: ProxyEnv = process.env,
): ReturnType<typeof fetch> {
  return fetch(input, buildProxyFetchInit(init, explicitProxyUrl, env) as RequestInit);
}
