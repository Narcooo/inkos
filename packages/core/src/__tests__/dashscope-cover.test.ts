import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolveCoverProviderPreset, COVER_PROVIDER_PRESETS, type CoverProviderId } from "../llm/cover-providers.js";

describe("DashScope cover provider preset", () => {
  it("is included in COVER_PROVIDER_PRESETS", () => {
    const preset = COVER_PROVIDER_PRESETS.find((p) => p.service === "dashscope");
    expect(preset).toBeDefined();
    expect(preset!.label).toContain("DashScope");
    expect(preset!.api).toBe("dashscope");
    expect(preset!.defaultModel).toBe("wan2.6-t2i");
    expect(preset!.models).toContain("wan2.6-t2i");
    expect(preset!.baseUrl).toContain("dashscope.aliyuncs.com");
  });

  it("resolveCoverProviderPreset returns DashScope preset", () => {
    const preset = resolveCoverProviderPreset("dashscope");
    expect(preset).toBeDefined();
    expect(preset!.service).toBe("dashscope");
    expect(preset!.api).toBe("dashscope");
  });

  it("resolveCoverProviderPreset returns undefined for unknown service", () => {
    const preset = resolveCoverProviderPreset("nonexistent");
    expect(preset).toBeUndefined();
  });
});

describe("resolveCoverGenerationRequest with DashScope", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("detects DashScope URL and sets api to dashscope", async () => {
    vi.stubEnv("INKOS_COVER_BASE_URL", "https://dashscope.aliyuncs.com/api/v1");
    vi.stubEnv("INKOS_COVER_MODEL", "wan2.6-t2i");
    vi.stubEnv("INKOS_COVER_API_KEY", "test-key");

    const { resolveCoverGenerationRequest } = await import("../pipeline/short-fiction-runner.js");
    const request = await resolveCoverGenerationRequest({ root: "/tmp/test" });

    expect(request.api).toBe("dashscope");
    expect(request.model).toBe("wan2.6-t2i");
    expect(request.baseUrl).toContain("dashscope.aliyuncs.com");
  });

  it("falls back to wan2.6-t2i as default model for DashScope", async () => {
    vi.stubEnv("INKOS_COVER_BASE_URL", "https://dashscope.aliyuncs.com/api/v1");
    vi.stubEnv("INKOS_COVER_API_KEY", "test-key");
    // Do not set INKOS_COVER_MODEL — should default

    const { resolveCoverGenerationRequest } = await import("../pipeline/short-fiction-runner.js");
    const request = await resolveCoverGenerationRequest({ root: "/tmp/test" });

    expect(request.api).toBe("dashscope");
    expect(request.model).toBe("wan2.6-t2i");
  });
});

describe("generateImageFromPrompt DashScope routing", () => {
  it("routes dashscope api to generateDashScopeCover", async () => {
    const mockBuffer = Buffer.from("fake-image-data");

    // Mock global fetch
    const fetchMock = vi.fn();
    // First call: POST to DashScope API returns image URL
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        output: {
          choices: [{
            message: {
              content: [
                { type: "text", text: "generated" },
                { type: "image", image: "https://example.com/image.png" },
              ],
            },
          }],
        },
      })),
    });
    // Second call: GET image URL returns binary
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: new Map([["content-type", "image/png"]]),
      arrayBuffer: () => Promise.resolve(mockBuffer.buffer),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { generateImageFromPrompt } = await import("../pipeline/short-fiction-runner.js");
    const result = await generateImageFromPrompt(
      {
        api: "dashscope",
        baseUrl: "https://dashscope.aliyuncs.com/api/v1",
        model: "wan2.6-t2i",
        apiKey: "test-key",
      },
      "a beautiful sunset over mountains",
      "1024x1360",
    );

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.extension).toBe("png");

    // Verify the POST request was made to the correct endpoint
    expect(fetchMock).toHaveBeenCalledWith(
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      }),
    );

    // Verify the body format
    const postCall = fetchMock.mock.calls[0];
    const body = JSON.parse(postCall[1].body);
    expect(body.model).toBe("wan2.6-t2i");
    expect(body.input.messages[0].content[0].text).toBe("a beautiful sunset over mountains");
    expect(body.parameters.size).toBe("1024*1360");
    expect(body.parameters.n).toBe(1);
    expect(body.parameters.watermark).toBe(false);

    vi.unstubAllGlobals();
  });

  it("throws on DashScope HTTP error", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { generateImageFromPrompt } = await import("../pipeline/short-fiction-runner.js");
    await expect(
      generateImageFromPrompt(
        {
          api: "dashscope",
          baseUrl: "https://dashscope.aliyuncs.com/api/v1",
          model: "wan2.6-t2i",
          apiKey: "bad-key",
        },
        "test prompt",
        "1024x1360",
      ),
    ).rejects.toThrow("DashScope image generation failed: HTTP 401");

    vi.unstubAllGlobals();
  });

  it("throws when DashScope response has no image", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        output: {
          choices: [{
            message: {
              content: [{ type: "text", text: "no image here" }],
            },
          }],
        },
      })),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { generateImageFromPrompt } = await import("../pipeline/short-fiction-runner.js");
    await expect(
      generateImageFromPrompt(
        {
          api: "dashscope",
          baseUrl: "https://dashscope.aliyuncs.com/api/v1",
          model: "wan2.6-t2i",
          apiKey: "test-key",
        },
        "test prompt",
        "1024x1360",
      ),
    ).rejects.toThrow("did not include image URL");

    vi.unstubAllGlobals();
  });
});
