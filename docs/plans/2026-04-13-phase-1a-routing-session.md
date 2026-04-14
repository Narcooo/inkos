# Phase 1a: URL Hash 路由 + Per-book Session 隔离

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复刷新丢失路由和跨书消息混乱，实现 URL hash 持久化路由和每本书独立 session 文件。

**Architecture:** 用 `window.location.hash` 驱动路由替换 `useState<Route>`；将 `.inkos/session.json` 拆为全局状态 + `.inkos/sessions/{sessionId}.json` 独立 session 文件；前端 store 按 bookId 加载对应 session。

**Tech Stack:** React, Zustand, Zod, Hono, nanoid

**设计 spec:** `docs/infra/studio-routing-and-session.md`

---

## File Structure

```
packages/core/src/interaction/
├── session.ts                    ← 修改：新增 BookSession 类型
├── book-session-store.ts         ← 新建：per-book session CRUD
├── project-session-store.ts      ← 修改：全局 session 简化
├── project-control.ts            ← 修改：使用 BookSession
└── runtime.ts                    ← 修改：返回值包含 sessionId

packages/studio/src/
├── hooks/use-hash-route.ts       ← 新建：hash 路由 hook
├── App.tsx                       ← 修改：useHashRoute 替换 useState
├── api/server.ts                 ← 修改：新增 session API 端点
└── store/chat/
    ├── types.ts                  ← 修改：新增 currentSessionId
    ├── slices/message/action.ts  ← 修改：loadSession(bookId)
    └── slices/message/initialState.ts ← 修改：新增字段默认值
```

---

### Task 1: Core — BookSession 类型定义

**Files:**
- Modify: `packages/core/src/interaction/session.ts`

- [ ] **Step 1: 添加 BookSession schema**

在 `session.ts` 的 `InteractionSessionSchema` 定义之后添加：

```typescript
export const BookSessionSchema = z.object({
  sessionId: z.string().min(1),
  bookId: z.string().nullable(),
  messages: z.array(InteractionMessageSchema).default([]),
  creationDraft: BookCreationDraftSchema.optional(),
  draftRounds: z.array(DraftRoundSchema).default([]),
  events: z.array(InteractionEventSchema).default([]),
  currentExecution: ExecutionStateSchema.optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type BookSession = z.infer<typeof BookSessionSchema>;
```

添加 `GlobalSession` schema：

```typescript
export const GlobalSessionSchema = z.object({
  activeBookId: z.string().min(1).optional(),
  automationMode: AutomationModeSchema.default("semi"),
});

export type GlobalSession = z.infer<typeof GlobalSessionSchema>;
```

添加辅助函数：

```typescript
export function createBookSession(bookId: string | null): BookSession {
  const now = Date.now();
  return {
    sessionId: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    bookId,
    messages: [],
    draftRounds: [],
    events: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function appendBookSessionMessage(
  session: BookSession,
  message: InteractionMessage,
): BookSession {
  return {
    ...session,
    messages: [...session.messages, message].sort((a, b) => a.timestamp - b.timestamp),
    updatedAt: Date.now(),
  };
}
```

- [ ] **Step 2: 导出新类型**

在 `packages/core/src/interaction/index.ts` 确认导出：

```typescript
export type { BookSession, GlobalSession } from "./session.js";
export { BookSessionSchema, GlobalSessionSchema, createBookSession, appendBookSessionMessage } from "./session.js";
```

- [ ] **Step 3: 验证构建**

Run: `pnpm --filter @actalk/inkos-core build 2>&1 | tail -5`

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/interaction/session.ts packages/core/src/interaction/index.ts
git commit -m "feat(core): add BookSession and GlobalSession types"
```

---

### Task 2: Core — BookSession 存储层

**Files:**
- Create: `packages/core/src/interaction/book-session-store.ts`
- Modify: `packages/core/src/interaction/project-session-store.ts`

- [ ] **Step 1: 创建 book-session-store.ts**

```typescript
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BookSessionSchema, createBookSession } from "./session.js";
import type { BookSession } from "./session.js";

const SESSIONS_DIR = ".inkos/sessions";

function sessionsDir(projectRoot: string): string {
  return join(projectRoot, SESSIONS_DIR);
}

