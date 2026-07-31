import { describe, expect, it, vi } from "vitest";
import type { OpenAICodexLoginOptions } from "@actalk/inkos-core";
import {
  OpenAICodexOAuthBusyError,
  OpenAICodexOAuthSessionManager,
} from "./openai-codex-oauth.js";

describe("OpenAICodexOAuthSessionManager", () => {
  it("publishes the authorization URL and persists successful credentials", async () => {
    const onCredentials = vi.fn(async () => {});
    const login = vi.fn(async (options: OpenAICodexLoginOptions) => {
      options.onAuth({ url: "https://auth.example/login", instructions: "Sign in" });
      options.onProgress?.("Waiting for callback");
      return { access: "access", refresh: "refresh", expires: 123 };
    });
    const manager = new OpenAICodexOAuthSessionManager(onCredentials, login);

    const started = await manager.start();
    expect(started.url).toBe("https://auth.example/login");
    await vi.waitFor(() => expect(manager.status(started.sessionId)).toEqual({ state: "success" }));
    expect(onCredentials).toHaveBeenCalledWith({ access: "access", refresh: "refresh", expires: 123 });
  });

  it("accepts a manual callback code", async () => {
    const manager = new OpenAICodexOAuthSessionManager(
      async () => {},
      async (options) => {
        options.onAuth({ url: "https://auth.example/login" });
        const code = await options.onManualCodeInput!();
        expect(code).toBe("code-from-browser");
        return { access: "access", refresh: "refresh", expires: 123 };
      },
    );

    const started = await manager.start();
    expect(manager.submitCode(started.sessionId, " code-from-browser ")).toBe(true);
    await vi.waitFor(() => expect(manager.status(started.sessionId)).toEqual({ state: "success" }));
  });

  it("rejects a second concurrent login", async () => {
    const manager = new OpenAICodexOAuthSessionManager(
      async () => {},
      async (options) => {
        options.onAuth({ url: "https://auth.example/login" });
        await options.onManualCodeInput!();
        return { access: "access", refresh: "refresh", expires: 123 };
      },
    );

    const started = await manager.start();
    await expect(manager.start()).rejects.toBeInstanceOf(OpenAICodexOAuthBusyError);
    manager.submitCode(started.sessionId, "done");
  });
});
