# 右侧侧边栏 + Artifacts 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 FloatingPanels 浮层替换为常驻右侧侧边栏，展示 pipeline 进度、核心文件、解析摘要、章节列表，点击文件进入 artifacts 预览。

**Architecture:** 新建 `BookSidebar` 组件替换 `FloatingPanels + BookInfoPanel`，内含 5 个 section + artifacts 模式。Store 增加 sidebar 状态字段，SSE 驱动 pipeline 进度，`bookDataVersion` 驱动刷新。

**Tech Stack:** React, Zustand (useChatStore), Tailwind CSS, Streamdown (markdown 渲染), SSE EventSource

**设计 spec:** `docs/infra/studio-sidebar-artifacts.md`

---

### Task 1: Store 扩展 — sidebar 状态字段

**Files:**
- Modify: `packages/studio/src/store/chat/types.ts`
- Modify: `packages/studio/src/store/chat/slices/create/initialState.ts`
- Modify: `packages/studio/src/store/chat/slices/create/action.ts`

- [ ] **Step 1: 更新类型定义**

在 `types.ts` 的 `CreateState` 中添加字段：

```typescript
export interface BookSummary {
  world: string;
  protagonist: string;
  cast: string;
}

export interface CreateState {
  pendingBookArgs: Record<string, unknown> | null;
  bookCreating: boolean;
  createProgress: string;
  // sidebar
  bookDataVersion: number;
  sidebarView: "panel" | "artifact";
  artifactFile: string | null;
  bookSummary: BookSummary | null;
}
```

在 `CreateActions` 中添加：

```typescript
export interface CreateActions {
  setPendingBookArgs: (args: Record<string, unknown> | null) => void;
  setBookCreating: (creating: boolean) => void;
  setCreateProgress: (progress: string) => void;
  handleCreateBook: (activeBookId?: string) => Promise<string | null>;
  // sidebar
  bumpBookDataVersion: () => void;
  openArtifact: (file: string) => void;
  closeArtifact: () => void;
  setBookSummary: (summary: BookSummary | null) => void;
}
```

- [ ] **Step 2: 更新 initialState**

在 `slices/create/initialState.ts`：

```typescript
export const initialCreateState: CreateState = {
  pendingBookArgs: null,
  bookCreating: false,
  createProgress: "",
  bookDataVersion: 0,
  sidebarView: "panel",
  artifactFile: null,
  bookSummary: null,
};
```

- [ ] **Step 3: 更新 actions**

在 `slices/create/action.ts` 添加新 action：

```typescript
bumpBookDataVersion: () => set((s) => ({ bookDataVersion: s.bookDataVersion + 1 })),

openArtifact: (file) => set({ sidebarView: "artifact", artifactFile: file }),

closeArtifact: () => set({ sidebarView: "panel", artifactFile: null }),

setBookSummary: (summary) => set({ bookSummary: summary }),
```

在 `handleCreateBook` 的 try 块中，成功创建后调用 `bumpBookDataVersion`：

```typescript
handleCreateBook: async (activeBookId) => {
  if (!get().pendingBookArgs) return null;
  set({ bookCreating: true });
  try {
    const data = await fetchJson<AgentResponse>("/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: "/create", activeBookId }),
    });
    const newBookId = data.session?.activeBookId ?? null;
    if (newBookId) get().bumpBookDataVersion();
    return newBookId;
  } catch (e) {
    get().addErrorMessage(e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    set({ bookCreating: false });
  }
},
```

- [ ] **Step 4: 更新 barrel export**

在 `store/chat/index.ts` 补充导出：

```typescript
export type { ChatStore, Message, ToolCall, BookSummary } from "./types";
```

- [ ] **Step 5: 验证构建**

Run: `pnpm --filter @actalk/inkos-studio build 2>&1 | tail -5`
Expected: 构建成功，无 TS 错误

- [ ] **Step 6: Commit**

```bash
git add packages/studio/src/store/chat/
git commit -m "feat(studio): add sidebar state fields to chat store"
```