function sessionPath(projectRoot: string, sessionId: string): string {
  return join(sessionsDir(projectRoot), `${sessionId}.json`);
}

export async function loadBookSession(
  projectRoot: string,
  sessionId: string,
): Promise<BookSession | null> {
  try {
    const raw = await readFile(sessionPath(projectRoot, sessionId), "utf-8");
    return BookSessionSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function persistBookSession(
  projectRoot: string,
  session: BookSession,
): Promise<void> {
  const dir = sessionsDir(projectRoot);
  await mkdir(dir, { recursive: true });
  await writeFile(
    sessionPath(projectRoot, session.sessionId),
    JSON.stringify(session, null, 2),
  );
}

export async function listBookSessions(
  projectRoot: string,
  bookId: string | null,
): Promise<ReadonlyArray<BookSession>> {
  const dir = sessionsDir(projectRoot);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const sessions: BookSession[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(dir, file), "utf-8");
      const session = BookSessionSchema.parse(JSON.parse(raw));
      if (session.bookId === bookId) {
        sessions.push(session);
      }
    } catch {
      // skip corrupt files
    }
  }

  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function findOrCreateBookSession(
  projectRoot: string,
  bookId: string | null,
): Promise<BookSession> {
  const existing = await listBookSessions(projectRoot, bookId);
  if (existing.length > 0) return existing[0];
  const session = createBookSession(bookId);
  await persistBookSession(projectRoot, session);
  return session;
}
```

- [ ] **Step 2: 简化 project-session-store.ts**

在 `project-session-store.ts` 中，保留现有 `loadProjectSession` 和 `persistProjectSession`（TUI 还在用），新增全局 session 的简化读写：

```typescript
import type { GlobalSession } from "./session.js";
import { GlobalSessionSchema } from "./session.js";

export async function loadGlobalSession(projectRoot: string): Promise<GlobalSession> {
  try {
    const raw = await readFile(join(projectRoot, SESSION_DIR, SESSION_FILE), "utf-8");
    const data = JSON.parse(raw);
    return GlobalSessionSchema.parse({
      activeBookId: data.activeBookId,
      automationMode: data.automationMode ?? "semi",
    });
  } catch {
    return { automationMode: "semi" };
  }
}

export async function persistGlobalSession(
  projectRoot: string,
  global: GlobalSession,
): Promise<void> {
  const dir = join(projectRoot, SESSION_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, SESSION_FILE), JSON.stringify(global, null, 2));
}
```

- [ ] **Step 3: 导出**

在 `packages/core/src/interaction/index.ts` 添加：

```typescript
export { loadBookSession, persistBookSession, listBookSessions, findOrCreateBookSession } from "./book-session-store.js";
export { loadGlobalSession, persistGlobalSession } from "./project-session-store.js";
```

- [ ] **Step 4: 验证构建**

Run: `pnpm --filter @actalk/inkos-core build 2>&1 | tail -5`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/interaction/book-session-store.ts packages/core/src/interaction/project-session-store.ts packages/core/src/interaction/index.ts
git commit -m "feat(core): add per-book session storage layer"
```

---

### Task 3: Studio — Session API 端点

**Files:**
- Modify: `packages/studio/src/api/server.ts`

- [ ] **Step 1: 添加 session API 端点**

在 `server.ts` 中找到现有的 `GET /api/interaction/session` 端点附近，添加新端点：

```typescript
import { findOrCreateBookSession, listBookSessions, loadBookSession, persistBookSession } from "@actalk/inkos-core";

// 获取某本书的所有 session
app.get("/api/sessions", async (c) => {
  const bookId = c.req.query("bookId") ?? null;
  const sessions = await listBookSessions(root, bookId === "null" ? null : bookId);
  return c.json({ sessions: sessions.map((s) => ({
    sessionId: s.sessionId,
    bookId: s.bookId,
    messageCount: s.messages.length,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  })) });
});

// 加载某个 session 的完整数据
app.get("/api/sessions/:sessionId", async (c) => {
  const session = await loadBookSession(root, c.req.param("sessionId"));
  if (!session) return c.json({ error: "Session not found" }, 404);
  return c.json({ session });
});

// 创建新 session
app.post("/api/sessions", async (c) => {
  const body = await c.req.json<{ bookId?: string | null }>();
  const bookId = body.bookId ?? null;
  const session = await findOrCreateBookSession(root, bookId);
  return c.json({ session });
});
```

