# Studio 路由持久化 + 消息隔离 + pi-ai/pi-agent 集成

> Phase 1 基础修复 + 架构升级。分三步：1a 路由 + 消息隔离，1b pi-ai 替换 provider，1c pi-agent 交互层。

## Phase 1a: URL Hash 路由 + bookId 消息隔离

### URL Hash 路由

```
#/                    → Dashboard
#/book/{bookId}       → ChatPage + Sidebar
#/book/new            → ChatPage (建书流程，无侧边栏)
#/config              → ConfigView
```

其他页面（chapter、analytics、truth、daemon、logs 等）从 sidebar 或页面内导航进入，不需要独立 hash 路由。

**实现方式：**
- `App.tsx` 的 `useState<Route>` 替换为 `useHashRoute()` 自定义 hook
- `nav.toBook(id)` → `window.location.hash = "#/book/" + id`
- `nav.toBookCreate()` → `window.location.hash = "#/book/new"`
- `nav.toDashboard()` → `window.location.hash = "#/"`
- 监听 `hashchange` 事件解析 route
- 浏览器前进后退自然工作
- 刷新后恢复当前页面

**左侧导航 `+` 按钮：** 直接跳转 `#/book/new`，不弹确认。当前书的对话按 bookId 保留，回来还在。

### Per-book Session 隔离

每本书一个独立 session 文件，带唯一 sessionId。

**存储结构：**

```
.inkos/
├── session.json              ← 全局状态（activeBookId, automationMode）
└── sessions/
    ├── {sessionId}.json      ← 某本书的对话 session
    ├── {sessionId}.json      ← 另一本书的对话 session
    └── ...
```

**Session 文件结构：**

```typescript
interface BookSession {
  sessionId: string;           // 唯一 ID（如 nanoid）
  bookId: string | null;       // 关联的书籍，null = 建书草案
  messages: InteractionMessage[];
  creationDraft?: BookCreationDraft;
  draftRounds?: DraftRound[];
  events: InteractionEvent[];
  currentExecution?: ExecutionState;
  createdAt: number;
  updatedAt: number;
}
```

**全局 session.json 简化为：**

```typescript
interface GlobalSession {
  activeBookId?: string;
  automationMode: AutomationMode;
  // messages、creationDraft、events 不再存这里
}
```

**生命周期：**

```
用户进入 #/book/{bookId}
  → 查找 .inkos/sessions/ 下 bookId 匹配的最近 session
  → 有 → 加载该 session 的 messages
  → 无 → 新建 session（sessionId = nanoid(), bookId = bookId）

用户进入 #/book/new
  → 新建 session（sessionId = nanoid(), bookId = null）
  → 建书成功后 session.bookId = newBookId

用户切换到另一本书
  → 当前 session 自动持久化
  → 加载目标书的最近 session
```

**API 变更：**

```
GET  /api/sessions?bookId={id}           → 该书的所有 session 列表
GET  /api/sessions/{sessionId}           → 加载某个 session
POST /api/sessions                       → 创建新 session
PUT  /api/sessions/{sessionId}/messages  → 追加消息（由 runtime 内部调用）
```

**前端 store：**

- `loadSession(bookId)` → `GET /api/sessions?bookId={id}` → 取最近的 session → 加载 messages
- 路由切换时自动切换 session
- store 新增 `currentSessionId: string | null`

---

## Phase 1b: pi-ai 替换 LLM Provider

### 依赖

```
@mariozechner/pi-ai@^0.67.1
```

### 替换映射

| 当前 InkOS (`llm/provider.ts`) | pi-ai |
|---|---|
| `LLMClient` (OpenAI/Anthropic SDK) | `Model` (统一抽象) |
| `chatCompletion(client, model, msgs)` | pi-ai `streamSimple()` |
| `chatWithTools(client, model, msgs, tools)` | pi-ai tool calling |
| `ProjectConfig.model` / `provider` | pi-ai `Model` 对象（含 `baseUrl` + `api`） |
| `loadProjectConfig()` API key | pi-ai `Model.headers` 或环境变量 |

### 第三方服务兼容

pi-ai 通过 `baseUrl` + OpenAI 兼容 API 类型接入所有主流第三方服务，不需要为每家写 provider：

