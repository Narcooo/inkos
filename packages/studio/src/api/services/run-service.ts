import {
  PipelineRunner,
  createLLMClient,
  createLogger,
  loadProjectConfig,
  type LogEntry,
} from "@actalk/inkos-core";
import type { RunAction, RunLogEntry, RunStreamEvent, StudioRun } from "../../shared/contracts.js";
import { RunStore } from "../lib/run-store.js";

export interface RunExecutionContext {
  readonly runId: string;
  readonly action: RunAction;
  readonly bookId: string;
  readonly chapterNumber: number | null;
  emitStage(stage: string): void;
  emitLog(message: string, level?: RunLogEntry["level"]): void;
}

export type RunExecutor = (context: RunExecutionContext) => Promise<unknown>;

export class RunConflictError extends Error {
  constructor(readonly runId: string, message = `A write run is already active (${runId}).`) {
    super(message);
  }
}

export class RunService {
  constructor(
    private readonly projectRoot: string,
    private readonly store = new RunStore(),
    private readonly executor: RunExecutor = createPipelineExecutor(projectRoot),
  ) {}

  listRuns(): ReadonlyArray<StudioRun> {
    return this.store.list();
  }

  getRun(runId: string): StudioRun | null {
    return this.store.get(runId);
  }

  subscribe(runId: string, subscriber: (event: RunStreamEvent) => void): () => void {
    return this.store.subscribe(runId, subscriber);
  }

  startRun(input: { bookId: string; action: RunAction; chapterNumber?: number }): StudioRun {
    const activeRun = this.store.findActiveRun(input.bookId);
    if (activeRun) {
      throw new RunConflictError(activeRun.id, `A run is already active for book "${input.bookId}".`);
    }

    const run = this.store.create(input);
    this.store.markRunning(run.id, this.labelAction(input.action));

    void this.execute(run.id);
    return this.getRun(run.id)!;
  }

  private async execute(runId: string): Promise<void> {
    const run = this.store.get(runId);
    if (!run) {
      return;
    }

    try {
      const result = await this.executor({
        runId: run.id,
        action: run.action,
        bookId: run.bookId,
        chapterNumber: run.chapterNumber,
        emitStage: (stage) => {
          this.store.updateStage(run.id, stage);
        },
        emitLog: (message, level = "info") => {
          this.store.appendLog(run.id, {
            timestamp: new Date().toISOString(),
            level,
            message,
          });
        },
      });
      this.store.succeed(run.id, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Run failed.";
      this.store.appendLog(run.id, {
        timestamp: new Date().toISOString(),
        level: "error",
        message,
      });
      this.store.fail(run.id, message);
    }
  }

  private labelAction(action: RunAction): string {
    switch (action) {
      case "draft":
        return "Drafting";
      case "audit":
        return "Auditing";
      case "revise":
        return "Revising";
      case "write-next":
        return "Writing next chapter";
    }
  }
}

function createPipelineExecutor(projectRoot: string): RunExecutor {
  return async ({ action, bookId, chapterNumber, emitStage, emitLog }) => {
    const config = await loadProjectConfig(projectRoot);
    const logger = createLogger({
      tag: "studio-run",
      sinks: [{
        write(entry: LogEntry) {
          emitStage(entry.message);
          emitLog(entry.message, entry.level === "debug" ? "info" : entry.level);
        },
      }],
    });

    const pipeline = new PipelineRunner({
      client: createLLMClient(config.llm),
      model: config.llm.model,
      projectRoot,
      defaultLLMConfig: config.llm,
      modelOverrides: config.modelOverrides,
      inputGovernanceMode: config.inputGovernanceMode,
      notifyChannels: config.notify,
      logger,
      onStreamProgress(progress) {
        emitLog(`Streaming ${progress.totalChars} chars after ${Math.round(progress.elapsedMs / 1000)}s.`);
      },
    });

    switch (action) {
      case "draft":
        return pipeline.writeDraft(bookId);
      case "audit":
        return pipeline.auditDraft(bookId, chapterNumber ?? undefined);
      case "revise":
        return pipeline.reviseDraft(bookId, chapterNumber ?? undefined);
      case "write-next":
        return pipeline.writeNextChapter(bookId);
    }
  };
}
