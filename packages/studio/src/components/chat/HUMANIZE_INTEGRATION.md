# Web 界面集成去 AI 味功能

## 已完成的工作

### 1. ✅ QuickActions 按钮
在聊天页面的快速操作栏添加了"去 AI 味"按钮（ Wand2 图标）

**位置**: `packages/studio/src/components/chat/QuickActions.tsx`

```typescript
{
  icon: <Wand2 size={12} />,
  labelZh: "去 AI 味",
  labelEn: "Humanize",
  commandZh: "去 AI 味",
  commandEn: "humanize",
}
```

### 2. ✅ API 端点
添加了后端 API 端点处理去 AI 味请求

**位置**: `packages/studio/src/api/server.ts`

```typescript
app.post("/api/v1/books/:id/humanize/:chapter", async (c) => {
  // 读取章节内容
  // 创建 AITasteRemoverAgent
  // 调用 removeAITaste()
  // 保存修改后的内容
  // 广播事件
});
```

**参数**:
- `style`: "conservative" | "aggressive" (默认 conservative)
- `register`: 语体类型 (可选，自动检测)

**返回**:
```typescript
{
  revisedContent: string;
  gateCheckResult: { type: "human" | "ai" | "uncertain"; evidence: string[] };
  registerDetected: string;
  patternsFound: AIPattern[];
  polishReport: PolishReport;
}
```

### 3. ✅ Core 导出
在 `packages/core/src/index.ts` 中导出 AITasteRemoverAgent

## 使用方式

### 方法 1: 通过聊天界面（推荐）

1. 点击聊天页面的"去 AI 味"按钮
2. 系统会自动发送"去 AI 味"命令到聊天
3. LLM 会理解并调用相应的 API

### 方法 2: 直接调用 API

```typescript
// 对特定章节去 AI 味
const response = await fetch(`/api/v1/books/${bookId}/humanize/${chapterNum}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    style: "conservative",  // 或 "aggressive"
    register: "written",    // 可选：指定语体
  }),
});

const result = await response.json();
console.log(result.revisedContent);
console.log(result.gateCheckResult); // 门检结果
console.log(result.patternsFound);   // 发现的 AI 腔模式
```

### 方法 3: 在 BookDetail 页面添加按钮

可以在 `BookDetail.tsx` 中添加一个"批量去 AI 味"按钮：

```typescript
const [humanizingChapters, setHumanizingChapters] = useState<number[]>([]);

const handleHumanizeChapter = async (chapterNum: number) => {
  setHumanizingChapters(prev => [...prev, chapterNum]);
  try {
    await postApi(`/api/v1/books/${bookId}/humanize/${chapterNum}`, {
      style: "conservative",
    });
  } catch (e) {
    alert(e instanceof Error ? e.message : "Failed");
  } finally {
    setHumanizingChapters(prev => prev.filter(n => n !== chapterNum));
  }
};
```

## 工作流程

```
用户点击"去 AI 味"按钮
    ↓
发送命令到聊天："去 AI 味"
    ↓
LLM 理解意图
    ↓
调用 API: POST /api/v1/books/:id/humanize/:chapter
    ↓
AITasteRemoverAgent 执行
    ├─ 门检（判断是否真人写作）
    ├─ 语体识别
    ├─ AI 腔检测
    ├─ 保守修改
    └─ 输出报告
    ↓
保存修改后的章节
    ↓
广播 "humanize:complete" 事件
    ↓
UI 刷新显示结果
```

## 事件监听

可以在 ChatPage 监听 humanize 事件：

```typescript
useEffect(() => {
  const recent = sse.messages.at(-1);
  if (!recent) return;

  if (recent.event === "humanize:start") {
    // 显示加载状态
  }

  if (recent.event === "humanize:complete") {
    // 刷新章节列表
    refetch();
  }
}, [sse.messages]);
```

## 语体说明

| 语体 | 描述 | 典型场景 |
|------|------|----------|
| `social` | 社交/口语 | 微信聊天、朋友圈 |
| `content` | 内容/自媒体 | 公众号、小红书 |
| `business` | 商务/职场 | 工作邮件、汇报 |
| `written` | 书面/一般 | 博客、时评 |
| `academic` | 学术/科技 | 论文、技术报告 |

## 注意事项

1. **门检机制**: 如果检测到是真人写作（有自纠语气、地域词等），会停手不改
2. **保守策略**: 默认使用保守策略，只改明显的 AI 腔
3. **不发明事实**: 终稿里的具体信息原文都得有依据
4. **保留毛边**: 至少保留一处真人痕迹

## 下一步优化

- [ ] 在 BookDetail 页面添加章节级别的去 AI 味按钮
- [ ] 添加批量去 AI 味功能（全书）
- [ ] 显示打磨报告 UI
- [ ] 添加语体选择下拉菜单
- [ ] 添加修改前后对比视图
- [ ] 支持撤销操作

## 相关文件

- Agent 实现：`packages/core/src/agents/ai-taste-remover.ts`
- 使用示例：`packages/core/src/agents/ai-taste-remover.example.ts`
- 文档：`packages/core/src/agents/README.ai-taste-remover.md`
- Web 集成：`packages/studio/src/components/chat/QuickActions.tsx`
- API 端点：`packages/studio/src/api/server.ts`
