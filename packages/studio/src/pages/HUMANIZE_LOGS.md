# 去 AI 味功能详细日志说明

## 📝 日志级别与位置

### 1. **API 层日志** (`server.ts`)
位置：`packages/studio/src/api/server.ts`

**日志前缀**: `[Humanize]`

**覆盖范围**:
- ✅ 请求参数记录
- ✅ 文件读取过程
- ✅ LLM 配置检查
- ✅ Agent 初始化
- ✅ 处理结果统计
- ✅ 错误详细信息

### 2. **Agent 层日志** (`ai-taste-remover.ts`)
位置：`packages/core/src/agents/ai-taste-remover.ts`

**日志前缀**: `[AITasteRemover]`, `[GateCheck]`

**覆盖范围**:
- ✅ 门检分析过程
- ✅ 语体识别
- ✅ LLM 调用
- ✅ 结果解析

## 📊 日志输出示例

### 正常流程日志

```
[Humanize] ====== 开始处理 ======
[Humanize] 书籍 ID: book-123
[Humanize] 章节号：1
[Humanize] 处理风格：conservative
[Humanize] 指定语体：自动检测
[Humanize] Step 1: 加载书籍配置...
[Humanize] ✓ 书籍配置加载成功
  - 书名：我的小说
  - 语言：zh
  - 类型：玄幻
[Humanize] Step 2: 查找章节文件...
[Humanize] ✓ 找到章节文件：0001.md
[Humanize] Step 3: 读取章节内容...
[Humanize] ✓ 章节内容读取成功
  - 文件路径：d:\GitHub\inkos\inkos\my-novel\chapters\0001.md
  - 内容长度：3500 字符
  - 预估字数：1750 字
[Humanize] Step 4: 创建 AI 味去除 Agent...
[Humanize] LLM 配置检查:
  - Client: openai
  - Model: gpt-4
[Humanize] ✓ LLM 配置验证通过
[Humanize] 初始化 AITasteRemoverAgent...
[Humanize] ✓ Agent 创建成功
[Humanize] Step 5: 执行去 AI 味处理...
[Humanize] 输入参数:
  - targetStyle: conservative
  - register: 自动检测
  - language: zh
[AITasteRemover] 开始处理
[AITasteRemover]   - 语言：zh
[AITasteRemover]   - 风格：conservative
[AITasteRemover]   - 语体提示：自动检测
[AITasteRemover]   - 内容长度：3500 字符
[AITasteRemover] Step -1: 执行门检...
[GateCheck] 开始门检分析...
[GateCheck]   检测信号 1: 自纠/犹疑语气...
[GateCheck]   检测信号 2: 地域词...
[GateCheck]   检测信号 3: meta-irony/自嘲...
[GateCheck]   检测信号 4: 具体细节...
[GateCheck]     ✓ 发现："他说"
[GateCheck]   检测信号 5: 作家声口...
[GateCheck]   真人信号总数：1
[GateCheck]   检测 AI 信号...
[GateCheck]     ✓ AI 信号：时代背景套路
[GateCheck]     ✓ AI 信号：空洞强调
[GateCheck]     ✓ AI 信号：过度拔高
[GateCheck]   AI 信号总数：3
[GateCheck]   决策：AI 生成 (AI 信号≥3 且无真人信号)
[GateCheck] 门检完成
[AITasteRemover]   - 门检结果：ai
[AITasteRemover]   - 门检行动：continue
[AITasteRemover]   - 证据数量：3 条
[AITasteRemover] Step 0: 语体识别...
[AITasteRemover]   - 检测到语体：written
[AITasteRemover] Step 1-3: 构建提示词并调用 LLM...
[AITasteRemover]   - System Prompt 长度：2500 字符
[AITasteRemover]   - User Prompt 长度：3600 字符
[AITasteRemover]   - 调用 LLM (gpt-4)...
[AITasteRemover]   ✓ LLM 响应成功
[AITasteRemover]   - 响应长度：3200 字符
[AITasteRemover] 解析输出...
[AITasteRemover] 处理完成
[AITasteRemover]   - 修改后长度：3200 字符
[AITasteRemover]   - AI 模式数量：3
[Humanize] ✓ 处理完成
[Humanize] ====== 处理结果 ======
[Humanize]   - 门检结果：ai
[Humanize]   - 门检行动：continue
[Humanize]   - 检测语体：written
[Humanize]   - 发现 AI 模式：3 条
[Humanize]   - 原文长度：3500 字符
[Humanize]   - 修改后长度：3200 字符
[Humanize]   - 长度变化：-300 字符
[Humanize]   - 修改比例：8.57%
[Humanize] 检测到的 AI 模式:
  1. 内容拔高 - 时代背景套路 (high)
  2. 内容拔高 - 过度拔高 (high)
  3. 内容拔高 - 空洞强调 (medium)
[Humanize] 打磨报告:
  - 动词强化：some
  - 节奏重塑：some
  - 填充词删除：5 个
  - 抽象换具体：some
  - 语序归位：some
  - 语体匹配：written
[Humanize] Step 6: 保存修改后的内容...
[Humanize] ✓ 内容保存成功
[Humanize] Step 7: 广播完成事件...
[Humanize] ✓ 事件广播成功
[Humanize] ====== 处理结束 ======
[Humanize] 总耗时：12.45 秒
```

