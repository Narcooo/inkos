// -- Data types --

export interface ToolCall {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export interface Message {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly thinking?: string;
  readonly thinkingStreaming?: boolean;
  readonly timestamp: number;
  readonly toolCall?: ToolCall;
}

export interface SessionMessage {
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly timestamp: number;
}

export interface AgentResponse {
  readonly response?: string;
  readonly error?: string | { code?: string; message?: string };
  readonly details?: {
    readonly draftRaw?: string;
    readonly toolCall?: ToolCall;
  };
  readonly session?: {
    readonly activeBookId?: string;
    readonly creationDraft?: unknown;
    readonly messages?: ReadonlyArray<SessionMessage>;
  };
  readonly request?: unknown;
}

export interface SessionResponse {
  readonly session?: {
    readonly sessionId?: string;
    readonly activeBookId?: string;
    readonly messages?: ReadonlyArray<SessionMessage>;
  };
  readonly activeBookId?: string;
}

// -- State interfaces --

export interface BookSummary {
  world: string;
  protagonist: string;
  cast: string;
}

export interface MessageState {
  messages: ReadonlyArray<Message>;
  input: string;
  loading: boolean;
  currentSessionId: string | null;
  selectedModel: string | null;
  selectedService: string | null;
  /** Active EventSource ref — closed on session switch */
  _activeStream: EventSource | null;
  /** Active pipeline operation (from SSE tool events) */
  activeOperation: string | null;
}

export interface CreateState {
  pendingBookArgs: Record<string, unknown> | null;
  bookCreating: boolean;
  createProgress: string;
  bookDataVersion: number;
  sidebarView: "panel" | "artifact";
  artifactFile: string | null;         // foundation file name, e.g. "story_bible.md"
  artifactChapter: number | null;      // chapter number, e.g. 1
  bookSummary: BookSummary | null;
}

export type ChatState = MessageState & CreateState;

// -- Action interfaces --

export interface MessageActions {
  setInput: (text: string) => void;
  addUserMessage: (content: string) => void;
  appendStreamChunk: (text: string, streamTs: number) => void;
  finalizeStream: (streamTs: number, content: string, toolCall?: ToolCall) => void;
  replaceStreamWithError: (streamTs: number, errorMsg: string) => void;
  addErrorMessage: (errorMsg: string) => void;
  setLoading: (loading: boolean) => void;
  loadSessionMessages: (msgs: ReadonlyArray<SessionMessage>) => void;
  loadSession: (bookId?: string) => Promise<void>;
  sendMessage: (text: string, activeBookId?: string) => Promise<void>;
  setSelectedModel: (model: string, service: string) => void;
}

export interface CreateActions {
  setPendingBookArgs: (args: Record<string, unknown> | null) => void;
  setBookCreating: (creating: boolean) => void;
  setCreateProgress: (progress: string) => void;
  handleCreateBook: (activeBookId?: string) => Promise<string | null>;
  bumpBookDataVersion: () => void;
  openArtifact: (file: string) => void;
  openChapterArtifact: (chapterNum: number) => void;
  closeArtifact: () => void;
  setBookSummary: (summary: BookSummary | null) => void;
}

// -- Composed store type --

export type ChatStore = ChatState & MessageActions & CreateActions;
