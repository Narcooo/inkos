# 修复 "sinks is not iterable" 错误

## ❌ 问题原因

在创建 Logger 时使用了错误的参数格式：

```typescript
// ❌ 错误代码
const agent = new AITasteRemoverAgent({
  client: llmClient,
  model: llmModel,
  projectRoot: root,
  bookId: id,
  logger: createLogger({ sink: "console" }),  // ← 错误！应该是 sinks 数组
});
```

`createLogger` 函数需要传入以下参数：
```typescript
interface CreateLoggerOptions {
  readonly tag: string;                    // 日志标签
  readonly sinks: ReadonlyArray<LogSink>;  // 日志输出目标（数组）
  readonly minLevel?: LogLevel;            // 最小日志级别
  readonly baseCtx?: Record<string, unknown>; // 基础上下文
}
```

## ✅ 解决方案

使用正确的参数格式创建 Logger：

```typescript
// ✅ 正确代码
const { createLogger, createStderrSink } = await import("@actalk/inkos-core");

const logger = createLogger({
  tag: "AITasteRemover",
  sinks: [createStderrSink({ minLevel: "info", enableColors: true })],
});

const agent = new AITasteRemoverAgent({
  client: llmClient,
  model: llmModel,
  projectRoot: root,
  bookId: id,
  logger,  // 使用正确创建的 logger
});
```

## 📝 修改的文件

**文件**: `packages/studio/src/api/server.ts`

**修改内容**:
```diff
- const { AITasteRemoverAgent, createLogger } = await import("@actalk/inkos-core");
+ const { AITasteRemoverAgent, createLogger, createStderrSink } = await import("@actalk/inkos-core");

- const agent = new AITasteRemoverAgent({
-   logger: createLogger({ sink: "console" }),
- });

+ const logger = createLogger({
+   tag: "AITasteRemover",
+   sinks: [createStderrSink({ minLevel: "info", enableColors: true })],
+ });
+ 
+ const agent = new AITasteRemoverAgent({
+   logger,
+ });
```

## 🔍 技术细节

### Logger 接口

```typescript
export interface Logger {
  readonly debug: (msg: string, ctx?: Record<string, unknown>) => void;
  readonly info: (msg: string, ctx?: Record<string, unknown>) => void;
  readonly warn: (msg: string, ctx?: Record<string, unknown>) => void;
  readonly error: (msg: string, ctx?: Record<string, unknown>) => void;
  readonly child: (tag: string, extraCtx?: Record<string, unknown>) => Logger;
}
```

### createLogger 函数

```typescript
export function createLogger(options: {
  readonly tag: string;                    // 必需：日志标签
  readonly sinks: ReadonlyArray<LogSink>;  // 必需：输出目标数组
  readonly minLevel?: LogLevel;            // 可选：最小级别
  readonly baseCtx?: Record<string, unknown>; // 可选：基础上下文
}): Logger
```

### createStderrSink 函数

```typescript
export function createStderrSink(options: {
  readonly minLevel?: LogLevel;       // 默认："info"
  readonly enableColors?: boolean;    // 默认：终端支持颜色
}): LogSink
```

### LogSink 接口

```typescript
export interface LogSink {
  readonly write: (entry: LogEntry) => void;
}
```

## 🎯 可用的 Sink 类型

### 1. Stderr Sink（推荐）
```typescript
createStderrSink({ 
  minLevel: "info",      // 只输出 info 及以上级别
  enableColors: true     // 启用颜色
})
```

### 2. JSON Line Sink
```typescript
createJsonLineSink(process.stdout)
```

### 3. Null Sink（不输出）
```typescript
nullSink
```

### 4. 自定义 Sink
```typescript
const customSink: LogSink = {
  write: (entry) => {
    // 自定义处理逻辑
    console.log(`[${entry.tag}] ${entry.level}: ${entry.message}`);
  }
};
```

## 📊 日志输出示例

修复后的日志输出：

```
[Humanize] ====== 开始处理 ======
[Humanize] 书籍 ID: 咒术回战 - 无为转变之后宫生活
[Humanize] 章节号：10
[Humanize] Step 4: 创建 AI 味去除 Agent...
[AITasteRemover] 开始处理
[AITasteRemover]   - 语言：zh
[AITasteRemover]   - 风格：conservative
[GateCheck] 开始门检分析...
[GateCheck]   检测信号 1: 自纠/犹疑语气...
...
```

## ✅ 测试

修复后，点击"去 AI 味"按钮应该：

1. ✅ 正常创建 Agent
2. ✅ 显示详细的日志输出
3. ✅ 执行去 AI 味处理
4. ✅ 保存修改后的内容

## 📚 相关文件

- **Logger 实现**: `packages/core/src/utils/logger.ts`
- **BaseAgent**: `packages/core/src/agents/base.ts`
- **AITasteRemoverAgent**: `packages/core/src/agents/ai-taste-remover.ts`
- **Server API**: `packages/studio/src/api/server.ts`

## 🎯 最佳实践

### 1. 开发环境
```typescript
const logger = createLogger({
  tag: "MyAgent",
  sinks: [createStderrSink({ 
    minLevel: "debug",      // 输出所有日志
    enableColors: true 
  })],
});
```

### 2. 生产环境
```typescript
const logger = createLogger({
  tag: "MyAgent",
  sinks: [
    createStderrSink({ minLevel: "warn" }),
    createJsonLineSink(logFile),
  ],
});
```

### 3. 静默模式
```typescript
const logger = createLogger({
  tag: "MyAgent",
  sinks: [nullSink],  // 不输出任何日志
});
```

## ✅ 完成状态

- [x] 修复 `createLogger` 参数错误
- [x] 使用 `createStderrSink` 创建正确的 sink
- [x] 添加日志标签 "AITasteRemover"
- [x] 启用颜色输出
- [x] 设置最小级别为 "info"

现在去 AI 味功能应该可以正常工作了！✨
