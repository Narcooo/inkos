import type { ActionPayload, ActionSource, PlayMode, RequestedIntent, SessionKind } from "@actalk/inkos-core";

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
  details?: unknown;
  error?: string;
  stages?: PipelineStage[];
  logs?: string[];
  startedAt: number;
  completedAt?: number;
  // 后台生产任务的工具卡（来自带 background 标记的 tool:start 或任务快照恢复）。
  // 无 executionId 事件的回退路由据此跳过任务卡，只挂聊天轮工具卡。
  background?: boolean;
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
  readonly toolExecutions?: ReadonlyArray<ToolExecution>;
  readonly timestamp: number;
}

export interface SessionSummary {
  readonly sessionId: string;
  readonly bookId: string | null;
  readonly sessionKind?: ChatSessionKind;
  readonly playMode?: PlayMode;
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
    readonly toolExecutions?: ReadonlyArray<ToolExecution>;
  };
  readonly session?: {
    readonly sessionId?: string;
    readonly bookId?: string | null;
    readonly sessionKind?: ChatSessionKind;
    readonly playMode?: PlayMode;
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
    readonly sessionKind?: ChatSessionKind;
    readonly playMode?: PlayMode;
    readonly title?: string | null;
    readonly activeBookId?: string;
    readonly messages?: ReadonlyArray<SessionMessage>;
  };
  readonly activeBookId?: string;
  readonly task?: StudioTaskSnapshot;
}

export interface StudioTaskSnapshot {
  readonly version: 1;
  readonly sessionId: string;
  readonly sourceRequestId?: string;
  readonly requestedIntent: RequestedIntent;
  readonly execution: ToolExecution;
  readonly updatedAt: number;
}

// -- State interfaces --

export interface BookSummary {
  world: string;
  protagonist: string;
  cast: string;
}

export type ChatSessionKind = SessionKind;
export type ChatActionSource = ActionSource;
export type ChatRequestedIntent = RequestedIntent;
export type ChatActionPayload = ActionPayload;

export interface SendMessageOptions {
  readonly activeBookId?: string;
  readonly sessionKind?: ChatSessionKind;
  readonly actionSource?: ChatActionSource;
  readonly requestedIntent?: ChatRequestedIntent;
  readonly actionPayload?: ChatActionPayload;
  readonly requestedSkills?: ReadonlyArray<string>;
  readonly disabledSkills?: ReadonlyArray<string>;
  readonly attachments?: ReadonlyArray<ChatAttachmentPayload>;
  readonly playMode?: PlayMode;
}

// 一次失败的聊天轮发送的原样参数（sendMessage 的 text 与 options），
// 供"重试"按钮一键重发。
export interface FailedSendRecord {
  readonly text: string;
  readonly options?: SendMessageOptions;
}

export interface ChatAttachmentPayload {
  readonly id: string;
  readonly filename: string;
  readonly mediaType: string;
  readonly size: number;
  readonly dataUrl: string;
}

export interface SessionRuntime {
  readonly sessionId: string;
  readonly bookId: string | null;
  readonly sessionKind?: ChatSessionKind;
  readonly playMode?: PlayMode;
  readonly title: string | null;
  readonly messages: ReadonlyArray<Message>;
  readonly stream: EventSource | null;
  // isStreaming = 聊天轮流式中 或 后台生产任务运行中（面向"会话是否忙"的读取方）。
  readonly isStreaming: boolean;
  // isChatStreaming 只表示聊天轮本身在流式中；后台任务运行期间它是 false，
  // 用户仍可继续发消息。
  readonly isChatStreaming: boolean;
  readonly lastError: string | null;
  // 上一条失败的聊天轮发送记录：请求失败（fetch 拒绝、/agent 返回 error 等）时写入，
  // 新一轮发送开始时清除。用户主动停止与后台生产任务轮的失败不记录
  //（任务卡有自己的失败展示）。存在且非聊天流式中时 UI 显示"重试"按钮。
  readonly lastFailedSend?: FailedSendRecord;
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
  bookDataVersion: number;
  sidebarView: "panel" | "artifact";
  artifactFile: string | null;         // foundation file name, e.g. "story_bible.md"
  artifactChapter: number | null;      // chapter number, e.g. 1
  projectArtifactPath: string | null;  // generated project artifact, e.g. "interactive-films/demo/script.md"
  bookSummary: BookSummary | null;
  // Proposed-action cards (propose_action) are one-shot: once confirmed or
  // rejected, the card locks so the user can't re-fire the production action.
  // Keyed by the proposal's ToolExecution id.
  resolvedProposals: Record<string, "confirmed" | "rejected">;
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
  loadSessionList: (bookId: string | null) => Promise<ReadonlyArray<SessionSummary>>;
  createSession: (bookId: string | null, sessionKind?: ChatSessionKind, playMode?: PlayMode) => Promise<string>;
  createDraftSession: (bookId: string | null, sessionKind?: ChatSessionKind, playMode?: PlayMode) => string;
  setSessionPlayMode: (sessionId: string, playMode: PlayMode) => void;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  loadSessionDetail: (sessionId: string) => Promise<void>;
  sendMessage: (sessionId: string, text: string, options?: SendMessageOptions) => Promise<void>;
  // 用 lastFailedSend 记录的原样参数重发上一条失败的消息；无记录或聊天轮流式中时不做任何事。
  retryLastSend: (sessionId: string) => Promise<void>;
  // scope="chat" 只中止当前聊天轮，不停后台生产任务；默认 "all" 两者一起停。
  abortSession: (sessionId: string, scope?: "chat" | "all") => Promise<void>;
  setSelectedModel: (model: string, service: string) => void;
}

export interface CreateActions {
  bumpBookDataVersion: () => void;
  openArtifact: (file: string) => void;
  openChapterArtifact: (chapterNum: number) => void;
  closeArtifact: () => void;
  openProjectArtifact: (path: string) => void;
  closeProjectArtifact: () => void;
  setBookSummary: (summary: BookSummary | null) => void;
  markProposalResolved: (execId: string, resolution: "confirmed" | "rejected") => void;
}

// -- Composed store type --

export type ChatStore = ChatState & MessageActions & CreateActions;
