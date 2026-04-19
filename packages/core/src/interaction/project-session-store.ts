import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { InteractionSessionSchema, type InteractionSession, GlobalSessionSchema, type GlobalSession } from "./session.js";

const SESSION_DIR = ".inkos";
const SESSION_FILE = "session.json";

export function resolveProjectSessionPath(projectRoot: string): string {
  return join(projectRoot, SESSION_DIR, SESSION_FILE);
}

export function createProjectSession(projectRoot: string): InteractionSession {
  return InteractionSessionSchema.parse({
    sessionId: `${Date.now()}`,
    projectRoot,
    automationMode: "semi",
    messages: [],
  });
}

export async function loadProjectSession(projectRoot: string): Promise<InteractionSession> {
  try {
    const raw = await readFile(resolveProjectSessionPath(projectRoot), "utf-8");
    return InteractionSessionSchema.parse(JSON.parse(raw));
  } catch {
    return createProjectSession(projectRoot);
  }
}

export async function persistProjectSession(
  projectRoot: string,
  session: InteractionSession,
): Promise<void> {
  const dir = join(projectRoot, SESSION_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(resolveProjectSessionPath(projectRoot), JSON.stringify(session, null, 2), "utf-8");
}

export async function loadGlobalSession(projectRoot: string): Promise<GlobalSession> {
  try {
    const raw = await readFile(join(projectRoot, SESSION_DIR, SESSION_FILE), "utf-8");
    const data = JSON.parse(raw);
    return GlobalSessionSchema.parse({
      activeBookId: data.activeBookId,
      automationMode: data.automationMode ?? "semi",
    });
  } catch {
    return { automationMode: "semi" };
  }
}

export async function persistGlobalSession(
  projectRoot: string,
  global: GlobalSession,
): Promise<void> {
  const dir = join(projectRoot, SESSION_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, SESSION_FILE), JSON.stringify(global, null, 2));
}

export async function resolveSessionActiveBook(
  projectRoot: string,
  session: InteractionSession,
): Promise<string | undefined> {
  const booksDir = join(projectRoot, "books");
  const entries = await readdir(booksDir, { withFileTypes: true }).catch(() => []);
  const bookIds = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (session.activeBookId && bookIds.includes(session.activeBookId)) {
    return session.activeBookId;
  }

  if (bookIds.length === 1) {
    return bookIds[0];
  }

  return undefined;
}
