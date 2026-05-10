import type { Hono } from "hono";
import {
  appendManualSessionMessages,
  buildAgentSystemPrompt,
  chatCompletion,
  createLLMClient,
  loadBookSession,
  migrateBookSession,
  PipelineRunner,
  runAgentSession,
  SessionAlreadyMigratedError,
  type PipelineConfig,
  type ProjectConfig,
  type StateManager,
} from "@actalk/inkos-core";
import { ApiError } from "../errors.js";
import { loadStudioBookListSummary } from "../books/summary.js";
import { isTextChatModelId } from "../services/service-config.js";
import {
  AgentModelApiKeyError,
  createAgentPipelineClient,
  resolveAgentModel,
} from "../agent/model-resolution.js";
import {
  type CollectedToolExec,
  isWriteNextInstruction,
  nonTextModelMessage,
  PIPELINE_STAGES,
  resolveCreatedBookIdFromToolExecs,
  validateAgentActionExecution,
} from "../agent/execution.js";
import { createAgentSessionEventHandler } from "../agent/session-events.js";

interface RegisterAgentRoutesOptions {
  readonly root: string;
  readonly state: StateManager;
  readonly bookCreateStatus: Map<string, { status: "creating" | "error"; error?: string }>;
  readonly loadCurrentProjectConfig: (options?: { readonly requireApiKey?: boolean }) => Promise<ProjectConfig>;
  readonly buildPipelineConfig: (
    overrides?: Partial<Pick<PipelineConfig, "externalContext" | "client" | "model">> & {
      readonly currentConfig?: ProjectConfig;
      readonly sessionIdForSSE?: string;
    },
  ) => Promise<PipelineConfig>;
  readonly normalizeApiBookId: (value: unknown, fieldName: string) => string | null;
  readonly broadcast: (event: string, data: unknown) => void;
}

