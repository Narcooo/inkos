# InkOS

AI 长篇小说写作平台。monorepo: `packages/core`（运行时）、`packages/cli`（TUI）、`packages/studio`（Web UI / Hono + Vite）。

## 常用命令

```bash
pnpm dev              # 启动 studio dev server (core + cli + studio)
pnpm build            # 全量构建
pnpm test             # vitest 全仓测试
pnpm --filter @actalk/inkos-studio build   # 单独构建 studio client
```

## 设计文档

| 文档 | 范围 | 何时读 |
|------|------|--------|
| `docs/infra/studio-state-management.md` | Studio Zustand store 架构、slice 约定、目录结构 | 修改 `packages/studio/src/store/` 时 |
| `docs/plans/2026-04-13-chat-page-redesign.md` | ChatPage 全宽对话页设计 | 修改 ChatPage / FloatingPanels 时 |
| `docs/plans/2026-04-13-tool-calling-book-create.md` | 建书流程 tool calling 设计 | 修改 create_book 工具 / BookFormCard 时 |
| `docs/plans/2026-04-13-ai-elements-integration.md` | ai-elements 组件集成方案 | 修改 ai-elements 相关组件时 |
| `docs/infra/studio-sidebar-artifacts.md` | 右侧侧边栏 + Artifacts 设计 | 修改 BookInfoPanel / FloatingPanels / 侧边栏时 |
| `docs/plans/2026-04-13-sidebar-artifacts-plan.md` | 侧边栏 + Artifacts 实施计划（10 个 task） | 实施侧边栏功能时 |
| `docs/infra/studio-routing-and-session.md` | URL hash 路由 + 消息隔离 + pi-ai/pi-agent 集成 | 修改路由、session、LLM provider 时 |
| `docs/plans/2026-04-13-phase-1a-routing-session.md` | Phase 1a 实施计划（7 task） | 实施路由 + session 隔离时 |

## 工作规范

- **不要推测错误** — 遇到报错先读完整错误信息，定位根因后再修，不凭猜测改代码
- **原子化提交** — 每个 commit 只做一件事，功能和修复分开提交；不要把不相关的改动塞进同一个 commit

## 关键路径

- **建书流程**: `core/interaction/project-tools.ts` → `CREATE_BOOK_TOOL` + `chatWithTools` → Studio `ChatPage` → `BookFormCard`
- **Studio 入口**: `studio/src/App.tsx` → route 驱动页面切换
- **状态管理**: `studio/src/store/chat/` — Zustand，LobeHub slice 约定（详见 infra spec）
- **SSE 事件**: `studio/src/hooks/use-sse.ts`（共享 buffer）+ 组件内直连 EventSource（流式渲染）
