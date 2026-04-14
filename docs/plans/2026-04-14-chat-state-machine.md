# Chat 状态机重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 chat store 的 tool call 状态管理，支持结构化工具执行记录、pipeline 阶段进度、thinking 追加模式。

**Architecture:** Message 内嵌 `ToolExecution[]`，每个 ToolExecution 包含 pipeline stages。后端 SSE 事件补传 toolCallId + isError + stages 列表。前端监听 `log` 和 `llm:progress` 事件驱动阶段状态机。删除 `activeOperation` 字段。

**Tech Stack:** Zustand (store), Zod (schema), base-ui Collapsible (UI), Hono SSE (server)

**Spec:** `docs/infra/studio-chat-state-machine.md`

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `packages/core/src/interaction/session.ts` | 持久化 schema | Modify: 新增 `PipelineStageSchema` + `ToolExecutionSchema`，扩展 `InteractionMessageSchema` |
| `packages/studio/src/store/chat/types.ts` | 前端类型定义 | Modify: 新增 `PipelineStage` + `ToolExecution`，扩展 `Message`，删除 `activeOperation` |
| `packages/studio/src/store/chat/slices/message/initialState.ts` | 初始状态 | Modify: 删除 `activeOperation` |
| `packages/studio/src/store/chat/slices/message/action.ts` | SSE 监听 + 状态更新 | Modify: 重写全部 SSE 监听器 |
| `packages/studio/src/api/server.ts` | SSE 广播 + 持久化 | Modify: tool:start/end 补字段，收集 tool execs |
| `packages/studio/src/components/chat/ToolExecutionSteps.tsx` | 工具执行 UI 组件 | Create |
| `packages/studio/src/pages/ChatPage.tsx` | 页面渲染 | Modify: 渲染 ToolExecutionSteps，删除 activeOperation |

---

### Task 1: 持久化 Schema 扩展

**Files:**
- Modify: `packages/core/src/interaction/session.ts:14-19`
- Test: `pnpm test` (existing schema tests)

- [ ] **Step 1: 在 `InteractionMessageSchema` 前添加 `PipelineStageSchema` 和 `ToolExecutionSchema`**

在 `packages/core/src/interaction/session.ts` 中，`InteractionMessageSchema` 定义（第 14 行）之前插入：

```ts
export const PipelineStageSchema = z.object({
  label: z.string(),
  status: z.enum(["pending", "active", "completed"]),
});

export type PipelineStage = z.infer<typeof PipelineStageSchema>;

export const ToolExecutionSchema = z.object({
  id: z.string(),
  tool: z.string(),
  agent: z.string().optional(),
  label: z.string(),
  status: z.enum(["running", "processing", "completed", "error"]),
  args: z.record(z.unknown()).optional(),
  result: z.string().optional(),
  error: z.string().optional(),
  stages: z.array(PipelineStageSchema).optional(),
  startedAt: z.number(),
  completedAt: z.number().optional(),
});

export type ToolExecution = z.infer<typeof ToolExecutionSchema>;
```

- [ ] **Step 2: 在 `InteractionMessageSchema` 中添加 `toolExecutions` 字段**

将 `InteractionMessageSchema`（第 14-19 行）改为：

```ts
export const InteractionMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1),
  thinking: z.string().optional(),
  toolExecutions: z.array(ToolExecutionSchema).optional(),
  timestamp: z.number().int().nonnegative(),
});
```

- [ ] **Step 3: 运行测试确认不破坏现有功能**