### 真人文本检测日志

```
[Humanize] ====== 开始处理 ======
...
[AITasteRemover] Step -1: 执行门检...
[GateCheck] 开始门检分析...
[GateCheck]   检测信号 1: 自纠/犹疑语气...
[GateCheck]     ✓ 发现：我忘了
[GateCheck]     ✓ 发现：说不上来
[GateCheck]   检测信号 2: 地域词...
[GateCheck]     ✓ 发现 [北京话（内/那）]: 内
[GateCheck]   真人信号总数：3
[GateCheck]   检测 AI 信号...
[GateCheck]   AI 信号总数：0
[GateCheck]   决策：真人写作 (信号≥2)
[GateCheck] 门检完成
[AITasteRemover]   - 门检结果：human
[AITasteRemover]   - 门检行动：stop
[AITasteRemover]   ⚠ 检测到真人写作痕迹，跳过修改
[Humanize] ✓ 处理完成
[Humanize] ====== 处理结果 ======
[Humanize]   - 门检结果：human
[Humanize]   - 门检行动：stop
[Humanize]   - 检测语体：written
[Humanize]   - 发现 AI 模式：0 条
[Humanize]   - 原文长度：2800 字符
[Humanize]   - 修改后长度：2800 字符
[Humanize]   - 长度变化：0 字符
[Humanize]   - 修改比例：0.00%
[Humanize] ⚠ 检测到真人写作痕迹，未做修改
[Humanize] 证据:
  1. 自纠/犹疑语气：我忘了
  2. 自纠/犹疑语气：说不上来
...
```

### 错误日志

```
[Humanize] ====== 开始处理 ======
...
[Humanize] Step 4: 创建 AI 味去除 Agent...
[Humanize] LLM 配置检查:
  - Client: 未配置
  - Model: 未配置
[Humanize] ✗ LLM 未配置，终止处理
[Humanize] ✗ 处理失败
[Humanize] 错误类型：Error
[Humanize] 错误信息：LLM not configured. Please configure LLM in settings first.
[Humanize] 堆栈跟踪:
Error: LLM not configured. Please configure LLM in settings first.
    at app.post (.../server.ts:3332:15)
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
```

## 🔍 关键日志指标说明

### 门检结果类型

| 类型 | 说明 | 行动 |
|------|------|------|
| `human` | 检测到真人写作 | 停手，不改 |
| `ai` | 检测到 AI 生成 | 继续处理 |
| `uncertain` | 不确定 | 保守处理 |

### 决策逻辑

```
if (真人信号 ≥ 2) → human (停手)
else if (AI 信号 ≥ 3 且 真人信号 = 0) → ai (继续)
else → uncertain (保守继续)
```

