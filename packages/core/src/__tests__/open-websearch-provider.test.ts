import { describe, expect, it, vi } from "vitest";
import {
  OpenWebSearchProvider,
  OpenWebSearchProviderError,
} from "../research/open-websearch-provider.js";

function envelope(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({
    status: status >= 400 ? "error" : "ok",
    data: status >= 400 ? null : data,
    error: status >= 400 ? { code: "engine_error", message: "search failed" } : null,
    hint: null,
  }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("OpenWebSearchProvider", () => {
  it("maps daemon search and fetch responses to the provider contract", async () => {
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(envelope({
        results: [
          {
            title: "County archive",
            url: "https://example.com/archive",
            description: "Primary-source index",
            engine: "bing",
            source: "web",
          },
        ],
      }))
      .mockResolvedValueOnce(envelope({
        content: "Readable evidence that is longer than the requested limit.",
      }));
    const provider = new OpenWebSearchProvider({
      endpoint: "http://127.0.0.1:3210/",
      fetchFn,
    });

    await expect(provider.search("county records", 3)).resolves.toEqual([
      {
        title: "County archive",
        url: "https://example.com/archive",
        snippet: "Primary-source index",
      },
    ]);
    await expect(provider.fetch("https://example.com/archive", 17)).resolves.toBe("Readable evidence");

    expect(fetchFn).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:3210/search",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ query: "county records", limit: 3 }),
      }),
    );
    expect(fetchFn).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:3210/fetch-web",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects non-loopback endpoints before making a request", () => {
    expect(() => new OpenWebSearchProvider({
      endpoint: "https://search.example.com",
    })).toThrowError(OpenWebSearchProviderError);
  });

  it("preserves structured daemon errors", async () => {
    const provider = new OpenWebSearchProvider({
      fetchFn: vi.fn<typeof fetch>().mockResolvedValue(envelope(null, 502)),
    });

    await expect(provider.search("test", 1)).rejects.toMatchObject({
      name: "OpenWebSearchProviderError",
      code: "engine_error",
      status: 502,
      message: "search failed",
    });
  });
});
