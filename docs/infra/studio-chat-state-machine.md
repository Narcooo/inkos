# Studio Chat 状态机重构

> 解决 thinking 覆盖、tool call 无记录、loading 指示器混乱、成功/失败不分、pipeline 阶段不可见等问题。

## 1. 数据模型

### 1.1 PipelineStage（新增）

```ts
interface PipelineStage {
  label: string;                           // "准备章节输入"
  status: "pending" | "active" | "completed";
  progress?: {                             // LLM 步骤才有
    elapsedMs: number;
    totalChars: number;
    chineseChars: number;
  };
}
```

### 1.2 ToolExecution（新增）

```ts
interface ToolExecution {
  id: string;                              // toolCallId（后端传入）
  tool: string;                            // "sub_agent" | "read" | "edit" | "grep" | "ls"
  agent?: string;                          // sub_agent 专用："writer" | "auditor" | "reviser" | "architect" | "exporter"
  label: string;                           // 用户可读："写作" | "审计" | "读取文件" | ...
  status: "running" | "processing" | "completed" | "error";
  args?: Record<string, unknown>;          // tool:start 的完整参数
  result?: string;                         // 成功时的结果摘要
  error?: string;                          // 失败时的错误信息
  stages?: PipelineStage[];                // sub_agent 专用：pipeline 阶段列表
  startedAt: number;
  completedAt?: number;
}
```

### 1.3 Message 扩展

```ts
interface Message {
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  thinkingStreaming?: boolean;
  timestamp: number;
  toolCall?: ToolCall;                     // 保留：create_book 表单专用
  toolExecutions?: ToolExecution[];        // 新增：工具执行记录
}
```

### 1.4 删除的字段

从 `MessageState` 中删除 `activeOperation: string | null`，由 `Message.toolExecutions` 替代。

## 2. Pipeline 阶段定义

### 2.1 各 agent 的预定义阶段

后端在 `tool:start` 时根据 agent 类型下发阶段列表。

**writer**（writeNextChapter）：
1. 准备章节输入 — IO
2. 撰写章节草稿 — **LLM 流式**
3. 落盘草稿与真相文件 — IO
4. 更新章节索引与快照 — IO

**writer**（writeDraft，完整 pipeline）：
1. 准备章节输入 — IO
2. 撰写章节草稿 — **LLM 流式**
3. 落盘最终章节 — IO
4. 生成最终真相文件 — IO
5. 校验真相文件变更 — IO
6. 同步记忆索引 — 可能有 LLM
7. 更新章节索引与快照 — IO

**architect**（initBook）：
1. 生成基础设定 — **LLM 流式** + review loop
2. 保存书籍配置 — IO
3. 写入基础设定文件 — IO
4. 初始化控制文档 — IO
5. 创建初始快照 — IO

**reviser**：
1. 加载修订上下文 — IO
2. 修订章节 — **LLM 流式**
3. 落盘修订结果 — IO
4. 更新索引与快照 — IO

**auditor**：
1. 审计章节 — **LLM 流式**

### 2.2 后端 PIPELINE_STAGES 常量

```ts
// server.ts 或 core 中的共享常量
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
```

注：writer 的实际阶段取决于调用的是 `writeNextChapter`（4 步）还是 `writeDraft`（7 步）。
后端无法在 `tool:start` 时确定会走哪条路径，统一下发完整 7 步。
如果实际跳过了某些步骤（如 writeNextChapter 不经过"校验真相文件变更"），
前端在 `tool:end` 时将剩余 pending 步骤直接标记为 completed。

## 3. SSE 事件改动（后端 server.ts）

### 3.1 tool:start 补传 toolCallId + stages

```ts
broadcast("tool:start", { 
  id: event.toolCallId,
  tool: event.toolName, 
  args: event.args,
  stages: event.toolName === "sub_agent"
    ? PIPELINE_STAGES[event.args?.agent] ?? []
    : [],
});
```

### 3.2 tool:end 补传 isError + toolCallId

```ts
broadcast("tool:end", { 
  id: event.toolCallId,
  tool: event.toolName, 
  result: event.result,
  isError: event.isError,
});
```

### 3.3 log 事件已有，不改

PipelineRunner 的 `logStage()` 通过 logger → sseSink 广播为 `log` 事件。
格式：`{ message: "阶段：准备章节输入", level: "info", tag: "inkos" }`

