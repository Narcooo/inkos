import { PipelineRunner } from "./runner.js";
import type { PipelineConfig } from "./runner.js";
import { StateManager } from "../state/manager.js";
import type { BookConfig } from "../models/book.js";
import type { QualityGates, DetectionConfig } from "../models/project.js";
import { dispatchWebhookEvent } from "../notify/dispatcher.js";
import { detectChapter, detectAndRewrite } from "./detection-runner.js";
import type { Logger } from "../utils/logger.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface SchedulerConfig extends PipelineConfig {
  readonly radarCron: string;
  readonly writeCron: string;
  readonly maxConcurrentBooks: number;
  readonly chaptersPerCycle: number;
  readonly retryDelayMs: number;
  readonly cooldownAfterChapterMs: number;
  readonly maxChaptersPerDay: number;
  readonly qualityGates?: QualityGates;
  readonly detection?: DetectionConfig;
  readonly onChapterComplete?: (bookId: string, chapter: number, status: string) => void;
  readonly onError?: (bookId: string, error: Error) => void;
  readonly onPause?: (bookId: string, reason: string) => void;
}

interface ScheduledTask {
  readonly name: string;
  readonly intervalMs: number;
  timer?: ReturnType<typeof setInterval>;
}

// ─── Forma persistida del estado del scheduler ───

interface PersistedSchedulerState {
  /** bookId → número de fallos consecutivos */
  consecutiveFailures: Record<string, number>;
  /** bookIds pausados */
  pausedBooks: string[];
  /** bookId → (dimensión → contador) */
  failureDimensions: Record<string, Record<string, number>>;
  /** "YYYY-MM-DD" → contador */
  dailyChapterCount: Record<string, number>;
  /** Timestamp de última persistencia */
  savedAt: string;
}

export class Scheduler {
  private readonly pipeline: PipelineRunner;
  private readonly state: StateManager;
  private readonly config: SchedulerConfig;
  private tasks: ScheduledTask[] = [];
  private running = false;

  // Quality gate tracking (per book) — ahora respaldados por disco
  private consecutiveFailures = new Map<string, number>();
  private pausedBooks = new Set<string>();
  private failureDimensions = new Map<string, Map<string, number>>();
  private dailyChapterCount = new Map<string, number>();

  private readonly log?: Logger;
  private readonly statePath: string;

  constructor(config: SchedulerConfig) {
    this.config = config;
    this.pipeline = new PipelineRunner(config);
    this.state = new StateManager(config.projectRoot);
    this.log = config.logger?.child("scheduler");
    this.statePath = join(config.projectRoot, "scheduler_state.json");
  }

  async start(): Promise<void> {
    if (this.running) return;

    // Restaura estado previo desde disco
    await this.loadState();

    this.running = true;

    // Run write cycle immediately on start, then schedule
    await this.runWriteCycle();

    // Schedule recurring write cycle
    const writeCycleMs = this.cronToMs(this.config.writeCron);
    const writeTask: ScheduledTask = {
      name: "write-cycle",
      intervalMs: writeCycleMs,
    };
    writeTask.timer = setInterval(() => {
      this.runWriteCycle().catch((e) => {
        this.config.onError?.("scheduler", e as Error);
      });
    }, writeCycleMs);
    this.tasks.push(writeTask);

    // Schedule radar scan
    const radarMs = this.cronToMs(this.config.radarCron);
    const radarTask: ScheduledTask = {
      name: "radar-scan",
      intervalMs: radarMs,
    };
    radarTask.timer = setInterval(() => {
      this.runRadarScan().catch((e) => {
        this.config.onError?.("radar", e as Error);
      });
    }, radarMs);
    this.tasks.push(radarTask);
  }

