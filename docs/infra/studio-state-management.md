# Studio 状态管理 (Zustand)

> 参考 LobeHub lobe-chat 的 store 目录约定 + Claude Code 的 selector/listener 模式，适配 InkOS Studio 的规模。

## 参考来源

| 来源 | 借鉴点 |
|------|--------|
| **LobeHub lobe-chat** | 目录结构约定：`store/chat/slices/*/action.ts + initialState.ts`；`StateCreator` slice 组合；barrel export |
| **Claude Code** | selector 驱动订阅（组件只 re-render 关心的 slice）；action 与状态同源（不分离 dispatch）；`subscribe()` 做 side-effect listener；派生状态用纯函数 selector 计算，不存储 |

## 设计原则

- **单 store** — `useChatStore`，不拆多个 store（Studio 复杂度不需要）
- **Slice 分治** — store 内部按职责拆 slice，每个 slice 独立 action + initialState（LobeHub 约定）
- **Selector 订阅** — 组件只订阅自己关心的 slice，避免无关 re-render（Claude Code `useAppState(selector)` 模式）
- **Action 稳定引用** — Zustand action 天然 stable，不需要 useCallback 包装（对应 Claude Code `useSetAppState()` 稳定引用）
- **Side-effect listener** — 用 `store.subscribe()` 监听状态变更触发副作用（对应 Claude Code `onChangeAppState`）
- **不动的部分** — `useTheme`、`useI18n`、`useSSE` 保持 hook 形态；`route` 留在 App.tsx（对应 Claude Code 的多 Context 分离关注点）

## 目录结构

```
packages/studio/src/store/
└── chat/
    ├── slices/
    │   ├── message/
    │   │   ├── action.ts          # addUserMessage, appendStreamChunk, finalizeStream, loadSession
    │   │   └── initialState.ts    # messages: [], input: "", loading: false
    │   └── create/
    │       ├── action.ts          # handleCreateBook, setPendingBookArgs
    │       └── initialState.ts    # pendingBookArgs: null, bookCreating: false, createProgress: ""
    ├── store.ts                   # create() + compose slices
    ├── index.ts                   # barrel: export { useChatStore } + selectors
    ├── initialState.ts            # merge slice initialStates
    └── selectors.ts               # 派生状态（isZh, hasBook, hasPendingTool 等）
```

## Store 类型定义

```typescript
// -- State --
interface ChatState {
  // message slice
  messages: ReadonlyArray<Message>;
  input: string;
  loading: boolean;
  // create slice
  pendingBookArgs: Record<string, unknown> | null;
  bookCreating: boolean;
  createProgress: string;
}

// -- Actions --
interface MessageActions {
  setInput: (text: string) => void;
  addUserMessage: (content: string) => void;
  appendStreamChunk: (text: string, streamTs: number) => void;
  finalizeStream: (streamTs: number, content: string, toolCall?: ToolCall) => void;
  addErrorMessage: (error: string) => void;
  setLoading: (loading: boolean) => void;
  loadSessionMessages: (msgs: ReadonlyArray<SessionMessage>) => void;
}

interface CreateActions {
  setPendingBookArgs: (args: Record<string, unknown> | null) => void;
  setBookCreating: (creating: boolean) => void;
  setCreateProgress: (progress: string) => void;
}

type ChatStore = ChatState & MessageActions & CreateActions;
```

## Slice 组合模式

参照 LobeHub 的 `StateCreator` 约定：

```typescript
// slices/message/action.ts
import type { StateCreator } from "zustand";

export const createMessageSlice: StateCreator<ChatStore, [], [], MessageActions> = (set, get) => ({
  setInput: (text) => set({ input: text }),
  addUserMessage: (content) => set((s) => ({
    messages: [...s.messages, { role: "user", content, timestamp: Date.now() }],
  })),
  // ...
});
```

```typescript
// store.ts
export const useChatStore = create<ChatStore>()((...a) => ({
  ...initialState,
  ...createMessageSlice(...a),
  ...createCreateSlice(...a),
}));
```

## Selectors

```typescript
// selectors.ts — 纯函数，不存储派生值
const hasBook = (activeBookId?: string) => Boolean(activeBookId);
const hasPendingTool = (s: ChatState) => s.pendingBookArgs !== null;
const isCreating = (s: ChatState) => s.bookCreating;
```

## 组件使用

```typescript
// 只订阅 messages — 其他字段变化不触发 re-render
const messages = useChatStore((s) => s.messages);

// 取 action — 稳定引用，不触发 re-render
const sendMessage = useChatStore((s) => s.addUserMessage);
```

## 与现有代码的关系

| 之前 (ChatPage useState) | 之后 (useChatStore) |
|---|---|
| `const [messages, setMessages] = useState([])` | `useChatStore(s => s.messages)` |
| `const [loading, setLoading] = useState(false)` | `useChatStore(s => s.loading)` |
| `const [pendingBookArgs, setPendingBookArgs] = useState(null)` | `useChatStore(s => s.pendingBookArgs)` |
| `sendMessage` 定义在 ChatPage 内部 | `useChatStore(s => s.sendMessage)` 或外部调用 |
| props drilling: theme, t, sse | 不变，保持 hook/props |

## activeBookId 的归属

`activeBookId` 是导航状态（从 `route` 派生），不放进 chat store。
ChatPage 继续通过 props 接收，action 需要时作为参数传入：

```typescript
// ChatPage 调用
const sendMessage = useChatStore(s => s.sendMessage);
await sendMessage(text, { activeBookId });
```