前端解析 `"阶段："` 前缀来匹配步骤。

### 3.4 llm:progress 事件已有，不改

格式：`{ elapsedMs: number, totalChars: number, chineseChars: number, status: "streaming" }`

前端用这个更新当前 active 阶段的 `progress` 字段。

## 4. Store 状态管理重写

### 4.1 thinking:start — 追加模式

```ts
// 之前（覆盖）：
{ thinking: "", thinkingStreaming: true }

// 之后（追加）：
{ 
  thinking: (last.thinking ?? "") + (last.thinking ? "\n\n---\n\n" : ""),
  thinkingStreaming: true 
}
```

多轮 thinking 用 `---` 分隔，不丢失前面的 turn。

### 4.2 tool:start — 创建 ToolExecution + 移动 content

```ts
streamEs.addEventListener("tool:start", (e) => {
  const d = JSON.parse(e.data);
  
  // 先把 processing 的标记为 completed
  set((s) => ({ ...s, ...markProcessingCompleted(s, streamTs) }));
  
  set((s) => {
    const last = s.messages[s.messages.length - 1];
    if (last?.timestamp !== streamTs || last.role !== "assistant") return s;
    
    // 1. 移动 pre-tool content 到 thinking
    const prevThinking = last.thinking ?? "";
    const movedContent = last.content 
      ? (prevThinking ? prevThinking + "\n\n" : "") + last.content 
      : prevThinking;
    
    // 2. 创建 ToolExecution 记录
    const agent = d.tool === "sub_agent" ? d.args?.agent : undefined;
    const stages: PipelineStage[] = (d.stages ?? []).map((label: string) => ({
      label,
      status: "pending" as const,
    }));
    
    const newExec: ToolExecution = {
      id: d.id,
      tool: d.tool,
      agent,
      label: resolveToolLabel(d.tool, agent),
      status: "running",
      args: d.args,
      stages: stages.length > 0 ? stages : undefined,
      startedAt: Date.now(),
    };
    
    return {
      messages: [...s.messages.slice(0, -1), {
        ...last,
        thinking: movedContent,
        content: "",
        toolExecutions: [...(last.toolExecutions ?? []), newExec],
      }],
    };
  });
});
```

### 4.3 log 事件 — 更新 pipeline 阶段

```ts
streamEs.addEventListener("log", (e) => {
  try {
    const d = e.data ? JSON.parse(e.data) : null;
    const msg = d?.message as string | undefined;
    if (!msg) return;
    
    // 提取阶段名："阶段：准备章节输入" → "准备章节输入"
    const stageMatch = msg.match(/^(?:阶段：|Stage: )(.+)$/);
    if (!stageMatch) return;
    const stageName = stageMatch[1];
    
    set((s) => {
      const last = s.messages[s.messages.length - 1];
      if (last?.timestamp !== streamTs || last.role !== "assistant") return s;
      
      // 找到当前 running 的 sub_agent tool execution
      const execIdx = last.toolExecutions?.findIndex(
        t => t.status === "running" && t.stages
      ) ?? -1;
      if (execIdx === -1) return s;
      
      const exec = last.toolExecutions![execIdx];
      const stages = exec.stages!.map((stage) => {
        if (stage.label === stageName) return { ...stage, status: "active" as const };
        if (stage.status === "active") return { ...stage, status: "completed" as const };
        return stage;
      });
      
      const updatedExecs = [...last.toolExecutions!];
      updatedExecs[execIdx] = { ...exec, stages };
      
      return {
        messages: [...s.messages.slice(0, -1), { ...last, toolExecutions: updatedExecs }],
      };
    });
  } catch { /* ignore */ }
});
```

### 4.4 llm:progress 事件 — 更新 LLM 步骤进度

