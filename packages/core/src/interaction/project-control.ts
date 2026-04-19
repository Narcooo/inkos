import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { appendInteractionEvent, appendInteractionMessage } from "./session.js";
import { routeNaturalLanguageIntent } from "./nl-router.js";
import type { InteractionRequest } from "./intents.js";
import type { InteractionRuntimeTools } from "./runtime.js";
import { runInteractionRequest } from "./runtime.js";
import {
  loadProjectSession,
  persistProjectSession,
  resolveSessionActiveBook,
} from "./project-session-store.js";

async function processProjectInteractionRequestInternal(params: {
  readonly projectRoot: string;
  readonly request: InteractionRequest;
  readonly tools: InteractionRuntimeTools;
  readonly activeBookId?: string;
}) {
  const requestLanguage = await detectProjectInteractionLanguage(params.projectRoot);
  const localizedRequest = attachRequestLanguage(params.request, requestLanguage);
  const session = await loadProjectSession(params.projectRoot);
  const restoredBookId = await resolveSessionActiveBook(params.projectRoot, session);
  const resolvedBookId = params.activeBookId ?? localizedRequest.bookId ?? restoredBookId;
  const sessionWithBook = resolvedBookId && session.activeBookId !== resolvedBookId
    ? { ...session, activeBookId: resolvedBookId }
    : session;

  try {
    const result = await runInteractionRequest({
      session: sessionWithBook,
      request: localizedRequest,
      tools: params.tools,
    });
    await persistProjectSession(params.projectRoot, result.session);
    return {
      ...result,
      request: localizedRequest,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const failedSession = appendInteractionEvent({
      ...sessionWithBook,
      currentExecution: {
        status: "failed",
        bookId: sessionWithBook.activeBookId,
        chapterNumber: sessionWithBook.activeChapterNumber,
        stageLabel: localizedRequest.language === "en" ? `failed ${localizedRequest.intent}` : `执行失败：${localizedRequest.intent}`,
      },
    }, {
      kind: "task.failed",
      timestamp: Date.now(),
      status: "failed",
      bookId: sessionWithBook.activeBookId,
      chapterNumber: sessionWithBook.activeChapterNumber,
      detail,
    });
    await persistProjectSession(params.projectRoot, failedSession);
    throw error;
  }
}

export async function processProjectInteractionInput(params: {
  readonly projectRoot: string;
  readonly input: string;
  readonly tools: InteractionRuntimeTools;
  readonly activeBookId?: string;
}) {
  const requestLanguage = await detectProjectInteractionLanguage(params.projectRoot);
  const session = await loadProjectSession(params.projectRoot);
  const restoredBookId = await resolveSessionActiveBook(params.projectRoot, session);
  const resolvedBookId = params.activeBookId ?? restoredBookId;
  const sessionWithBook = resolvedBookId && session.activeBookId !== resolvedBookId
    ? { ...session, activeBookId: resolvedBookId }
    : session;
  const userSession = appendInteractionMessage(sessionWithBook, {
    role: "user",
    content: params.input,
    timestamp: Date.now(),
  });
  const request = attachRequestLanguage(routeNaturalLanguageIntent(params.input, {
    activeBookId: userSession.activeBookId,
    hasCreationDraft: Boolean(userSession.creationDraft),
  }), requestLanguage);
  try {
    const result = await runInteractionRequest({
      session: userSession,
      request,
      tools: params.tools,
    });
    await persistProjectSession(params.projectRoot, result.session);
    return {
      ...result,
      request,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const failedSession = appendInteractionEvent({
      ...userSession,
      currentExecution: {
        status: "failed",
        bookId: userSession.activeBookId,
        chapterNumber: userSession.activeChapterNumber,
        stageLabel: request.language === "en" ? `failed ${request.intent}` : `执行失败：${request.intent}`,
      },
    }, {
      kind: "task.failed",
      timestamp: Date.now(),
      status: "failed",
      bookId: userSession.activeBookId,
      chapterNumber: userSession.activeChapterNumber,
      detail,
    });
    await persistProjectSession(params.projectRoot, failedSession);
    throw error;
  }
}

export async function processProjectInteractionRequest(params: {
  readonly projectRoot: string;
  readonly request: InteractionRequest;
  readonly tools: InteractionRuntimeTools;
  readonly activeBookId?: string;
}) {
  return processProjectInteractionRequestInternal(params);
}

function attachRequestLanguage(
  request: InteractionRequest,
  language: "zh" | "en" | undefined,
): InteractionRequest {
  if (request.language || !language) {
    return request;
  }

  return {
    ...request,
    language,
  };
}

async function detectProjectInteractionLanguage(projectRoot: string): Promise<"zh" | "en" | undefined> {
  try {
    const raw = await readFile(join(projectRoot, "inkos.json"), "utf-8");
    const parsed = JSON.parse(raw) as { language?: string };
    return parsed.language === "en" ? "en" : parsed.language === "zh" ? "zh" : undefined;
  } catch {
    return undefined;
  }
}
