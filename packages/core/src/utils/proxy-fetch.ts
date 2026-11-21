import { ProxyAgent } from "undici";

type ProxyEnv = Record<string, string | undefined>;
type FetchInitWithDispatcher = RequestInit & { dispatcher?: unknown };

const LOOPBACK_HOST = /^(localhost|::1|\[::1\]|127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

function defaultPort(protocol: string): string {
  if (protocol === "https:") return "443";
  if (protocol === "http:") return "80";
  return "";
}

function extractTargetUrl(input: Parameters<typeof fetch>[0]): URL | undefined {
  try {
    if (input instanceof URL) return input;
    if (typeof input === "string") return new URL(input);
    if (typeof input === "object" && input !== null && "url" in input && typeof input.url === "string") {
      return new URL(input.url);
    }
  } catch {
    // Ignore malformed URLs and allow normal fetch error handling to surface.
  }
  return undefined;
}

function matchesNoProxy(url: URL, noProxy?: string): boolean {
  if (!noProxy) return false;
  const host = normalizeHostname(url.hostname);
  const port = url.port || defaultPort(url.protocol);

  return noProxy
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .some((rule) => {
      if (!rule) return false;
      if (rule === "*") return true;

      let ruleHost = rule;
      let rulePort: string | undefined;

      if (rule.startsWith("[")) {
        const closeBracket = rule.indexOf("]");
        if (closeBracket !== -1) {
          ruleHost = rule.slice(1, closeBracket);
          const rest = rule.slice(closeBracket + 1);
          if (rest.startsWith(":")) {
            rulePort = rest.slice(1);
          }
        }
      } else {
        const lastColon = rule.lastIndexOf(":");
        if (lastColon !== -1 && !rule.slice(0, lastColon).includes(":")) {
          ruleHost = rule.slice(0, lastColon);
          rulePort = rule.slice(lastColon + 1);
        }
      }

      if (rulePort && rulePort !== port) {
        return false;
      }

      const bare = ruleHost.replace(/^\./, "");
      if (!bare) return false;
      return host === bare || host.endsWith(`.${bare}`);
    });
}

function shouldBypassProxy(url: URL | undefined, env: ProxyEnv): boolean {
  if (!url) return false;
  const host = normalizeHostname(url.hostname);
  if (LOOPBACK_HOST.test(host)) return true;
  return matchesNoProxy(url, env.NO_PROXY ?? env.no_proxy);
}

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
    dispatcher: new ProxyAgent(proxyUrl),
  };
}

export function fetchWithProxy(
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
  explicitProxyUrl?: string,
  env: ProxyEnv = process.env,
): ReturnType<typeof fetch> {
  if (shouldBypassProxy(extractTargetUrl(input), env)) {
    return fetch(input, init);
  }
  return fetch(input, buildProxyFetchInit(init, explicitProxyUrl, env));
}
