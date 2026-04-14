# Studio 服务商管理设计

## 概述

将旧 ConfigView 拆解为三个独立触点：服务商管理页、聊天输入栏模型选择器、顶栏偏好设置。核心流程为"服务商优先"——选服务商 → 填 Key → 自动拉取模型列表。

## 路由

| 路由 | 页面 | 说明 |
|------|------|------|
| `#/` | Dashboard | 无 LLM 配置时顶部显示黄色警告条 |
| `#/services` | 服务商管理（卡片网格） | 所有内置 + 自定义服务商平铺展示 |
| `#/services/:serviceId` | 服务商详情（整页跳转） | Key、模型列表、高级参数 |
| `#/book/:bookId` | 聊天页 | PromptInputSelect 选模型 |

旧 `#/config` 路由废弃，访问时 redirect 到 `#/services`。

## 数据结构

### inkos.json（可提交到 git）

```jsonc
{
  "llm": {
    "services": [
      {
        "service": "moonshot"     // 对应 SERVICE_PRESETS key
      },
      {
        "service": "deepseek"
      },
      {
        "service": "custom",
        "name": "公司内网 GPT",   // custom 必填
        "baseUrl": "https://llm.internal.corp/v1"  // custom 必填
      }
    ],
    "defaultModel": "kimi-k2.5"  // 聊天默认使用的模型
  },
  "language": "zh"
}
```

### .inkos/secrets.json（gitignore，不提交）

```jsonc
{
  "services": {
    "moonshot": { "apiKey": "sk-xxx" },
    "deepseek": { "apiKey": "sk-xxx" },
    "custom:公司内网 GPT": { "apiKey": "" }  // 选填，本地服务可为空
  }
}
```

Key 的查找优先级：`.inkos/secrets.json` → 环境变量（`MOONSHOT_API_KEY`）→ 未配置。

**向后兼容**：如果检测到旧格式（`llm.provider` + `llm.model` + `llm.apiKey`），自动迁移：配置写入 `llm.services[]`，apiKey 移入 `.inkos/secrets.json`。

### 内置服务商

沿用 `packages/core/src/llm/service-presets.ts` 中的 `SERVICE_PRESETS`（12 个），每个预设已有 `api`、`baseUrl`、`label`。

## 页面设计

### 1. 服务商管理页（#/services）

卡片网格布局，两列。

**已连接的服务商**：实线边框 + 绿色背景底色 + 绿色状态点，显示"N 个模型"。

**未配置的服务商**：虚线边框 + 灰色状态点，显示"未配置"。

**最后一张卡**："+ 自定义服务"，点击进入自定义服务商详情页。

点击任意卡片 → 整页跳转到 `#/services/:serviceId`。

### 2. 服务商详情页（#/services/:serviceId）

页面顶部有"← 返回"链接回 `#/services`。

**内置服务商**展示：
- 服务商名称 + 连接状态标签
- API Key 输入框（密码模式，带显示/隐藏切换）
- "测试连接"按钮：验证 Key 有效性
- 可用模型列表：填 Key 后自动调 `GET /api/services/:service/models?apiKey=xxx` 拉取
- 高级参数区：temperature、maxTokens（每个服务商独立配置）

**自定义服务商**额外展示：
- 名称输入框（用户自定义显示名）
- Base URL 输入框（必填）
- API Key 输入框（选填）

**模型拉取失败的兜底**：
- Key 错误 → 提示"Key 无效，请检查后重试"
- 网络不通 → 提示"无法连接到 xxx"
- 不支持 /v1/models → 降级显示手动输入框，用户自行填入模型 ID
- 手动输入的模型和自动发现的模型在 PromptInputSelect 里同等可用

### 3. 聊天页模型选择器

使用 ai-elements 的 `PromptInputSelect` 组件，位于输入栏底部工具栏。

下拉内容按已激活服务商分组：

```
┌─ Moonshot ─────────────────┐
│  kimi-k2.5            ✓    │
│  moonshot-v1-8k            │
│  moonshot-v1-32k           │
├─ DeepSeek ─────────────────┤
│  deepseek-chat             │
│  deepseek-reasoner         │
├────────────────────────────┤
│  ⚙ 管理服务商              │
└────────────────────────────┘
```

底部放"管理服务商"快捷链接，跳转到 `#/services`。

选择的模型保存到 Zustand store，发送消息时传给后端。

### 4. 顶栏偏好设置

