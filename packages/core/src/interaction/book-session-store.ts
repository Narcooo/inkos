import { readFile, writeFile, readdir, mkdir, unlink } from "node:fs/promises";
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

/**
 * 从 messages 数组里取第一条 user 消息，裁剪成 ≤20 字的单行字符串。
 * 用于把用户首条提问作为会话标题。
 */
export function extractFirstUserMessageTitle(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    if ((message as { role?: unknown }).role !== "user") continue;
    const content = (message as { content?: unknown }).content;
    if (typeof content !== "string") return null;
    const oneLine = content.trim().replace(/\s+/g, " ");
    if (oneLine.length === 0) return null;
    return oneLine.length > 20 ? `${oneLine.slice(0, 20)}…` : oneLine;
  }
  return null;
}

export class SessionAlreadyMigratedError extends Error {
  constructor(sessionId: string, currentBookId: string) {
    super(`Session "${sessionId}" is already bound to book "${currentBookId}"`);
    this.name = "SessionAlreadyMigratedError";
  }
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

export interface BookSessionSummary {
  readonly sessionId: string;
  readonly bookId: string | null;
  readonly title: string | null;
  readonly messageCount: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export async function listBookSessions(
  projectRoot: string,
  bookId: string | null,
): Promise<ReadonlyArray<BookSessionSummary>> {
  const dir = sessionsDir(projectRoot);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const jsonFiles = files.filter((file) => file.endsWith(".json"));
  const summaries = await Promise.all(
    jsonFiles.map(async (file): Promise<BookSessionSummary | null> => {
      try {
        const raw = await readFile(join(dir, file), "utf-8");
        const data = JSON.parse(raw) as {
          sessionId?: unknown;
          bookId?: unknown;
          title?: unknown;
          messages?: unknown;
          createdAt?: unknown;
          updatedAt?: unknown;
        };
        if (typeof data.sessionId !== "string") return null;
        const parsedBookId = data.bookId === null || typeof data.bookId === "string"
          ? (data.bookId as string | null)
          : null;
        if (parsedBookId !== bookId) return null;

        let persistedTitle = typeof data.title === "string" ? data.title : null;

        // Lazy migration：老 session 的 title 字段是 null 但已经有用户消息的，
        // 一次性把第一条用户消息补写成 title 并 persist 回磁盘。用户在新流程中
        // 发消息时会立即写 title，此 migration 只对历史数据生效一次。
        if (persistedTitle === null) {
          const recoveredTitle = extractFirstUserMessageTitle(data.messages);
          if (recoveredTitle) {
            try {
              const fullSession = await loadBookSession(projectRoot, data.sessionId);
              if (fullSession && fullSession.title === null) {
                await persistBookSession(projectRoot, { ...fullSession, title: recoveredTitle });
                persistedTitle = recoveredTitle;
              }
            } catch {
              // 读不出完整 session 就忽略；下次再试
            }
          }
        }

        return {
          sessionId: data.sessionId,
          bookId: parsedBookId,
          title: persistedTitle,
          messageCount: Array.isArray(data.messages) ? data.messages.length : 0,
          createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
          updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
        };
      } catch {
        return null;
      }
    }),
  );

  return summaries
    .filter((summary): summary is BookSessionSummary => summary !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function renameBookSession(
  projectRoot: string,
  sessionId: string,
  title: string,
): Promise<BookSession | null> {
  const session = await loadBookSession(projectRoot, sessionId);
  if (!session) return null;
  const updated = { ...session, title, updatedAt: Date.now() };
  await persistBookSession(projectRoot, updated);
  return updated;
}

export async function deleteBookSession(
  projectRoot: string,
  sessionId: string,
): Promise<void> {
  try {
    await unlink(sessionPath(projectRoot, sessionId));
  } catch {
    // Session file is already absent; treat delete as idempotent.
  }
}

export async function migrateBookSession(
  projectRoot: string,
  sessionId: string,
  newBookId: string,
): Promise<BookSession | null> {
  const session = await loadBookSession(projectRoot, sessionId);
  if (!session) return null;
  if (session.bookId !== null) {
    throw new SessionAlreadyMigratedError(sessionId, session.bookId);
  }

  const updated = {
    ...session,
    bookId: newBookId,
    updatedAt: Date.now(),
  };
  await persistBookSession(projectRoot, updated);
  return updated;
}

export async function createAndPersistBookSession(
  projectRoot: string,
  bookId: string | null,
  sessionId?: string,
): Promise<BookSession> {
  // 如果指定了 sessionId 且对应文件已存在，视为幂等操作直接返回（支持"用户发消息时才持久化 draft"流程）
  if (sessionId) {
    const existing = await loadBookSession(projectRoot, sessionId);
    if (existing) return existing;
  }
  const session = createBookSession(bookId, sessionId);
  await persistBookSession(projectRoot, session);
  return session;
}
