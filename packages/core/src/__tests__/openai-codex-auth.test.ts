import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import {
  addOpenAICodexForwardCompatibleModels,
  extractOpenAICodexAccountId,
  listOpenAICodexModels,
  OPENAI_CODEX_MODELS_URL,
} from "../llm/openai-codex-auth.js";

function accessToken(accountId = "acct-test"): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({
    "https://api.openai.com/auth": { chatgpt_account_id: accountId },
  })}.signature`;
}

describe("OpenAI Codex model discovery", () => {
  it("extracts the ChatGPT account id from an OAuth JWT", () => {
    expect(extractOpenAICodexAccountId(accessToken())).toBe("acct-test");
    expect(extractOpenAICodexAccountId("not-a-jwt")).toBeNull();
  });

  it("fetches, filters, and prioritizes the account model catalog", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      models: [
        { slug: "gpt-5.4", priority: 20 },
        { slug: "hidden-model", priority: 1, visibility: "hidden" },
        { slug: "gpt-5.5", priority: 10 },
      ],
    }), { status: 200 })) as unknown as typeof fetch;

    const models = await listOpenAICodexModels(accessToken(), { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(OPENAI_CODEX_MODELS_URL, expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: expect.stringContaining("Bearer "),
        "ChatGPT-Account-Id": "acct-test",
      }),
    }));
    expect(models.slice(0, 2)).toEqual(["gpt-5.5", "gpt-5.4"]);
    expect(models).toContain("gpt-5.6-sol");
    expect(models).toContain("gpt-5.6-terra");
    expect(models).toContain("gpt-5.6-luna");
    expect(models.some((model) => model.endsWith("-pro"))).toBe(false);
    expect(models).not.toContain("hidden-model");
  });

  it("adds GPT-5.6 compatibility entries only when a compatible template exists", () => {
    expect(addOpenAICodexForwardCompatibleModels(["gpt-5.4"])).toContain("gpt-5.6-sol");
    expect(addOpenAICodexForwardCompatibleModels(["unrelated-model"])).toEqual(["unrelated-model"]);
  });

  it("rejects catalog discovery errors instead of pretending the account has no models", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    await expect(listOpenAICodexModels(accessToken(), { fetchImpl }))
      .rejects.toThrow("HTTP 503");
  });
});
