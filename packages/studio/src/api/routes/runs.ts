import { Hono } from "hono";
import type { RunAction, RunActionPayload } from "../../shared/contracts.js";
import { isTerminalRunStatus } from "../lib/run-store.js";
import { createRunEventStream } from "../lib/sse.js";
import { isSafeBookId } from "../errors.js";
import type { ChapterService } from "../services/chapter-service.js";
import { RunConflictError, type RunService } from "../services/run-service.js";

function jsonError(code: string, message: string, status: number, extra?: Record<string, unknown>) {
  return new Response(JSON.stringify({ error: { code, message, ...(extra ?? {}) } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function createRunRoutes(chapterService: ChapterService, runService: RunService): Hono {
  const app = new Hono();

  for (const action of ["draft", "audit", "revise", "write-next"] as const) {
    app.post(`/books/:bookId/actions/${action}`, async (c) => {
      const validated = await validateRunRequest(c.req.raw, c.req.param("bookId"), action);
      if (validated instanceof Response) {
        return validated;
      }

      if (!(await chapterService.hasBook(validated.bookId))) {
        return jsonError("BOOK_NOT_FOUND", `Book "${validated.bookId}" not found.`, 404);
      }

      try {
        const run = runService.startRun(validated);
        return c.json(run, 202);
      } catch (error) {
        if (error instanceof RunConflictError) {
          return jsonError("RUN_CONFLICT", error.message, 409, { runId: error.runId });
        }
        throw error;
      }
    });
  }

  app.get("/runs", (c) => c.json(runService.listRuns()));

  app.get("/runs/:runId/stream", (c) => {
    const run = runService.getRun(c.req.param("runId"));
    if (!run) {
      return jsonError("RUN_NOT_FOUND", `Run "${c.req.param("runId")}" not found.`, 404);
    }

    return createRunEventStream(
      { type: "snapshot", runId: run.id, run },
      (send) => runService.subscribe(run.id, send),
      (event) => event.type === "snapshot" && !!event.run && isTerminalRunStatus(event.run.status),
    );
  });

  return app;
}

async function validateRunRequest(
  request: Request,
  bookId: string,
  action: RunAction,
): Promise<{ bookId: string; action: RunAction; chapterNumber?: number } | Response> {
  if (!isSafeBookId(bookId)) {
    return jsonError("BOOK_NOT_FOUND", `Book "${bookId}" not found.`, 404);
  }

  let payload: RunActionPayload = {};
  if (request.headers.get("content-type")?.includes("application/json")) {
    try {
      payload = (await request.json()) as RunActionPayload;
    } catch {
      return jsonError("INVALID_PAYLOAD", 'Expected JSON payload with optional positive integer "chapterNumber".', 400);
    }
  }

  if (
    payload.chapterNumber !== undefined
    && (!Number.isInteger(payload.chapterNumber) || payload.chapterNumber < 1)
  ) {
    return jsonError("INVALID_PAYLOAD", 'Expected JSON payload with optional positive integer "chapterNumber".', 400);
  }

  return {
    bookId,
    action,
    ...(payload.chapterNumber !== undefined ? { chapterNumber: payload.chapterNumber } : {}),
  };
}
