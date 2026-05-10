import {
  loadBookSession,
  type StateManager,
} from "@actalk/inkos-core";
import { ApiError } from "../errors.js";

type LoadedBookSession = NonNullable<Awaited<ReturnType<typeof loadBookSession>>>;

export interface AgentSessionContext {
  agentBookId: string | null;
  bookSession: LoadedBookSession;
  refreshBookSessionFromTranscript: () => Promise<void>;
  streamSessionId: string;
}

export async function createAgentSessionContext(args: {
  readonly root: string;
  readonly state: StateManager;
  readonly activeBookId?: string;
  readonly sessionId: string;
  readonly normalizeApiBookId: (value: unknown, fieldName: string) => string | null;
  readonly broadcast: (event: string, data: unknown) => void;
}): Promise<AgentSessionContext> {
  const loadedBookSession = await loadBookSession(args.root, args.sessionId);
  if (!loadedBookSession) {
    throw new ApiError(404, "SESSION_NOT_FOUND", `Session not found: ${args.sessionId}`);
  }

  const requestedActiveBookId = args.normalizeApiBookId(args.activeBookId, "activeBookId");
  const persistedBookId = args.normalizeApiBookId(loadedBookSession.bookId, "session.bookId");
  if (
    requestedActiveBookId
    && persistedBookId
    && persistedBookId !== requestedActiveBookId
  ) {
    throw new ApiError(
      409,
      "SESSION_BOOK_MISMATCH",
      `Session ${loadedBookSession.sessionId} is bound to ${persistedBookId}, not ${requestedActiveBookId}`,
    );
  }

  const context: AgentSessionContext = {
    agentBookId: requestedActiveBookId ?? persistedBookId,
    bookSession: loadedBookSession,
    streamSessionId: loadedBookSession.sessionId,
    refreshBookSessionFromTranscript: async () => undefined,
  };

  if (context.agentBookId) {
    try {
      await args.state.loadBookConfig(context.agentBookId);
    } catch {
      throw new ApiError(404, "BOOK_NOT_FOUND", `Book not found: ${context.agentBookId}`);
    }
  }

  const titleBeforeRun = context.bookSession.title;
  let sessionTitleBroadcasted = false;
  context.refreshBookSessionFromTranscript = async (): Promise<void> => {
    const refreshed = await loadBookSession(args.root, context.bookSession.sessionId);
    if (refreshed) {
      context.bookSession = refreshed;
    }
    if (!sessionTitleBroadcasted && titleBeforeRun === null && context.bookSession.title) {
      args.broadcast("session:title", {
        sessionId: context.bookSession.sessionId,
        title: context.bookSession.title,
      });
      sessionTitleBroadcasted = true;
    }
  };

  return context;
}
