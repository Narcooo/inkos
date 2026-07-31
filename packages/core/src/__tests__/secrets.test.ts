import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadSecrets,
  saveSecrets,
  getServiceApiKey,
  getServiceAuthStatus,
  hasServiceCredentials,
  saveServiceOAuthCredentials,
} from "../llm/secrets.js";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const oauthMocks = vi.hoisted(() => ({
  getOAuthApiKey: vi.fn(),
}));

vi.mock("@mariozechner/pi-ai/oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@mariozechner/pi-ai/oauth")>()),
  getOAuthApiKey: oauthMocks.getOAuthApiKey,
}));

describe("secrets", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-secrets-"));
    oauthMocks.getOAuthApiKey.mockReset();
    oauthMocks.getOAuthApiKey.mockImplementation(async (provider: string, credentials: Record<string, {
      access: string;
      refresh: string;
      expires: number;
    }>) => ({
      newCredentials: credentials[provider],
      apiKey: credentials[provider].access,
    }));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe("loadSecrets", () => {
    it("returns empty when .inkos/secrets.json does not exist", async () => {
      const secrets = await loadSecrets(root);
      expect(secrets).toEqual({ services: {} });
    });

    it("reads existing secrets file", async () => {
      await mkdir(join(root, ".inkos"), { recursive: true });
      await writeFile(
        join(root, ".inkos", "secrets.json"),
        JSON.stringify({ services: { moonshot: { apiKey: "sk-test" } } }),
      );
      const secrets = await loadSecrets(root);
      expect(secrets.services.moonshot.apiKey).toBe("sk-test");
    });
  });

  describe("saveSecrets", () => {
    it("creates .inkos dir and writes secrets file", async () => {
      await saveSecrets(root, {
        services: { deepseek: { apiKey: "sk-deep" } },
      });
      const raw = await readFile(join(root, ".inkos", "secrets.json"), "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.services.deepseek.apiKey).toBe("sk-deep");
    });

    it("overwrites existing secrets file", async () => {
      await mkdir(join(root, ".inkos"), { recursive: true });
      await writeFile(
        join(root, ".inkos", "secrets.json"),
        JSON.stringify({ services: { old: { apiKey: "old-key" } } }),
      );
      await saveSecrets(root, {
        services: { new: { apiKey: "new-key" } },
      });
      const secrets = await loadSecrets(root);
      expect(secrets.services.new.apiKey).toBe("new-key");
      expect(secrets.services.old).toBeUndefined();
    });
  });

  describe("getServiceApiKey", () => {
    it("returns key from secrets.json first", async () => {
      await mkdir(join(root, ".inkos"), { recursive: true });
      await writeFile(
        join(root, ".inkos", "secrets.json"),
        JSON.stringify({ services: { moonshot: { apiKey: "sk-from-file" } } }),
      );
      const key = await getServiceApiKey(root, "moonshot");
      expect(key).toBe("sk-from-file");
    });

    it("falls back to environment variable", async () => {
      vi.stubEnv("MOONSHOT_API_KEY", "sk-from-env");
      const key = await getServiceApiKey(root, "moonshot");
      expect(key).toBe("sk-from-env");
      vi.unstubAllEnvs();
    });

    it("returns null when neither secrets nor env exists", async () => {
      const key = await getServiceApiKey(root, "moonshot");
      expect(key).toBeNull();
    });

    it("handles custom service with colon key format", async () => {
      await mkdir(join(root, ".inkos"), { recursive: true });
      await writeFile(
        join(root, ".inkos", "secrets.json"),
        JSON.stringify({
          services: { "custom:内网GPT": { apiKey: "sk-custom" } },
        }),
      );
      const key = await getServiceApiKey(root, "custom:内网GPT");
      expect(key).toBe("sk-custom");
    });

    it("returns a valid OAuth access token", async () => {
      await saveServiceOAuthCredentials(root, "openaiCodex", "openai-codex", {
        access: "oauth-access",
        refresh: "oauth-refresh",
        expires: Date.now() + 60_000,
      });

      expect(await getServiceApiKey(root, "openaiCodex")).toBe("oauth-access");
      const secret = (await loadSecrets(root)).services.openaiCodex;
      expect(hasServiceCredentials(secret)).toBe(true);
      expect(getServiceAuthStatus(secret)).toEqual({
        authType: "oauth",
        connected: true,
        expiresAt: expect.any(Number),
      });
      expect(secret.apiKey).toBeUndefined();
    });

    it("coalesces concurrent OAuth refreshes and persists the refreshed credentials", async () => {
      await saveServiceOAuthCredentials(root, "openaiCodex", "openai-codex", {
        access: "expired-access",
        refresh: "old-refresh",
        expires: 1,
      });
      let releaseRefresh!: () => void;
      const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
      oauthMocks.getOAuthApiKey.mockImplementationOnce(async () => {
        await refreshGate;
        return {
          apiKey: "fresh-access",
          newCredentials: {
            access: "fresh-access",
            refresh: "fresh-refresh",
            expires: Date.now() + 60_000,
          },
        };
      });

      const first = getServiceApiKey(root, "openaiCodex");
      const second = getServiceApiKey(root, "openaiCodex");
      await vi.waitFor(() => expect(oauthMocks.getOAuthApiKey).toHaveBeenCalledTimes(1));
      releaseRefresh();

      await expect(Promise.all([first, second])).resolves.toEqual(["fresh-access", "fresh-access"]);
      expect((await loadSecrets(root)).services.openaiCodex.oauth?.credentials).toMatchObject({
        access: "fresh-access",
        refresh: "fresh-refresh",
      });
    });

    it("does not overwrite a newer login with a stale refresh result", async () => {
      await saveServiceOAuthCredentials(root, "openaiCodex", "openai-codex", {
        access: "expired-access",
        refresh: "old-refresh",
        expires: 1,
      });
      let releaseRefresh!: () => void;
      const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
      oauthMocks.getOAuthApiKey.mockImplementationOnce(async () => {
        await refreshGate;
        return {
          apiKey: "stale-refreshed-access",
          newCredentials: {
            access: "stale-refreshed-access",
            refresh: "stale-refreshed-refresh",
            expires: Date.now() + 60_000,
          },
        };
      });

      const staleRefresh = getServiceApiKey(root, "openaiCodex");
      await vi.waitFor(() => expect(oauthMocks.getOAuthApiKey).toHaveBeenCalledTimes(1));
      await saveServiceOAuthCredentials(root, "openaiCodex", "openai-codex", {
        access: "new-login-access",
        refresh: "new-login-refresh",
        expires: Date.now() + 120_000,
      });
      await expect(getServiceApiKey(root, "openaiCodex")).resolves.toBe("new-login-access");
      releaseRefresh();
      await expect(staleRefresh).resolves.toBe("stale-refreshed-access");

      expect((await loadSecrets(root)).services.openaiCodex.oauth?.credentials).toMatchObject({
        access: "new-login-access",
        refresh: "new-login-refresh",
      });
    });
  });
});