---

### Task 2: API 白名单 — 补充 foundation 文件

**Files:**
- Modify: `packages/studio/src/api/server.ts`

当前 `TRUTH_FILES` 白名单缺少 4 个 initBook 创建的文件：`story_bible.md`、`volume_outline.md`、`current_state.md`、`pending_hooks.md`。

- [ ] **Step 1: 找到 TRUTH_FILES 定义**

位于 `server.ts` 约 276-282 行，搜索 `TRUTH_FILES`。

- [ ] **Step 2: 添加缺失文件**

在 `TRUTH_FILES` 数组中添加：

```typescript
"story_bible.md",
"volume_outline.md",
"current_state.md",
"pending_hooks.md",
```

- [ ] **Step 3: 验证构建**

Run: `pnpm --filter @actalk/inkos-studio build 2>&1 | tail -5`

- [ ] **Step 4: Commit**

```bash
git add packages/studio/src/api/server.ts
git commit -m "fix(studio): add missing foundation files to truth whitelist"
```

---

### Task 3: 布局重构 — FloatingPanels → 侧边栏

**Files:**
- Modify: `packages/studio/src/App.tsx`
- Create: `packages/studio/src/components/chat/BookSidebar.tsx`
- Delete: `packages/studio/src/components/chat/FloatingPanels.tsx` (被替换)

- [ ] **Step 1: 创建 BookSidebar 空壳**

创建 `packages/studio/src/components/chat/BookSidebar.tsx`：

```tsx
import { useState } from "react";
import type { Theme } from "../../hooks/use-theme";
import type { TFunction } from "../../hooks/use-i18n";
import type { SSEMessage } from "../../hooks/use-sse";
import { useChatStore } from "../../store/chat";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { cn } from "../../lib/utils";

export interface BookSidebarProps {
  readonly bookId: string;
  readonly theme: Theme;
  readonly t: TFunction;
  readonly sse: { messages: ReadonlyArray<SSEMessage>; connected: boolean };
}

export function BookSidebar({ bookId, theme, t, sse }: BookSidebarProps) {
  const sidebarView = useChatStore((s) => s.sidebarView);

  return (
    <aside className="hidden lg:flex w-[300px] shrink-0 flex-col border-l border-border/20 bg-background/30 backdrop-blur-sm overflow-y-auto">
      {sidebarView === "artifact" ? (
        <ArtifactView bookId={bookId} />
      ) : (
        <PanelView bookId={bookId} theme={theme} t={t} sse={sse} />
      )}
    </aside>
  );
}

function PanelView({ bookId, theme, t, sse }: BookSidebarProps) {
  return (
    <div className="flex flex-col gap-2 p-3">
      <p className="text-xs text-muted-foreground">侧边栏占位 — bookId: {bookId}</p>
    </div>
  );
}

function ArtifactView({ bookId }: { readonly bookId: string }) {
  const artifactFile = useChatStore((s) => s.artifactFile);
  const closeArtifact = useChatStore((s) => s.closeArtifact);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/20">
        <button onClick={closeArtifact} className="text-muted-foreground hover:text-foreground transition-colors">
          ←
        </button>
        <span className="text-sm font-medium truncate">{artifactFile}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <p className="text-xs text-muted-foreground">Artifacts 占位</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 修改 App.tsx 布局**

将 `FloatingPanels + BookInfoPanel` 替换为 `BookSidebar`。修改 `route.page === "book"` 分支：

```tsx
{(route.page === "book" || route.page === "book-create") && (
  <div className="flex flex-1 min-w-0">
    <ChatPage
      activeBookId={route.page === "book" ? route.bookId : undefined}
      nav={nav}
      theme={theme}
      t={t}
      sse={sse}
    />
    {route.page === "book" && (
      <BookSidebar bookId={route.bookId} theme={theme} t={t} sse={sse} />
    )}
  </div>
)}
```

更新 import：移除 `FloatingPanels`、`BookInfoPanel`，添加 `BookSidebar`。

- [ ] **Step 3: 添加移动端唤出按钮**

在 `BookSidebar.tsx` 添加响应式 overlay 逻辑：

```tsx
export function BookSidebarToggle({ bookId, theme, t, sse }: BookSidebarProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* 移动端唤出按钮 */}
      <button
        onClick={() => setOpen(true)}
        className="fixed right-3 top-[72px] z-20 lg:hidden w-8 h-8 rounded-lg bg-card border border-border/40 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
      >
        <PanelRightOpen size={14} />
      </button>

      {/* Overlay */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
          <aside
            className="absolute right-0 top-0 h-full w-[300px] bg-background border-l border-border/20 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/20">
              <span className="text-xs font-medium text-muted-foreground">书籍信息</span>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <PanelRightClose size={14} />
              </button>
            </div>
            <PanelView bookId={bookId} theme={theme} t={t} sse={sse} />
          </aside>
        </div>
      )}
    </>
  );
}
```

在 App.tsx 中 ChatPage 下方添加：

```tsx
{route.page === "book" && (
  <BookSidebarToggle bookId={route.bookId} theme={theme} t={t} sse={sse} />
)}
```

- [ ] **Step 4: 删除旧文件**

删除 `packages/studio/src/components/chat/FloatingPanels.tsx`。
保留 `BookInfoPanel.tsx` 暂不删除（后续 task 会迁移逻辑后删除）。

- [ ] **Step 5: 验证构建**

Run: `pnpm --filter @actalk/inkos-studio build 2>&1 | tail -5`

- [ ] **Step 6: Commit**

```bash
git add packages/studio/src/App.tsx packages/studio/src/components/chat/BookSidebar.tsx
git rm packages/studio/src/components/chat/FloatingPanels.tsx
git commit -m "feat(studio): replace floating panels with sidebar layout"
```

---

### Task 4: 执行 Section — Pipeline 进度

**Files:**
- Create: `packages/studio/src/components/sidebar/ProgressSection.tsx`

- [ ] **Step 1: 定义 pipeline 步骤常量**

```tsx
const INIT_BOOK_STEPS = [
  "生成基础设定",
  "保存书籍配置",
  "写入基础设定文件",
  "初始化控制文档",
  "创建初始快照",
] as const;

