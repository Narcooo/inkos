import {
  appendInteractionMessage,
  clearPendingDecision,
  createLLMClient,
  runAgentSession,
  type InteractionSession,
} from "@actalk/inkos-core";
import { persistProjectSession } from "./session-store.js";
import { buildPipelineConfig, loadConfig } from "../utils.js";

export async function processTuiAgentInput(params: {
  readonly projectRoot: string;
  readonly input: string;
  readonly session: InteractionSession;
  readonly activeBookId?: string;
  readonly onTextDelta?: (text: string) => void;
}) {
  const config = await loadConfig({ requireApiKey: false, projectRoot: params.projectRoot });
  const client = createLLMClient(config.llm);
  const pipeline = new (await import("@actalk/inkos-core")).PipelineRunner(
    buildPipelineConfig(config, params.projectRoot, { quiet: true }),
  );
  const userTimestamp = Date.now();
  const resolvedBookId = params.activeBookId ?? params.session.activeBookId ?? null;
  const initialMessages = params.session.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({ role: message.role, content: message.content }));

  let nextSession = appendInteractionMessage(clearPendingDecision({
    ...params.session,
    ...(resolvedBookId ? { activeBookId: resolvedBookId } : {}),
    currentExecution: {
      status: "planning",
      ...(resolvedBookId ? { bookId: resolvedBookId } : {}),
      ...(params.session.activeChapterNumber ? { chapterNumber: params.session.activeChapterNumber } : {}),
      stageLabel: "agent",
    },
  }), {
    role: "user",
    content: params.input,
    timestamp: userTimestamp,
  });

  const result = await runAgentSession(
    {
      sessionId: params.session.sessionId,
      bookId: resolvedBookId,
      language: config.language ?? "zh",
      pipeline,
      projectRoot: params.projectRoot,
      model: client._piModel
        ? client._piModel
        : { provider: config.llm.provider ?? "openai", modelId: config.llm.model },
      apiKey: client._apiKey,
      onEvent: (event: any) => {
        if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
          params.onTextDelta?.(event.assistantMessageEvent.delta);
        }
      },
    },
    params.input,
    initialMessages,
  );

  if (result.responseText?.trim()) {
    const lastAssistant = result.messages.filter((message: any) => message.role === "assistant").pop() as { thinking?: string } | undefined;
    nextSession = appendInteractionMessage({
      ...nextSession,
      currentExecution: {
        status: "completed",
        ...(resolvedBookId ? { bookId: resolvedBookId } : {}),
        ...(params.session.activeChapterNumber ? { chapterNumber: params.session.activeChapterNumber } : {}),
        stageLabel: "agent",
      },
    }, {
      role: "assistant",
      content: result.responseText,
      ...(lastAssistant?.thinking ? { thinking: lastAssistant.thinking } : {}),
      timestamp: userTimestamp + 1,
    });
  } else {
    nextSession = {
      ...nextSession,
      currentExecution: {
        status: "completed",
        ...(resolvedBookId ? { bookId: resolvedBookId } : {}),
        ...(params.session.activeChapterNumber ? { chapterNumber: params.session.activeChapterNumber } : {}),
        stageLabel: "agent",
      },
    };
  }

  await persistProjectSession(params.projectRoot, nextSession);
  return {
    responseText: result.responseText,
    session: nextSession,
  };
}