export function registerAgentRoutes(app: Hono, options: RegisterAgentRoutesOptions): void {
  const {
    root,
    state,
    bookCreateStatus,
    loadCurrentProjectConfig,
    buildPipelineConfig,
    normalizeApiBookId,
    broadcast,
  } = options;

  app.post("/api/v1/agent", async (c) => {
    const { instruction, activeBookId, sessionId: reqSessionId, model: reqModel, service: reqService } = await c.req.json<{
      instruction: string;
      activeBookId?: string;
      sessionId?: string;
      model?: string;
      service?: string;
    }>();
    const sessionId = reqSessionId;
    if (!instruction?.trim()) {
      return c.json({ error: "No instruction provided" }, 400);
    }
    if (!sessionId?.trim()) {
      throw new ApiError(400, "SESSION_ID_REQUIRED", "sessionId is required");
    }
    if (reqModel && !isTextChatModelId(reqModel)) {
      const message = nonTextModelMessage(reqModel);
      return c.json({ error: message, response: message }, 400);
    }

    broadcast("agent:start", { instruction, activeBookId, sessionId });

    try {
      const config = await loadCurrentProjectConfig({ requireApiKey: false });
      const client = createLLMClient(config.llm);

      const loadedBookSession = await loadBookSession(root, sessionId);
      if (!loadedBookSession) {
        throw new ApiError(404, "SESSION_NOT_FOUND", `Session not found: ${sessionId}`);
      }
      let bookSession = loadedBookSession;
      const requestedActiveBookId = normalizeApiBookId(activeBookId, "activeBookId");
      const persistedBookId = normalizeApiBookId(bookSession.bookId, "session.bookId");
      if (
        requestedActiveBookId
        && persistedBookId
        && persistedBookId !== requestedActiveBookId
      ) {
        throw new ApiError(
          409,
          "SESSION_BOOK_MISMATCH",
          `Session ${bookSession.sessionId} is bound to ${persistedBookId}, not ${requestedActiveBookId}`,
        );
      }
      const agentBookId = requestedActiveBookId ?? persistedBookId;
      if (agentBookId) {
        try {
          await state.loadBookConfig(agentBookId);
        } catch {
          throw new ApiError(404, "BOOK_NOT_FOUND", `Book not found: ${agentBookId}`);
        }
      }
      const streamSessionId = loadedBookSession.sessionId;
      const titleBeforeRun = bookSession.title;
      let sessionTitleBroadcasted = false;
      const refreshBookSessionFromTranscript = async (): Promise<void> => {
        const refreshed = await loadBookSession(root, bookSession.sessionId);
        if (refreshed) {
          bookSession = refreshed;
        }
        if (!sessionTitleBroadcasted && titleBeforeRun === null && bookSession.title) {
          broadcast("session:title", { sessionId: bookSession.sessionId, title: bookSession.title });
          sessionTitleBroadcasted = true;
        }
      };

      let modelResolution: Awaited<ReturnType<typeof resolveAgentModel>>;
      try {
        modelResolution = await resolveAgentModel({
          root,
          config,
          client,
          requestedService: reqService,
          requestedModel: reqModel,
        });
      } catch (e) {
        if (e instanceof AgentModelApiKeyError) {
          return c.json({
            error: e.message,
            response: `${e.message}，然后再试。`,
          }, 400);
        }
        throw e;
      }

      const model = modelResolution.model;
      const agentApiKey = modelResolution.apiKey;
      const configuredEntry = modelResolution.configuredEntry;

      const pipelineClient = createAgentPipelineClient({
        config,
        fallbackClient: client,
        resolution: modelResolution,
        requestedService: reqService,
        requestedModel: reqModel,
      });
      const pipeline = new PipelineRunner(await buildPipelineConfig({
        client: pipelineClient,
        model: reqModel ?? config.llm.model,
        currentConfig: config,
        sessionIdForSSE: bookSession.sessionId,
      }));

      if (agentBookId && isWriteNextInstruction(instruction)) {
        const toolCallId = `direct-writer-${Date.now().toString(36)}`;
        const toolArgs = { agent: "writer", bookId: agentBookId };
        broadcast("tool:start", {
          sessionId: streamSessionId,
          id: toolCallId,
          tool: "sub_agent",
          args: toolArgs,
          stages: PIPELINE_STAGES.writer,
        });

        try {
          const writeResult = await pipeline.writeNextChapter(agentBookId);
          const responseText = [
            `已为 ${agentBookId} 完成第 ${writeResult.chapterNumber} 章`,
            writeResult.title ? `《${writeResult.title}》` : "",
            `，字数 ${writeResult.wordCount}，状态 ${writeResult.status}。`,
          ].join("");
          const toolResult = {
            content: [{ type: "text", text: responseText }],
            details: {
              kind: "chapter_written",
              bookId: agentBookId,
              chapterNumber: writeResult.chapterNumber,
              title: writeResult.title,
              wordCount: writeResult.wordCount,
              status: writeResult.status,
            },
          };
          broadcast("tool:end", {
            sessionId: streamSessionId,
            id: toolCallId,
            tool: "sub_agent",
            result: toolResult,
            isError: false,
          });
          await appendManualSessionMessages(root, bookSession.sessionId, [{
            role: "assistant",
            content: [{ type: "text", text: responseText }],
            api: "anthropic-messages",
            provider: configuredEntry?.service ?? reqService ?? config.llm.provider,
            model: reqModel ?? config.llm.model,
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "toolUse",
            timestamp: Date.now(),
          }], instruction);
          await refreshBookSessionFromTranscript();
          broadcast("agent:complete", { instruction, activeBookId: agentBookId, sessionId: bookSession.sessionId });
          return c.json({
            response: responseText,
            session: {
              sessionId: bookSession.sessionId,
              activeBookId: agentBookId,
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const toolResult = { content: [{ type: "text", text: message }] };
          broadcast("tool:end", {
            sessionId: streamSessionId,
            id: toolCallId,
            tool: "sub_agent",
            result: toolResult,
            isError: true,
          });
          broadcast("agent:error", { instruction, activeBookId: agentBookId, sessionId: bookSession.sessionId, error: message });
          return c.json({
            error: { code: "AGENT_ACTION_FAILED", message },
            response: message,
          }, 502);
        }
      }

      const collectedToolExecs: CollectedToolExec[] = [];
      const result = await runAgentSession(
        {
          model,
          apiKey: agentApiKey,
          pipeline,
          projectRoot: root,
          bookId: agentBookId,
          sessionId: bookSession.sessionId,
          language: config.language ?? "zh",
          onEvent: createAgentSessionEventHandler({
            collectedToolExecs,
            agentBookId,
            streamSessionId,
            bookCreateStatus,
            broadcast,
          }),
        },
        instruction,
      );

      if (result.responseText) {
        const actionExecutionError = validateAgentActionExecution({
          instruction,
          agentBookId,
          responseText: result.responseText,
          collectedToolExecs,
        });
        if (actionExecutionError) {
          return c.json({
            error: { code: "AGENT_ACTION_NOT_EXECUTED", message: actionExecutionError },
            response: actionExecutionError,
          }, 502);
        }
      }

      let broadcastedCreatedBookId: string | null = null;
      const finalizeCreatedBook = async (): Promise<string | null> => {
        if (agentBookId) return null;
        const createdBookId = resolveCreatedBookIdFromToolExecs(collectedToolExecs);
        if (!createdBookId) return null;
        if (broadcastedCreatedBookId === createdBookId) return createdBookId;

        try {
          const migratedSession = await migrateBookSession(root, bookSession.sessionId, createdBookId);
          if (migratedSession) {
            bookSession = migratedSession;
          }
        } catch (e) {
          if (!(e instanceof SessionAlreadyMigratedError)) {
            throw e;
          }
        }

        const book = await loadStudioBookListSummary(state, createdBookId).catch(() => undefined);
        bookCreateStatus.delete(createdBookId);
        broadcast("book:created", {
          bookId: createdBookId,
          sessionId: bookSession.sessionId,
          ...(book ? { book } : {}),
        });
        broadcastedCreatedBookId = createdBookId;
        return createdBookId;
      };

      if (!result.responseText) {
        if (result.errorMessage) {
          if (resolveCreatedBookIdFromToolExecs(collectedToolExecs)) {
            await finalizeCreatedBook();
          }
          return c.json({
            error: { code: "AGENT_LLM_ERROR", message: result.errorMessage },
            response: result.errorMessage,
          }, 502);
        }

        try {
          const fallbackClient = createLLMClient({
            ...config.llm,
            service: configuredEntry?.service ?? reqService ?? config.llm.service,
            model: reqModel ?? config.llm.model,
            apiKey: agentApiKey ?? config.llm.apiKey,
            baseUrl: configuredEntry?.baseUrl ?? "",
            ...(configuredEntry?.apiFormat ? { apiFormat: configuredEntry.apiFormat } : {}),
            ...(configuredEntry?.stream !== undefined ? { stream: configuredEntry.stream } : {}),
          } as ProjectConfig["llm"]);
          const fallback = await chatCompletion(
            fallbackClient,
            reqModel ?? config.llm.model,
            [
              { role: "system", content: buildAgentSystemPrompt(agentBookId, config.language ?? "zh") },
              { role: "user", content: instruction },
            ],
            { maxTokens: 256 },
          );
          if (fallback.content?.trim()) {
            const actionExecutionError = validateAgentActionExecution({
              instruction,
              agentBookId,
              responseText: fallback.content,
              collectedToolExecs,
            });
            if (actionExecutionError) {
              return c.json({
                error: { code: "AGENT_ACTION_NOT_EXECUTED", message: actionExecutionError },
                response: actionExecutionError,
              }, 502);
            }
            await appendManualSessionMessages(root, bookSession.sessionId, [{
              role: "assistant",
              content: [{ type: "text", text: fallback.content }],
              api: "anthropic-messages",
              provider: configuredEntry?.service ?? reqService ?? config.llm.provider,
              model: reqModel ?? config.llm.model,
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
              stopReason: "stop",
              timestamp: Date.now(),
            }], instruction);
            await refreshBookSessionFromTranscript();
            const createdBookId = await finalizeCreatedBook();
            return c.json({
              response: fallback.content,
              session: {
                sessionId: bookSession.sessionId,
                ...(createdBookId ? { activeBookId: createdBookId } : {}),
              },
            });
          }
        } catch {
          // fall through to probe-based diagnosis below
        }

        try {
          const probeClient = createLLMClient({
            ...config.llm,
            service: configuredEntry?.service ?? reqService ?? config.llm.service,
            model: reqModel ?? config.llm.model,
            apiKey: agentApiKey ?? config.llm.apiKey,
            baseUrl: configuredEntry?.baseUrl ?? "",
            ...(configuredEntry?.apiFormat ? { apiFormat: configuredEntry.apiFormat } : {}),
            ...(configuredEntry?.stream !== undefined ? { stream: configuredEntry.stream } : {}),
          } as ProjectConfig["llm"]);
          await chatCompletion(
            probeClient,
            reqModel ?? config.llm.model,
            [{ role: "user", content: "ping" }],
            { maxTokens: 5 },
          );
        } catch (probeError) {
          const probeMessage = probeError instanceof Error ? probeError.message : String(probeError);
          if (resolveCreatedBookIdFromToolExecs(collectedToolExecs)) {
            await finalizeCreatedBook();
          }
          return c.json({
            error: { code: "AGENT_EMPTY_RESPONSE", message: probeMessage },
            response: probeMessage,
          }, 502);
        }

        const emptyMessage = "模型未返回文本内容。请检查协议类型（chat/responses）、流式开关或上游服务兼容性。";
        if (resolveCreatedBookIdFromToolExecs(collectedToolExecs)) {
          await finalizeCreatedBook();
        }
        return c.json({
          error: { code: "AGENT_EMPTY_RESPONSE", message: emptyMessage },
          response: emptyMessage,
        }, 502);
      }
      await refreshBookSessionFromTranscript();
      await finalizeCreatedBook();

      broadcast("agent:complete", { instruction, activeBookId, sessionId: bookSession.sessionId });

      return c.json({
        response: result.responseText,
        session: {
          sessionId: bookSession.sessionId,
          ...(bookSession.bookId ? { activeBookId: bookSession.bookId } : {}),
        },
      });
    } catch (e) {
      if (e instanceof ApiError) {
        throw e;
      }
      if (e instanceof SessionAlreadyMigratedError) {
        const migratedMessage = e instanceof Error ? e.message : String(e);
        throw new ApiError(409, "SESSION_ALREADY_MIGRATED", migratedMessage);
      }
      const msg = e instanceof Error ? e.message : String(e);
      broadcast("agent:error", { instruction, activeBookId, sessionId, error: msg });

      if (/already processing|prompt.*queue/i.test(msg)) {
        return c.json({
          error: { code: "AGENT_BUSY", message: "正在处理中，请等待当前操作完成" },
          response: "正在处理中，请等待当前操作完成后再发送。",
        }, 429);
      }

      return c.json(
        { error: { code: "AGENT_ERROR", message: msg } },
        500,
      );
    }
  });
}