| 服务 | Api 类型 | baseUrl |
|---|---|---|
| **OpenAI** | `openai-responses` | 原生支持，内置 provider |
| **Anthropic** | `anthropic-messages` | 原生支持，内置 provider |
| **DeepSeek** | `openai-completions` | `https://api.deepseek.com` |
| **Moonshot (Kimi)** | `openai-completions` | `https://api.moonshot.cn/v1` |
| **MiniMax** | `openai-completions` | `https://api.minimax.chat/v1` |
| **百炼 (Qwen)** | `openai-completions` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| **智谱 GLM (国际)** | `openai-completions` | `https://open.bigmodel.cn/api/paas/v4` |
| **智谱 BigModel (国内)** | `openai-completions` | `https://open.bigmodel.cn/api/paas/v4` |
| **硅基流动** | `openai-completions` | `https://api.siliconflow.cn/v1` |
| **PPIO** | `openai-completions` | `https://api.ppinfra.com/v3/openai` |
| **OpenRouter** | `openai-responses` | `https://openrouter.ai/api/v1` |
| **Ollama** | `openai-completions` | `http://localhost:11434/v1` |

### 配置设计

**用户体验：** 选服务商 → 填 API key → 选模型。不需要手动填 baseUrl。

```jsonc
// inkos.json — 新格式
{
  "service": "moonshot",      // 从预设列表选
  "model": "kimi-k2.5",       // 该服务下的模型
  "apiKey": "sk-..."          // API key
}

// 高级用户：自定义端点
{
  "service": "custom",
  "model": "my-model",
  "apiKey": "sk-...",
  "baseUrl": "https://my-server.com/v1"
}
```

**预设服务商列表（内置，不需要用户配置 baseUrl）：**

```typescript
const SERVICE_PRESETS: Record<string, ServicePreset> = {
  openai:       { api: "openai-responses",   baseUrl: "https://api.openai.com/v1",                         label: "OpenAI" },
  anthropic:    { api: "anthropic-messages",  baseUrl: "https://api.anthropic.com",                          label: "Anthropic" },
  deepseek:     { api: "openai-completions",  baseUrl: "https://api.deepseek.com",                           label: "DeepSeek" },
  moonshot:     { api: "openai-completions",  baseUrl: "https://api.moonshot.cn/v1",                         label: "Moonshot (Kimi)" },
  minimax:      { api: "openai-completions",  baseUrl: "https://api.minimax.chat/v1",                        label: "MiniMax" },
  bailian:      { api: "openai-completions",  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",  label: "百炼 (通义千问)" },
  zhipu:        { api: "openai-completions",  baseUrl: "https://open.bigmodel.cn/api/paas/v4",               label: "智谱 GLM" },
  siliconflow:  { api: "openai-completions",  baseUrl: "https://api.siliconflow.cn/v1",                      label: "硅基流动" },
  ppio:         { api: "openai-completions",  baseUrl: "https://api.ppinfra.com/v3/openai",                  label: "PPIO" },
  openrouter:   { api: "openai-responses",    baseUrl: "https://openrouter.ai/api/v1",                       label: "OpenRouter" },
  ollama:       { api: "openai-completions",  baseUrl: "http://localhost:11434/v1",                           label: "Ollama (本地)" },
  custom:       { api: "openai-completions",  baseUrl: "",                                                    label: "自定义端点" },
};
```

**内部转换：**

```typescript
function toModel(config: ProjectConfig): Model<Api> {
  const preset = SERVICE_PRESETS[config.service];
  return {
    id: config.model,
    name: config.model,
    api: preset.api,
    provider: config.service,
    baseUrl: config.baseUrl ?? preset.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131072,
    maxTokens: 8192,
  };
}
```

**Studio ConfigView 的服务选择 UI：**

```
┌─ 模型配置 ──────────────────────────────┐
│                                          │
│  服务商   [Moonshot (Kimi)        ▾]    │
│  模型     [kimi-k2.5              ]     │
│  API Key  [sk-••••••••••••        ]     │
│                                          │
│  (选 "自定义端点" 时额外显示:)           │
│  端点 URL [https://...            ]     │
│                                          │
└──────────────────────────────────────────┘
```

**向后兼容：** 旧格式 `{ "provider": "openai-compatible", "baseUrl": "..." }` 自动映射：根据 baseUrl 匹配预设，匹配不到则归入 `custom`。

### Pipeline agents 适配

- `BaseAgent.chat()` 底层从 `chatCompletion()` 改为 pi-ai `streamSimple()` 调用
- Agent 接口不变（传 messages 数组），只换底层
- 12+ 个 agent 文件需要 `LLMMessage` → pi-ai `Message` 类型适配
- 流式回调 `onTextDelta` → pi-ai stream events