  stop(): void {
    this.running = false;
    for (const task of this.tasks) {
      if (task.timer) clearInterval(task.timer);
    }
    this.tasks = [];
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Resume a paused book. */
  async resumeBook(bookId: string): Promise<void> {
    this.pausedBooks.delete(bookId);
    this.consecutiveFailures.delete(bookId);
    this.failureDimensions.delete(bookId);
    await this.persistState();
  }

  /** Check if a book is paused. */
  isBookPaused(bookId: string): boolean {
    return this.pausedBooks.has(bookId);
  }

  private get gates(): QualityGates {
    return this.config.qualityGates ?? {
      maxAuditRetries: 2,
      pauseAfterConsecutiveFailures: 3,
      retryTemperatureStep: 0.1,
    };
  }

  /** Check if daily cap is reached across all books. */
  private isDailyCapReached(): boolean {
    const today = new Date().toISOString().slice(0, 10);
    const count = this.dailyChapterCount.get(today) ?? 0;
    return count >= this.config.maxChaptersPerDay;
  }

  /** Increment daily chapter counter. */
  private async recordChapterWritten(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const count = this.dailyChapterCount.get(today) ?? 0;
    this.dailyChapterCount.set(today, count + 1);

    // Clean up old dates (keep only today)
    for (const key of this.dailyChapterCount.keys()) {
      if (key !== today) this.dailyChapterCount.delete(key);
    }
    await this.persistState();
  }

  private async runWriteCycle(): Promise<void> {
    if (this.isDailyCapReached()) {
      this.log?.info(`Daily cap reached (${this.config.maxChaptersPerDay}), skipping cycle`);
      return;
    }

    const bookIds = await this.state.listBooks();

    const activeBooks: Array<{ readonly id: string; readonly config: BookConfig }> = [];
    for (const id of bookIds) {
      if (this.pausedBooks.has(id)) continue;
      const config = await this.state.loadBookConfig(id);
      if (config.status === "active" || config.status === "outlining") {
        activeBooks.push({ id, config });
      }
    }

    const booksToWrite = activeBooks.slice(0, this.config.maxConcurrentBooks);

    // Parallel book processing
    await Promise.all(
      booksToWrite.map((book) => this.processBook(book.id, book.config)),
    );
  }

  /** Process a single book: write chaptersPerCycle chapters with retry + cooldown. */
  private async processBook(bookId: string, bookConfig: BookConfig): Promise<void> {
    for (let i = 0; i < this.config.chaptersPerCycle; i++) {
      if (!this.running) return;
      if (this.isDailyCapReached()) return;
      if (this.pausedBooks.has(bookId)) return;

      // Cooldown between chapters (skip for the first one)
      if (i > 0 && this.config.cooldownAfterChapterMs > 0) {
        await this.sleep(this.config.cooldownAfterChapterMs);
      }

      const success = await this.writeOneChapter(bookId, bookConfig);
      if (!success) {
        // Immediate retry with delay (if within retry limit)
        const failures = this.consecutiveFailures.get(bookId) ?? 0;
        if (failures <= this.gates.maxAuditRetries && this.config.retryDelayMs > 0) {
          this.log?.warn(`${bookId} retrying in ${this.config.retryDelayMs}ms`);
          await this.sleep(this.config.retryDelayMs);
          const retrySuccess = await this.writeOneChapter(bookId, bookConfig);
          if (!retrySuccess) break; // Stop this book's cycle on second failure
        } else {
          break; // Stop this book's cycle
        }
      }
    }
  }

  /** Write one chapter for a book. Returns true if approved. */
  private async writeOneChapter(bookId: string, bookConfig: BookConfig): Promise<boolean> {
    try {
      // Compute temperature override: base 0.7 + failures * step
      const failures = this.consecutiveFailures.get(bookId) ?? 0;
      const tempOverride = failures > 0
        ? Math.min(1.2, 0.7 + failures * this.gates.retryTemperatureStep)
        : undefined;

      const result = await this.pipeline.writeNextChapter(bookId, undefined, tempOverride);

      if (result.status === "ready-for-review") {
        this.consecutiveFailures.delete(bookId);
        await this.recordChapterWritten();

        // Auto-detection loop after successful audit
        if (this.config.detection?.enabled) {
          await this.runDetection(bookId, bookConfig, result.chapterNumber);
        }

        this.config.onChapterComplete?.(bookId, result.chapterNumber, result.status);
        return true;
      }

      // Audit failed — apply quality gates
      const issueCategories = result.auditResult.issues.map((i) => i.category);
      await this.handleAuditFailure(bookId, result.chapterNumber, issueCategories);
      this.config.onChapterComplete?.(bookId, result.chapterNumber, result.status);
      return false;
    } catch (e) {
      this.config.onError?.(bookId, e as Error);
      await this.handleAuditFailure(bookId, 0);
      return false;
    }
  }

  private async runDetection(
    bookId: string,
    bookConfig: BookConfig,
    chapterNumber: number,
  ): Promise<void> {
    if (!this.config.detection) return;
    try {
      const bookDir = this.state.bookDir(bookId);
      const chapterContent = await this.readChapterContent(bookDir, chapterNumber);
      const detResult = await detectChapter(
        this.config.detection,
        chapterContent,
        chapterNumber,
      );
      if (!detResult.passed && this.config.detection.autoRewrite) {
        await detectAndRewrite(
          this.config.detection,
          { client: this.config.client, model: this.config.model, projectRoot: this.config.projectRoot },
          bookDir,
          chapterContent,
          chapterNumber,
          bookConfig.genre,
        );
      }
    } catch (e) {
      this.config.onError?.(bookId, e as Error);
    }
  }

  private async handleAuditFailure(
    bookId: string,
    chapterNumber: number,
    issueCategories: ReadonlyArray<string> = [],
  ): Promise<void> {
    const failures = (this.consecutiveFailures.get(bookId) ?? 0) + 1;
    this.consecutiveFailures.set(bookId, failures);

    // Track failure dimensions for clustering
    if (issueCategories.length > 0) {
      const existing = this.failureDimensions.get(bookId);
      const dimMap = existing ? new Map(existing) : new Map<string, number>();
      for (const cat of issueCategories) {
        dimMap.set(cat, (dimMap.get(cat) ?? 0) + 1);
      }
      this.failureDimensions.set(bookId, dimMap);

      // Check for dimension clustering (any dimension with >=3 failures)
      for (const [dimension, count] of dimMap) {
        if (count >= 3) {
          await this.emitDiagnosticAlert(bookId, chapterNumber, dimension, count);
        }
      }
    }

    const gates = this.gates;

    if (failures <= gates.maxAuditRetries) {
      this.log?.warn(`${bookId} audit failed (${failures}/${gates.maxAuditRetries}), will retry`);
      await this.persistState();
      return;
    }

    // Check if we should pause
    if (failures >= gates.pauseAfterConsecutiveFailures) {
      this.pausedBooks.add(bookId);
      const reason = `${failures} consecutive audit failures (threshold: ${gates.pauseAfterConsecutiveFailures})`;
      this.log?.error(`${bookId} PAUSED: ${reason}`);
      this.config.onPause?.(bookId, reason);

      if (this.config.notifyChannels && this.config.notifyChannels.length > 0) {
        await dispatchWebhookEvent(this.config.notifyChannels, {
          event: "pipeline-error",
          bookId,
          chapterNumber: chapterNumber > 0 ? chapterNumber : undefined,
          timestamp: new Date().toISOString(),
          data: { reason, consecutiveFailures: failures },
        });
      }
    }

    await this.persistState();
  }

  private async runRadarScan(): Promise<void> {
    try {
      await this.pipeline.runRadar();
    } catch (e) {
      this.config.onError?.("radar", e as Error);
    }
  }

  private async emitDiagnosticAlert(
    bookId: string,
    chapterNumber: number,
    dimension: string,
    count: number,
  ): Promise<void> {
    this.log?.warn(`DIAGNOSTIC: ${bookId} has ${count} failures in dimension "${dimension}"`);

    if (this.config.notifyChannels && this.config.notifyChannels.length > 0) {
      await dispatchWebhookEvent(this.config.notifyChannels, {
        event: "diagnostic-alert",
        bookId,
        chapterNumber: chapterNumber > 0 ? chapterNumber : undefined,
        timestamp: new Date().toISOString(),
        data: { dimension, failureCount: count },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // State persistence — garantiza que reinicios no pierden estado crítico
  // ---------------------------------------------------------------------------

  /** Persiste el estado actual del scheduler a disco. */
  private async persistState(): Promise<void> {
    const data: PersistedSchedulerState = {
      consecutiveFailures: Object.fromEntries(this.consecutiveFailures),
      pausedBooks: [...this.pausedBooks],
      failureDimensions: Object.fromEntries(
        [...this.failureDimensions].map(([bookId, dimMap]) => [
          bookId,
          Object.fromEntries(dimMap),
        ]),
      ),
      dailyChapterCount: Object.fromEntries(this.dailyChapterCount),
      savedAt: new Date().toISOString(),
    };

    try {
      await mkdir(join(this.config.projectRoot), { recursive: true });
      await writeFile(this.statePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (e) {
      this.log?.error(`Failed to persist scheduler state: ${e}`);
    }
  }

  /** Restaura el estado del scheduler desde disco. */
  private async loadState(): Promise<void> {
    try {
      const raw = await readFile(this.statePath, "utf-8");
      const data: PersistedSchedulerState = JSON.parse(raw);

      // Restaura failures
      this.consecutiveFailures = new Map(Object.entries(data.consecutiveFailures ?? {}));

      // Restaura pausas
      this.pausedBooks = new Set(data.pausedBooks ?? []);

      // Restaura dimensiones de fallo
      this.failureDimensions = new Map(
        Object.entries(data.failureDimensions ?? {}).map(([bookId, dims]) => [
          bookId,
          new Map(Object.entries(dims)),
        ]),
      );

      // Restaura contador diario (descarta fechas que no sean hoy)
      const today = new Date().toISOString().slice(0, 10);
      this.dailyChapterCount = new Map();
      for (const [date, count] of Object.entries(data.dailyChapterCount ?? {})) {
        if (date === today) {
          this.dailyChapterCount.set(date, count);
        }
      }

      const pauseCount = this.pausedBooks.size;
      const failCount = this.consecutiveFailures.size;
      const dailyCount = this.dailyChapterCount.get(today) ?? 0;

      this.log?.info(
        `Scheduler state restored: ${pauseCount} paused, ${failCount} with failures, ${dailyCount} written today`,
      );
    } catch {
      // Primer arranque o archivo corrupto — estado en blanco
      this.log?.info("No previous scheduler state found, starting fresh");
    }
  }

  private async readChapterContent(bookDir: string, chapterNumber: number): Promise<string> {
    const { readdir } = await import("node:fs/promises");
    const chaptersDir = join(bookDir, "chapters");
    const files = await readdir(chaptersDir);
    const paddedNum = String(chapterNumber).padStart(4, "0");
    const chapterFile = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
    if (!chapterFile) {
      throw new Error(`Chapter ${chapterNumber} file not found in ${chaptersDir}`);
    }
    const raw = await readFile(join(chaptersDir, chapterFile), "utf-8");
    const lines = raw.split("\n");
    const contentStart = lines.findIndex((l, i) => i > 0 && l.trim().length > 0);
    return contentStart >= 0 ? lines.slice(contentStart).join("\n") : raw;
  }

  private cronToMs(cron: string): number {
    const parts = cron.split(" ");
    if (parts.length < 5) return 24 * 60 * 60 * 1000;

    const minute = parts[0]!;
    const hour = parts[1]!;

    // "*/N * * * *" → every N minutes
    if (minute.startsWith("*/")) {
      const interval = parseInt(minute.slice(2), 10);
      return interval * 60 * 1000;
    }

    // "0 */N * * *" → every N hours
    if (hour.startsWith("*/")) {
      const interval = parseInt(hour.slice(2), 10);
      return interval * 60 * 60 * 1000;
    }

    // Fixed time → treat as daily
    return 24 * 60 * 60 * 1000;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
