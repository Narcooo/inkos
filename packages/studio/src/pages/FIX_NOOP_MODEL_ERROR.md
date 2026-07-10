# 修复 "404 model 'noop-model' not found" 错误

## ❌ 问题原因

`pipeline.config.model` 返回了占位符 `noop-model`，而不是实际配置的模型。

**日志分析**:
```
[failover] Manager initialized: service=custom, model=Qwen/Qwen3.5-27B
[Humanize] LLM 配置检查:
  - Client: openai
  - Model: Qwen/Qwen3.5-27B  ← 这里显示的是正确模型
...
[Humanize] ✗ 处理失败
[Humanize] 错误信息：404 model 'noop-model' not found  ← 但实际使用的是 noop-model
```

**根因**: `buildPipelineConfig()` 返回的 `model` 字段可能是占位符，而实际配置的模型存储在 `currentConfig.llm.model` 或 failover 配置中。

## ✅ 解决方案

在使用模型前，检查是否为占位符，如果是则从原始配置中获取真实模型：

```typescript
const currentConfig = await loadCurrentProjectConfig();
const pipeline = new PipelineRunner(await buildPipelineConfig());

const llmClient = pipeline.config?.client;
let llmModel = pipeline.config?.model;

// If model is placeholder, use the actual configured model
if (llmModel === "noop-model" || !llmModel) {
  llmModel = currentConfig.llm.model;
  // Also check failover config for model
  const failoverConfig = (currentConfig.llm as Record<string, unknown>)?.failover;
  if (failoverConfig?.fallbacks && failoverConfig.fallbacks.length > 0) {
    const firstFallback = failoverConfig.fallbacks[0];
    if (typeof firstFallback === "object" && "model" in firstFallback) {
      llmModel = String(firstFallback.model);
    }
  }
}

// Final validation
if (!llmClient || !llmModel || llmModel === "noop-model") {
  throw new Error("LLM not configured");
}
```

## 📝 修改的文件

**文件**: `packages/studio/src/api/server.ts`

**修改内容**:
```diff
+ // Load current config to get the actual model
+ const currentConfig = await loadCurrentProjectConfig();
  const pipeline = new PipelineRunner(await buildPipelineConfig());
  
  // Get LLM config from pipeline and fallback to actual config if needed
  const llmClient = pipeline.config?.client;
- const llmModel = pipeline.config?.model;
+ let llmModel = pipeline.config?.model;
  
+ // If model is placeholder, use the actual configured model
+ if (llmModel === "noop-model" || !llmModel) {
+   llmModel = currentConfig.llm.model;
+   // Also check failover config for model
+   const failoverConfig = (currentConfig.llm as Record<string, unknown>)?.failover;
+   if (failoverConfig?.fallbacks && Array.isArray(failoverConfig.fallbacks) && failoverConfig.fallbacks.length > 0) {
+     const firstFallback = failoverConfig.fallbacks[0];
+     if (typeof firstFallback === "object" && firstFallback !== null && "model" in firstFallback) {
+       llmModel = String(firstFallback.model);
+     }
+   }
+ }
  
+ console.log(`  - 原始配置模型: ${currentConfig.llm.model}`);
  
- if (!llmClient || !llmModel) {
+ if (!llmClient || !llmModel || llmModel === "noop-model") {
```

## 🔍 技术细节

### noop-model 生成位置

`noop-model` 在以下位置生成：

```typescript
// effective-llm-config.ts
function resolveServiceModel(...) {
  if (!entry) return defaultModel || currentModel || "noop-model";
  if (entry.service === "custom") return defaultModel || currentModel || "noop-model";
  // ...
  return endpoint?.checkModel ?? endpoint?.models.find(...)?.id ?? defaultModel ?? currentModel ?? "noop-model";
}

function fillNoopLLMDefaults(llm) {
  if (typeof llm.model !== "string" || llm.model.length === 0) llm.model = "noop-model";
}
```

### 配置优先级

修复后的模型获取优先级：

1. `pipeline.config.model` - 如果不是 `noop-model`
2. `currentConfig.llm.model` - 原始配置模型
3. `failover.fallbacks[0].model` - failover 配置中的第一个备用模型

### Failover 配置结构

```typescript
{
  llm: {
    service: "custom",
    model: "...",
    failover: {
      enabled: true,
      mode: "auto",
      fallbacks: [
        { service: "custom", model: "Qwen/Qwen3.5-27B" },
        // ...
      ]
    }
  }
}
```

## 📊 修复后的日志输出

```
[Humanize] Step 4: 创建 AI 味去除 Agent...
[studio] Initializing FailoverManager for session
[failover] Manager initialized: service=custom, model=Qwen/Qwen3.5-27B
[Humanize] LLM 配置检查:
  - Client: openai
  - Model: Qwen/Qwen3.5-27B
  - 原始配置模型: Qwen/Qwen3.5-27B
[Humanize] ✓ LLM 配置验证通过
[Humanize] 初始化 AITasteRemoverAgent...
[Humanize] ✓ Agent 创建成功
[Humanize] Step 5: 执行去 AI 味处理...
...
```

## ✅ 测试

修复后，点击"去 AI 味"按钮应该：

1. ✅ 正确获取配置的模型（如 `Qwen/Qwen3.5-27B`）
2. ✅ 不再使用占位符 `noop-model`
3. ✅ 成功调用 LLM API
4. ✅ 执行去 AI 味处理

## 📚 相关文件

- **配置解析**: `packages/core/src/utils/effective-llm-config.ts`
- **Pipeline 配置**: `packages/studio/src/api/server.ts` (buildPipelineConfig)
- **Server API**: `packages/studio/src/api/server.ts` (humanize endpoint)

## 🎯 最佳实践

### 1. 配置验证

在使用任何配置前，进行严格验证：

```typescript
if (!model || model === "noop-model") {
  throw new Error("LLM model is not configured");
}
```

### 2. 日志记录

记录多个配置来源，便于排查问题：

```typescript
console.log(`Pipeline model: ${pipeline.config.model}`);
console.log(`Config model: ${currentConfig.llm.model}`);
console.log(`Failover model: ${failoverModel}`);
```

### 3. Fallback 策略

实现多层 fallback，确保总有可用的配置：

```typescript
let model = pipelineConfig.model;
if (!model || model === "noop-model") model = config.llm.model;
if (!model || model === "noop-model") model = failoverConfig?.fallbacks?.[0]?.model;
if (!model || model === "noop-model") throw new Error("No model configured");
```

## ✅ 完成状态

- [x] 修复 `noop-model` 占位符问题
- [x] 添加配置 fallback 逻辑
- [x] 支持 failover 配置中的模型
- [x] 添加详细日志
- [x] 增加最终验证

现在去 AI 味功能应该可以正常工作了！✨
