import { useEffect } from "react";
import { useChatStore } from "../../store/chat";
import {
  getBookCreateSessionId,
  setBookCreateSessionId,
} from "../chat-page-state";

export function useChatSession(activeBookId: string | undefined): void {
  const loadSessionList = useChatStore((s) => s.loadSessionList);
  const createSession = useChatStore((s) => s.createSession);
  const loadSessionDetail = useChatStore((s) => s.loadSessionDetail);
  const activateSession = useChatStore((s) => s.activateSession);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (activeBookId) {
        await loadSessionList(activeBookId);
        if (cancelled) return;

        const state = useChatStore.getState();
        const currentSession = state.activeSessionId
          ? state.sessions[state.activeSessionId]
          : null;
        if (currentSession?.bookId === activeBookId) {
          await loadSessionDetail(currentSession.sessionId);
          return;
        }

        const ids = state.sessionIdsByBook[activeBookId] ?? [];
        if (ids.length > 0) {
          activateSession(ids[0]);
          await loadSessionDetail(ids[0]);
          return;
        }

        await createSession(activeBookId);
        return;
      }

      const existingId = getBookCreateSessionId();
      if (existingId) {
        await loadSessionDetail(existingId);
        if (cancelled) return;

        const state = useChatStore.getState();
        const session = state.sessions[existingId];
        if (session && session.bookId === null) {
          activateSession(existingId);
          return;
        }
      }

      const newSessionId = await createSession(null);
      if (!cancelled) {
        setBookCreateSessionId(newSessionId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeBookId, activateSession, createSession, loadSessionDetail, loadSessionList]);
}
