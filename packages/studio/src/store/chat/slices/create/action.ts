import type { StateCreator } from "zustand";
import type { ChatStore, CreateActions, AgentResponse } from "../../types";
import { fetchJson } from "../../../../hooks/use-api";
import { bookKey } from "../message/runtime";

export const createCreateSlice: StateCreator<ChatStore, [], [], CreateActions> = (set, get) => ({
  setPendingBookArgs: (args) =>
    set((state) => {
      if (!state.activeSessionId) return {};
      return {
        sessions: {
          ...state.sessions,
          [state.activeSessionId]: {
            ...state.sessions[state.activeSessionId],
            pendingBookArgs: args,
          },
        },
      };
    }),
  setBookCreating: (creating) => set({ bookCreating: creating }),
  setCreateProgress: (progress) => set({ createProgress: progress }),

  bumpBookDataVersion: () => set((s) => ({ bookDataVersion: s.bookDataVersion + 1 })),
  openArtifact: (file) => set({ sidebarView: "artifact", artifactFile: file, artifactChapter: null }),
  openChapterArtifact: (chapterNum) => set({ sidebarView: "artifact", artifactFile: null, artifactChapter: chapterNum }),
  closeArtifact: () => set({ sidebarView: "panel", artifactFile: null, artifactChapter: null }),
  setBookSummary: (summary) => set({ bookSummary: summary }),

  handleCreateBook: async (sessionId, activeBookId) => {
    const session = get().sessions[sessionId];
    if (!session?.pendingBookArgs) return null;

    set({ bookCreating: true });
    try {
      const data = await fetchJson<AgentResponse>("/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: "/create", activeBookId, sessionId }),
      });
      const newBookId = data.session?.activeBookId ?? null;
      if (newBookId) {
        set((state) => {
          const session = state.sessions[sessionId];
          if (!session) {
            return {};
          }

          const previousIds = state.sessionIdsByBook[bookKey(session.bookId)] ?? [];
          const nextIds = state.sessionIdsByBook[newBookId] ?? [];

          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...session,
                bookId: newBookId,
                pendingBookArgs: null,
              },
            },
            sessionIdsByBook: {
              ...state.sessionIdsByBook,
              [bookKey(session.bookId)]: previousIds.filter((id) => id !== sessionId),
              [newBookId]: nextIds.includes(sessionId) ? nextIds : [sessionId, ...nextIds],
            },
          };
        });
        get().bumpBookDataVersion();
      }
      set((state) => {
        if (!state.sessions[sessionId]) return {};
        return {
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...state.sessions[sessionId],
              pendingBookArgs: null,
            },
          },
        };
      });
      return newBookId;
    } catch (e) {
      get().addErrorMessage(sessionId, e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      set({ bookCreating: false });
    }
  },
});