const WRITE_CHAPTER_STEPS = [
  "准备章节输入",
  "撰写章节草稿",
  "落盘最终章节",
  "生成最终真相文件",
  "校验真相文件变更",
  "同步记忆索引",
  "更新章节索引与快照",
] as const;
```

- [ ] **Step 2: 实现 ProgressSection 组件**

```tsx
import { useEffect, useState, useMemo } from "react";
import type { SSEMessage } from "../../hooks/use-sse";
import { Loader2, Check } from "lucide-react";
import { cn } from "../../lib/utils";

interface ProgressSectionProps {
  readonly sse: { messages: ReadonlyArray<SSEMessage>; connected: boolean };
}

type StepStatus = "pending" | "active" | "done";

export function ProgressSection({ sse }: ProgressSectionProps) {
  const [operation, setOperation] = useState<"idle" | "init" | "write">("idle");
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const [activeStep, setActiveStep] = useState<string | null>(null);

  // 监听 SSE 事件确定当前操作和步骤
  useEffect(() => {
    const latest = sse.messages;
    for (const msg of latest) {
      if (msg.event === "book:creating") {
        setOperation("init");
        setCompletedSteps(new Set());
        setActiveStep(null);
      } else if (msg.event === "write:start") {
        setOperation("write");
        setCompletedSteps(new Set());
        setActiveStep(null);
      } else if (msg.event === "book:created" || msg.event === "write:complete") {
        setOperation("idle");
      } else if (msg.event === "log") {
        const data = msg.data as { message?: string } | null;
        const message = data?.message;
        if (message) {
          setCompletedSteps((prev) => {
            if (activeStep && !prev.has(activeStep)) {
              const next = new Set(prev);
              next.add(activeStep);
              return next;
            }
            return prev;
          });
          setActiveStep(message);
        }
      }
    }
  }, [sse.messages]);

  const steps = operation === "init" ? INIT_BOOK_STEPS
    : operation === "write" ? WRITE_CHAPTER_STEPS
    : null;

  if (!steps) return null;

  return (
    <SidebarCard title="执行">
      <ul className="space-y-2">
        {steps.map((step, i) => {
          const status: StepStatus = completedSteps.has(step) ? "done"
            : activeStep === step ? "active"
            : "pending";
          return (
            <li key={step} className="flex items-center gap-2.5">
              <StepIndicator index={i + 1} status={status} />
              <span className={cn(
                "text-xs",
                status === "done" && "text-muted-foreground",
                status === "active" && "text-foreground font-medium",
                status === "pending" && "text-muted-foreground/50",
              )}>
                {step}
              </span>
            </li>
          );
        })}
      </ul>
    </SidebarCard>
  );
}

