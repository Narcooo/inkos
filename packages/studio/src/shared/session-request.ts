import type { ActionPayload, ActionSource, AgentSessionConfig, AgentSessionResult, PlayMode, RequestedIntent, SessionKind, WorkManifest } from "@actalk/inkos-core";
export type StudioCompletionStatus = NonNullable<AgentSessionResult["completion"]>["status"];

export interface ChatAttachmentPayload {
  readonly id: string;
  readonly filename: string;
  readonly mediaType: string;
  readonly size: number;
  readonly dataUrl: string;
}

export interface SendMessageOptions {
  readonly retryOfRequestId?: string;
  readonly activeBookId?: string;
  readonly sessionKind?: SessionKind;
  readonly profileId?: string;
  readonly workId?: string | null;
  readonly actionSource?: ActionSource;
  readonly requestedIntent?: RequestedIntent;
  readonly actionPayload?: ActionPayload;
  readonly requestedSkills?: ReadonlyArray<string>;
  readonly disabledSkills?: ReadonlyArray<string>;
  readonly attachments?: ReadonlyArray<ChatAttachmentPayload>;
  readonly playMode?: PlayMode;
}

export interface FailedSendRecord {
  readonly text: string;
  readonly options?: SendMessageOptions;
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

/** Request state survives page/server restarts; the transcript owns results. */
export interface StudioChatRequestSnapshot {
  /** Host-owned original revision inventory; never accepted from a request body. */
  readonly baselineWork?: WorkManifest | null;
  readonly deliveryState?: AgentSessionConfig['deliveryState'];
  readonly sessionId: string;
  readonly requestId: string;
  readonly startedAt: number;
  readonly status: "running" | "completed" | "failed" | "cancelled";
  readonly completedAt?: number;
  readonly completionStatus?: StudioCompletionStatus;
  readonly toolExecutions?: ReadonlyArray<ToolExecution>;
  readonly retry?: FailedSendRecord;
  readonly error?: { readonly code: string; readonly message: string };
}
