import {
  createLLMClient,
  PipelineRunner,
  runAgentSession,
  SessionAlreadyMigratedError,
} from "@actalk/inkos-core";
import { ApiError } from "../errors.js";
import {
  AgentModelApiKeyError,
  createAgentPipelineClient,
  resolveAgentModel,
} from "./model-resolution.js";
import { createCreatedBookFinalizer } from "./created-book-finalizer.js";
import { runDirectWriteNext } from "./direct-write-next.js";
import { recoverEmptyAgentResponse } from "./empty-response-recovery.js";
import {
  type CollectedToolExec,
  isWriteNextInstruction,
  validateAgentActionExecution,
} from "./execution.js";
import type {
  AgentRouteDependencies,
  AgentRouteRequest,
  AgentRouteResult,
} from "./route-types.js";
import { createAgentSessionContext } from "./session-context.js";
import { createAgentSessionEventHandler } from "./session-events.js";

export async function handleAgentRoute(
  request: AgentRouteRequest,
  deps: AgentRouteDependencies,
): Promise<AgentRouteResult> {
  const {
    instruction,
    activeBookId,
    sessionId,
    model: reqModel,
    service: reqService,
  } = request;

  deps.broadcast("agent:start", { instruction, activeBookId, sessionId });

  try {
    const config = await deps.loadCurrentProjectConfig({ requireApiKey: false });
    const client = createLLMClient(config.llm);
    const sessionContext = await createAgentSessionContext({
      root: deps.root,
      state: deps.state,
      activeBookId,
      sessionId: sessionId ?? "",
      normalizeApiBookId: deps.normalizeApiBookId,
      broadcast: deps.broadcast,
    });

    let modelResolution: Awaited<ReturnType<typeof resolveAgentModel>>;
    try {
      modelResolution = await resolveAgentModel({
        root: deps.root,
        config,
        client,
        requestedService: reqService,
        requestedModel: reqModel,
      });
    } catch (e) {
      if (e instanceof AgentModelApiKeyError) {
        return {
          body: {
            error: e.message,
            response: `${e.message}，然后再试。`,
          },
          status: 400,
        };
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
    const pipeline = new PipelineRunner(await deps.buildPipelineConfig({
      client: pipelineClient,
      model: reqModel ?? config.llm.model,
      currentConfig: config,
      sessionIdForSSE: sessionContext.bookSession.sessionId,
    }));

    if (sessionContext.agentBookId && isWriteNextInstruction(instruction)) {
      return runDirectWriteNext({
        agentBookId: sessionContext.agentBookId,
        broadcast: deps.broadcast,
        config,
        configuredEntry,
        instruction,
        pipeline,
        requestedModel: reqModel,
        requestedService: reqService,
        root: deps.root,
        sessionContext,
      });
    }

    const collectedToolExecs: CollectedToolExec[] = [];
    const result = await runAgentSession(
      {
        model,
        apiKey: agentApiKey,
        pipeline,
        projectRoot: deps.root,
        bookId: sessionContext.agentBookId,
        sessionId: sessionContext.bookSession.sessionId,
        language: config.language ?? "zh",
        onEvent: createAgentSessionEventHandler({
          collectedToolExecs,
          agentBookId: sessionContext.agentBookId,
          streamSessionId: sessionContext.streamSessionId,
          bookCreateStatus: deps.bookCreateStatus,
          broadcast: deps.broadcast,
        }),
      },
      instruction,
    );

    if (result.responseText) {
      const actionExecutionError = validateAgentActionExecution({
        instruction,
        agentBookId: sessionContext.agentBookId,
        responseText: result.responseText,
        collectedToolExecs,
      });
      if (actionExecutionError) {
        return {
          body: {
            error: { code: "AGENT_ACTION_NOT_EXECUTED", message: actionExecutionError },
            response: actionExecutionError,
          },
          status: 502,
        };
      }
    }

    const finalizeCreatedBook = createCreatedBookFinalizer({
      agentBookId: sessionContext.agentBookId,
      bookCreateStatus: deps.bookCreateStatus,
      broadcast: deps.broadcast,
      collectedToolExecs,
      root: deps.root,
      sessionContext,
      state: deps.state,
    });

    if (!result.responseText) {
      return recoverEmptyAgentResponse({
        agentApiKey,
        agentBookId: sessionContext.agentBookId,
        collectedToolExecs,
        config,
        configuredEntry,
        finalizeCreatedBook,
        instruction,
        requestedModel: reqModel,
        requestedService: reqService,
        result,
        root: deps.root,
        sessionContext,
      });
    }

    await sessionContext.refreshBookSessionFromTranscript();
    await finalizeCreatedBook();

    deps.broadcast("agent:complete", {
      instruction,
      activeBookId,
      sessionId: sessionContext.bookSession.sessionId,
    });

    return {
      body: {
        response: result.responseText,
        session: {
          sessionId: sessionContext.bookSession.sessionId,
          ...(sessionContext.bookSession.bookId ? { activeBookId: sessionContext.bookSession.bookId } : {}),
        },
      },
    };
  } catch (e) {
    if (e instanceof ApiError) {
      throw e;
    }
    if (e instanceof SessionAlreadyMigratedError) {
      const migratedMessage = e instanceof Error ? e.message : String(e);
      throw new ApiError(409, "SESSION_ALREADY_MIGRATED", migratedMessage);
    }
    const msg = e instanceof Error ? e.message : String(e);
    deps.broadcast("agent:error", { instruction, activeBookId, sessionId, error: msg });

    if (/already processing|prompt.*queue/i.test(msg)) {
      return {
        body: {
          error: { code: "AGENT_BUSY", message: "正在处理中，请等待当前操作完成" },
          response: "正在处理中，请等待当前操作完成后再发送。",
        },
        status: 429,
      };
    }

    return {
      body: { error: { code: "AGENT_ERROR", message: msg } },
      status: 500,
    };
  }
}