### 处理结果统计

| 字段 | 说明 | 正常范围 |
|------|------|----------|
| 修改比例 | (原文 - 修改后) / 原文 | 5-15% |
| AI 模式数量 | 检测到的 AI 腔数量 | 0-10 |
| 长度变化 | 修改后 - 原文 | -500 ~ +100 |

### 语体类型

| 语体 | 说明 | 处理策略 |
|------|------|----------|
| `social` | 社交/口语 | 保留口语化表达 |
| `content` | 自媒体 | 保留互动语句 |
| `business` | 商务 | 保留专业术语 |
| `written` | 书面 | 标准处理 |
| `academic` | 学术 | 保留规范表达 |

## 🛠️ 排查问题指南

### 1. 处理失败

**查看日志**:
```
[Humanize] ✗ 处理失败
[Humanize] 错误类型：xxx
[Humanize] 错误信息：xxx
```

**常见问题**:
- LLM 未配置 → 检查设置
- 章节文件不存在 → 检查文件路径
- 网络错误 → 检查网络连接
- API 限流 → 等待重试

### 2. 未做修改

**查看日志**:
```
[Humanize] ⚠ 检测到真人写作痕迹，未做修改
[Humanize] 证据:
  1. xxx
  2. xxx
```

**原因**:
- 门检检测到真人写作（≥2 个真人信号）
- 这是正常行为，保护作者风格

### 3. 修改比例异常

**查看日志**:
```
[Humanize]   - 修改比例：25.50%
```

**可能原因**:
- 修改比例 > 20% → 可能过度修改
- 修改比例 < 5% → 可能修改不足

**解决方案**:
- 调整 `targetStyle` 参数
- 指定 `register` 语体
- 检查原文质量

### 4. LLM 调用失败

**查看日志**:
```
[AITasteRemover]   - 调用 LLM (gpt-4)...
[Humanize] ✗ 处理失败
```

**可能原因**:
- API Key 过期
- 网络超时
- 模型不可用

**解决方案**:
- 检查 API Key 配置
- 检查网络连接
- 更换模型

## 📈 性能监控

### 耗时统计

```
[Humanize] 总耗时：12.45 秒
```

**正常范围**:
- 短篇 (<2000 字): 5-10 秒
- 中篇 (2000-5000 字): 10-20 秒
- 长篇 (>5000 字): 20-40 秒

**耗时分布**:
- 门检：~0.1 秒
- 语体识别：~0.1 秒
- LLM 调用：80-90% 总耗时
- 文件操作：~0.5 秒

### 内存使用

日志中未直接显示，可通过 Node.js 监控：
```javascript
console.log(`内存使用：${process.memoryUsage().heapUsed / 1024 / 1024} MB`);
```

## 🎯 优化建议

### 1. 减少日志输出（生产环境）

修改日志级别，只输出关键信息：
```typescript
if (process.env.NODE_ENV === "production") {
  // 只输出错误和关键统计
  this.log?.error(...)
  this.log?.info(`[Humanize] 处理完成`)
} else {
  // 开发环境输出详细日志
  this.log?.info(...)
}
```

### 2. 添加性能指标

记录关键步骤耗时：
```typescript
const startTime = Date.now();
// ... 处理逻辑
const endTime = Date.now();
console.log(`[Humanize] LLM 调用耗时：${(endTime - startTime) / 1000}秒`);
```

### 3. 添加成功率统计

```typescript
let successCount = 0;
let failCount = 0;

// 在成功/失败时累加
// 定期输出统计
console.log(`成功率：${successCount / (successCount + failCount) * 100}%`);
```

## 📚 相关文件

- **API 日志**: `packages/studio/src/api/server.ts`
- **Agent 日志**: `packages/core/src/agents/ai-taste-remover.ts`
- **日志配置**: `packages/core/src/utils/logger.ts`

---

**提示**: 所有日志都带有 `[Humanize]`, `[AITasteRemover]`, `[GateCheck]` 前缀，方便使用 `grep` 或日志工具过滤。
