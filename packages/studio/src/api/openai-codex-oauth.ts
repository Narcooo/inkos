import { randomUUID } from "node:crypto";
import type { OAuthCredentials, OpenAICodexLoginOptions } from "@actalk/inkos-core";

export type OpenAICodexOAuthStatus =
  | { state: "pending"; progress?: string }
  | { state: "success" }
  | { state: "error"; error: string };

interface Session {
  status: OpenAICodexOAuthStatus;
  submitCode: (code: string) => void;
}

type Login = (options: OpenAICodexLoginOptions) => Promise<OAuthCredentials>;
const defaultLogin: Login = async (options) => {
  const { loginOpenAICodex } = await import("@actalk/inkos-core");
  return await loginOpenAICodex(options);
};

export interface OpenAICodexOAuthSessionManagerLike {
  start(): Promise<{ sessionId: string; url: string; instructions?: string }>;
  status(sessionId: string): OpenAICodexOAuthStatus | undefined;
  submitCode(sessionId: string, code: string): boolean;
}

export class OpenAICodexOAuthBusyError extends Error {
  constructor() {
    super("An OpenAI Codex login is already in progress.");
    this.name = "OpenAICodexOAuthBusyError";
  }
}

export class OpenAICodexOAuthSessionManager implements OpenAICodexOAuthSessionManagerLike {
  private readonly sessions = new Map<string, Session>();
  private activeSessionId: string | undefined;

  constructor(
    private readonly onCredentials: (credentials: OAuthCredentials) => Promise<void>,
    private readonly login: Login = defaultLogin,
    private readonly timeoutMs = 10 * 60 * 1000,
  ) {}

  async start(): Promise<{ sessionId: string; url: string; instructions?: string }> {
    if (this.activeSessionId) {
      throw new OpenAICodexOAuthBusyError();
    }

    const sessionId = randomUUID();
    let resolveCode!: (code: string) => void;
    let rejectCode!: (error: Error) => void;
    const manualCode = new Promise<string>((resolve, reject) => {
      resolveCode = resolve;
      rejectCode = reject;
    });
    const session: Session = {
      status: { state: "pending" },
      submitCode: resolveCode,
    };
    this.sessions.set(sessionId, session);
    this.activeSessionId = sessionId;

    let resolveAuth!: (value: { sessionId: string; url: string; instructions?: string }) => void;
    let rejectAuth!: (error: Error) => void;
    const auth = new Promise<{ sessionId: string; url: string; instructions?: string }>((resolve, reject) => {
      resolveAuth = resolve;
      rejectAuth = reject;
    });
    let authPublished = false;
    const timeout = setTimeout(() => rejectCode(new Error("OpenAI Codex login timed out.")), this.timeoutMs);
    timeout.unref?.();

    void this.login({
      onAuth: ({ url, instructions }) => {
        authPublished = true;
        resolveAuth({ sessionId, url, ...(instructions ? { instructions } : {}) });
      },
      onPrompt: async () => await manualCode,
      onManualCodeInput: async () => await manualCode,
      onProgress: (progress) => {
        session.status = { state: "pending", progress };
      },
    }).then(async (credentials) => {
      await this.onCredentials(credentials);
      session.status = { state: "success" };
    }).catch((error: unknown) => {
      const normalized = error instanceof Error ? error : new Error(String(error));
      session.status = { state: "error", error: normalized.message };
      if (!authPublished) rejectAuth(normalized);
    }).finally(() => {
      clearTimeout(timeout);
      if (this.activeSessionId === sessionId) this.activeSessionId = undefined;
      const cleanup = setTimeout(() => this.sessions.delete(sessionId), 15 * 60 * 1000);
      cleanup.unref?.();
    });

    return await auth;
  }

  status(sessionId: string): OpenAICodexOAuthStatus | undefined {
    return this.sessions.get(sessionId)?.status;
  }

  submitCode(sessionId: string, code: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.status.state !== "pending" || !code.trim()) return false;
    session.submitCode(code.trim());
    return true;
  }
}
