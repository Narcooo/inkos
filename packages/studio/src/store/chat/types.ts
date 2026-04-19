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

export interface SessionSummary {
  readonly sessionId: string;
  readonly bookId: string | null;
  readonly title: string | null;
  readonly messageCount: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface AgentResponse {
  readonly response?: string;
  readonly error?: string | { code?: string; message?: string };
  readonly details?: {
    readonly draftRaw?: string;
    readonly toolCall?: ToolCall;
  };
  readonly session?: {
    readonly sessionId?: string;
    readonly bookId?: string | null;
    readonly title?: string | null;
    readonly activeBookId?: string;
    readonly creationDraft?: unknown;
    readonly messages?: ReadonlyArray<SessionMessage>;
  };
  readonly request?: unknown;
}

export interface SessionResponse {
  readonly session?: {
    readonly sessionId?: string;
    readonly bookId?: string | null;
    readonly title?: string | null;
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

export interface SessionRuntime {
  readonly sessionId: string;
  readonly bookId: string | null;
  readonly title: string | null;
  readonly messages: ReadonlyArray<Message>;
  readonly stream: EventSource | null;
  readonly isStreaming: boolean;
  readonly lastError: string | null;
  readonly pendingBookArgs: Record<string, unknown> | null;
  // 仅前端存在、尚未持久化到磁盘的草稿会话。发送第一条消息时才调 POST /sessions 把它落盘。
  readonly isDraft: boolean;
}

export interface MessageState {
  sessions: Record<string, SessionRuntime>;
  sessionIdsByBook: Record<string, ReadonlyArray<string>>;
  activeSessionId: string | null;
  input: string;
  selectedModel: string | null;
  selectedService: string | null;
}

export interface CreateState {
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
  activateSession: (sessionId: string | null) => void;
  setInput: (text: string) => void;
  addUserMessage: (sessionId: string, content: string) => void;
  appendStreamChunk: (sessionId: string, text: string, streamTs: number) => void;
  finalizeStream: (sessionId: string, streamTs: number, content: string, toolCall?: ToolCall) => void;
  replaceStreamWithError: (sessionId: string, streamTs: number, errorMsg: string) => void;
  addErrorMessage: (sessionId: string, errorMsg: string) => void;
  loadSessionMessages: (sessionId: string, msgs: ReadonlyArray<SessionMessage>) => void;
  loadSessionList: (bookId: string | null) => Promise<void>;
  createSession: (bookId: string | null) => Promise<string>;
  createDraftSession: (bookId: string | null) => string;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  loadSessionDetail: (sessionId: string) => Promise<void>;
  sendMessage: (sessionId: string, text: string, activeBookId?: string) => Promise<void>;
  setSelectedModel: (model: string, service: string) => void;
}

export interface CreateActions {
  setPendingBookArgs: (args: Record<string, unknown> | null) => void;
  setBookCreating: (creating: boolean) => void;
  setCreateProgress: (progress: string) => void;
  handleCreateBook: (sessionId: string, activeBookId?: string) => Promise<string | null>;
  bumpBookDataVersion: () => void;
  openArtifact: (file: string) => void;
  openChapterArtifact: (chapterNum: number) => void;
  closeArtifact: () => void;
  setBookSummary: (summary: BookSummary | null) => void;
}

// -- Composed store type --

export type ChatStore = ChatState & MessageActions & CreateActions;
