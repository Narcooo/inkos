import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildCodexOAuthHeaders,
  getCodexOAuthStatus,
  listCodexOAuthModels,
} from "../llm/codex-oauth.js";

function jwtWithExp(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `${header}.${payload}.`;
}

describe("Codex OAuth runtime auth", () => {
  it("reads ChatGPT OAuth status from CODEX_HOME auth.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-codex-home-"));
    try {
      await mkdir(root, { recursive: true });
      await writeFile(join(root, "auth.json"), JSON.stringify({
        auth_mode: "chatgpt",
        tokens: {
          access_token: jwtWithExp(2_000_000_000),
          account_id: "acct_123",
          id_token: jwtWithExp(2_000_000_000),
          refresh_token: "refresh",
        },
        last_refresh: "2026-05-26T03:23:48Z",
      }));

      const status = await getCodexOAuthStatus({ codexHome: root, now: new Date("2026-05-27T00:00:00Z") });

      expect(status).toMatchObject({
        connected: true,
        authMode: "chatgpt",
        accountId: "acct_123",
        authPath: join(root, "auth.json"),
      });
      expect(status.expiresAt).toBe("2033-05-18T03:33:20.000Z");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("builds bearer and ChatGPT account headers without exposing tokens in status", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-codex-home-"));
    try {
      await mkdir(root, { recursive: true });
      await writeFile(join(root, "auth.json"), JSON.stringify({
        auth_mode: "chatgpt",
        tokens: {
          access_token: jwtWithExp(2_000_000_000),
          account_id: "acct_456",
          id_token: jwtWithExp(2_000_000_000),
          refresh_token: "refresh",
        },
      }));

      await expect(buildCodexOAuthHeaders({ codexHome: root })).resolves.toEqual({
        Authorization: expect.stringMatching(/^Bearer /),
        "ChatGPT-Account-ID": "acct_456",
      });

      await expect(getCodexOAuthStatus({ codexHome: root })).resolves.not.toHaveProperty("accessToken");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("lists models from the Codex backend and maps slug metadata", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      expect(url).toBe("https://chatgpt.com/backend-api/codex/models?client_version=0.134.0");
      expect(init?.headers).toMatchObject({
        Authorization: expect.stringMatching(/^Bearer /),
        "ChatGPT-Account-ID": "acct_789",
      });
      return new Response(JSON.stringify({
        models: [
          { slug: "gpt-5.5", display_name: "GPT-5.5", context_window: 272000, max_context_window: 272000, supported_in_api: true, visibility: "list" },
          { slug: "hidden-model", display_name: "Hidden", supported_in_api: false, visibility: "hidden" },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const root = await mkdtemp(join(tmpdir(), "inkos-codex-home-"));
    try {
      await mkdir(root, { recursive: true });
      await writeFile(join(root, "auth.json"), JSON.stringify({
        auth_mode: "chatgpt",
        tokens: {
          access_token: jwtWithExp(2_000_000_000),
          account_id: "acct_789",
          id_token: jwtWithExp(2_000_000_000),
          refresh_token: "refresh",
        },
      }));

      await expect(listCodexOAuthModels({ codexHome: root, fetchImpl, codexVersion: "0.134.0" })).resolves.toEqual([
        { id: "gpt-5.5", name: "GPT-5.5", contextWindow: 272000, maxOutput: 272000 },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
