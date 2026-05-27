# 修复 "Cannot read properties of undefined (reading 'service')" 错误

## ❌ 问题原因

在 `server.ts` 中创建 `AITasteRemoverAgent` 时，使用了错误的参数：

```typescript
// ❌ 错误代码
const tools = createInteractionToolsFromDeps(pipeline, state);
const agent = new AITasteRemoverAgent({
  projectRoot: root,
  bookDir,
  llm: tools.llm,  // ← tools.llm 是 undefined!
  logger: createLogger({ sink: "console" }),
});
```

`InteractionRuntimeTools` 接口没有 `llm` 属性，导致 `tools.llm` 返回 `undefined`。

## ✅ 解决方案

使用 `PipelineRunner` 的 `config` 属性获取 LLM 客户端和模型：

```typescript
// ✅ 正确代码
const pipeline = new PipelineRunner(await buildPipelineConfig());

// 从 pipeline 配置中获取 LLM
const llmClient = pipeline.config?.client;
const llmModel = pipeline.config?.model;

if (!llmClient || !llmModel) {
  throw new Error("LLM not configured. Please configure LLM in settings first.");
}

const agent = new AITasteRemoverAgent({
  client: llmClient,      // ← LLM 客户端
  model: llmModel,        // ← 模型名称
  projectRoot: root,
  bookId: id,
  logger: createLogger({ sink: "console" }),
});
```

## 📝 修改的文件

**文件**: `packages/studio/src/api/server.ts`

**修改内容**:
```diff
- const tools = createInteractionToolsFromDeps(pipeline, state);
- 
- const agent = new AITasteRemoverAgent({
-   projectRoot: root,
-   bookDir,
-   llm: tools.llm,
-   logger: createLogger({ sink: "console" }),
- });

+ const llmClient = pipeline.config?.client;
+ const llmModel = pipeline.config?.model;
+ 
+ if (!llmClient || !llmModel) {
+   throw new Error("LLM not configured. Please configure LLM in settings first.");
+ }
+ 
+ const agent = new AITasteRemoverAgent({
+   client: llmClient,
+   model: llmModel,
+   projectRoot: root,
+   bookId: id,
+   logger: createLogger({ sink: "console" }),
+ });
```

## 🔍 技术细节

### AgentContext 接口

`AITasteRemoverAgent` 继承自 `BaseAgent`，需要传入 `AgentContext`：

```typescript
export interface AgentContext {
  readonly client: LLMClient;      // LLM 客户端（OpenAI/Claude 等）
  readonly model: string;          // 模型名称（gpt-4, claude-3 等）
  readonly projectRoot: string;    // 项目根目录
  readonly bookId?: string;        // 可选的书籍 ID
  readonly logger?: Logger;        // 可选的日志记录器
  readonly onStreamProgress?: OnStreamProgress;
  readonly onFailover?: (error: unknown) => Promise<{ client: LLMClient; model: string } | null>;
}
```

### PipelineRunner.config

`PipelineRunner` 包含 LLM 配置：

```typescript
interface PipelineConfig {
  readonly client: LLMClient;      // LLM 客户端
  readonly model: string;          // 模型名称
  // ... 其他配置
}
```

### 错误处理

添加了 LLM 配置检查，如果用户未配置 LLM，会显示友好的错误信息：

```typescript
if (!llmClient || !llmModel) {
  throw new Error("LLM not configured. Please configure LLM in settings first.");
}
```

## 🧪 测试

修复后，点击"去 AI 味"按钮应该：

1. ✅ 正常调用 API
2. ✅ 显示加载动画
3. ✅ 执行去 AI 味处理
4. ✅ 保存修改后的内容
5. ✅ 页面自动刷新

如果 LLM 未配置，会显示错误提示：
> "LLM not configured. Please configure LLM in settings first."

## 📚 相关文件

- **BaseAgent**: `packages/core/src/agents/base.ts`
- **AITasteRemoverAgent**: `packages/core/src/agents/ai-taste-remover.ts`
- **PipelineRunner**: `packages/core/src/pipeline/runner.ts`
- **Server API**: `packages/studio/src/api/server.ts`

## ✅ 完成状态

- [x] 修复 `tools.llm` undefined 错误
- [x] 使用 `pipeline.config` 获取 LLM
- [x] 添加 LLM 配置检查
- [x] 提供友好的错误提示

现在去 AI 味功能应该可以正常工作了！✨
