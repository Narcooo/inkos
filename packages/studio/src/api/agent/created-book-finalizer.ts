import {
  migrateBookSession,
  SessionAlreadyMigratedError,
  type StateManager,
} from "@actalk/inkos-core";
import { loadStudioBookListSummary } from "../books/summary.js";
import type { CollectedToolExec } from "./execution.js";
import { resolveCreatedBookIdFromToolExecs } from "./execution.js";
import type { AgentSessionContext } from "./session-context.js";

export function createCreatedBookFinalizer(args: {
  readonly agentBookId: string | null;
  readonly bookCreateStatus: Map<string, { status: "creating" | "error"; error?: string }>;
  readonly broadcast: (event: string, data: unknown) => void;
  readonly collectedToolExecs: CollectedToolExec[];
  readonly root: string;
  readonly sessionContext: AgentSessionContext;
  readonly state: StateManager;
}) {
  let broadcastedCreatedBookId: string | null = null;

  return async function finalizeCreatedBook(): Promise<string | null> {
    if (args.agentBookId) return null;
    const createdBookId = resolveCreatedBookIdFromToolExecs(args.collectedToolExecs);
    if (!createdBookId) return null;
    if (broadcastedCreatedBookId === createdBookId) return createdBookId;

    try {
      const migratedSession = await migrateBookSession(
        args.root,
        args.sessionContext.bookSession.sessionId,
        createdBookId,
      );
      if (migratedSession) {
        args.sessionContext.bookSession = migratedSession;
      }
    } catch (e) {
      if (!(e instanceof SessionAlreadyMigratedError)) {
        throw e;
      }
    }

    const book = await loadStudioBookListSummary(args.state, createdBookId).catch(() => undefined);
    args.bookCreateStatus.delete(createdBookId);
    args.broadcast("book:created", {
      bookId: createdBookId,
      sessionId: args.sessionContext.bookSession.sessionId,
      ...(book ? { book } : {}),
    });
    broadcastedCreatedBookId = createdBookId;
    return createdBookId;
  };
}
