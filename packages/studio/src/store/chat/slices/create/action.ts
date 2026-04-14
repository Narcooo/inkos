import type { StateCreator } from "zustand";
import type { ChatStore, CreateActions, AgentResponse } from "../../types";
import { fetchJson } from "../../../../hooks/use-api";

export const createCreateSlice: StateCreator<ChatStore, [], [], CreateActions> = (set, get) => ({
  setPendingBookArgs: (args) => set({ pendingBookArgs: args }),
  setBookCreating: (creating) => set({ bookCreating: creating }),
  setCreateProgress: (progress) => set({ createProgress: progress }),

  bumpBookDataVersion: () => set((s) => ({ bookDataVersion: s.bookDataVersion + 1 })),
  openArtifact: (file) => set({ sidebarView: "artifact", artifactFile: file, artifactChapter: null }),
  openChapterArtifact: (chapterNum) => set({ sidebarView: "artifact", artifactFile: null, artifactChapter: chapterNum }),
  closeArtifact: () => set({ sidebarView: "panel", artifactFile: null, artifactChapter: null }),
  setBookSummary: (summary) => set({ bookSummary: summary }),

  handleCreateBook: async (activeBookId) => {
    if (!get().pendingBookArgs) return null;

    set({ bookCreating: true });
    try {
      const data = await fetchJson<AgentResponse>("/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: "/create", activeBookId }),
      });
      const newBookId = data.session?.activeBookId ?? null;
      if (newBookId) get().bumpBookDataVersion();
      return newBookId;
    } catch (e) {
      get().addErrorMessage(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      set({ bookCreating: false });
    }
  },
});