### 风险点

- `openai-completions` vs `openai-responses`：部分服务（如 DeepSeek）支持 responses API，部分（如 Moonshot）只支持 completions。需要在 `toModel` 中正确判断
- 流式回调接口差异（`onTextDelta` → pi-ai stream events）
- 12 个 agent 文件的类型迁移工作量
- thinking model（kimi-k2.5）的静默思考阶段在 pi-ai 中的处理方式需要验证

---

## Phase 1c: pi-agent 交互层

### 依赖

```
@mariozechner/pi-agent-core@^0.67.1
```

### Agent 实例管理

```
bookId → Agent 实例（内存中）

用户进入 #/book/{bookId}
  → 有该 bookId 的 Agent → 恢复
  → 无 → 新建 Agent，注册工具，加载历史消息

用户进入 #/book/new
  → 新建临时 Agent（无 bookId）
  → 建书成功后绑定 bookId
```

### AgentTool + Pipeline 工作流架构

参考 Claude Code 的 AgentTool + 文件工具模式。主 Agent 拥有 pipeline tool（重操作）+ 文件工具（轻操作）+ 自然对话。

```
pi-agent Agent（主对话）
│  负责：理解用户意图、多轮对话、上下文管理
│  持有 messages[]，支持 transformContext
│
├── pipeline tool（重操作路由器）
     │
     ├── action: "create_book"
     │   └── pipeline.initBook()
     │       └── 内部: ArchitectAgent → FoundationReviewerAgent (review loop)
     │
     ├── action: "write_next"
     │   └── pipeline.writeNextChapter()
     │       └── 内部: PlannerAgent → ComposerAgent → WriterAgent → ContinuityAuditor → ReviserAgent
     │
     ├── action: "revise"
     │   └── pipeline.reviseDraft()
     │       └── 内部: ReviserAgent
     │
     ├── action: "audit"
     │   └── pipeline.auditDraft()
     │       └── 内部: ContinuityAuditor
     │
     ├── action: "patch_text"      → pipeline.patchChapterText()
     ├── action: "rename_entity"   → pipeline.renameEntity()
     ├── action: "edit_truth"      → pipeline.writeTruthFile()
     ├── action: "update_focus"    → pipeline.updateCurrentFocus()
     ├── action: "update_intent"   → pipeline.updateAuthorIntent()
     ├── action: "export"          → pipeline.exportBook()
     └── action: "list_books"      → pipeline.listBooks()
│
├── read tool — 读取 truth files / 章节内容
│   用户: "主角的设定是什么？" → Agent 调用 read → story_bible.md → 直接回答
│
├── edit tool — 编辑 truth files
│   用户: "把主角名字改成陈浩" → Agent 调用 edit → story_bible.md → 精确替换
│
├── grep tool — 搜索内容
│   用户: "哪一章提到了金库？" → Agent 调用 grep → 返回匹配章节
│
├── ls tool — 列出文件 / 章节
│   用户: "现在有几章了？" → Agent 调用 ls → 返回章节列表
│
└── 无 tool 匹配 → 自然对话（闲聊、建议、问答）
```

**轻重分离原则：**
- **轻操作**（读文件、小编辑、搜索）→ 文件工具直接执行，一个 tool call 搞定
- **重操作**（写章节、建书、审计）→ pipeline tool 路由到 pipeline 方法，内部多 agent 编排

**AgentTool 实现：**

```typescript
const pipelineTool: AgentTool = {
  name: "pipeline",
  label: "执行写作流水线操作",
  parameters: Type.Object({
    action: Type.String({ description: "操作类型" }),
    bookId: Type.Optional(Type.String()),
    params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  }),
  execute: async (toolCallId, { action, bookId, params }, signal) => {
    switch (action) {
      case "create_book":
        await pipeline.initBook(buildBookConfig(params), { externalContext: params.brief });
        return { content: [{ type: "text", text: `书籍已创建` }], details: { action } };
      case "write_next":
        const result = await pipeline.writeNextChapter(bookId!);
        return { content: [{ type: "text", text: `第${result.chapterNumber}章已完成` }], details: result };
      case "revise":
        await pipeline.reviseDraft(bookId!, params?.chapterNumber);
        return { content: [{ type: "text", text: "修订完成" }], details: { action } };
      // ... 其他 action
    }
  },
};
```

**与 Claude Code AgentTool 的对应：**

