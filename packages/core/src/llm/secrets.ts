import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface SecretsFile {
  services: Record<string, { apiKey: string }>;
}

const SECRETS_DIR = ".inkos";
const SECRETS_FILE = "secrets.json";

export async function loadSecrets(projectRoot: string): Promise<SecretsFile> {
  try {
    const raw = await readFile(
      join(projectRoot, SECRETS_DIR, SECRETS_FILE),
      "utf-8",
    );
    return JSON.parse(raw) as SecretsFile;
  } catch {
    return { services: {} };
  }
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

  // 2. Environment variable: MOONSHOT_API_KEY, DEEPSEEK_API_KEY, etc.
  const envKey = `${service.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_API_KEY`;
  if (process.env[envKey]) return process.env[envKey]!;

  return null;
}