function StepIndicator({ index, status }: { index: number; status: StepStatus }) {
  if (status === "done") {
    return (
      <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center shrink-0">
        <Check size={12} className="text-primary-foreground" strokeWidth={2.5} />
      </div>
    );
  }
  if (status === "active") {
    return (
      <div className="w-5 h-5 rounded-full border-2 border-primary flex items-center justify-center shrink-0">
        <Loader2 size={10} className="text-primary animate-spin" />
      </div>
    );
  }
  return (
    <div className="w-5 h-5 rounded-full border border-border/60 flex items-center justify-center shrink-0">
      <span className="text-[10px] text-muted-foreground/50">{index}</span>
    </div>
  );
}
```

- [ ] **Step 3: 创建共享的 SidebarCard 组件**

创建 `packages/studio/src/components/sidebar/SidebarCard.tsx`：

```tsx
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

interface SidebarCardProps {
  readonly title: string;
  readonly defaultOpen?: boolean;
  readonly children: React.ReactNode;
  readonly actions?: React.ReactNode;
}

export function SidebarCard({ title, defaultOpen = true, children, actions }: SidebarCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl bg-card/60">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2.5"
      >
        <span className="text-sm font-medium text-foreground">{title}</span>
        <div className="flex items-center gap-1.5">
          {actions}
          <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </div>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}
```

- [ ] **Step 4: 验证构建**

Run: `pnpm --filter @actalk/inkos-studio build 2>&1 | tail -5`

- [ ] **Step 5: Commit**

```bash
git add packages/studio/src/components/sidebar/
git commit -m "feat(studio): add ProgressSection with pipeline step tracking"
```

---

### Task 5: 核心文件 Section — Foundation 文件列表

**Files:**
- Create: `packages/studio/src/components/sidebar/FoundationSection.tsx`

- [ ] **Step 1: 定义文件名映射**

```tsx
const FOUNDATION_FILES: ReadonlyArray<{ file: string; label: string }> = [
  { file: "story_bible.md", label: "世界观设定" },
  { file: "volume_outline.md", label: "卷纲规划" },
  { file: "book_rules.md", label: "叙事规则" },
  { file: "current_state.md", label: "状态卡" },
  { file: "pending_hooks.md", label: "伏笔池" },
  { file: "subplot_board.md", label: "支线进度" },
  { file: "emotional_arcs.md", label: "情感弧线" },
  { file: "character_matrix.md", label: "角色矩阵" },
];
```

- [ ] **Step 2: 实现 FoundationSection 组件**

```tsx
import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { useChatStore } from "../../store/chat";
import { fetchJson } from "../../hooks/use-api";
import { SidebarCard } from "./SidebarCard";
import { cn } from "../../lib/utils";

interface FoundationSectionProps {
  readonly bookId: string;
}

interface TruthFileInfo {
  name: string;
  size: number;
}

