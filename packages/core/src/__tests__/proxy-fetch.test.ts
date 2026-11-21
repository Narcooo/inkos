import { afterEach, describe, expect, it, vi } from "vitest";

const proxyAgentMock = vi.fn((url: string) => ({ kind: "proxy-agent", url }));

vi.mock("undici", () => ({
  ProxyAgent: proxyAgentMock,
}));

describe("proxy fetch helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("prefers explicit llm proxyUrl over environment proxy variables", async () => {
    const { fetchWithProxy, resolveProxyUrl } = await import("../utils/proxy-fetch.js");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const env = {
      INKOS_LLM_PROXY_URL: "http://inkos-env-proxy:9910",
      HTTPS_PROXY: "http://standard-proxy:9910",
    };

    expect(resolveProxyUrl("http://explicit-proxy:9910", env)).toBe("http://explicit-proxy:9910");
    await fetchWithProxy("https://api.example/v1/chat/completions", { method: "POST" }, "http://explicit-proxy:9910", env);

    expect(proxyAgentMock).toHaveBeenCalledWith("http://explicit-proxy:9910");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        dispatcher: { kind: "proxy-agent", url: "http://explicit-proxy:9910" },
      }),
    );
  });

  it("uses INKOS_LLM_PROXY_URL before standard HTTPS_PROXY/HTTP_PROXY env vars", async () => {
    const { fetchWithProxy, resolveProxyUrl } = await import("../utils/proxy-fetch.js");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const env = {
      INKOS_LLM_PROXY_URL: "http://inkos-proxy:9910",
      HTTPS_PROXY: "http://standard-proxy:9910",
      HTTP_PROXY: "http://http-proxy:9910",
    };

    expect(resolveProxyUrl(undefined, env)).toBe("http://inkos-proxy:9910");
    await fetchWithProxy("https://api.example/v1/models", {}, undefined, env);

    expect(proxyAgentMock).toHaveBeenCalledWith("http://inkos-proxy:9910");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example/v1/models",
      expect.objectContaining({
        dispatcher: { kind: "proxy-agent", url: "http://inkos-proxy:9910" },
      }),
    );
  });

  it("does not attach a dispatcher when no proxy is configured", async () => {
    const { fetchWithProxy, resolveProxyUrl } = await import("../utils/proxy-fetch.js");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    expect(resolveProxyUrl(undefined, {})).toBeUndefined();
    await fetchWithProxy("https://api.example/v1/models", { headers: { Authorization: "Bearer test" } }, undefined, {});

    expect(proxyAgentMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example/v1/models",
      { headers: { Authorization: "Bearer test" } },
    );
  });

  it.each([
    "http://127.0.0.1:7863/v1/models",
    "http://localhost:11434/v1/chat/completions",
    "http://[::1]:8000/v1/models",
  ])("bypasses proxy for loopback target %s even when HTTP(S)_PROXY is set", async (targetUrl) => {
    const { fetchWithProxy } = await import("../utils/proxy-fetch.js");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const env = {
      HTTP_PROXY: "http://127.0.0.1:7890",
      HTTPS_PROXY: "http://127.0.0.1:7890",
    };

    await fetchWithProxy(targetUrl, { method: "GET" }, undefined, env);

    expect(proxyAgentMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(targetUrl, { method: "GET" });
  });

  it("honours NO_PROXY / no_proxy host, suffix, port, and wildcard rules", async () => {
    const { fetchWithProxy } = await import("../utils/proxy-fetch.js");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const env = {
      HTTPS_PROXY: "http://127.0.0.1:7890",
      NO_PROXY: "internal.corp, .local.dev, gateway.example:8443",
    };

    await fetchWithProxy("https://internal.corp/v1/models", {}, undefined, env);
    await fetchWithProxy("https://api.local.dev/v1/models", {}, undefined, env);
    await fetchWithProxy("https://gateway.example:8443/v1/models", {}, undefined, env);

    expect(proxyAgentMock).not.toHaveBeenCalled();

    // Non-matching port on gateway.example still uses the proxy
    await fetchWithProxy("https://gateway.example:9443/v1/models", {}, undefined, env);
    expect(proxyAgentMock).toHaveBeenCalledTimes(1);

    // Wildcard NO_PROXY=* bypasses proxy for any host
    proxyAgentMock.mockClear();
    await fetchWithProxy("https://api.example/v1/models", {}, undefined, {
      HTTPS_PROXY: "http://127.0.0.1:7890",
      no_proxy: "*",
    });
    expect(proxyAgentMock).not.toHaveBeenCalled();
  });
});