Run: `pnpm test`
Expected: 全部通过（新字段是 optional，不影响已有数据）

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/interaction/session.ts
git commit -m "feat(core): add ToolExecution + PipelineStage schemas to InteractionMessage"
```

---

### Task 2: 前端类型定义 + 删除 activeOperation

**Files:**
- Modify: `packages/studio/src/store/chat/types.ts`
- Modify: `packages/studio/src/store/chat/slices/message/initialState.ts`

- [ ] **Step 1: 在 `types.ts` 中添加 `PipelineStage` 和 `ToolExecution` 类型**

在 `packages/studio/src/store/chat/types.ts` 的 `ToolCall` interface（第 3-6 行）之后添加：

```ts
export interface PipelineStage {
  label: string;
  status: "pending" | "active" | "completed";
  progress?: {
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
  startedAt: number;
  completedAt?: number;
}
```

- [ ] **Step 2: 在 `Message` interface 中添加 `toolExecutions` 字段**

在 `Message` interface（第 8-15 行）中 `toolCall` 行之后添加：

```ts
  readonly toolExecutions?: ToolExecution[];
```

- [ ] **Step 3: 从 `MessageState` 中删除 `activeOperation`**

在 `MessageState` interface（第 56-67 行）中，删除这两行：

```ts
  /** Active pipeline operation (from SSE tool events) */
  activeOperation: string | null;
```

- [ ] **Step 4: 从 `initialState.ts` 中删除 `activeOperation`**

在 `packages/studio/src/store/chat/slices/message/initialState.ts`（第 11 行），删除：

```ts
  activeOperation: null,
```

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit -p packages/studio/tsconfig.json 2>&1 | head -30`
Expected: 会有几个编译错误（ChatPage 和 action.ts 引用了已删除的 `activeOperation`），这些在后续 Task 中修复。记录错误数量。

- [ ] **Step 6: Commit**

```bash
git add packages/studio/src/store/chat/types.ts packages/studio/src/store/chat/slices/message/initialState.ts
git commit -m "feat(studio): add ToolExecution/PipelineStage types, remove activeOperation"
```

---

### Task 3: 后端 SSE 事件 + PIPELINE_STAGES + 持久化

**Files:**
- Modify: `packages/studio/src/api/server.ts:869-932`

- [ ] **Step 1: 在 server.ts 的文件顶部（import 区域之后）添加 PIPELINE_STAGES 常量和辅助函数**

在 `packages/studio/src/api/server.ts` 中，找到 `const subscribers` 行附近，在其前面添加：

```ts
// -- Pipeline stage definitions per agent type --

const PIPELINE_STAGES: Record<string, string[]> = {
  writer: [
    "准备章节输入", "撰写章节草稿", "落盘最终章节",
    "生成最终真相文件", "校验真相文件变更", "同步记忆索引",
    "更新章节索引与快照",
  ],
  architect: [
    "生成基础设定", "保存书籍配置", "写入基础设定文件",
    "初始化控制文档", "创建初始快照",
  ],
  reviser: [
    "加载修订上下文", "修订章节", "落盘修订结果",
    "更新索引与快照",
  ],
  auditor: ["审计章节"],
};

const AGENT_LABELS: Record<string, string> = {
  architect: "建书", writer: "写作", auditor: "审计",
  reviser: "修订", exporter: "导出",
};
const TOOL_LABELS: Record<string, string> = {
  read: "读取文件", edit: "编辑文件", grep: "搜索", ls: "列目录",
};

function resolveToolLabel(tool: string, agent?: string): string {
  if (tool === "sub_agent" && agent) return AGENT_LABELS[agent] ?? agent;
  return TOOL_LABELS[tool] ?? tool;
}

function summarizeResult(result: unknown): string {
  if (typeof result === "string") return result.slice(0, 200);
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.content === "string") return r.content.slice(0, 200);
    if (typeof r.text === "string") return r.text.slice(0, 200);
  }
  return String(result).slice(0, 200);
}

function extractError(result: unknown): string {
  if (typeof result === "string") return result.slice(0, 500);
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.content === "string") return r.content.slice(0, 500);
    if (r.content && Array.isArray(r.content)) {
      const textPart = r.content.find((c: any) => c.type === "text");
      if (textPart) return (textPart as any).text?.slice(0, 500) ?? "";
    }
  }
  return String(result).slice(0, 500);
}

interface CollectedToolExec {
  id: string;
  tool: string;
  agent?: string;
  label: string;
  status: "running" | "completed" | "error";
  args?: Record<string, unknown>;
  result?: string;
  error?: string;
  stages?: Array<{ label: string; status: "pending" | "completed" }>;
  startedAt: number;
  completedAt?: number;
}
```

- [ ] **Step 2: 重写 `onEvent` 回调中的 tool 事件广播**

在 `packages/studio/src/api/server.ts` 中，将 `onEvent` 回调（第 879-909 行）替换为：

```ts
          onEvent: (event) => {
            if (event.type === "message_update") {
              const ame = event.assistantMessageEvent;
              if (ame.type === "text_delta") {
                broadcast("draft:delta", { text: ame.delta });
              } else if (ame.type === "thinking_delta") {
                broadcast("thinking:delta", { text: (ame as any).delta });
              } else if (ame.type === "thinking_start") {
                broadcast("thinking:start", {});
              } else if (ame.type === "thinking_end") {
                broadcast("thinking:end", {});
              }
            }
            if (event.type === "tool_execution_start") {
              const args = event.args as Record<string, unknown> | undefined;
              const agent = event.toolName === "sub_agent" ? (args?.agent as string | undefined) : undefined;
              const stages = agent ? (PIPELINE_STAGES[agent] ?? []) : [];

              collectedToolExecs.push({
                id: event.toolCallId,
                tool: event.toolName,
                agent,
                label: resolveToolLabel(event.toolName, agent),
                status: "running",
                args,
                stages: stages.length > 0
                  ? stages.map(l => ({ label: l, status: "pending" as const }))
                  : undefined,
                startedAt: Date.now(),
              });

              broadcast("tool:start", {
                id: event.toolCallId,
                tool: event.toolName,
                args,
                stages,
              });
            }
            if (event.type === "tool_execution_update") {
              broadcast("tool:update", { tool: event.toolName, partialResult: event.partialResult });
            }
            if (event.type === "tool_execution_end") {
              const exec = collectedToolExecs.find(t => t.id === event.toolCallId);
              if (exec) {
                exec.status = event.isError ? "error" : "completed";
                exec.completedAt = Date.now();
                exec.stages = exec.stages?.map(s => ({ ...s, status: "completed" as const }));
                if (event.isError) exec.error = extractError(event.result);
                else exec.result = summarizeResult(event.result);
              }
              broadcast("tool:end", {
                id: event.toolCallId,
                tool: event.toolName,
                result: event.result,
                isError: event.isError,
              });
            }
          },
```

- [ ] **Step 3: 在 `runAgentSession` 调用前声明 `collectedToolExecs`，删除 `activeWriterToolCallId`**

将第 869 行附近的：

```ts
      let activeWriterToolCallId: string | null = null;
```

替换为：

```ts
      const collectedToolExecs: CollectedToolExec[] = [];
```

- [ ] **Step 4: 修改持久化逻辑，将 tool executions 附加到 assistant message**

将第 921-931 行的持久化代码替换为：

```ts
      if (result.responseText) {
        const lastAssistant = result.messages?.filter((m: any) => m.role === "assistant").pop();
        const thinking = lastAssistant?.thinking;
        bookSession = appendBookSessionMessage(bookSession, {
          role: "assistant",
          content: result.responseText,
          ...(thinking ? { thinking } : {}),
          ...(collectedToolExecs.length > 0 ? { toolExecutions: collectedToolExecs } : {}),
          timestamp: Date.now() + 1,
        });
      }
```

注意：`appendBookSessionMessage` 接收 `InteractionMessage` 类型，Task 1 已经扩展了该 schema 支持 `toolExecutions`。

- [ ] **Step 5: 运行测试**

Run: `pnpm test`
Expected: 通过

- [ ] **Step 6: Commit**

```bash
git add packages/studio/src/api/server.ts
git commit -m "feat(studio): enrich SSE tool events with id/stages/isError, persist tool executions"
```

---

### Task 4: 重写 SSE 监听器（store action）

**Files:**
- Modify: `packages/studio/src/store/chat/slices/message/action.ts`

这是改动最大的文件。完整替换 `sendMessage` 中的 SSE 监听器逻辑。

- [ ] **Step 1: 在文件顶部添加辅助函数和常量**

在 `packages/studio/src/store/chat/slices/message/action.ts` 的 `extractErrorMessage` 函数之后，`createMessageSlice` 之前添加：

```ts
const AGENT_LABELS: Record<string, string> = {
  architect: "建书", writer: "写作", auditor: "审计",
  reviser: "修订", exporter: "导出",
};
const TOOL_LABELS: Record<string, string> = {
  read: "读取文件", edit: "编辑文件", grep: "搜索", ls: "列目录",
};

function resolveToolLabel(tool: string, agent?: string): string {
  if (tool === "sub_agent" && agent) return AGENT_LABELS[agent] ?? agent;
  return TOOL_LABELS[tool] ?? tool;
}

function summarizeResult(result: unknown): string {
  if (typeof result === "string") return result.slice(0, 200);
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.content === "string") return r.content.slice(0, 200);
  }
  return String(result).slice(0, 200);
}

function extractToolError(result: unknown): string {
  if (typeof result === "string") return result.slice(0, 500);
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.content === "string") return r.content.slice(0, 500);
    if (r.content && Array.isArray(r.content)) {
      const textPart = r.content.find((c: any) => c.type === "text");
      if (textPart) return (textPart as any).text?.slice(0, 500) ?? "";
    }
  }
  return String(result).slice(0, 500);
}

/** Mark all "processing" tool executions as "completed" on the streaming message. */
function markProcessingCompleted(messages: ReadonlyArray<import("../../types").Message>, streamTs: number): ReadonlyArray<import("../../types").Message> {
  const last = messages[messages.length - 1];
  if (!last || last.timestamp !== streamTs || last.role !== "assistant") return messages;
  const hasProcessing = last.toolExecutions?.some(t => t.status === "processing");
  if (!hasProcessing) return messages;
  return [...messages.slice(0, -1), {
    ...last,
    toolExecutions: last.toolExecutions!.map(t =>
      t.status === "processing" ? { ...t, status: "completed" as const } : t
    ),
  }];
}
```

- [ ] **Step 2: 替换 `sendMessage` 中全部 SSE 监听器（从 `streamEs.addEventListener("thinking:start"` 到 `tool:end` 监听器结束）**

将 `sendMessage` 中第 109-194 行的所有 `streamEs.addEventListener(...)` 块替换为：

```ts
    // -- thinking events (append mode, not overwrite) --

    streamEs.addEventListener("thinking:start", () => {
      set((s) => {
        const msgs = markProcessingCompleted(s.messages, streamTs);
        const last = msgs[msgs.length - 1];
        if (last?.timestamp === streamTs && last.role === "assistant") {
          // Append separator, keep existing thinking, set streaming flag
          const prev = last.thinking ?? "";
          const sep = prev ? "\n\n---\n\n" : "";
          return { messages: [...msgs.slice(0, -1), { ...last, thinking: prev + sep, thinkingStreaming: true }] };
        }
        return { messages: [...msgs, { role: "assistant" as const, content: "", thinking: "", thinkingStreaming: true, timestamp: streamTs }] };
      });
    });

    streamEs.addEventListener("thinking:delta", (e: MessageEvent) => {
      try {
        const d = e.data ? JSON.parse(e.data) : null;
        if (!d?.text) return;
        set((s) => {
          const last = s.messages[s.messages.length - 1];
          if (last?.timestamp === streamTs && last.role === "assistant") {
            return { messages: [...s.messages.slice(0, -1), { ...last, thinking: (last.thinking ?? "") + d.text }] };
          }
          return s;
        });
      } catch { /* ignore */ }
    });

    streamEs.addEventListener("thinking:end", () => {
      set((s) => {
        const last = s.messages[s.messages.length - 1];
        if (last?.timestamp === streamTs && last.role === "assistant") {
          return { messages: [...s.messages.slice(0, -1), { ...last, thinkingStreaming: false }] };
        }
        return s;
      });
    });

    // -- draft text events --

    streamEs.addEventListener("draft:delta", (e: MessageEvent) => {
      try {
        const d = e.data ? JSON.parse(e.data) : null;
        if (!d?.text) return;
        // Mark processing→completed before appending new content
        set((s) => ({ messages: markProcessingCompleted(s.messages, streamTs) }));
        get().appendStreamChunk(d.text, streamTs);
      } catch { /* ignore */ }
    });

    // -- tool execution events --

    streamEs.addEventListener("tool:start", (e: MessageEvent) => {
      try {
        const d = e.data ? JSON.parse(e.data) : null;
        if (!d?.tool) return;

        set((s) => {
          // Mark processing→completed
          let msgs = markProcessingCompleted(s.messages, streamTs);
          const last = msgs[msgs.length - 1];
          if (!last || last.timestamp !== streamTs || last.role !== "assistant") {
            // Create streaming message if it doesn't exist
            const newMsg = { role: "assistant" as const, content: "", timestamp: streamTs };
            msgs = [...msgs, newMsg];
          }

          const current = msgs[msgs.length - 1]!;

          // Move pre-tool content to thinking
          const prevThinking = current.thinking ?? "";
          const movedContent = current.content
            ? (prevThinking ? prevThinking + "\n\n" : "") + current.content
            : prevThinking;

          // Create ToolExecution
          const agent = d.tool === "sub_agent" ? (d.args?.agent as string | undefined) : undefined;
          const stages = (d.stages as string[] | undefined)?.map((label: string) => ({
            label,
            status: "pending" as const,
          }));

          const newExec = {
            id: d.id as string,
            tool: d.tool as string,
            agent,
            label: resolveToolLabel(d.tool, agent),
            status: "running" as const,
            args: d.args as Record<string, unknown> | undefined,
            stages: stages && stages.length > 0 ? stages : undefined,
            startedAt: Date.now(),
          };

          return {
            messages: [...msgs.slice(0, -1), {
              ...current,
              thinking: movedContent,
              content: "",
              toolExecutions: [...(current.toolExecutions ?? []), newExec],
            }],
          };
        });
      } catch { /* ignore */ }
    });

    streamEs.addEventListener("tool:end", (e: MessageEvent) => {
      try {
        const d = e.data ? JSON.parse(e.data) : null;
        if (!d?.tool) return;

        set((s) => {
          const last = s.messages[s.messages.length - 1];
          if (!last || last.timestamp !== streamTs || last.role !== "assistant") return s;

          const toolExecutions = (last.toolExecutions ?? []).map((t) => {
            if (t.id !== d.id) return t;
            const stages = t.stages?.map((stage) =>
              stage.status !== "completed"
                ? { ...stage, status: "completed" as const, progress: undefined }
                : stage
            );
            return {
              ...t,
              status: (d.isError ? "error" : "processing") as "error" | "processing",
              stages,
              result: d.isError ? undefined : summarizeResult(d.result),
              error: d.isError ? extractToolError(d.result) : undefined,
              completedAt: Date.now(),
            };
          });

          return {
            messages: [...s.messages.slice(0, -1), { ...last, toolExecutions }],
          };
        });

        get().bumpBookDataVersion();
      } catch { /* ignore */ }
    });

    // -- pipeline stage events (from PipelineRunner.logStage) --

    streamEs.addEventListener("log", (e: MessageEvent) => {
      try {
        const d = e.data ? JSON.parse(e.data) : null;
        const msg = d?.message as string | undefined;
        if (!msg) return;

        const stageMatch = msg.match(/^(?:阶段：|Stage: )(.+)$/);
        if (!stageMatch) return;
        const stageName = stageMatch[1];

        set((s) => {
          const last = s.messages[s.messages.length - 1];
          if (!last || last.timestamp !== streamTs || last.role !== "assistant") return s;

          const execIdx = last.toolExecutions?.findIndex(t => t.status === "running" && t.stages) ?? -1;
          if (execIdx === -1) return s;

          const exec = last.toolExecutions![execIdx];
          let found = false;
          const stages = exec.stages!.map((stage) => {
            if (stage.label === stageName) {
              found = true;
              return { ...stage, status: "active" as const };
            }
            if (!found && stage.status === "active") {
              return { ...stage, status: "completed" as const, progress: undefined };
            }
            return stage;
          });

          if (!found) return s; // stage name not in predefined list

          const updatedExecs = [...last.toolExecutions!];
          updatedExecs[execIdx] = { ...exec, stages };

          return {
            messages: [...s.messages.slice(0, -1), { ...last, toolExecutions: updatedExecs }],
          };
        });
      } catch { /* ignore */ }
    });

    // -- LLM streaming progress (elapsed time + char count) --

    streamEs.addEventListener("llm:progress", (e: MessageEvent) => {
      try {
        const d = e.data ? JSON.parse(e.data) : null;
        if (!d || d.status !== "streaming") return;

        set((s) => {
          const last = s.messages[s.messages.length - 1];
          if (!last || last.timestamp !== streamTs || last.role !== "assistant") return s;

          const execIdx = last.toolExecutions?.findIndex(t => t.status === "running" && t.stages) ?? -1;
          if (execIdx === -1) return s;

          const exec = last.toolExecutions![execIdx];
          const stages = exec.stages!.map((stage) =>
            stage.status === "active"
              ? { ...stage, progress: { elapsedMs: d.elapsedMs, totalChars: d.totalChars, chineseChars: d.chineseChars } }
              : stage
          );

          const updatedExecs = [...last.toolExecutions!];
          updatedExecs[execIdx] = { ...exec, stages };

          return {
            messages: [...s.messages.slice(0, -1), { ...last, toolExecutions: updatedExecs }],
          };
        });
      } catch { /* ignore */ }
    });
```

- [ ] **Step 3: 更新 `finalizeStream`（第 25-33 行）**

替换为：

```ts
  finalizeStream: (streamTs, content, toolCall) => set((s) => ({
    messages: markProcessingCompleted(s.messages, streamTs).map((m) => {
      if (m.timestamp !== streamTs || m.role !== "assistant") return m;
      return { ...m, content, toolCall };
    }),
  })),
```

- [ ] **Step 4: 更新 `loadSessionMessages`（第 50-58 行）添加 toolExecutions 透传**

替换为：

```ts
  loadSessionMessages: (msgs) => set((s) => {
    if (s.messages.length > 0) return s;
    return {
      messages: msgs
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
          thinking: m.thinking,
          toolExecutions: (m as any).toolExecutions,
          timestamp: m.timestamp,
        })),
    };
  }),
```

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit -p packages/studio/tsconfig.json 2>&1 | head -30`
Expected: 只剩 ChatPage.tsx 中 `activeOperation` 的引用错误（Task 6 修复）。

- [ ] **Step 6: Commit**

```bash
git add packages/studio/src/store/chat/slices/message/action.ts
git commit -m "feat(studio): rewrite SSE listeners with structured ToolExecution state machine"
```

---

### Task 5: ToolExecutionSteps UI 组件

**Files:**
- Create: `packages/studio/src/components/chat/ToolExecutionSteps.tsx`

- [ ] **Step 1: 创建组件文件**

```tsx
import { useMemo, useState, useEffect } from "react";
import type { ToolExecution, PipelineStage } from "../../store/chat/types";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "../ui/collapsible";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  Wrench,
} from "lucide-react";

