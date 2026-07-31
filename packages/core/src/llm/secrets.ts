import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getOAuthApiKey, type OAuthCredentials } from "@mariozechner/pi-ai/oauth";

export interface OAuthServiceSecret {
  provider: string;
  credentials: OAuthCredentials;
}

export interface ServiceSecret {
  apiKey?: string;
  oauth?: OAuthServiceSecret;
}

export interface SecretsFile {
  services: Record<string, ServiceSecret>;
}

const SECRETS_DIR = ".inkos";
const SECRETS_FILE = "secrets.json";

const LEGACY_SERVICE_ID_REMAP: Record<string, string> = {
  siliconflow: "siliconcloud",
};

function migrateLegacyServiceIds(secrets: SecretsFile): { data: SecretsFile; changed: boolean } {
  let changed = false;
  for (const [oldId, newId] of Object.entries(LEGACY_SERVICE_ID_REMAP)) {
    if (secrets.services[oldId] && !secrets.services[newId]) {
      secrets.services[newId] = secrets.services[oldId];
      delete secrets.services[oldId];
      changed = true;
    }
  }
  return { data: secrets, changed };
}

async function readSecretsRaw(projectRoot: string): Promise<SecretsFile> {
  try {
    const raw = await readFile(
      join(projectRoot, SECRETS_DIR, SECRETS_FILE),
      "utf-8",
    );
    const parsed = JSON.parse(raw) as SecretsFile;
    if (!parsed || typeof parsed !== "object" || !parsed.services) {
      return { services: {} };
    }
    return parsed;
  } catch {
    return { services: {} };
  }
}

export async function loadSecrets(projectRoot: string): Promise<SecretsFile> {
  const raw = await readSecretsRaw(projectRoot);
  const { data, changed } = migrateLegacyServiceIds(raw);
  if (changed) await saveSecrets(projectRoot, data);
  return data;
}

export async function saveSecrets(
  projectRoot: string,
  secrets: SecretsFile,
): Promise<void> {
  const dir = join(projectRoot, SECRETS_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, SECRETS_FILE),
    JSON.stringify(secrets, null, 2),
    "utf-8",
  );
}

export async function getServiceApiKey(
  projectRoot: string,
  service: string,
): Promise<string | null> {
  // 1. secrets.json
  const secrets = await loadSecrets(projectRoot);
  const entry = secrets.services[service];
  if (entry?.apiKey) return entry.apiKey;

  if (entry?.oauth) {
    const result = await getOAuthApiKey(entry.oauth.provider, {
      [entry.oauth.provider]: entry.oauth.credentials,
    });
    if (result) {
      if (result.newCredentials !== entry.oauth.credentials) {
        const latest = await loadSecrets(projectRoot);
        const latestEntry = latest.services[service];
        if (latestEntry?.oauth?.provider === entry.oauth.provider) {
          latest.services[service] = {
            oauth: {
              provider: entry.oauth.provider,
              credentials: result.newCredentials,
            },
          };
          await saveSecrets(projectRoot, latest);
        }
      }
      return result.apiKey;
    }
  }

  // 2. Environment variable: MOONSHOT_API_KEY, DEEPSEEK_API_KEY, etc.
  const envKey = `${service.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_API_KEY`;
  if (process.env[envKey]) return process.env[envKey]!;

  return null;
}

export function hasServiceCredentials(secret: ServiceSecret | undefined): boolean {
  return Boolean(secret?.apiKey || secret?.oauth?.credentials.access);
}

export function getServiceAuthStatus(secret: ServiceSecret | undefined): {
  authType: "apiKey" | "oauth" | null;
  connected: boolean;
  expiresAt?: number;
} {
  if (secret?.apiKey) return { authType: "apiKey", connected: true };
  if (secret?.oauth?.credentials.access) {
    return {
      authType: "oauth",
      connected: true,
      expiresAt: secret.oauth.credentials.expires,
    };
  }
  return { authType: null, connected: false };
}

export async function saveServiceOAuthCredentials(
  projectRoot: string,
  service: string,
  provider: string,
  credentials: OAuthCredentials,
): Promise<void> {
  const secrets = await loadSecrets(projectRoot);
  secrets.services[service] = { oauth: { provider, credentials } };
  await saveSecrets(projectRoot, secrets);
}
