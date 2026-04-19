import { useEffect } from "react";
import type { SSEMessage } from "./use-sse";
import type { HashRoute } from "./use-hash-route";
import { useChatStore } from "../store/chat";
import { bookKey, mergeSessionIds, updateSession } from "../store/chat/slices/message/runtime";
import { clearBookCreateSessionId, getBookCreateSessionId } from "../pages/chat-page-state";

/**
 * 监听全局 SSE 事件中与 session 有关的两类消息：
 * - session:title — AI 自动生成标题后推送，更新侧边栏显示
 * - book:created  — 新建书籍成功后推送，把 session 从 null 迁移到新书籍、清 localStorage、跳转
 */
export function useSessionEvents(
  sse: { messages: ReadonlyArray<SSEMessage> },
  route: HashRoute,
  setRoute: (route: HashRoute) => void,
): void {
  useEffect(() => {
    const recent = sse.messages.at(-1);
    if (!recent) return;

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

      if (getBookCreateSessionId() === sessionId) {
        clearBookCreateSessionId();
        if (route.page === "book-create") {
          setRoute({ page: "book", bookId });
        }
      }
    }
  }, [route.page, setRoute, sse.messages]);
}