```ts
streamEs.addEventListener("llm:progress", (e) => {
  try {
    const d = e.data ? JSON.parse(e.data) : null;
    if (!d || d.status !== "streaming") return;
    
    set((s) => {
      const last = s.messages[s.messages.length - 1];
      if (last?.timestamp !== streamTs || last.role !== "assistant") return s;
      
      const execIdx = last.toolExecutions?.findIndex(
        t => t.status === "running" && t.stages
      ) ?? -1;
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

### 4.5 tool:end — 更新为 processing / error

```ts
streamEs.addEventListener("tool:end", (e) => {
  const d = JSON.parse(e.data);
  
  set((s) => {
    const last = s.messages[s.messages.length - 1];
    if (last?.timestamp !== streamTs || last.role !== "assistant") return s;
    
    const toolExecutions = (last.toolExecutions ?? []).map((t) => {
      if (t.id !== d.id) return t;
      
      // 把所有剩余 pending/active 的 stages 标记为 completed
      const stages = t.stages?.map((stage) =>
        stage.status === "pending" || stage.status === "active"
          ? { ...stage, status: "completed" as const, progress: undefined }
          : stage
      );
      
      return {
        ...t,
        status: d.isError ? "error" as const : "processing" as const,
        stages,
        result: d.isError ? undefined : summarizeResult(d.result),
        error: d.isError ? extractError(d.result) : undefined,
        completedAt: Date.now(),
      };
    });
    
    return {
      messages: [...s.messages.slice(0, -1), { ...last, toolExecutions }],
    };
  });
  
  get().bumpBookDataVersion();
});
```

### 4.6 processing → completed 转换

当 agent 消化完工具结果、开始下一步时，把所有 `processing` 状态的 tool 标记为 `completed`。

触发时机：`thinking:start`、`draft:delta`、下一个 `tool:start`、`finalizeStream` 中任一。

```ts
function markProcessingCompleted(s: ChatState, streamTs: number): Partial<ChatState> {
  const last = s.messages[s.messages.length - 1];
  if (last?.timestamp !== streamTs || last.role !== "assistant") return {};
  const hasProcessing = last.toolExecutions?.some(t => t.status === "processing");
  if (!hasProcessing) return {};
  return {
    messages: [...s.messages.slice(0, -1), {
      ...last,
      toolExecutions: last.toolExecutions!.map(t =>
        t.status === "processing" ? { ...t, status: "completed" as const } : t
      ),
    }],
  };
}
```

### 4.7 resolveToolLabel 辅助函数

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
```

### 4.8 loading 指示器简化

```tsx
const isStreaming = useMemo(() => {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return false;
  return last.thinkingStreaming === true 
    || !last.content 
    || (last.toolExecutions?.some(t => t.status === "running" || t.status === "processing") ?? false);
}, [messages]);

// 显示"思考中"：loading 且没有任何流式活动
{loading && !isStreaming && <Shimmer>思考中...</Shimmer>}
```

### 4.9 finalizeStream

```ts
finalizeStream: (streamTs, content, toolCall) => set((s) => ({
  messages: s.messages.map((m) => {
    if (m.timestamp !== streamTs || m.role !== "assistant") return m;
    return { ...m, content, toolCall };
  }),
})),
```

## 5. UI 组件

### 5.1 ToolExecutionSteps（新建）

文件：`packages/studio/src/components/chat/ToolExecutionSteps.tsx`

基于 base-ui Collapsible，渲染 `ToolExecution[]`。

#### Pipeline 操作（sub_agent）— 醒目展示 + 阶段列表

执行中（展开）：
```
┌─ ✍️ 写作 · book-abc                        ⏳ 执行中 ─┐
│  ✅ 准备章节输入                                        │
│  ⏳ 撰写章节草稿  ·  32s · 3,200字                      │
│  ○  落盘最终章节                                        │
│  ○  生成最终真相文件                                     │
│  ○  校验真相文件变更                                     │
│  ○  同步记忆索引                                        │
│  ○  更新章节索引与快照                                   │
└──────────────────────────────────────────────────────────┘
```

已完成（折叠）：
```
┌─ ✍️ 写作 · book-abc    45s    ✅ 已完成  ▾ ─┐
└──────────────────────────────────────────────┘
```

失败：
```
┌─ ✍️ 写作 · book-abc                        ❌ 失败   ─┐
│  错误: Sub-agent "writer" failed: timeout               │
└──────────────────────────────────────────────────────────┘
```

#### Pipeline 阶段状态图标

| stage.status | 图标 | 颜色 |
|-------------|------|------|
| pending | `○` (空心圆) | `text-muted-foreground/40` |
| active | `Loader2` (spin) | `text-primary` |
| completed | `✅` / `CheckCircle2` | `text-green-600` |

active 阶段如果有 `progress`，显示耗时和字数：
`⏳ 撰写章节草稿  ·  32s · 3,200字`

#### 辅助工具（read/edit/grep/ls）— 折叠聚合