- [ ] **Step 2: 修改 POST /api/agent 使用 BookSession**

找到现有的 `POST /api/agent` 端点。当前它调用 `processProjectInteractionInput`，这会读写旧的单一 session.json。

在 agent 端点中，改为先获取/创建 BookSession，然后将消息写入该 session：

```typescript
app.post("/api/agent", async (c) => {
  const { instruction, activeBookId, sessionId } = await c.req.json<{
    instruction: string;
    activeBookId?: string;
    sessionId?: string;
  }>();

  // 加载或创建 per-book session
  let bookSession: BookSession;
  if (sessionId) {
    bookSession = await loadBookSession(root, sessionId) ?? await findOrCreateBookSession(root, activeBookId ?? null);
  } else {
    bookSession = await findOrCreateBookSession(root, activeBookId ?? null);
  }

  // ... 继续现有的 agent 处理逻辑 ...
  // processProjectInteractionInput 仍然使用旧 session（保持 TUI 兼容）
  // 但把用户消息和助手回复也写入 bookSession

  const result = await processProjectInteractionInput({ projectRoot: root, input: instruction, tools, activeBookId });

  // 同步消息到 bookSession
  const userMsg = { role: "user" as const, content: instruction, timestamp: Date.now() };
  const assistantMsg = { role: "assistant" as const, content: result.responseText ?? "", timestamp: Date.now() + 1 };
  bookSession = appendBookSessionMessage(bookSession, userMsg);
  bookSession = appendBookSessionMessage(bookSession, assistantMsg);
  bookSession = { ...bookSession, currentExecution: result.session?.currentExecution };
  if (result.session?.creationDraft) {
    bookSession = { ...bookSession, creationDraft: result.session.creationDraft };
  }
  await persistBookSession(root, bookSession);

  return c.json({
    response: result.responseText,
    details: result.details,
    session: { ...result.session, sessionId: bookSession.sessionId },
  });
});
```

注意：这是**双写策略**——旧 session.json 继续工作（TUI 兼容），同时写入新的 per-book session。

- [ ] **Step 3: 验证构建**

Run: `pnpm --filter @actalk/inkos-studio build 2>&1 | tail -5`

- [ ] **Step 4: Commit**

```bash
git add packages/studio/src/api/server.ts
git commit -m "feat(studio): add per-book session API endpoints"
```

---

### Task 4: Frontend — useHashRoute hook

**Files:**
- Create: `packages/studio/src/hooks/use-hash-route.ts`

- [ ] **Step 1: 实现 hash 路由 hook**

```typescript
import { useState, useEffect, useCallback } from "react";

export type HashRoute =
  | { page: "dashboard" }
  | { page: "book"; bookId: string }
  | { page: "book-create" }
  | { page: "config" }
  // 以下页面不在 hash 里，但从内部导航进入
  | { page: "chapter"; bookId: string; chapterNumber: number }
  | { page: "analytics"; bookId: string }
  | { page: "truth"; bookId: string }
  | { page: "daemon" }
  | { page: "logs" }
  | { page: "genres" }
  | { page: "style" }
  | { page: "import" }
  | { page: "radar" }
  | { page: "doctor" };

function parseHash(hash: string): HashRoute {
  const path = hash.replace(/^#\/?/, "");

  if (!path || path === "/") return { page: "dashboard" };
  if (path === "config") return { page: "config" };
  if (path === "book/new") return { page: "book-create" };

  const bookMatch = path.match(/^book\/([^/]+)$/);
  if (bookMatch) return { page: "book", bookId: decodeURIComponent(bookMatch[1]) };

  return { page: "dashboard" };
}

function routeToHash(route: HashRoute): string {
  switch (route.page) {
    case "dashboard": return "#/";
    case "book": return `#/book/${encodeURIComponent(route.bookId)}`;
    case "book-create": return "#/book/new";
    case "config": return "#/config";
    default: return ""; // 非 hash 路由的页面不改 hash
  }
}

