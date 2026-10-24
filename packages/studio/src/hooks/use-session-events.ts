import type { SSEMessage } from "./use-sse";
import { useEffect } from "react";
import { useNewSSEMessages } from "./use-sse";
import type { HashRoute } from "./use-hash-route";
import { useChatStore } from "../store/chat";
import { bookKey, mergeSessionIds, updateSession } from "../store/chat/slices/message/runtime";
import { clearBookCreateSessionId, getBookCreateSessionId, getProjectChatSessionId } from "../pages/chat-page-state";
import type { AgentResponse } from "../store/chat/types";

type SessionTarget = NonNullable<AgentResponse["session"]> & { sessionId: string; workId: string; profileId: string; previousWorkId?: string | null };

/**
 * 监听全局 SSE 事件中与 session 有关的两类消息：
 * - session:title — AI 自动生成标题后推送，更新侧边栏显示
 * - book:created  — 新建书籍成功后推送，把 session 从 null 迁移到新书籍、清 localStorage、跳转
 *
 * Cursor-based consumption matters because React may batch multiple SSE state
 * updates into one render; looking only at messages.at(-1) drops middle events.
 */
export function useSessionEvents(
  sse: { messages: ReadonlyArray<SSEMessage> },
  route: HashRoute,
  setRoute: (route: HashRoute) => void,
): void {
  const activeSessionId = useChatStore(state => state.activeSessionId);
  const activeSession = useChatStore(state => state.activeSessionId ? state.sessions[state.activeSessionId] : undefined);
  useEffect(() => {
    const entrySessionId = route.page === "book-create" ? getBookCreateSessionId()
      : route.page === "chat" ? getProjectChatSessionId() : null;
    const target = activeSession?.pendingWorkTarget ?? (
      entrySessionId === activeSessionId && activeSession?.workId && activeSession.profileId
        ? { workId: activeSession.workId, profileId: activeSession.profileId, fromWorkId: null }
        : undefined
    );
    if (!activeSessionId || !activeSession || !target || activeSession.isChatStreaming || activeSession.isStreaming) return;
    if (!["chat", "book", "book-create", "work-chat", "film-author"].includes(route.page)) return;
    const routeWorkId = route.page === "work-chat" ? route.workId : route.page === "book" ? route.bookId : undefined;
    if (routeWorkId && routeWorkId !== target.fromWorkId && routeWorkId !== target.workId) return;
    useChatStore.setState(state => ({ sessions: updateSession(state.sessions, activeSessionId, () => ({ pendingWorkTarget: undefined })) }));
    if (getBookCreateSessionId() === activeSessionId) clearBookCreateSessionId();
    setRoute(target.profileId === "longform-novel" ? { page: "book", bookId: target.workId }
      : { page: "work-chat", workId: target.workId, profileId: target.profileId });
  }, [activeSessionId, activeSession, route, setRoute]);
  useNewSSEMessages(sse.messages, (recent) => {
    if (recent.event === "session:target") {
      const target = recent.data as SessionTarget;
      if (!target?.sessionId || !target.workId || !target.profileId) return;
      useChatStore.setState(state => ({ sessions: updateSession(state.sessions, target.sessionId, session => ({
        pendingWorkTarget: { workId: target.workId, profileId: target.profileId,
          fromWorkId: target.previousWorkId ?? session.workId ?? session.bookId },
      })) }));
      return;
    }
    if (recent.event === "session:title") {
      const data = recent.data as { sessionId?: string; title?: string } | null;
      if (!data?.sessionId || !data.title) return;
      const { sessionId, title } = data;
      useChatStore.setState((state) => {
        const session = state.sessions[sessionId];
        if (!session) return {};
        return {
          sessions: updateSession(state.sessions, sessionId, () => ({ title })),
        };
      });
      return;
    }

    if (recent.event === "book:created") {
      const data = recent.data as { sessionId?: string; bookId?: string } | null;
      if (!data?.sessionId || !data.bookId) return;
      const { sessionId, bookId } = data;

      useChatStore.setState((state) => {
        const session = state.sessions[sessionId];
        if (!session) return {};
        const previousKey = bookKey(session.bookId);
        const nextKey = bookKey(bookId);
        return {
          sessions: updateSession(state.sessions, sessionId, () => ({ bookId })),
          sessionIdsByBook: {
            ...state.sessionIdsByBook,
            [previousKey]: (state.sessionIdsByBook[previousKey] ?? []).filter((id) => id !== sessionId),
            [nextKey]: mergeSessionIds(state.sessionIdsByBook[nextKey], [sessionId]),
          },
        };
      });

      if (getBookCreateSessionId() === sessionId && !useChatStore.getState().sessions[sessionId]?.pendingWorkTarget) {
        clearBookCreateSessionId();
        if (route.page === "book-create") {
          setRoute({ page: "book", bookId });
        }
      }
    }
  });
}
