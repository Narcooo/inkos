import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const CODEX_OAUTH_SERVICE_ID = "codexOAuth";
export const CODEX_OAUTH_BASE_URL = "https://chatgpt.com/backend-api/codex";
const DEFAULT_CODEX_VERSION = "0.134.0";

interface CodexAuthJson {
  readonly auth_mode?: unknown;
  readonly tokens?: {
    readonly access_token?: unknown;
    readonly account_id?: unknown;
    readonly id_token?: unknown;
    readonly refresh_token?: unknown;
  };
  readonly last_refresh?: unknown;
}

export interface CodexOAuthStatus {
  readonly connected: boolean;
  readonly authMode?: string;
  readonly accountId?: string;
  readonly authPath: string;
  readonly expiresAt?: string;
  readonly lastRefresh?: string;
  readonly message?: string;
}

export interface CodexOAuthModelInfo {
  readonly id: string;
  readonly name: string;
  readonly contextWindow: number;
  readonly maxOutput?: number;
}

interface CodexOAuthCredentials {
  readonly accessToken: string;
  readonly accountId: string;
  readonly authPath: string;
  readonly expiresAt?: string;
}

export function isCodexOAuthService(service: string | undefined): boolean {
  return service === CODEX_OAUTH_SERVICE_ID;
}

function resolveCodexHome(codexHome?: string): string {
  return codexHome || process.env.CODEX_HOME || join(homedir(), ".codex");
}

function resolveAuthPath(codexHome?: string): string {
  return join(resolveCodexHome(codexHome), "auth.json");
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function jwtExpiresAt(token: string): string | undefined {
  const exp = decodeJwtPayload(token)?.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return undefined;
  return new Date(exp * 1000).toISOString();
}

function isExpired(expiresAt: string | undefined, now: Date): boolean {
  return Boolean(expiresAt && Date.parse(expiresAt) <= now.getTime());
}

async function readCodexAuth(codexHome?: string): Promise<{ authPath: string; auth: CodexAuthJson }> {
  const authPath = resolveAuthPath(codexHome);
  const raw = await readFile(authPath, "utf-8");
  return { authPath, auth: JSON.parse(raw) as CodexAuthJson };
}

async function readCredentials(
  options?: { readonly codexHome?: string; readonly now?: Date },
): Promise<CodexOAuthCredentials> {
  const { authPath, auth } = await readCodexAuth(options?.codexHome);
  const accessToken = typeof auth.tokens?.access_token === "string" ? auth.tokens.access_token : "";
  const accountId = typeof auth.tokens?.account_id === "string" ? auth.tokens.account_id : "";
  const authMode = typeof auth.auth_mode === "string" ? auth.auth_mode : "";
  const expiresAt = accessToken ? jwtExpiresAt(accessToken) : undefined;

  if (authMode !== "chatgpt") {
    throw new Error("Codex is not logged in with ChatGPT OAuth. Run `codex login` and choose ChatGPT.");
  }
  if (!accessToken || !accountId) {
    throw new Error("Codex ChatGPT OAuth tokens are incomplete. Run `codex login` again.");
  }
  if (isExpired(expiresAt, options?.now ?? new Date())) {
    throw new Error("Codex ChatGPT OAuth access token is expired. Run `codex login status` or `codex login` to refresh it.");
  }

  return { accessToken, accountId, authPath, ...(expiresAt ? { expiresAt } : {}) };
}

export async function getCodexOAuthStatus(
  options?: { readonly codexHome?: string; readonly now?: Date },
): Promise<CodexOAuthStatus> {
  const authPath = resolveAuthPath(options?.codexHome);
  try {
    const { auth } = await readCodexAuth(options?.codexHome);
    const authMode = typeof auth.auth_mode === "string" ? auth.auth_mode : undefined;
    const accessToken = typeof auth.tokens?.access_token === "string" ? auth.tokens.access_token : "";
    const accountId = typeof auth.tokens?.account_id === "string" ? auth.tokens.account_id : undefined;
    const expiresAt = accessToken ? jwtExpiresAt(accessToken) : undefined;
    const lastRefresh = typeof auth.last_refresh === "string" ? auth.last_refresh : undefined;

    if (authMode !== "chatgpt") {
      return {
        connected: false,
        ...(authMode ? { authMode } : {}),
        authPath,
        message: "Codex is logged in with a non-ChatGPT auth mode.",
      };
    }
    if (!accessToken || !accountId) {
      return { connected: false, authMode, authPath, message: "Codex ChatGPT OAuth tokens are incomplete." };
    }
    if (isExpired(expiresAt, options?.now ?? new Date())) {
      return {
        connected: false,
        authMode,
        accountId,
        authPath,
        ...(expiresAt ? { expiresAt } : {}),
        ...(lastRefresh ? { lastRefresh } : {}),
        message: "Codex ChatGPT OAuth access token is expired.",
      };
    }
    return {
      connected: true,
      authMode,
      accountId,
      authPath,
      ...(expiresAt ? { expiresAt } : {}),
      ...(lastRefresh ? { lastRefresh } : {}),
    };
  } catch (error) {
    return {
      connected: false,
      authPath,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function buildCodexOAuthHeaders(
  options?: { readonly codexHome?: string; readonly now?: Date },
): Promise<Record<string, string>> {
  const credentials = await readCredentials(options);
  return {
    Authorization: `Bearer ${credentials.accessToken}`,
    "ChatGPT-Account-ID": credentials.accountId,
  };
}

async function resolveCodexVersion(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("codex", ["--version"], { timeout: 2_000 });
    const match = stdout.match(/\d+\.\d+\.\d+/);
    return match?.[0] ?? DEFAULT_CODEX_VERSION;
  } catch {
    return DEFAULT_CODEX_VERSION;
  }
}

function modelString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function modelNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export async function listCodexOAuthModels(
  options?: {
    readonly codexHome?: string;
    readonly codexVersion?: string;
    readonly fetchImpl?: typeof fetch;
  },
): Promise<ReadonlyArray<CodexOAuthModelInfo>> {
  const headers = await buildCodexOAuthHeaders({ codexHome: options?.codexHome });
  const codexVersion = options?.codexVersion ?? await resolveCodexVersion();
  const fetchImpl = options?.fetchImpl ?? fetch;
  const res = await fetchImpl(`${CODEX_OAUTH_BASE_URL}/models?client_version=${encodeURIComponent(codexVersion)}`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Codex OAuth model list failed: HTTP ${res.status} ${body.slice(0, 200)}`.trim());
  }
  const json = await res.json() as { models?: Array<Record<string, unknown>> };
  const models = Array.isArray(json.models) ? json.models : [];
  return models
    .filter((model) => model.supported_in_api !== false)
    .filter((model) => model.visibility !== "hidden")
    .map((model) => {
      const id = modelString(model.slug) ?? modelString(model.id) ?? modelString(model.model);
      if (!id) return null;
      const contextWindow = modelNumber(model.context_window)
        ?? modelNumber(model.max_context_window)
        ?? modelNumber(model.contextWindow)
        ?? 0;
      const maxOutput = modelNumber(model.max_output)
        ?? modelNumber(model.max_output_tokens)
        ?? modelNumber(model.max_context_window)
        ?? modelNumber(model.context_window);
      return {
        id,
        name: modelString(model.display_name) ?? modelString(model.name) ?? id,
        contextWindow,
        ...(maxOutput ? { maxOutput } : {}),
      };
    })
    .filter((model): model is CodexOAuthModelInfo => model !== null);
}