const HASH_PAGES = new Set(["dashboard", "book", "book-create", "config"]);

export function useHashRoute() {
  const [route, setRouteState] = useState<HashRoute>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setRouteState(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const setRoute = useCallback((newRoute: HashRoute) => {
    if (HASH_PAGES.has(newRoute.page)) {
      const hash = routeToHash(newRoute);
      if (hash) {
        window.location.hash = hash;
        return; // hashchange 事件会触发 setRouteState
      }
    }
    setRouteState(newRoute);
  }, []);

  return { route, setRoute };
}
```

- [ ] **Step 2: 验证构建**

Run: `pnpm --filter @actalk/inkos-studio build 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add packages/studio/src/hooks/use-hash-route.ts
git commit -m "feat(studio): add useHashRoute hook for URL-based routing"
```

---

### Task 5: Frontend — App.tsx 路由替换

**Files:**
- Modify: `packages/studio/src/App.tsx`

- [ ] **Step 1: 替换 useState 为 useHashRoute**

导入新 hook：
```typescript
import { useHashRoute } from "./hooks/use-hash-route";
import type { HashRoute } from "./hooks/use-hash-route";
```

替换 `App()` 内的路由状态：
```typescript
// 删除: const [route, setRoute] = useState<Route>({ page: "dashboard" });
const { route, setRoute } = useHashRoute();
```

- [ ] **Step 2: 更新 nav 对象**

```typescript
const nav = {
  toDashboard: () => setRoute({ page: "dashboard" }),
  toBook: (bookId: string) => setRoute({ page: "book", bookId }),
  toBookCreate: () => setRoute({ page: "book-create" }),
  toChapter: (bookId: string, chapterNumber: number) =>
    setRoute({ page: "chapter", bookId, chapterNumber }),
  toAnalytics: (bookId: string) => setRoute({ page: "analytics", bookId }),
  toConfig: () => setRoute({ page: "config" }),
  toTruth: (bookId: string) => setRoute({ page: "truth", bookId }),
  toDaemon: () => setRoute({ page: "daemon" }),
  toLogs: () => setRoute({ page: "logs" }),
  toGenres: () => setRoute({ page: "genres" }),
  toStyle: () => setRoute({ page: "style" }),
  toImport: () => setRoute({ page: "import" }),
  toRadar: () => setRoute({ page: "radar" }),
  toDoctor: () => setRoute({ page: "doctor" }),
};
```

nav 对象接口不变，只是底层从 `setRoute(useState)` 变为 `setRoute(useHashRoute)`，所有子组件无需改动。

- [ ] **Step 3: 删除旧的 Route 类型导出**

App.tsx 中原来的 `export type Route = ...` 和 `export function deriveActiveBookId` 需要更新。`Route` 类型改为使用 `HashRoute`：

```typescript
// 删除旧的 Route type export
// 改为 re-export
export type { HashRoute as Route } from "./hooks/use-hash-route";

export function deriveActiveBookId(route: HashRoute): string | undefined {
  return route.page === "book" || route.page === "chapter" || route.page === "truth" || route.page === "analytics"
    ? (route as { bookId: string }).bookId
    : undefined;
}
```

- [ ] **Step 4: 验证构建**

Run: `pnpm --filter @actalk/inkos-studio build 2>&1 | tail -5`

- [ ] **Step 5: 验证刷新行为**

1. 启动 `inkos studio`
2. 导航到某本书 → URL 显示 `#/book/{bookId}`
3. 刷新浏览器 → 应该恢复到同一本书
4. 点击 `+` → URL 显示 `#/book/new`
5. 浏览器后退 → 回到之前的书

- [ ] **Step 6: Commit**

```bash
git add packages/studio/src/App.tsx packages/studio/src/hooks/use-hash-route.ts
git commit -m "feat(studio): replace useState routing with URL hash"
```

---

### Task 6: Frontend — Store 接入 per-book session

**Files:**
- Modify: `packages/studio/src/store/chat/types.ts`
- Modify: `packages/studio/src/store/chat/slices/message/action.ts`
- Modify: `packages/studio/src/store/chat/slices/message/initialState.ts`
- Modify: `packages/studio/src/pages/ChatPage.tsx`

- [ ] **Step 1: 更新 store 类型**

在 `types.ts` 的 `MessageState` 添加：

```typescript
export interface MessageState {
  messages: ReadonlyArray<Message>;
  input: string;
  loading: boolean;
  currentSessionId: string | null;
}
```

在 `MessageActions` 中修改 `loadSession` 和 `sendMessage` 签名：

```typescript
export interface MessageActions {
  setInput: (text: string) => void;
  addUserMessage: (content: string) => void;
  appendStreamChunk: (text: string, streamTs: number) => void;
  finalizeStream: (streamTs: number, content: string, toolCall?: ToolCall) => void;
  replaceStreamWithError: (streamTs: number, errorMsg: string) => void;
  addErrorMessage: (errorMsg: string) => void;
  setLoading: (loading: boolean) => void;
  loadSessionMessages: (msgs: ReadonlyArray<SessionMessage>) => void;
  loadSession: (bookId?: string) => Promise<void>;
  sendMessage: (text: string, activeBookId?: string) => Promise<void>;
}
```

更新 `SessionResponse` 以包含 sessionId：

```typescript
export interface SessionResponse {
  readonly session?: {
    readonly sessionId?: string;
    readonly activeBookId?: string;
    readonly messages?: ReadonlyArray<SessionMessage>;
  };
  readonly activeBookId?: string;
}
```

- [ ] **Step 2: 更新 initialState**

```typescript
export const initialMessageState: MessageState = {
  messages: [],
  input: "",
  loading: false,
  currentSessionId: null,
};
```

- [ ] **Step 3: 更新 loadSession action**

在 `slices/message/action.ts` 中替换 `loadSession`：

```typescript
loadSession: async (bookId) => {
  try {
    // 获取或创建该 bookId 的 session
    const data = await fetchJson<{ session: { sessionId: string; messages: SessionMessage[] } }>("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId: bookId ?? null }),
    });
    const session = data.session;
    set({ currentSessionId: session.sessionId, messages: [] });
    if (session.messages && session.messages.length > 0) {
      get().loadSessionMessages(session.messages);
    }
  } catch {
    set({ currentSessionId: null, messages: [] });
  }
},
```

- [ ] **Step 4: 更新 sendMessage 传递 sessionId**

在 `sendMessage` action 中，fetchJson 调用添加 sessionId：

```typescript
const data = await fetchJson<AgentResponse>("/agent", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ instruction, activeBookId, sessionId: get().currentSessionId }),
});
```

- [ ] **Step 5: ChatPage 路由变化时重新加载 session**

在 `ChatPage.tsx` 中，`loadSession` 改为依赖 `activeBookId`：

```typescript
// 替换原来的 useEffect
useEffect(() => {
  useChatStore.getState().loadSession(activeBookId);
}, [activeBookId]);
```

- [ ] **Step 6: 验证构建**

Run: `pnpm --filter @actalk/inkos-studio build 2>&1 | tail -5`

- [ ] **Step 7: Commit**

```bash
git add packages/studio/src/store/chat/ packages/studio/src/pages/ChatPage.tsx
git commit -m "feat(studio): load per-book session on route change"
```

---

### Task 7: 端到端验证

- [ ] **Step 1: 全量构建**

```bash
pnpm build 2>&1 | tail -10
```

- [ ] **Step 2: 启动 + 手动验证**

```bash
inkos studio
```

检查清单：
- 打开 `http://localhost:4567` → Dashboard（URL 显示 `#/`）
- 点击书籍 → ChatPage + Sidebar（URL 显示 `#/book/{bookId}`）
- 刷新浏览器 → 恢复到同一本书
- 发送消息 → 消息保存到 `.inkos/sessions/{sessionId}.json`
- 导航回 Dashboard → 再进入同一本书 → 看到之前的消息
- 点击 `+` 新建 → `#/book/new` → 空对话，无旧消息
- 进入另一本书 → 看到该书的消息，不是之前那本的

- [ ] **Step 3: Commit（如有修复）**

```bash
git add -A
git commit -m "fix(studio): phase 1a polish from e2e testing"
```