```
📎 3 个文件操作                                    ▾
  read story_bible.md        ✅
  grep "林默"                ✅  
  read chapters/0001.md      ✅
```

默认收起。

#### 自动展开/折叠逻辑

- `running` → 自动展开（显示阶段进度）
- `processing` → 保持展开
- `completed` → 自动折叠（保留 header 摘要）
- `error` → 保持展开（显示错误信息）

### 5.2 ToolExecution 状态图标映射

| status | 图标 | 标签 | 颜色 |
|--------|------|------|------|
| running | `Loader2` (spin) | 执行中 | `text-primary` |
| processing | `Loader2` (spin, slow) | 处理结果 | `text-muted-foreground` |
| completed | `CheckCircle2` | 已完成 | `text-green-600` (dark: `text-green-400`) |
| error | `XCircle` | 失败 | `text-destructive` |

### 5.3 ChatPage 渲染位置

在每条 assistant 消息的 `<ChatMessage>` 之后：

```tsx
{msg.role === "assistant" && msg.toolExecutions && msg.toolExecutions.length > 0 && (
  <ToolExecutionSteps executions={msg.toolExecutions} />
)}
```

## 6. 持久化

### 6.1 Schema 扩展

`packages/core/src/interaction/session.ts`：

```ts
const PipelineStageSchema = z.object({
  label: z.string(),
  status: z.enum(["pending", "active", "completed"]),
});

const ToolExecutionSchema = z.object({
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

// InteractionMessageSchema 新增字段
toolExecutions: z.array(ToolExecutionSchema).optional(),
```

注：持久化时 `progress` 不保存（只是实时流式数据，历史加载不需要）。
持久化时所有 stages 的 status 都是 "completed"（因为 tool:end 时已全部标记完成）。

### 6.2 服务端持久化

`server.ts` 的 `POST /api/v1/agent` 中，在 `onEvent` 回调期间收集 tool executions 到一个临时数组。`runAgentSession` 完成后，将收集到的 tool executions 附加到持久化的 assistant message 上。

```ts
const collectedToolExecs: ToolExecution[] = [];

onEvent: (event) => {
  if (event.type === "tool_execution_start") {
    const agent = event.toolName === "sub_agent" ? event.args?.agent : undefined;
    collectedToolExecs.push({
      id: event.toolCallId,
      tool: event.toolName,
      agent,
      label: resolveToolLabel(event.toolName, agent),
      status: "running",
      args: event.args,
      stages: event.toolName === "sub_agent"
        ? (PIPELINE_STAGES[agent] ?? []).map(l => ({ label: l, status: "pending" as const }))
        : undefined,
      startedAt: Date.now(),
    });
    broadcast("tool:start", { ... });
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
    broadcast("tool:end", { ... });
  }
}

// 持久化
bookSession = appendBookSessionMessage(bookSession, {
  role: "assistant",
  content: result.responseText,
  ...(thinking ? { thinking } : {}),
  ...(collectedToolExecs.length > 0 ? { toolExecutions: collectedToolExecs } : {}),
  timestamp: Date.now() + 1,
});
```

### 6.3 前端加载历史

`loadSessionMessages` 已经透传消息字段，新增的 `toolExecutions` 自然跟随。
历史消息加载后，用户能看到之前执行过的工具操作及其结果（阶段列表全部 completed）。

## 7. 改动范围汇总

| 文件 | 改动 |
|------|------|
| `core/interaction/session.ts` | `InteractionMessageSchema` + `ToolExecutionSchema` + `PipelineStageSchema` |
| `studio/api/server.ts` | `tool:start/end` 广播补字段 + `PIPELINE_STAGES` 常量 + 收集 tool execs 持久化 |
| `studio/store/chat/types.ts` | `ToolExecution` + `PipelineStage` 类型 + `Message` 扩展 + 删除 `activeOperation` |
| `studio/store/chat/slices/message/initialState.ts` | 删除 `activeOperation` |
| `studio/store/chat/slices/message/action.ts` | SSE 监听器全部重写（tool:start/end/log/llm:progress） |
| `studio/components/chat/ToolExecutionSteps.tsx` | 新建组件（pipeline 面板 + 辅助工具折叠） |
| `studio/pages/ChatPage.tsx` | 渲染 `ToolExecutionSteps` + 简化 loading 指示器 + 删除 `activeOperation` 引用 |
