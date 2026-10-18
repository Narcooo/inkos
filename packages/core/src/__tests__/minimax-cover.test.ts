import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCoverProviderPreset } from "../llm/cover-providers.js";
import { saveSecrets } from "../llm/secrets.js";
import { generateImageFromPrompt, resolveCoverGenerationRequest } from "../pipeline/short-fiction-runner.js";

const preset = resolveCoverProviderPreset("minimax")!;
const request = { api: "minimax" as const, baseUrl: preset.baseUrl, model: preset.defaultModel, apiKey: "fixture-key" };

beforeEach(() => {
  vi.stubEnv("INKOS_COVER_ENDPOINT", "");
  vi.stubEnv("INKOS_COVER_BASE_URL", "");
  vi.stubEnv("INKOS_COVER_MODEL", "");
  vi.stubEnv("INKOS_COVER_API_KEY", "fixture-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("MiniMax cover configuration", () => {
  it("advertises only models supported by the text-to-image operation", () => {
    expect(preset.models).toEqual(["image-01"]);
    expect(preset.defaultModel).toBe("image-01");
  });

  it.each(["https://api.minimax.io/v1", "https://api.minimaxi.com/v1"])(
    "resolves the regional base URL %s and its explicit endpoint",
    async (baseUrl) => {
      const resolved = await resolveCoverGenerationRequest({ root: "/unused", coverBaseUrl: baseUrl });
      expect(resolved).toEqual({ ...request, baseUrl, endpoint: `${baseUrl}/image_generation` });
      vi.stubEnv("INKOS_COVER_ENDPOINT", `${baseUrl}/image_generation`);
      await expect(resolveCoverGenerationRequest({ root: "/unused" })).resolves.toEqual(resolved);
    },
  );

  it("accepts a project cover preset, custom regional URL, and separate cover key", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-minimax-cover-"));
    try {
      await writeFile(join(root, "inkos.json"), JSON.stringify({
        name: "fixture", version: "0.1.0", language: "en", notify: [],
        llm: {
          provider: "custom", model: "fixture", baseUrl: "https://example.com/v1",
          cover: { service: "minimax", model: preset.defaultModel, baseUrl: "https://api.minimaxi.com/v1" },
        },
      }));
      await saveSecrets(root, { services: { "cover:minimax": { apiKey: "fixture-key" } } });
      await expect(resolveCoverGenerationRequest({ root, coverModel: `MiniMax/${preset.defaultModel}` }))
        .resolves.toEqual({ ...request, baseUrl: "https://api.minimaxi.com/v1" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves an explicit endpoint and requested model", async () => {
    const endpoint = "https://proxy.example/v1/image_generation";
    await expect(resolveCoverGenerationRequest({ root: "/unused", coverEndpoint: endpoint, coverModel: "custom-image" }))
      .resolves.toMatchObject({ api: "minimax", endpoint, model: "custom-image" });
  });
});

describe("MiniMax cover generation", () => {
  it("sends dimensions and downloads data.image_urls without forwarding the key", async () => {
    const bytes = Buffer.from("fixture-image");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { image_urls: ["https://images.example/cover.jpg"] },
        metadata: { success_count: 1, failed_count: 0 },
        base_resp: { status_code: 0 },
      })))
      .mockResolvedValueOnce(new Response(bytes, { headers: { "Content-Type": "image/jpeg" } }));
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    await expect(generateImageFromPrompt(request, "A lantern beside a book", "1024x1360", signal))
      .resolves.toEqual({ buffer: bytes, extension: "jpg" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.minimax.io/v1/image_generation");
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer fixture-key");
    expect(init.signal).toBe(signal);
    expect(JSON.parse(init.body)).toEqual({
      model: preset.defaultModel, prompt: "A lantern beside a book",
      width: 1024, height: 1360, n: 1, response_format: "url",
    });
    expect(fetchMock.mock.calls[1]).toEqual(["https://images.example/cover.jpg", { signal }]);
  });

  it("rejects API errors even when the response includes an image URL", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      base_resp: { status_code: 1008, status_msg: "Insufficient balance" },
      data: { image_urls: ["https://images.example/cover.png"] },
    })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateImageFromPrompt(request, "A lantern", "1024x1360"))
      .rejects.toThrow("1008 Insufficient balance");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([{}, null, { data: { image_urls: [] } }, { data: { image_urls: [null, ""] } }])(
    "rejects a response without a usable image URL: %j",
    async (payload) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(payload))));
      await expect(generateImageFromPrompt(request, "A lantern", "1024x1360"))
        .rejects.toThrow("did not include an image URL");
    },
  );

  it("reports HTTP and JSON failures", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("invalid-json")));
    await expect(generateImageFromPrompt(request, "A lantern", "1024x1360")).rejects.toThrow("HTTP 503");
    await expect(generateImageFromPrompt(request, "A lantern", "1024x1360")).rejects.toThrow("non-JSON response");
  });

  it.each(["auto", "511x1024", "1024x2049", "1025x1024"])("rejects invalid size %s before a request", async (size) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateImageFromPrompt(request, "A lantern", size)).rejects.toThrow("cover size");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not silently discard a reference image", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateImageFromPrompt(request, "A lantern", "1024x1360", undefined, {
      buffer: Buffer.from("fixture-image"), mimeType: "image/png",
    })).rejects.toThrow("text prompts only");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates request cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn((_url, init) => {
      init.signal.throwIfAborted();
    }));
    await expect(generateImageFromPrompt(request, "A lantern", "1024x1360", controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
  });
});