语言切换（中/EN toggle）和主题切换（深色/浅色）放在 App 顶栏右侧，不需要独立页面。

### 5. Dashboard 引导条

当 `inkos.json` 中 `llm.services` 为空或不存在时，Dashboard 顶部显示黄色警告条：

```
⚠ 还没有配置 AI 模型    [去配置]
  配好一个服务商才能开始创作
```

点击"去配置"跳转到 `#/services`。不强制跳转，用户仍可浏览 Dashboard。

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/services` | 返回所有服务商及其连接状态、模型数量 |
| GET | `/api/services/:service/models?apiKey=xxx` | 拉取指定服务商的可用模型列表 |
| GET | `/api/services/config` | 返回当前 inkos.json 中的 services 配置 |
| PUT | `/api/services/config` | 更新 services 配置（增删改服务商） |
| POST | `/api/services/:service/test` | 测试连接（验证 Key + 网络） |

## 高级参数与模型约束

temperature 和 maxTokens 放在服务商详情页的"高级参数"区域，每个服务商可以独立配置。

部分模型对 temperature 有特殊要求，详情页中应展示提示文本并设为默认值。

已知约束（来自各服务商官方文档）：

| 服务商 | temperature 范围 | 默认值 | 创意写作推荐 | 特殊说明 |
|--------|-----------------|--------|-------------|----------|
| DeepSeek | [0, 2] | 1.0 | 1.5 | 编码/数学用 0.0，创意写作用 1.5 |
| Moonshot (Kimi) | **[0, 1]** | 0.3 | 1.0 (kimi-k2.5) | 范围比 OpenAI 窄，不要传超过 1；kimi-k2.5 推荐 1.0 |
| Anthropic (Claude) | [0, 1] | 1.0 | 1.0 | 不要同时改 temperature 和 top_p |
| OpenAI | [0, 2] | 1.0 | 1.0 | 不要同时改 temperature 和 top_p |
| 智谱 GLM | [0, 1] | 0.95 | 0.95 | OpenAI 兼容，范围 [0,1] |
| 百炼 (Qwen) | [0, 2] | 0.7 | 1.0 | OpenAI 兼容 |
| 硅基流动 | 透传下游 | — | — | 取决于实际调用的模型 |
| MiniMax | [0, 2] | 0.9 | 0.9 | — |
| PPIO | 透传下游 | — | — | 取决于实际调用的模型 |
| OpenRouter | 透传下游 | — | — | 取决于实际调用的模型 |
| Ollama | 模型决定 | — | — | 本地模型自带默认值 |

**关键发现**：temperature 的合法范围因服务商而异（[0,1] vs [0,2]），UI 的 temperature 输入/滑块必须根据当前服务商限制 max 值。

在 `service-presets.ts` 中扩展 `ServicePreset` 接口：

```ts
interface ServicePreset {
  api: string;
  baseUrl: string;
  label: string;
  temperatureRange?: [number, number];  // 新增，如 [0, 1] 或 [0, 2]
  defaultTemperature?: number;          // 新增，服务商级别默认值
  writingTemperature?: number;          // 新增，创意写作场景推荐值
  temperatureHint?: string;             // 新增，UI 提示文本
}
```

详情页展示效果：

```
Temperature: [1.0]  (范围 0 ~ 1)
ℹ Kimi 创意写作推荐 temperature=1.0
```

用户可以覆盖默认值，但 UI 会：
1. 限制输入不超过服务商的 max 范围
2. 标注当前值和推荐值的偏差

## Pi-ai / Agent 注入链路

### 当前流程（单服务商）

```
inkos.json (llm.provider + llm.model + llm.apiKey)
  → createLLMClient(config.llm)
    → client._piModel (pi-ai Model)
    → client._apiKey
      → runAgentSession({ model, apiKey, ... })
        → Agent({ model, getApiKey: () => apiKey })
```

### 新流程（多服务商）

```
前端 PromptInputSelect 选择 → POST /api/agent { model: "kimi-k2.5", service: "moonshot" }
  → resolveServiceModel("moonshot", "kimi-k2.5")
    → SERVICE_PRESETS["moonshot"] 获取 provider type + baseUrl
    → loadSecret("moonshot") 从 .inkos/secrets.json 读 apiKey
    → getModel(provider, modelId) 获取 pi-ai Model
      → runAgentSession({ model, apiKey, ... })
        → Agent({ model, getApiKey: () => apiKey })
