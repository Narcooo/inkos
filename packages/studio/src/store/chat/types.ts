// -- Data types --

export interface ToolCall {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export interface PipelineStage {
  label: string;
  status: "pending" | "active" | "completed";
  progress?: {
    status?: string;          // "thinking" | "streaming" | ...
    elapsedMs: number;
    totalChars: number;
    chineseChars: number;
  };
}

export interface ToolExecution {
  id: string;
  tool: string;
  agent?: string;
  label: string;
  status: "running" | "processing" | "completed" | "error";
  args?: Record<string, unknown>;
  result?: string;
  error?: string;
  stages?: PipelineStage[];
  logs?: string[];
  startedAt: number;
  completedAt?: number;
}

// -- Message parts (chronologically ordered for rendering) --

export type MessagePart =
  | { type: "thinking"; content: string; streaming: boolean }
  | { type: "text"; content: string }
  | { type: "tool"; execution: ToolExecution };

export interface Message {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly thinking?: string;
  readonly thinkingStreaming?: boolean;
  readonly timestamp: number;
  readonly toolCall?: ToolCall;
  readonly toolExecutions?: ToolExecution[];
  readonly parts?: MessagePart[];              // chronological parts for interleaved rendering
}

export interface SessionMessage {
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly thinking?: string;
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