// -- Status rendering helpers --

function ExecStatusBadge({ status }: { status: ToolExecution["status"] }) {
  switch (status) {
    case "running":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-primary">
          <Loader2 size={12} className="animate-spin" />
          <span>执行中</span>
        </span>
      );
    case "processing":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 size={12} className="animate-spin" style={{ animationDuration: "2s" }} />
          <span>处理结果</span>
        </span>
      );
    case "completed":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
          <CheckCircle2 size={12} />
          <span>已完成</span>
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-destructive">
          <XCircle size={12} />
          <span>失败</span>
        </span>
      );
  }
}

function StageIcon({ status }: { status: PipelineStage["status"] }) {
  switch (status) {
    case "pending":
      return <span className="w-4 h-4 rounded-full border border-border/60 flex items-center justify-center shrink-0 text-[8px] text-muted-foreground/40">○</span>;
    case "active":
      return <Loader2 size={14} className="text-primary animate-spin shrink-0" />;
    case "completed":
      return <CheckCircle2 size={14} className="text-green-600 dark:text-green-400 shrink-0" />;
  }
}

function formatProgress(progress: NonNullable<PipelineStage["progress"]>): string {
  const secs = Math.round(progress.elapsedMs / 1000);
  const chars = progress.chineseChars > 0
    ? `${progress.totalChars}字`
    : `${progress.totalChars} chars`;
  return `${secs}s · ${chars}`;
}

