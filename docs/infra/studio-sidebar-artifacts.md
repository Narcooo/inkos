# Studio 右侧侧边栏 + Artifacts

> 参考 Claude Cowork 右侧面板，展示 pipeline 进度、核心文件列表、解析摘要、章节列表。点击文件进入 artifacts 预览。

## 布局

```
┌─────────────────────────────────────────────────────────┐
│ Header                                                   │
├────────┬─────────────────────┬──────────────────────────┤
│ Nav    │   ChatPage          │  右侧面板 (300px)         │
│ sidebar│   对话消息流          │  执行 / 核心文件 /        │
│        │                     │  世界观 / 角色 / 章节      │
│        │   [输入框]           │                           │
└────────┴─────────────────────┴──────────────────────────┘
```

- 侧边栏无边框，`bg-background/30 backdrop-blur-sm`
- 左侧分隔线 `border-l border-border/20`
- 各 section 卡片 `rounded-xl bg-card/60`，无强边框
- 参考 Claude Cowork 的间距和字号

## Section 定义

### 1. 执行（Progress）

预定义步骤列表，按 SSE `log` 事件逐个点亮。

**initBook 步骤：**

| # | 阶段 | 状态 |
|---|------|------|
| 1 | 生成基础设定 | planning |
| 2 | 保存书籍配置 | persisting |
| 3 | 写入基础设定文件 | persisting |
| 4 | 初始化控制文档 | persisting |
| 5 | 创建初始快照 | persisting |

**writeNextChapter 步骤：**

| # | 阶段 | 状态 |
|---|------|------|
| 1 | 准备章节输入 | planning |
| 2 | 撰写章节草稿 | writing |
| 3 | 落盘最终章节 | persisting |
| 4 | 生成最终真相文件 | persisting |
| 5 | 校验真相文件变更 | persisting |
| 6 | 同步记忆索引 | persisting |
| 7 | 更新章节索引与快照 | persisting |

**视觉状态：**
- ✓ 蓝色实心 checkmark — 已完成
- ② 蓝色圆圈 + spinner — 执行中
- 3 灰色圆圈 — 待执行

**数据源：** SSE `log` 事件，关键字匹配到预定义步骤名点亮对应行。

### 2. 核心文件（Foundation）

8 个 foundation 文件，中文名显示，点击进入 artifacts 模式。

| 文件名 | 中文名 |
|--------|--------|
| story_bible.md | 世界观设定 |
| volume_outline.md | 卷纲规划 |
| book_rules.md | 叙事规则 |
| current_state.md | 状态卡 |
| pending_hooks.md | 伏笔池 |
| subplot_board.md | 支线进度 |
| emotional_arcs.md | 情感弧线 |
| character_matrix.md | 角色矩阵 |

**数据源：** `GET /books/{id}/truth` 获取文件列表。

### 3. 世界观（摘要）

从 `story_bible.md` 解析 `## 01_世界观` 段落，提取文本摘要展示。

### 4. 角色（摘要）

从 `story_bible.md` 解析 `## 02_主角` + `## 03_配角` 段落，提取角色名 + 一句话描述。

### 5. 章节

从 `GET /books/{id}` 获取 chapters 列表，展示章节号 + 标题 + 状态指示符。

**状态指示：**
- ✓ 绿色 — approved
- ◆ 黄色 — ready-for-review
- ○ 灰色 — drafted
- ✕ 红色 — needs-revision / audit-failed

## Artifacts 模式

点击核心文件列表中的任意文件，侧边栏整体替换为文件预览：

```
┌─ ← 世界观设定 ────────────┐
│                             │
│  ## 01_世界观               │
│  以灵气为根基的修仙世界...  │
│                             │
│  (Markdown 渲染，可滚动)    │
│                             │
└─────────────────────────────┘
```

- 顶部：`←` 返回按钮 + 文件中文名
- 内容：`GET /books/{id}/truth/{filename}` → markdown 渲染
- 返回：点 `←` 回到默认面板视图

## 摘要缓存策略

```
首次打开书籍页
  → fetch story_bible.md 原文
  → 按 markdown heading 解析各段落
  → 缓存到 store（bookSummary: { world, protagonist, cast }）

bookDataVersion 变化时
  → 清除缓存，重新 fetch + 解析
```

## 响应式

- `≥1024px`：侧边栏常驻，宽 300px
- `<1024px`：隐藏，ChatPage 右上角显示唤出按钮，overlay 模式覆盖主区域

## Store 变更

`useChatStore` create slice 新增字段：

```typescript
bookDataVersion: number;              // 操作完成后 ++，触发面板 refetch
sidebarView: "panel" | "artifact";    // 面板模式切换
artifactFile: string | null;          // 当前查看的文件名（如 "story_bible.md"）
bookSummary: {                        // story_bible 解析缓存
  world: string;
  protagonist: string;
  cast: string;
} | null;
```

## 刷新机制

- **Store 驱动**：`handleCreateBook`、写章节、审批等操作完成后 `bookDataVersion++`
- 侧边栏订阅 `bookDataVersion`，变化时 refetch 所有 section 数据
- **路由驱动**：`nav.toBook(id)` 切换 bookId 时重新挂载（作为兜底）

## SSE 事件对照

| SSE 事件 | 面板响应 |
|----------|----------|
| `book:creating` | 执行 section 出现，显示 initBook 预定义步骤 |
| `log` (stage.changed) | 匹配步骤名，点亮对应行 |
| `book:created` | 执行 section 全部完成，`bookDataVersion++` |
| `write:start` | 执行 section 切换为 writeNextChapter 步骤 |
| `write:complete` | 全部完成，`bookDataVersion++`，章节列表刷新 |
| `draft:delta` | 不影响面板（只影响对话流） |
