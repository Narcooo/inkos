import type { StateCreator } from "zustand";
import { nanoid } from "nanoid";
import type {
  AgentResponse,
  ChatAttachmentPayload,
  ChatSessionKind,
  ChatStore,
  MessageActions,
  SendMessageOptions,
  SessionResponse,
  SessionSummary,
} from "../../types";
import { fetchJson } from "../../../../hooks/use-api";
import { tr } from "../../../../lib/app-language";
import { isConfirmedProductionSend } from "../../message-policy";
import { attachSessionStreamListeners } from "./stream-events";
import {
  bookKey,
  createSessionRuntime,
  deriveResolvedProposals,
  deserializeMessages,
  extractErrorMessage,
  hasAnyInFlightExecution,
  markRunningToolsFailed,
  mergeToolExecution,
  mergeTaskExecution,
  mergeSessionIds,
  updateSession,
  upsertSessionSummary,
  withToolExecutions,
} from "./runtime";

const SKILL_DIRECTIVE_RE = /(^|\s)@([a-z][a-z0-9-]*)(?=\s|$)/gi;

function parseSkillDirectives(text: string): { instruction: string; requestedSkills: string[] } {
  const requestedSkills: string[] = [];
  const seen = new Set<string>();
  const instruction = text.replace(SKILL_DIRECTIVE_RE, (match, prefix: string, rawId: string) => {
    const id = rawId.toLowerCase();
    if (!seen.has(id)) {
      seen.add(id);
      requestedSkills.push(id);
    }
    return prefix;
  }).replace(/\s+/g, " ").trim();
  return { instruction: instruction || text.trim(), requestedSkills };
}