function formatDuration(startedAt: number, completedAt?: number): string {
  const ms = (completedAt ?? Date.now()) - startedAt;
  const secs = Math.round(ms / 1000);
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

// -- Pipeline operation (sub_agent) --

function PipelineExecution({ exec }: { exec: ToolExecution }) {
  const isActive = exec.status === "running" || exec.status === "processing";
  const [open, setOpen] = useState(isActive);

  // Auto-open when running, auto-close when completed
  useEffect(() => {
    if (exec.status === "running") setOpen(true);
    if (exec.status === "completed") {
      const timer = setTimeout(() => setOpen(false), 500);
      return () => clearTimeout(timer);
    }
  }, [exec.status]);

  const bookId = exec.args?.bookId as string | undefined;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-card/60 hover:bg-card/80 transition-colors cursor-pointer">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-foreground truncate">
            {exec.label}
            {bookId && <span className="text-muted-foreground font-normal"> · {bookId}</span>}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {exec.completedAt && (
            <span className="text-[10px] text-muted-foreground/60">
              {formatDuration(exec.startedAt, exec.completedAt)}
            </span>
          )}
          <ExecStatusBadge status={exec.status} />
          <ChevronDown size={14} className={`text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pb-3 pt-1">
          {/* Pipeline stages */}
          {exec.stages && exec.stages.length > 0 && (
            <ul className="space-y-1.5">
              {exec.stages.map((stage, i) => (
                <li key={i} className="flex items-center gap-2.5">
                  <StageIcon status={stage.status} />
                  <span className={`text-xs ${stage.status === "pending" ? "text-muted-foreground/40" : "text-muted-foreground"}`}>
                    {stage.label}
                  </span>
                  {stage.status === "active" && stage.progress && (
                    <span className="text-[10px] text-primary/70 ml-auto">
                      {formatProgress(stage.progress)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {/* Error message */}
          {exec.status === "error" && exec.error && (
            <div className="mt-2 text-xs text-destructive bg-destructive/5 rounded-lg px-2.5 py-2">
              {exec.error}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// -- Utility tools (read/edit/grep/ls) grouped --

function UtilityToolsGroup({ execs }: { execs: ToolExecution[] }) {
  const [open, setOpen] = useState(false);
  const allDone = execs.every(e => e.status === "completed" || e.status === "error");
  const hasError = execs.some(e => e.status === "error");

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer text-xs text-muted-foreground">
        <Wrench size={12} />
        <span>{execs.length} 个文件操作</span>
        {allDone && !hasError && <CheckCircle2 size={10} className="text-green-600 dark:text-green-400" />}
        {hasError && <XCircle size={10} className="text-destructive" />}
        {!allDone && <Loader2 size={10} className="animate-spin text-primary" />}
        <ChevronDown size={10} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="pl-6 space-y-0.5 py-1">
          {execs.map((exec) => (
            <li key={exec.id} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono truncate">{exec.tool} {exec.args?.path ?? exec.args?.pattern ?? ""}</span>
              {exec.status === "completed" && <CheckCircle2 size={10} className="text-green-600 dark:text-green-400 shrink-0" />}
              {exec.status === "error" && <XCircle size={10} className="text-destructive shrink-0" />}
              {exec.status === "running" && <Loader2 size={10} className="animate-spin text-primary shrink-0" />}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

// -- Main component --

export interface ToolExecutionStepsProps {
  executions: ToolExecution[];
}

export function ToolExecutionSteps({ executions }: ToolExecutionStepsProps) {
  const { pipelines, utilities } = useMemo(() => {
    const pipelines: ToolExecution[] = [];
    const utilities: ToolExecution[] = [];
    for (const exec of executions) {
      if (exec.tool === "sub_agent") pipelines.push(exec);
      else utilities.push(exec);
    }
    return { pipelines, utilities };
  }, [executions]);

  return (
    <div className="space-y-2 mt-2">
      {pipelines.map((exec) => (
        <PipelineExecution key={exec.id} exec={exec} />
      ))}
      {utilities.length > 0 && (
        <UtilityToolsGroup execs={utilities} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit -p packages/studio/tsconfig.json 2>&1 | grep ToolExecutionSteps`
Expected: 无错误（组件本身类型正确）

- [ ] **Step 3: Commit**

```bash
git add packages/studio/src/components/chat/ToolExecutionSteps.tsx
git commit -m "feat(studio): add ToolExecutionSteps component with pipeline stages + utility tools"
```

---

### Task 6: ChatPage 集成 + 删除 activeOperation 引用

**Files:**
- Modify: `packages/studio/src/pages/ChatPage.tsx`

- [ ] **Step 1: 添加 import**

在 `packages/studio/src/pages/ChatPage.tsx` 的 import 区域，在 `import { QuickActions }` 行之后添加：

```ts
import { ToolExecutionSteps } from "../components/chat/ToolExecutionSteps";
```

- [ ] **Step 2: 删除 `activeOperation` selector**

删除第 61 行：

```ts
  const activeOperation = useChatStore((s) => s.activeOperation);
```

- [ ] **Step 3: 添加 `isStreaming` useMemo**

在 `const isZh = ...` 行之后添加：

```ts
  const isStreaming = useMemo(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return false;
    return last.thinkingStreaming === true
      || !last.content
      || (last.toolExecutions?.some(t => t.status === "running" || t.status === "processing") ?? false);
  }, [messages]);
```

在文件顶部的 import 中确保 `useMemo` 已导入（当前已有 `useRef, useEffect, useMemo`）。

- [ ] **Step 4: 在消息渲染中添加 ToolExecutionSteps**

在消息 `map` 循环中，`<ChatMessage>` 组件之后、`</div>` 之前添加：

```tsx
                {msg.role === "assistant" && msg.toolExecutions && msg.toolExecutions.length > 0 && (
                  <ToolExecutionSteps executions={msg.toolExecutions} />
                )}
```

完整结构：
```tsx
              <div key={`${msg.timestamp}-${i}`}>
                {/* Thinking */}
                {msg.role === "assistant" && msg.thinking && (
                  <div className="mb-2">
                    <Reasoning isStreaming={msg.thinkingStreaming ?? false}>
                      <ReasoningTrigger />
                      <ReasoningContent>{msg.thinking}</ReasoningContent>
                    </Reasoning>
                  </div>
                )}
                <ChatMessage ... />
                {/* Tool executions */}
                {msg.role === "assistant" && msg.toolExecutions && msg.toolExecutions.length > 0 && (
                  <ToolExecutionSteps executions={msg.toolExecutions} />
                )}
              </div>
```

- [ ] **Step 5: 替换 activeOperation 指示器和 loading 指示器**

删除第 218-235 行的 `{/* Pipeline operation indicator */}` 和 `{/* Loading indicator */}` 两个块。替换为：

```tsx
            {/* Loading indicator — only when loading and no streaming activity */}
            {loading && !isStreaming && (
              <Message from="assistant">
                <MessageContent>
                  <Shimmer className="text-sm" duration={1.5}>
                    {isZh ? "思考中..." : "Thinking..."}
                  </Shimmer>
                </MessageContent>
              </Message>
            )}
```

- [ ] **Step 6: 类型检查 + 构建**

Run: `npx tsc --noEmit -p packages/studio/tsconfig.json`
Expected: 无错误

- [ ] **Step 7: 运行全量测试**

Run: `pnpm test`
Expected: 全部通过

- [ ] **Step 8: Commit**

```bash
git add packages/studio/src/pages/ChatPage.tsx
git commit -m "feat(studio): render ToolExecutionSteps in chat, replace activeOperation with isStreaming"
```

---

### Task 7: 手动验证

**Files:** 无代码改动

- [ ] **Step 1: 启动开发服务器**

Run: `pnpm dev`

- [ ] **Step 2: 在浏览器中测试基本对话**

打开 `http://localhost:4567`，选择模型，发送一条普通消息（如"你好"）。

确认：
- 思考过程正常显示在 Reasoning 折叠区
- 回复正常显示
- 无 console 报错

- [ ] **Step 3: 测试 tool call 流程**

选中一本已有书籍，发送"写下一章"。

确认：
- 出现 ToolExecutionSteps 面板，显示"写作"
- Pipeline 阶段依次从 pending → active → completed
- active 阶段显示 LLM 进度（秒数 + 字数）
- 完成后面板自动折叠，显示耗时和"已完成"
- 不再显示旧的"正在写作" spinner

- [ ] **Step 4: 测试错误情况**

发送一条会触发错误的指令（如对不存在的 bookId 写章节）。

确认：
- ToolExecution 显示红色"失败"状态
- 错误信息展示在面板内
- 不影响后续对话

- [ ] **Step 5: 测试 thinking 追加**

发送一条会触发多轮 thinking 的指令。

确认：
- Reasoning 区域包含多段 thinking，用 `---` 分隔
- 不出现 thinking 被覆盖的情况

- [ ] **Step 6: 测试历史加载**

刷新页面，确认：
- 历史消息中的 tool executions 正确加载和渲染
- 所有 stages 显示为 completed 状态

---

## Self-Review Checklist

| Spec 章节 | 对应 Task |
|-----------|----------|
| 1. 数据模型 — PipelineStage + ToolExecution | Task 1 (schema), Task 2 (frontend types) |
| 1.3 删除 activeOperation | Task 2 (types), Task 6 (ChatPage) |
| 2. Pipeline 阶段定义 | Task 3 (PIPELINE_STAGES) |
| 3.1 thinking:start 追加模式 | Task 4 (SSE listeners) |
| 3.2 tool:start 创建 ToolExecution | Task 4 |
| 3.3 tool:end → processing/error | Task 4 |
| 3.4 processing → completed | Task 4 (markProcessingCompleted) |
| 3.5 log 事件 pipeline 阶段 | Task 4 |
| 3.6 llm:progress 事件 | Task 4 |
| 4. SSE 事件改动 | Task 3 |
| 5. UI 组件 | Task 5 + Task 6 |
| 6. 持久化 | Task 1 (schema) + Task 3 (server persist) |
| 7. 改动范围 | All tasks cover all listed files |
