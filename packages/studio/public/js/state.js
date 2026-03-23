// InkOS Studio — Global State
export const state = {
  books: [],
  activeBookId: "",
  meta: null,
  chatHistory: [],
  pendingChatResult: null,
  currentView: "dashboard",
  busyCount: 0,
  contentState: {
    type: "",       // "chapter" | "story-file" | "outline" | "brief"
    bookId: "",
    file: "",
    content: "",
    isEditing: false,
  },
  chatContext: {
    targetType: "brief",
    bookId: "",
    file: "",
  },
  chapterIndex: null,
  chapterFiles: [],
  sidebarCollapsed: false,
};