export function FoundationSection({ bookId }: FoundationSectionProps) {
  const [files, setFiles] = useState<ReadonlyArray<TruthFileInfo>>([]);
  const openArtifact = useChatStore((s) => s.openArtifact);
  const bookDataVersion = useChatStore((s) => s.bookDataVersion);

  useEffect(() => {
    fetchJson<{ files: TruthFileInfo[] }>(`/books/${bookId}/truth`)
      .then((data) => setFiles(data.files))
      .catch(() => setFiles([]));
  }, [bookId, bookDataVersion]);

  const available = FOUNDATION_FILES.filter((f) =>
    files.some((tf) => tf.name === f.file),
  );

  if (available.length === 0) return null;

  return (
    <SidebarCard title="核心文件">
      <ul className="space-y-1">
        {available.map((item) => (
          <li key={item.file}>
            <button
              onClick={() => openArtifact(item.file)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
            >
              <FileText size={14} className="shrink-0 text-muted-foreground/60" />
              <span className="truncate">{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </SidebarCard>
  );
}
```

- [ ] **Step 3: 验证构建 + Commit**

```bash
pnpm --filter @actalk/inkos-studio build 2>&1 | tail -5
git add packages/studio/src/components/sidebar/FoundationSection.tsx
git commit -m "feat(studio): add FoundationSection with Chinese file names"
```

---

### Task 6: 摘要 Sections — 世界观 + 角色

**Files:**
- Create: `packages/studio/src/components/sidebar/SummarySection.tsx`

- [ ] **Step 1: 实现 story_bible 解析逻辑**

```tsx
import { useEffect } from "react";
import { useChatStore } from "../../store/chat";
import type { BookSummary } from "../../store/chat";
import { fetchJson } from "../../hooks/use-api";
import { SidebarCard } from "./SidebarCard";

function parseStoryBible(content: string): BookSummary {
  const sections = content.split(/^##\s+/m);
  let world = "";
  let protagonist = "";
  let cast = "";

  for (const section of sections) {
    const lower = section.toLowerCase();
    if (/^0?1[_\s]|世界观|world/i.test(section)) {
      world = section.replace(/^[^\n]+\n/, "").trim().split("\n\n")[0] ?? "";
    } else if (/^0?2[_\s]|主角|protagonist/i.test(section)) {
      protagonist = section.replace(/^[^\n]+\n/, "").trim().split("\n\n")[0] ?? "";
    } else if (/^0?3[_\s]|配角|supporting|cast/i.test(section)) {
      cast = section.replace(/^[^\n]+\n/, "").trim().split("\n\n")[0] ?? "";
    }
  }

  return { world, protagonist, cast };
}
```

- [ ] **Step 2: 实现 SummarySection 组件**

```tsx
interface SummarySectionProps {
  readonly bookId: string;
}

export function SummarySection({ bookId }: SummarySectionProps) {
  const summary = useChatStore((s) => s.bookSummary);
  const setBookSummary = useChatStore((s) => s.setBookSummary);
  const bookDataVersion = useChatStore((s) => s.bookDataVersion);

  useEffect(() => {
    setBookSummary(null);
    fetchJson<{ content: string | null }>(`/books/${bookId}/truth/story_bible.md`)
      .then((data) => {
        if (data.content) setBookSummary(parseStoryBible(data.content));
      })
      .catch(() => {});
  }, [bookId, bookDataVersion, setBookSummary]);

  if (!summary) return null;

  return (
    <>
      {summary.world && (
        <SidebarCard title="世界观">
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">
            {summary.world}
          </p>
        </SidebarCard>
      )}
      {(summary.protagonist || summary.cast) && (
        <SidebarCard title="角色">
          {summary.protagonist && (
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
              {summary.protagonist}
            </p>
          )}
          {summary.cast && (
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3 mt-2">
              {summary.cast}
            </p>
          )}
        </SidebarCard>
      )}
    </>
  );
}
```

- [ ] **Step 3: 验证构建 + Commit**

```bash
pnpm --filter @actalk/inkos-studio build 2>&1 | tail -5
git add packages/studio/src/components/sidebar/SummarySection.tsx
git commit -m "feat(studio): add SummarySection parsing story_bible.md"
```

---

### Task 7: 章节 Section

**Files:**
- Create: `packages/studio/src/components/sidebar/ChaptersSection.tsx`

- [ ] **Step 1: 实现 ChaptersSection**

```tsx
import { useEffect, useState } from "react";
import { fetchJson } from "../../hooks/use-api";
import { useChatStore } from "../../store/chat";
import { SidebarCard } from "./SidebarCard";
import { cn } from "../../lib/utils";

interface ChapterMeta {
  number: number;
  title: string;
  status: string;
  wordCount: number;
}

const STATUS_INDICATOR: Record<string, { symbol: string; color: string }> = {
  approved: { symbol: "✓", color: "text-emerald-500" },
  "ready-for-review": { symbol: "◆", color: "text-amber-500" },
  drafted: { symbol: "○", color: "text-muted-foreground" },
  "needs-revision": { symbol: "✕", color: "text-destructive" },
  imported: { symbol: "◇", color: "text-blue-500" },
};

interface ChaptersSectionProps {
  readonly bookId: string;
  readonly isZh: boolean;
}

export function ChaptersSection({ bookId, isZh }: ChaptersSectionProps) {
  const [chapters, setChapters] = useState<ReadonlyArray<ChapterMeta>>([]);
  const bookDataVersion = useChatStore((s) => s.bookDataVersion);

  useEffect(() => {
    fetchJson<{ chapters: ChapterMeta[] }>(`/books/${bookId}`)
      .then((data) => setChapters(data.chapters))
      .catch(() => setChapters([]));
  }, [bookId, bookDataVersion]);

  return (
    <SidebarCard title={isZh ? "章节" : "Chapters"}>
      {chapters.length === 0 ? (
        <p className="text-xs text-muted-foreground/50 italic">
          {isZh ? "暂无章节" : "No chapters"}
        </p>
      ) : (
        <ul className="space-y-1 max-h-52 overflow-y-auto">
          {chapters.map((ch) => {
            const ind = STATUS_INDICATOR[ch.status] ?? { symbol: "○", color: "text-muted-foreground" };
            return (
              <li key={ch.number} className="flex items-center gap-2 py-0.5 text-xs text-muted-foreground">
                <span className={cn("text-[10px] shrink-0", ind.color)}>{ind.symbol}</span>
                <span className="truncate flex-1">
                  {String(ch.number).padStart(2, "0")} {ch.title || (isZh ? `第${ch.number}章` : `Chapter ${ch.number}`)}
                </span>
                <span className="tabular-nums text-[10px] text-muted-foreground/50 shrink-0">
                  {(ch.wordCount ?? 0).toLocaleString()}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </SidebarCard>
  );
}
```

- [ ] **Step 2: 验证构建 + Commit**

```bash
pnpm --filter @actalk/inkos-studio build 2>&1 | tail -5
git add packages/studio/src/components/sidebar/ChaptersSection.tsx
git commit -m "feat(studio): add ChaptersSection with status indicators"
```

---

### Task 8: Artifacts 视图 — Markdown 文件预览

**Files:**
- Modify: `packages/studio/src/components/chat/BookSidebar.tsx` — 替换 ArtifactView 占位

- [ ] **Step 1: 实现 ArtifactView**

替换 BookSidebar.tsx 中的 ArtifactView 占位：

```tsx
import { useEffect, useState } from "react";
import { fetchJson } from "../../hooks/use-api";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Streamdown } from "streamdown";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";

const FOUNDATION_LABELS: Record<string, string> = {
  "story_bible.md": "世界观设定",
  "volume_outline.md": "卷纲规划",
  "book_rules.md": "叙事规则",
  "current_state.md": "状态卡",
  "pending_hooks.md": "伏笔池",
  "subplot_board.md": "支线进度",
  "emotional_arcs.md": "情感弧线",
  "character_matrix.md": "角色矩阵",
};

const artifactPlugins = { cjk, code };

function ArtifactView({ bookId }: { readonly bookId: string }) {
  const artifactFile = useChatStore((s) => s.artifactFile);
  const closeArtifact = useChatStore((s) => s.closeArtifact);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!artifactFile) return;
    setLoading(true);
    fetchJson<{ content: string | null }>(`/books/${bookId}/truth/${artifactFile}`)
      .then((data) => setContent(data.content ?? ""))
      .catch(() => setContent(null))
      .finally(() => setLoading(false));
  }, [bookId, artifactFile]);

  const label = artifactFile ? FOUNDATION_LABELS[artifactFile] ?? artifactFile : "";

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/20 shrink-0">
        <button
          onClick={closeArtifact}
          className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
        >
          <ArrowLeft size={14} />
        </button>
        <span className="text-sm font-medium truncate">{label}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={16} className="text-muted-foreground animate-spin" />
          </div>
        ) : content === null ? (
          <p className="text-xs text-muted-foreground/50 italic">文件不存在</p>
        ) : (
          <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-sm leading-7">
            <Streamdown plugins={artifactPlugins}>{content}</Streamdown>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 验证构建 + Commit**

```bash
pnpm --filter @actalk/inkos-studio build 2>&1 | tail -5
git add packages/studio/src/components/chat/BookSidebar.tsx
git commit -m "feat(studio): implement ArtifactView with Streamdown rendering"
```

---

### Task 9: 组装侧边栏 — PanelView 接入所有 section

**Files:**
- Modify: `packages/studio/src/components/chat/BookSidebar.tsx`

- [ ] **Step 1: 替换 PanelView 占位**

```tsx
import { ProgressSection } from "../sidebar/ProgressSection";
import { FoundationSection } from "../sidebar/FoundationSection";
import { SummarySection } from "../sidebar/SummarySection";
import { ChaptersSection } from "../sidebar/ChaptersSection";

function PanelView({ bookId, theme, t, sse }: BookSidebarProps) {
  const isZh = t("nav.connected") === "\u5DF2\u8FDE\u63A5";

  return (
    <div className="flex flex-col gap-2 p-3">
      <ProgressSection sse={sse} />
      <FoundationSection bookId={bookId} />
      <SummarySection bookId={bookId} />
      <ChaptersSection bookId={bookId} isZh={isZh} />
    </div>
  );
}
```

- [ ] **Step 2: 删除旧 BookInfoPanel**

确认所有功能已迁移后，删除 `packages/studio/src/components/chat/BookInfoPanel.tsx`。
从 App.tsx 移除 import（如果 Task 3 中已移除则跳过）。

- [ ] **Step 3: 验证构建 + Commit**

```bash
pnpm --filter @actalk/inkos-studio build 2>&1 | tail -5
git rm packages/studio/src/components/chat/BookInfoPanel.tsx
git add packages/studio/src/components/chat/BookSidebar.tsx
git commit -m "feat(studio): wire up all sidebar sections, remove BookInfoPanel"
```

---

### Task 10: 端到端验证

- [ ] **Step 1: 全量构建**

```bash
pnpm build 2>&1 | tail -10
```

- [ ] **Step 2: 启动 dev server 手动验证**

```bash
pnpm dev
```

检查清单：
- 打开书籍页 → 右侧侧边栏可见（≥1024px）
- 核心文件列表展示 8 个中文文件名
- 点击文件 → 侧边栏切换为 artifacts，markdown 渲染正确
- 点击 ← → 返回面板模式
- 世界观 / 角色摘要从 story_bible.md 解析
- 章节列表展示（或"暂无章节"）
- 窄屏 → 侧边栏隐藏，右上角按钮唤出 overlay
- 创建新书 → 执行 section 流式展示 pipeline 步骤
- 创建完成 → 核心文件列表、摘要自动刷新

- [ ] **Step 3: 最终 Commit（如有修复）**

```bash
git add -A
git commit -m "fix(studio): sidebar polish from e2e testing"
```