```

### 关键变更

**1. 新增 `resolveServiceModel(service, modelId)`**

位于 `packages/core/src/llm/service-resolver.ts`：

```ts
interface ResolvedModel {
  model: Model<Api>;   // pi-ai Model 对象
  apiKey: string;      // 从 secrets.json 或环境变量获取
  temperature?: number; // 服务商级别的默认参数
  maxTokens?: number;
}

function resolveServiceModel(
  service: string,
  modelId: string,
  projectRoot: string,
): Promise<ResolvedModel>
```

查找链：`.inkos/secrets.json` → 环境变量（`MOONSHOT_API_KEY`）→ 抛错。

**2. 新增 `packages/core/src/llm/secrets.ts`**

```ts
function loadSecrets(projectRoot: string): Promise<SecretsFile>
function saveSecrets(projectRoot: string, secrets: SecretsFile): Promise<void>
function getServiceApiKey(projectRoot: string, service: string): Promise<string | null>
```

**3. `POST /api/agent` 请求体扩展**

```ts
// 旧: { instruction, activeBookId }
// 新: { instruction, activeBookId, model?, service? }
// model/service 缺省时使用 inkos.json 中的 defaultModel + 对应服务商
```

**4. Agent 缓存的模型切换**

当用户在 PromptInputSelect 切换模型时：
- 如果新模型和当前 Agent 的模型相同 → 复用缓存
- 如果不同 → evict 旧 Agent，用新模型创建新 Agent（保留消息历史）

**5. Pipeline 子智能体的模型**

Pipeline 内部的 writer/auditor/reviser 等子智能体沿用 `inkos.json` 中的 `defaultModel` 对应的服务商配置，不跟随聊天页的 PromptInputSelect 选择。原因：子智能体是后台重操作，应该用稳定的默认配置而不是用户临时切换的模型。

## 测试策略

### 单元测试

| 模块 | 测试文件 | 覆盖点 |
|------|----------|--------|
| `secrets.ts` | `__tests__/secrets.test.ts` | 读写 secrets.json、key 查找优先级（secrets → env → null）、文件不存在时优雅降级 |
| `service-resolver.ts` | `__tests__/service-resolver.test.ts` | 内置服务商解析、自定义服务商解析、apiKey 注入、temperature/maxTokens 传递 |
| 旧格式迁移 | `__tests__/config-migration.test.ts` | 旧 `llm.provider+model+apiKey` → `llm.services[]` + `secrets.json` 拆分 |
| `service-presets.ts` | 扩展已有测试 | `listModelsForService` 失败时返回空数组、手动模型 ID 合并 |

### 集成测试

| 场景 | 覆盖点 |
|------|--------|
| API 端点 | `GET/PUT /api/services/config` 读写 inkos.json、`POST /api/services/:service/test` 连接测试 |
| Agent 注入 | `POST /api/agent { model, service }` → Agent 使用正确的 model + apiKey |
| 模型切换 | 发消息用 model A → 切换 → 发消息用 model B → Agent 缓存正确 evict + 消息历史保留 |
| secrets 隔离 | apiKey 不出现在 inkos.json 中、不出现在 API 响应中 |

### 回归守护

- **maxTokens 传递**：每个服务商配置的 maxTokens 必须正确传递到 pi-ai `streamSimple()`，不丢失不硬编码
- **temperature 范围校验**：传给 API 的 temperature 不超过服务商的合法范围（Moonshot/Claude/GLM ≤1.0，DeepSeek/OpenAI/Qwen ≤2.0）；写测试断言每个服务商的 temperature 被 clamp 到合法范围
- **temperature 默认值**：未手动配置时，使用服务商的 `writingTemperature`（创意写作场景），而非硬编码 0.7
- **旧配置不破坏**：已有单服务商 inkos.json 自动迁移后功能正常

## 系统提示词补丁

`agent-system-prompt.ts` 中两种模式（建书 / 写作）的提示词末尾追加：

- 中文：`- **不要在回复中添加表情符号**`
- 英文：`- **Do NOT use emoji in your responses**`

## 废弃项

- `#/config` 路由 → redirect 到 `#/services`
- `ConfigView.tsx` → 删除
- `GET/PUT /api/project` 中的 LLM 相关字段 → 迁移到 `/api/services/config`
- `GET/PUT /api/project/model-overrides` → 废弃（由 PromptInputSelect 替代）
- inkos.json 旧格式 `llm.provider` / `llm.model` / `llm.baseUrl` / `llm.apiKey` → 自动迁移为 `llm.services[]`