| Claude Code | InkOS |
|---|---|
| AgentTool spawn 子 agent | AgentTool dispatch 到 pipeline 方法 |
| 子 agent 有独立 messages[] | pipeline 内部有自己的 agent 编排（WriterAgent 等）|
| AgentTool 是唯一 tool | pipeline tool 是唯一 tool |
| 主 Agent 判断何时 spawn | 主 Agent 判断何时调用哪个 action |

**关键区别：** Claude Code 的子 agent 是 LLM 驱动的（有自己的对话能力），InkOS 的 pipeline agent 是**代码编排的**（PlannerAgent → WriterAgent → Auditor 是固定流程）。InkOS 不需要 LLM 来决定"接下来调哪个 agent"——pipeline 已经硬编码了流程。

### transformContext

```typescript
transformContext: (messages) => {
  // 保留最近 20 条消息
  // pipeline 执行结果摘要为短文本，不占过多 context
  return messages.slice(-20);
}
```

### 事件流统一

```
pipeline 事件               →  pi-agent 事件         →  SSE 广播
pipeline stage.changed      →  tool_execution_update  →  SSE pipeline:progress
pipeline 完成               →  tool_execution_end     →  SSE pipeline:complete
draft:delta (流式文本)      →  message_update         →  SSE message:delta
```

### 不动的部分

- Pipeline agents（WriterAgent、ArchitectAgent 等）保持独立，不改内部
- Pipeline 内部 LLM 调用走 pi-ai（Phase 1b 已替换）
- pi-agent 主 Agent 只管对话 + 意图判断 + 调用 AgentTool
- AgentTool 只做路由，实际执行是 pipeline 方法

### 无配置时的引导

当 `inkos.json` 没有配置模型时：

```
用户打开 Studio
  → 检测到无 LLM 配置
  → 主页面显示配置引导（不是 Dashboard）
  → 选服务商 → 填 key → 选模型 → 保存
  → 自动跳转 Dashboard

Studio ConfigView 也可以随时修改配置
```

```
┌─ 欢迎使用 InkOS ──────────────────────────┐
│                                              │
│  开始之前，请选择你的 AI 服务：              │
│                                              │
│  ┌────────┐ ┌────────┐ ┌────────┐          │
│  │ OpenAI │ │  Kimi  │ │DeepSeek│  ...     │
│  └────────┘ └────────┘ └────────┘          │
│                                              │
│  API Key  [                           ]     │
│  模型     [                     ▾]         │
│                                              │
│              [开始写作 →]                    │
└──────────────────────────────────────────────┘
```

---

## UI 交互逻辑

### ChatPage 状态流转

```
Dashboard → 点击书籍 → #/book/{bookId}
  → store.loadMessages(bookId)
  → 侧边栏加载 foundation + 章节
  → 输入框就绪

Dashboard → 点击 "+" 或 "新建书籍" → #/book/new
  → store.loadMessages(undefined)
  → 无侧边栏
  → placeholder: "输入你的想法，自动构建新书"

建书完成 → #/book/{newBookId}
  → 侧边栏出现
  → 后续消息标记 newBookId
```

### 对话交互（pi-agent 接入后）

```
用户: "写下一章"
  → Agent.prompt("写下一章")
  → Agent 调用 write_next 工具
  → 侧边栏 Progress 流式点亮
  → Agent 回复 "第2章《xxx》已完成"
  → 侧边栏章节列表刷新

用户: "把主角的名字改成李默"
  → Agent 有上下文（transformContext 保留最近消息）
  → Agent 回复或调用工具修改 truth file

用户: "刚才那章节奏太慢了"
  → Agent 理解多轮上下文
  → 调用 revise 或给建议
```

### 侧边栏联动

| 用户操作 | ChatPage | 侧边栏 |
|---|---|---|
| 发送消息 | 对话流新增 | 不变 |
| Agent 调用工具 | 工具调用卡片 | Progress 点亮步骤 |
| 工具完成 | 显示结果 | 刷新章节/文件列表 |
| 点击侧边栏文件 | 不变 | Artifacts 预览 |
| 浏览器刷新 | 恢复历史（bookId 过滤） | 重新加载 |

### 输入框

```
#/book/new      → placeholder: "输入你的想法，自动构建新书"
                → 无快捷操作按钮

#/book/{id}     → placeholder: "输入指令..."
                → 快捷操作: 写下一章 / 审计 / 导出 / 市场雷达
                → 支持自然语言
```