function mergeSkillIds(
  parsed: ReadonlyArray<string>,
  explicit: ReadonlyArray<string> | undefined,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of [...parsed, ...(explicit ?? [])]) {
    const id = value.trim().toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function formatAttachmentSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${size} B`;
}

function formatUserMessageForDisplay(text: string, attachments: ReadonlyArray<ChatAttachmentPayload>): string {
  if (attachments.length === 0) return text;
  const heading = tr("附件：", "Attachments:");
  const lines = text ? [text, "", heading] : [heading];
  for (const attachment of attachments) {
    lines.push(`- ${attachment.filename} (${attachment.mediaType || "application/octet-stream"}, ${formatAttachmentSize(attachment.size)})`);
  }
  return lines.join("\n");
}

export const createMessageSlice: StateCreator<ChatStore, [], [], MessageActions> = (set, get) => {
  const abortPreviousChatRound = (nextSessionId: string | null): void => {
    const previousSessionId = get().activeSessionId;
    if (!previousSessionId || previousSessionId === nextSessionId) return;
    if (!get().sessions[previousSessionId]?.isChatStreaming) return;
    void get().abortSession(previousSessionId, "chat");
  };

  return {
    activateSession: (sessionId) => {
      abortPreviousChatRound(sessionId);
      set({ activeSessionId: sessionId });
    },

  setSessionPlayMode: (sessionId, playMode) => {
    const session = get().sessions[sessionId];
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, () => ({ playMode })),
    }));
    if (session?.isDraft) return;
    void fetchJson(`/sessions/${sessionId}/play-mode`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playMode }),
    }).catch(() => undefined);
  },

  setInput: (text) => set({ input: text }),

  addUserMessage: (sessionId, content) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (session) => ({
        messages: [...session.messages, { role: "user", content, timestamp: Date.now() }],
        lastError: null,
      })),
    })),

  appendStreamChunk: (sessionId, text, streamTs) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (session) => {
        const last = session.messages[session.messages.length - 1];
        if (last?.timestamp === streamTs && last.role === "assistant") {
          return {
            messages: [...session.messages.slice(0, -1), { ...last, content: last.content + text }],
          };
        }
        return {
          messages: [...session.messages, { role: "assistant", content: text, timestamp: streamTs }],
        };
      }),
    })),

  finalizeStream: (sessionId, streamTs, content, toolCall) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (session) => ({
        messages: session.messages.map((message) => {
          if (message.timestamp !== streamTs || message.role !== "assistant") return message;
          const parts = [...(message.parts ?? [])];
          const lastPart = parts[parts.length - 1];
          if (lastPart?.type === "text") {
            parts[parts.length - 1] = { ...lastPart, content };
          } else if (content) {
            parts.push({ type: "text", content });
          }
          return { ...message, content, toolCall, parts };
        }),
      })),
    })),

  replaceStreamWithError: (sessionId, streamTs, errorMsg) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (session) => {
        const streamMessage = session.messages.find(
          (message) => message.timestamp === streamTs && message.role === "assistant",
        );
        const streamExecutions = [
          ...(streamMessage?.toolExecutions ?? []),
          ...(streamMessage?.parts ?? []).flatMap((part) => (
            part.type === "tool" ? [part.execution] : []
          )),
        ];
        const hasActiveOrFailedTool = streamExecutions.some(
          (execution) => execution.status === "running"
            || execution.status === "processing"
            || execution.status === "error",
        );
        // 只把本轮（streamTs 消息）里的运行中工具标记为失败：并行运行的后台
        // 任务卡挂在更早的消息上，聊天轮出错不代表任务失败，不能连带标记。
        // isStreaming / stream 的收尾统一交给 sendMessage 的 finally 判断
        //（那里会检查是否还有任务在跑）。
        const messages = hasActiveOrFailedTool
          ? session.messages.map((message) => (
              message.timestamp === streamTs && message.role === "assistant"
                ? markRunningToolsFailed([message], errorMsg)[0]!
                : message
            ))
          : [
              ...session.messages.filter(
                (message) => !(message.timestamp === streamTs && message.role === "assistant"),
              ),
              { role: "assistant" as const, content: `\u2717 ${errorMsg}`, timestamp: Date.now() },
            ];
        return {
          messages,
          lastError: errorMsg,
        };
      }),
    })),

  addErrorMessage: (sessionId, errorMsg) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (session) => ({
        messages: [...session.messages, { role: "assistant", content: `\u2717 ${errorMsg}`, timestamp: Date.now() }],
        lastError: errorMsg,
      })),
    })),

  loadSessionMessages: (sessionId, msgs) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session || session.messages.length > 0) return {};
      const messages = deserializeMessages(msgs);
      return {
        sessions: updateSession(state.sessions, sessionId, () => ({ messages })),
        resolvedProposals: {
          ...state.resolvedProposals,
          ...deriveResolvedProposals(messages),
        },
      };
    }),

  setSelectedModel: (model, service) => set({ selectedModel: model, selectedService: service }),

  loadSessionList: async (bookId) => {
    const query = bookId === null ? "null" : encodeURIComponent(bookId);
    try {
      const data = await fetchJson<{ sessions: ReadonlyArray<SessionSummary> }>(`/sessions?bookId=${query}`);
      set((state) => {
        let sessions = state.sessions;
        for (const summary of data.sessions) {
          sessions = upsertSessionSummary(sessions, summary);
        }
        return {
          sessions,
          sessionIdsByBook: {
            ...state.sessionIdsByBook,
            [bookKey(bookId)]: data.sessions.map((session) => session.sessionId),
          },
        };
      });
      return data.sessions;
    } catch {
      return [];
    }
  },

  createSession: async (bookId, sessionKind, playMode) => {
    abortPreviousChatRound(null);
    const data = await fetchJson<SessionResponse>("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId, sessionKind, playMode }),
    });
    const sessionId = data.session?.sessionId;
    if (!sessionId) {
      throw new Error("Failed to create session");
    }

    set((state) => {
      const runtime = createSessionRuntime({
        sessionId,
        bookId: data.session?.bookId ?? bookId ?? null,
        sessionKind: data.session?.sessionKind ?? sessionKind,
        playMode: data.session?.playMode,
        title: data.session?.title ?? null,
      });
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: runtime,
        },
        sessionIdsByBook: {
          ...state.sessionIdsByBook,
          [bookKey(runtime.bookId)]: mergeSessionIds(
            state.sessionIdsByBook[bookKey(runtime.bookId)],
            [sessionId],
          ),
        },
        activeSessionId: sessionId,
      };
    });

    return sessionId;
  },

  createDraftSession: (bookId, sessionKind, playMode) => {
    abortPreviousChatRound(null);
    // 前端生成 sessionId（与后端 createBookSession 同格式），暂不持久化到磁盘，
    // 也暂不写入 sessionIdsByBook——侧边栏看不到这条 draft。
    // 发送第一条消息时 sendMessage 会调 POST /sessions { sessionId, bookId } 落盘
    // 并把 id 追加进 sessionIdsByBook，那一刻侧边栏才出现该会话（带着 title）。
    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((state) => {
      const runtime = createSessionRuntime({
        sessionId,
        bookId,
        sessionKind,
        playMode,
        title: null,
        isDraft: true,
      });
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: runtime,
        },
        activeSessionId: sessionId,
      };
    });
    return sessionId;
  },

  renameSession: async (sessionId, title) => {
    const previous = get().sessions[sessionId]?.title ?? null;
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, () => ({ title })),
    }));

    try {
      await fetchJson(`/sessions/${sessionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
    } catch {
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, () => ({ title: previous })),
      }));
    }
  },

  deleteSession: async (sessionId) => {
    const session = get().sessions[sessionId];
    session?.stream?.close();
    // 草稿会话还没写到磁盘，跳过 DELETE 请求避免后端返回 404
    if (session && !session.isDraft) {
      try {
        await fetchJson(`/sessions/${sessionId}`, { method: "DELETE" });
      } catch {
        // ignore
      }
    }

    set((state) => {
      const { [sessionId]: deleted, ...rest } = state.sessions;
      const sessionIdsByBook = Object.fromEntries(
        Object.entries(state.sessionIdsByBook).map(([key, ids]) => [
          key,
          ids.filter((id) => id !== sessionId),
        ]),
      );

      let activeSessionId = state.activeSessionId;
      if (activeSessionId === sessionId) {
        const fallbackKey = bookKey(session?.bookId ?? null);
        activeSessionId = sessionIdsByBook[fallbackKey]?.[0] ?? null;
      }

      return {
        sessions: rest,
        sessionIdsByBook,
        activeSessionId,
      };
    });
  },

  abortSession: async (sessionId, scope = "all") => {
    const session = get().sessions[sessionId];
    const stoppedAt = Date.now();
    const stoppedMessage = tr("已由用户停止", "Stopped by user");
    const chatOnly = scope === "chat";
    const messages = markRunningToolsFailed(
      session?.messages ?? [],
      stoppedMessage,
      stoppedAt,
      (execution) => !chatOnly || execution.background !== true,
    );
    const keepProductionStream = chatOnly && hasAnyInFlightExecution(messages);
    if (!keepProductionStream) session?.stream?.close();
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (runtime) => ({
        isStreaming: keepProductionStream,
        isChatStreaming: false,
        stream: keepProductionStream ? runtime.stream : null,
        lastError: null,
        messages,
      })),
    }));
    try {
      await fetchJson(`/sessions/${sessionId}/abort${chatOnly ? "?scope=chat" : ""}`, {
        method: "POST",
      });
    } catch (error) {
      get().addErrorMessage(sessionId, error instanceof Error ? error.message : String(error));
    }
  },

  loadSessionDetail: async (sessionId) => {
    // 草稿会话：磁盘上还没有文件，直接跳过远端拉取。
    const existing = get().sessions[sessionId];
    if (existing?.isDraft) return;
    if (existing?.isStreaming && existing.stream) return;

    try {
      const data = await fetchJson<SessionResponse>(`/sessions/${sessionId}`);
      const detail = data.session;
      if (!detail?.sessionId) return;
      const detailSessionId = detail.sessionId;
      const persistedMessages = detail.messages ? deserializeMessages(detail.messages) : [];
      const task = data.task;
      const taskRunning = task?.execution.status === "running" || task?.execution.status === "processing";
      let restoredMessages: ReadonlyArray<ReturnType<typeof deserializeMessages>[number]> = persistedMessages;
      if (task) restoredMessages = mergeTaskExecution(restoredMessages, task.execution);
      const messages = restoredMessages;
      const restoredResolutions = deriveResolvedProposals(messages);

      set((state) => {
        const runtime = state.sessions[detailSessionId];
        const nextBookId = detail.bookId ?? runtime?.bookId ?? null;
        const baseMessages = runtime?.messages.length ? runtime.messages : messages;
        const nextMessages = task ? mergeTaskExecution(baseMessages, task.execution) : baseMessages;
        return {
          sessions: {
            ...state.sessions,
            [detailSessionId]: {
              ...(runtime ?? createSessionRuntime({
                sessionId: detailSessionId,
                bookId: nextBookId,
                sessionKind: detail.sessionKind,
                playMode: detail.playMode,
                title: detail.title ?? null,
              })),
              bookId: nextBookId,
              sessionKind: detail.sessionKind ?? runtime?.sessionKind,
              playMode: detail.playMode ?? runtime?.playMode,
              title: detail.title ?? runtime?.title ?? null,
              messages: nextMessages,
              isStreaming: taskRunning,
            },
          },
          sessionIdsByBook: {
            ...state.sessionIdsByBook,
            [bookKey(nextBookId)]: mergeSessionIds(
              state.sessionIdsByBook[bookKey(nextBookId)],
              [detailSessionId],
            ),
          },
          resolvedProposals: {
            ...state.resolvedProposals,
            ...restoredResolutions,
          },
        };
      });

      if (taskRunning && task) {
        const current = get().sessions[detailSessionId];
        current?.stream?.close();
        const streamEs = new EventSource(`/api/v1/events?sessionId=${encodeURIComponent(detailSessionId)}`);
        set((state) => ({
          sessions: updateSession(state.sessions, detailSessionId, () => ({ stream: streamEs, isStreaming: true })),
        }));
        attachSessionStreamListeners({
          sessionId: detailSessionId,
          streamTs: task.execution.startedAt,
          streamEs,
          set,
          get,
        });
      }
    } catch {
      // ignore
    }
  },

  sendMessage: async (sessionId, text, options?: SendMessageOptions) => {
    const trimmed = text.trim();
    const attachments = options?.attachments ?? [];
    const session = get().sessions[sessionId];
    // 只挡"聊天轮流式中"：后台生产任务运行期间（isStreaming=true 但
    // isChatStreaming=false）允许继续发消息，聊天与任务并行。
    if ((!trimmed && attachments.length === 0) || !session || session.isChatStreaming) return;
    const userInstruction = trimmed || tr("请阅读我上传的文件。", "Please read the files I uploaded.");
    const activeBookId = options?.activeBookId ?? session.bookId ?? undefined;
    const sessionKind: ChatSessionKind = options?.sessionKind
      ?? session.sessionKind
      ?? (activeBookId ? "book" : "chat");
    const actionSource = options?.actionSource ?? "free-text";
    const playMode = options?.playMode ?? session.playMode;
    // 确认式生产任务的发送轮不是"聊天轮"：请求会挂起到任务结束，
    // 期间用户仍可继续聊天，所以不置 isChatStreaming。
    const isProductionTaskSend = isConfirmedProductionSend(actionSource, options?.requestedIntent);
    // 聊天轮失败时记录原样发送参数（text + options），供"重试"按钮一键重发。
    // 生产任务轮不记录：任务失败由任务卡自己展示，重试按钮只管聊天轮。
    const rememberFailedSend = () => {
      if (isProductionTaskSend) return;
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, () => ({
          lastFailedSend: options ? { text, options } : { text },
        })),
      }));
    };

    if (!get().selectedModel) {
      get().addUserMessage(sessionId, formatUserMessageForDisplay(userInstruction, attachments));
      get().addErrorMessage(sessionId, tr("请先选择一个模型", "Select a model first"));
      rememberFailedSend();
      return;
    }

    // 草稿会话：第一条消息发送时才真正把 session 文件写到磁盘。
    // 后端 POST /sessions 支持接受客户端传入的 sessionId，所以 id 保持一致，
    // 前端 store 里的 runtime 不用 remount，只需要把 isDraft 翻成 false。
    if (session.isDraft) {
      try {
        await fetchJson<SessionResponse>("/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, bookId: session.bookId, sessionKind, playMode }),
        });
        // 落盘成功：把 isDraft 翻成 false，同时把 sessionId 追加进 sessionIdsByBook
        // 让侧边栏现在才看到这条会话。
        set((state) => ({
          sessions: updateSession(state.sessions, sessionId, () => ({ isDraft: false, sessionKind, playMode })),
          sessionIdsByBook: {
            ...state.sessionIdsByBook,
            [bookKey(session.bookId)]: mergeSessionIds(
              state.sessionIdsByBook[bookKey(session.bookId)],
              [sessionId],
            ),
          },
        }));
      } catch (err) {
        get().addErrorMessage(sessionId, err instanceof Error ? err.message : String(err));
        rememberFailedSend();
        return;
      }
    }

    const skillDirectives = parseSkillDirectives(userInstruction);
    const instruction = skillDirectives.instruction;
    const requestedSkills = mergeSkillIds(skillDirectives.requestedSkills, options?.requestedSkills);
    const disabledSkills = mergeSkillIds([], options?.disabledSkills);
    const streamTs = Date.now() + 1;
    const sourceRequestId = nanoid();

    set((state) => ({
      input: "",
      activeSessionId: sessionId,
      sessions: updateSession(state.sessions, sessionId, () => ({
        isStreaming: true,
        isChatStreaming: !isProductionTaskSend,
        lastError: null,
        // 新一轮发送开始即清除上一条失败记录：本轮失败会重新记录，
        // 本轮成功则说明对话已继续，旧的重试入口不再保留。
        lastFailedSend: undefined,
      })),
    }));

    get().addUserMessage(sessionId, formatUserMessageForDisplay(userInstruction, attachments));
    // 单连接原则：任务恢复流等旧连接先关掉，换成本轮的新连接。
    // 运行中的任务卡不受影响——新连接建立时服务端会重放 running 快照，
    // 任务日志（log）与收尾（tool:end）都按 execution id 匹配，与 streamTs 无关。
    session.stream?.close();
    const streamEs = new EventSource(`/api/v1/events?sessionId=${encodeURIComponent(sessionId)}`);
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, () => ({ stream: streamEs })),
    }));
    attachSessionStreamListeners({ sessionId, streamTs, sourceRequestId, streamEs, set, get });

    try {
      const data = await fetchJson<AgentResponse>("/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction,
          activeBookId,
          sessionKind,
          playMode,
          actionSource,
          requestedIntent: options?.requestedIntent,
          actionPayload: options?.actionPayload,
          requestedSkills,
          disabledSkills,
          attachments,
          sessionId,
          clientRequestId: sourceRequestId,
          model: get().selectedModel ?? undefined,
          service: get().selectedService ?? undefined,
        }),
      });

      const finalContent = data.details?.draftRaw || data.response || "";
      const toolCall = data.details?.toolCall ?? undefined;
      const responseToolExecutions = data.details?.toolExecutions ?? [];
      const responseBookId = data.session?.activeBookId ?? data.session?.bookId;
      const responseSessionKind = data.session?.sessionKind;
      if (responseBookId || responseSessionKind || data.session?.title || data.session?.playMode) {
        set((state) => {
          const runtime = state.sessions[sessionId];
          if (!runtime) return {};
          const nextBookId = responseBookId ?? runtime.bookId;
          return {
            sessions: updateSession(state.sessions, sessionId, () => ({
              bookId: nextBookId,
              sessionKind: responseSessionKind ?? runtime.sessionKind,
              playMode: data.session?.playMode ?? runtime.playMode,
              title: data.session?.title ?? runtime.title,
            })),
            sessionIdsByBook: {
              ...state.sessionIdsByBook,
              [bookKey(nextBookId)]: mergeSessionIds(
                state.sessionIdsByBook[bookKey(nextBookId)],
                [sessionId],
              ),
            },
          };
        });
      }
      const hasStream = Boolean(
        get().sessions[sessionId]?.messages.some((message) => message.timestamp === streamTs),
      );
      const attachResponseTools = () => {
        if (responseToolExecutions.length === 0) return;
        set((state) => ({
          sessions: updateSession(state.sessions, sessionId, (runtime) => ({
            messages: responseToolExecutions.reduce<ReadonlyArray<(typeof runtime.messages)[number]>>(
              (messages, execution) => mergeToolExecution(messages, execution),
              runtime.messages,
            ),
          })),
        }));
      };

      if (data.error) {
        const errorMessage = extractErrorMessage(data.error);
        if (hasStream) {
          get().replaceStreamWithError(sessionId, streamTs, errorMessage);
        } else {
          get().addErrorMessage(sessionId, errorMessage);
        }
        // 用户中途主动停止（abortSession）会先把 isChatStreaming 置回 false：
        // 那不算失败，不记录重试。
        if (get().sessions[sessionId]?.isChatStreaming) rememberFailedSend();
      } else if (finalContent) {
        if (hasStream) {
          get().finalizeStream(sessionId, streamTs, finalContent, toolCall);
          attachResponseTools();
        } else {
          const message = withToolExecutions({
            role: "assistant",
            content: finalContent,
            timestamp: Date.now(),
            toolCall,
          }, responseToolExecutions);
          set((state) => ({
            sessions: updateSession(state.sessions, sessionId, (runtime) => ({
              messages: [
                ...runtime.messages,
                message,
              ],
            })),
          }));
        }
      } else if (responseToolExecutions.length > 0) {
        if (hasStream) {
          get().finalizeStream(sessionId, streamTs, "", toolCall);
          attachResponseTools();
        } else {
          // A confirmed production task can be restored from task:snapshot before
          // tool:start arrives. That card uses the server-side startedAt timestamp,
          // not this request's streamTs, so hasStream is false even though the same
          // execution is already visible. Always merge by execution id here: it
          // updates the restored card, or appends one when no SSE event was observed.
          attachResponseTools();
        }
      } else {
        if (hasStream) {
          get().finalizeStream(sessionId, streamTs, "", toolCall);
        } else {
          const emptyMessage = tr(
            "模型未返回文本内容。请检查协议类型（chat/responses）、流式开关或上游服务兼容性。",
            "The model returned no text. Check the protocol type (chat/responses), the streaming toggle, or upstream service compatibility.",
          );
          get().addErrorMessage(sessionId, emptyMessage);
          // 空响应同样算这轮失败；用户主动停止的轮 isChatStreaming 已是 false，不记录。
          if (get().sessions[sessionId]?.isChatStreaming) rememberFailedSend();
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // 用户主动停止会先把 isChatStreaming 置回 false，被中止的请求随后 reject 到
      // 这里：那不算失败，不记录重试；真正的请求失败此刻 isChatStreaming 仍为 true。
      if (get().sessions[sessionId]?.isChatStreaming) rememberFailedSend();
      const failureAlreadyShown = get().sessions[sessionId]?.messages.some((message) => {
        const executions = [
          ...(message.toolExecutions ?? []),
          ...(message.parts ?? []).flatMap((part) => (
            part.type === "tool" ? [part.execution] : []
          )),
        ];
        return executions.some(
          (execution) => execution.status === "error"
            && (execution.completedAt ?? 0) >= streamTs,
        );
      }) ?? false;
      if (failureAlreadyShown) return;
      const hasStream = Boolean(
        get().sessions[sessionId]?.messages.some((message) => message.timestamp === streamTs),
      );
      if (hasStream) {
        get().replaceStreamWithError(sessionId, streamTs, errorMessage);
      } else {
        get().addErrorMessage(sessionId, errorMessage);
      }
    } finally {
      // 本轮请求已结束（成功/出错都走这里）。只有当会话的连接仍归本轮所有时
      // 才收尾：如果发新消息时旧连接已被替换（stream 指向更新一轮的连接），
      // 由新一轮负责后续状态。
      const runtime = get().sessions[sessionId];
      if (runtime && (runtime.stream === streamEs || runtime.stream === null)) {
        // 还有生产任务在跑：保持连接与 isStreaming，等任务自己的终态事件
        //（tool:end → agent:complete）到来时由 stream-events 收尾。
        const taskInFlight = hasAnyInFlightExecution(runtime.messages);
        if (!taskInFlight) streamEs.close();
        set((state) => ({
          sessions: updateSession(state.sessions, sessionId, () => ({
            isChatStreaming: false,
            isStreaming: taskInFlight,
            stream: taskInFlight ? streamEs : null,
          })),
        }));
      }
    }
  },

  retryLastSend: async (sessionId) => {
    const session = get().sessions[sessionId];
    const failed = session?.lastFailedSend;
    if (!session || !failed || session.isChatStreaming) return;
    // 先清除记录再重发：重复点击时第二次进来已无记录，直接返回，避免双发。
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, () => ({ lastFailedSend: undefined })),
    }));
    await get().sendMessage(sessionId, failed.text, failed.options);
    },
  };
};
