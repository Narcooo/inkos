import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BookSessionSchema, createBookSession } from "./session.js";
import type { BookSession } from "./session.js";

const SESSIONS_DIR = ".inkos/sessions";

function sessionsDir(projectRoot: string): string {
  return join(projectRoot, SESSIONS_DIR);
}

function sessionPath(projectRoot: string, sessionId: string): string {
  return join(sessionsDir(projectRoot), `${sessionId}.json`);
}

export async function loadBookSession(
  projectRoot: string,
  sessionId: string,
): Promise<BookSession | null> {
  try {
    const raw = await readFile(sessionPath(projectRoot, sessionId), "utf-8");
    return BookSessionSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function persistBookSession(
  projectRoot: string,
  session: BookSession,
): Promise<void> {
  const dir = sessionsDir(projectRoot);
  await mkdir(dir, { recursive: true });
  await writeFile(
    sessionPath(projectRoot, session.sessionId),
    JSON.stringify(session, null, 2),
  );
}

export async function listBookSessions(
  projectRoot: string,
  bookId: string | null,
): Promise<ReadonlyArray<BookSession>> {
  const dir = sessionsDir(projectRoot);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const sessions: BookSession[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(dir, file), "utf-8");
      const session = BookSessionSchema.parse(JSON.parse(raw));
      if (session.bookId === bookId) {
        sessions.push(session);
      }
    } catch {
      // skip corrupt files
    }
  }

  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function findOrCreateBookSession(
  projectRoot: string,
  bookId: string | null,
): Promise<BookSession> {
  const existing = await listBookSessions(projectRoot, bookId);
  if (existing.length > 0) return existing[0];
  const session = createBookSession(bookId);
  await persistBookSession(projectRoot, session);
  return session;
}
