import type { StateCreator } from "zustand";
import { fetchJson } from "../../../../hooks/use-api";
import type {
  ChatStore,
  MessageActions,
  SessionResponse,
  SessionSummary,
} from "../../types";
import {
  bookKey,
  createSessionRuntime,
  deserializeMessages,
  mergeSessionIds,
  updateSession,
  upsertSessionSummary,
} from "./runtime";

type SliceSet = Parameters<StateCreator<ChatStore, [], [], MessageActions>>[0];
type SliceGet = Parameters<StateCreator<ChatStore, [], [], MessageActions>>[1];

export function createDraftSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function removeSessionFromBookIndexes(
  sessionIdsByBook: Record<string, ReadonlyArray<string>>,
  sessionId: string,
): Record<string, ReadonlyArray<string>> {
  return Object.fromEntries(
    Object.entries(sessionIdsByBook).map(([key, ids]) => [
      key,
      ids.filter((id) => id !== sessionId),
    ]),
  );
}

export function resolveActiveSessionAfterDelete(input: {
  activeSessionId: string | null;
  deletedSessionId: string;
  deletedSessionBookId: string | null | undefined;
  sessionIdsByBook: Record<string, ReadonlyArray<string>>;
}): string | null {
  if (input.activeSessionId !== input.deletedSessionId) return input.activeSessionId;
  const fallbackKey = bookKey(input.deletedSessionBookId ?? null);
  return input.sessionIdsByBook[fallbackKey]?.[0] ?? null;
}

export async function loadSessionListAction(
  set: SliceSet,
  bookId: string | null,
): Promise<void> {
  const query = bookId === null ? "null" : encodeURIComponent(bookId);
  try {
    const data = await fetchJson<{ sessions: ReadonlyArray<SessionSummary> }>(`/sessions?bookId=${query}`);
    set((state) => {
      let sessions = state.sessions;
      for (const summary of data.sessions) {
        sessions = upsertSessionSummary(sessions, summary);
      }
      return {
        sessions,
        sessionIdsByBook: {
          ...state.sessionIdsByBook,
          [bookKey(bookId)]: data.sessions.map((session) => session.sessionId),
        },
      };
    });
  } catch {
    // ignore
  }
}

export async function createSessionAction(
  set: SliceSet,
  bookId: string | null,
): Promise<string> {
  const data = await fetchJson<SessionResponse>("/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookId }),
  });
  const sessionId = data.session?.sessionId;
  if (!sessionId) {
    throw new Error("Failed to create session");
  }

  set((state) => {
    const runtime = createSessionRuntime({
      sessionId,
      bookId: data.session?.bookId ?? bookId ?? null,
      title: data.session?.title ?? null,
    });
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: runtime,
      },
      sessionIdsByBook: {
        ...state.sessionIdsByBook,
        [bookKey(runtime.bookId)]: mergeSessionIds(
          state.sessionIdsByBook[bookKey(runtime.bookId)],
          [sessionId],
        ),
      },
      activeSessionId: sessionId,
    };
  });

  return sessionId;
}

export function createDraftSessionAction(
  set: SliceSet,
  bookId: string | null,
): string {
  const sessionId = createDraftSessionId();
  set((state) => {
    const runtime = createSessionRuntime({
      sessionId,
      bookId,
      title: null,
      isDraft: true,
    });
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: runtime,
      },
      activeSessionId: sessionId,
    };
  });
  return sessionId;
}

export async function renameSessionAction(
  set: SliceSet,
  get: SliceGet,
  sessionId: string,
  title: string,
): Promise<void> {
  const previous = get().sessions[sessionId]?.title ?? null;
  set((state) => ({
    sessions: updateSession(state.sessions, sessionId, () => ({ title })),
  }));

  try {
    await fetchJson(`/sessions/${sessionId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
  } catch {
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, () => ({ title: previous })),
    }));
  }
}

export async function deleteSessionAction(
  set: SliceSet,
  get: SliceGet,
  sessionId: string,
): Promise<void> {
  const session = get().sessions[sessionId];
  session?.stream?.close();
  if (session && !session.isDraft) {
    try {
      await fetchJson(`/sessions/${sessionId}`, { method: "DELETE" });
    } catch {
      // ignore
    }
  }

  set((state) => {
    const { [sessionId]: deleted, ...rest } = state.sessions;
    const sessionIdsByBook = removeSessionFromBookIndexes(state.sessionIdsByBook, sessionId);

    return {
      sessions: rest,
      sessionIdsByBook,
      activeSessionId: resolveActiveSessionAfterDelete({
        activeSessionId: state.activeSessionId,
        deletedSessionBookId: session?.bookId,
        deletedSessionId: sessionId,
        sessionIdsByBook,
      }),
    };
  });
}

export async function loadSessionDetailAction(
  set: SliceSet,
  get: SliceGet,
  sessionId: string,
): Promise<void> {
  const existing = get().sessions[sessionId];
  if (existing?.isDraft) return;
  if (existing && existing.messages.length > 0) return;

  try {
    const data = await fetchJson<SessionResponse>(`/sessions/${sessionId}`);
    const detail = data.session;
    if (!detail?.sessionId) return;
    const detailSessionId = detail.sessionId;
    const messages = detail.messages ? deserializeMessages(detail.messages) : [];

    set((state) => {
      const runtime = state.sessions[detailSessionId];
      if (runtime && runtime.messages.length > 0) return {};
      const nextBookId = detail.bookId ?? runtime?.bookId ?? null;
      return {
        sessions: {
          ...state.sessions,
          [detailSessionId]: {
            ...(runtime ?? createSessionRuntime({
              sessionId: detailSessionId,
              bookId: nextBookId,
              title: detail.title ?? null,
            })),
            bookId: nextBookId,
            title: detail.title ?? runtime?.title ?? null,
            messages,
          },
        },
        sessionIdsByBook: {
          ...state.sessionIdsByBook,
          [bookKey(nextBookId)]: mergeSessionIds(
            state.sessionIdsByBook[bookKey(nextBookId)],
            [detailSessionId],
          ),
        },
      };
    });
  } catch {
    // ignore
  }
}
