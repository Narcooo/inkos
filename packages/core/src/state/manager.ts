import { ownsWorkMutation } from "../utils/work-mutation-scope.js";
import { readFile, writeFile, mkdir, readdir, rm, stat, unlink, open } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { BookConfigSchema, type BookConfig, type WritingLanguage } from "../models/book.js";
import { ChapterMetaSchema, type ChapterMeta } from "../models/chapter.js";
import { resolveDurableStoryProgress } from "./state-bootstrap.js";
import {
  createWorkManifest,
  listWorkManifests,
  loadWorkManifest,
  saveWorkManifest,
  workDirectory,
} from "../harness/work-store.js";
import { syncWorkSourceArtifacts } from "../harness/source-sync.js";
import { commitAtomicFileSet } from "../utils/atomic-file-set.js";

const BOOK_LOCK_HEARTBEAT_MS = 30_000;
const BOOK_LOCK_LEASE_MS = 3 * 60_000;
const BOOK_LOCK_RELEASE_RETRIES = 4;

interface BookLockMetadata {
  readonly version: 1;
  readonly pid: number;
  readonly token: string;
  readonly startedAt: number;
  heartbeatAt: number;
}

interface ProcessBookLock {
  readonly metadata: BookLockMetadata;
  heartbeatTimer?: ReturnType<typeof setInterval>;
  heartbeatTask?: Promise<void>;
}

// Studio creates a PipelineRunner per request. Lock ownership therefore has to
// be shared by every StateManager in this process, not stored on one instance.
const processBookLocks = new Map<string, ProcessBookLock>();

export class BookWriteLockError extends Error {
  readonly code = "BOOK_BUSY";

  constructor(
    readonly bookId: string,
    readonly lockPath: string,
    lockData?: string,
  ) {
    super(
      `Book "${bookId}" is locked by an active InkOS write${lockData ? ` (${lockData})` : ""}. ` +
      "Wait for it to finish or stop the running task, then retry. Stale locks are recovered automatically.",
    );
    this.name = "BookWriteLockError";
  }
}

export class StateManager {
  constructor(private readonly projectRoot: string) {}

  private static defaultAuthorIntent(language: WritingLanguage): string {
    return language === "zh"
      ? "# 作者意图\n\n（在这里描述这本书的长期创作方向。）\n"
      : "# Author Intent\n\n(Describe the long-horizon vision for this book here.)\n";
  }

  private static defaultCurrentFocus(language: WritingLanguage): string {
    return language === "zh"
      ? "# 当前聚焦\n\n## 当前重点\n\n（描述接下来 1-3 章最需要优先推进的内容。）\n"
      : "# Current Focus\n\n## Active Focus\n\n(Describe what the next 1-3 chapters should prioritize.)\n";
  }

  async ensureControlDocuments(bookId: string, authorIntent?: string): Promise<void> {
    const language = await this.resolveControlDocumentLanguage(bookId);
    await this.ensureControlDocumentsAt(this.bookDir(bookId), language, authorIntent);
  }

  async ensureControlDocumentsAt(
    bookDir: string,
    language: WritingLanguage,
    authorIntent?: string,
  ): Promise<void> {
    const storyDir = join(bookDir, "story");
    const runtimeDir = join(storyDir, "runtime");
    const outlineDir = join(storyDir, "outline");
    const rolesMajorDir = join(storyDir, "roles", "主要角色");
    const rolesMinorDir = join(storyDir, "roles", "次要角色");

    await mkdir(storyDir, { recursive: true });
    await mkdir(runtimeDir, { recursive: true });
    await mkdir(outlineDir, { recursive: true });
    await mkdir(rolesMajorDir, { recursive: true });
    await mkdir(rolesMinorDir, { recursive: true });

    await this.writeIfMissing(
      join(storyDir, "author_intent.md"),
      authorIntent?.trim()
        ? authorIntent.trimEnd() + "\n"
        : StateManager.defaultAuthorIntent(language),
    );

    await this.writeIfMissing(
      join(storyDir, "current_focus.md"),
      StateManager.defaultCurrentFocus(language),
    );

  }

  async loadControlDocuments(bookId: string): Promise<{
    authorIntent: string;
    currentFocus: string;
    runtimeDir: string;
  }> {
    await this.ensureControlDocuments(bookId);

    const storyDir = join(this.bookDir(bookId), "story");
    const runtimeDir = join(storyDir, "runtime");
    const [authorIntent, currentFocus] = await Promise.all([
      readFile(join(storyDir, "author_intent.md"), "utf-8"),
      readFile(join(storyDir, "current_focus.md"), "utf-8"),
    ]);

    return { authorIntent, currentFocus, runtimeDir };
  }

  private async resolveControlDocumentLanguage(bookId: string): Promise<WritingLanguage> {
    const raw = await readFile(join(this.bookDir(bookId), "book.json"), "utf-8");
    return BookConfigSchema.parse(JSON.parse(raw)).language;
  }

  async acquireBookLock(bookId: string): Promise<() => Promise<void>> {
    if (ownsWorkMutation(this.projectRoot, bookId)) return async () => {};
    await mkdir(this.bookDir(bookId), { recursive: true });
    const lockPath = join(this.bookDir(bookId), ".write.lock");
    const lockKey = this.normalizeLockKey(lockPath);
    const existingOwner = processBookLocks.get(lockKey);
    if (existingOwner) {
      throw new BookWriteLockError(bookId, lockPath, this.describeLock(existingOwner.metadata));
    }

    const now = Date.now();
    const owner: ProcessBookLock = {
      metadata: {
        version: 1,
        pid: process.pid,
        token: randomUUID(),
        startedAt: now,
        heartbeatAt: now,
      },
    };
    // Reserve synchronously before the first filesystem await so two
    // StateManager instances in this process cannot race through EEXIST and
    // mistake the other one's live file for a stale same-process lock.
    processBookLocks.set(lockKey, owner);

    try {
      let acquired = false;
      for (let attempt = 0; attempt < 4 && !acquired; attempt++) {
        try {
          await this.createLockFile(lockPath, owner.metadata);
          acquired = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException | undefined)?.code !== "EEXIST") {
            throw error;
          }

          let snapshot: Awaited<ReturnType<StateManager["readLockSnapshot"]>>;
          try {
            snapshot = await this.readLockSnapshot(lockPath);
          } catch (snapshotError) {
            if ((snapshotError as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
              continue;
            }
            throw snapshotError;
          }
          if (!this.isStaleLock(snapshot.metadata, snapshot.mtimeMs)) {
            throw new BookWriteLockError(bookId, lockPath, snapshot.raw);
          }
          await this.removeStaleLock(lockPath, snapshot.raw);
        }
      }

      if (!acquired) {
        throw new BookWriteLockError(bookId, lockPath);
      }

      this.startLockHeartbeat(lockPath, lockKey, owner);
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        if (owner.heartbeatTimer) clearInterval(owner.heartbeatTimer);
        await owner.heartbeatTask;
        if (processBookLocks.get(lockKey)?.metadata.token === owner.metadata.token) {
          processBookLocks.delete(lockKey);
        }
        try {
          const snapshot = await this.readLockSnapshot(lockPath);
          if (snapshot.metadata?.token !== owner.metadata.token) {
            return;
          }
          await this.unlinkWithRetry(lockPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
            console.warn(`[inkos] Failed to release book lock ${lockPath}: ${String(error)}`);
          }
        }
      };
    } catch (error) {
      if (processBookLocks.get(lockKey)?.metadata.token === owner.metadata.token) {
        processBookLocks.delete(lockKey);
      }
      throw error;
    }
  }

  private normalizeLockKey(lockPath: string): string {
    const absolute = resolve(lockPath);
    return process.platform === "win32" ? absolute.toLowerCase() : absolute;
  }

  private serializeLock(metadata: BookLockMetadata): string {
    return JSON.stringify(metadata);
  }

  private describeLock(metadata: BookLockMetadata): string {
    return `pid:${metadata.pid} started:${new Date(metadata.startedAt).toISOString()}`;
  }

  private async createLockFile(lockPath: string, metadata: BookLockMetadata): Promise<void> {
    const handle = await open(lockPath, "wx");
    try {
      await handle.writeFile(this.serializeLock(metadata), "utf-8");
    } catch (error) {
      await handle.close().catch(() => undefined);
      await this.unlinkWithRetry(lockPath).catch(() => undefined);
      throw error;
    }
    await handle.close();
  }

  private parseLockMetadata(lockData: string): Partial<BookLockMetadata> | undefined {
    try {
      const parsed = JSON.parse(lockData) as Record<string, unknown>;
      const pid = typeof parsed.pid === "number" ? parsed.pid : undefined;
      const startedAt = typeof parsed.startedAt === "number" ? parsed.startedAt : undefined;
      const heartbeatAt = typeof parsed.heartbeatAt === "number" ? parsed.heartbeatAt : startedAt;
      return {
        ...(parsed.version === 1 ? { version: 1 as const } : {}),
        ...(pid !== undefined ? { pid } : {}),
        ...(typeof parsed.token === "string" ? { token: parsed.token } : {}),
        ...(startedAt !== undefined ? { startedAt } : {}),
        ...(heartbeatAt !== undefined ? { heartbeatAt } : {}),
      };
    } catch {
      return undefined;
    }
  }

  private async readLockSnapshot(lockPath: string): Promise<{
    readonly raw: string;
    readonly metadata?: Partial<BookLockMetadata>;
    readonly mtimeMs: number;
  }> {
    const [raw, lockStat] = await Promise.all([
      readFile(lockPath, "utf-8"),
      stat(lockPath),
    ]);
    return { raw, metadata: this.parseLockMetadata(raw), mtimeMs: lockStat.mtimeMs };
  }

  private isStaleLock(metadata: Partial<BookLockMetadata> | undefined, mtimeMs: number): boolean {
    if (metadata?.pid === process.pid) {
      // No processBookLocks owner existed before this acquisition reserved its
      // slot, so a same-pid file here can only be orphaned from an older task.
      return true;
    }
    if (metadata?.pid !== undefined && !this.isProcessAlive(metadata.pid)) {
      return true;
    }
    const heartbeatAt = metadata?.heartbeatAt ?? mtimeMs;
    const hasLeaseMetadata = metadata?.version === 1 && typeof metadata.token === "string";
    return hasLeaseMetadata && Date.now() - heartbeatAt > BOOK_LOCK_LEASE_MS;
  }

  private async removeStaleLock(lockPath: string, expectedRaw: string): Promise<void> {
    const currentRaw = await readFile(lockPath, "utf-8").catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    });
    if (currentRaw === undefined) return;
    if (currentRaw !== expectedRaw) {
      return;
    }
    await this.unlinkWithRetry(lockPath);
  }

  private startLockHeartbeat(lockPath: string, lockKey: string, owner: ProcessBookLock): void {
    const refresh = async () => {
      if (processBookLocks.get(lockKey)?.metadata.token !== owner.metadata.token) return;
      const handle = await open(lockPath, "r+");
      try {
        const currentRaw = await handle.readFile("utf-8");
        if (this.parseLockMetadata(currentRaw)?.token !== owner.metadata.token) return;
        owner.metadata.heartbeatAt = Date.now();
        const serialized = Buffer.from(this.serializeLock(owner.metadata), "utf-8");
        await handle.write(serialized, 0, serialized.length, 0);
        await handle.truncate(serialized.length);
      } finally {
        await handle.close();
      }
    };
    owner.heartbeatTimer = setInterval(() => {
      if (owner.heartbeatTask) return;
      const task = refresh()
        .catch((error) => {
          console.warn(`[inkos] Failed to refresh book lock ${lockPath}: ${String(error)}`);
        })
        .finally(() => {
          if (owner.heartbeatTask === task) owner.heartbeatTask = undefined;
        });
      owner.heartbeatTask = task;
    }, BOOK_LOCK_HEARTBEAT_MS);
    owner.heartbeatTimer.unref?.();
  }

  private async unlinkWithRetry(lockPath: string): Promise<void> {
    for (let attempt = 0; attempt < BOOK_LOCK_RELEASE_RETRIES; attempt++) {
      try {
        await unlink(lockPath);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        if (code === "ENOENT") return;
        const retryable = code === "EPERM" || code === "EACCES" || code === "EBUSY";
        if (!retryable || attempt === BOOK_LOCK_RELEASE_RETRIES - 1) throw error;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 25 * (attempt + 1)));
      }
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ESRCH") {
        return false;
      }
      return true;
    }
  }

  get booksDir(): string {
    return join(this.projectRoot, "works");
  }

  bookDir(bookId: string): string {
    return join(workDirectory(this.projectRoot, bookId), "source");
  }

  stateDir(bookId: string): string {
    return join(this.bookDir(bookId), "story", "state");
  }

  async loadProjectConfig(): Promise<Record<string, unknown>> {
    const configPath = join(this.projectRoot, "inkos.json");
    const raw = await readFile(configPath, "utf-8");
    return JSON.parse(raw);
  }

  async saveProjectConfig(config: Record<string, unknown>): Promise<void> {
    const configPath = join(this.projectRoot, "inkos.json");
    await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  }

  async loadBookConfig(bookId: string): Promise<BookConfig> {
    const configPath = join(this.bookDir(bookId), "book.json");
    const raw = await readFile(configPath, "utf-8");
    if (!raw.trim()) {
      throw new Error(`book.json is empty for book "${bookId}"`);
    }
    return BookConfigSchema.parse(JSON.parse(raw));
  }

  async saveBookConfig(bookId: string, config: BookConfig): Promise<void> {
    await this.saveBookConfigAt(this.bookDir(bookId), config);
    try {
      await loadWorkManifest(this.projectRoot, bookId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await saveWorkManifest(this.projectRoot, createWorkManifest({
        id: bookId,
        title: config.title,
        profileId: "longform-novel",
        language: config.language,
        now: config.createdAt,
        lineage: config.parentBookId
          ? [{ relation: "derived-from", sourceWorkId: config.parentBookId }]
          : [],
        metadata: {
          genre: config.genre,
          platform: config.platform,
          ...(config.fanficMode ? { fanficMode: config.fanficMode } : {}),
        },
      }));
    }
    await syncWorkSourceArtifacts({ projectRoot: this.projectRoot, workId: bookId, language: config.language, updatedAt: config.updatedAt, accept: true, acceptPaths: ["source/book.json"] });
  }

  async saveBookConfigAt(bookDir: string, config: BookConfig): Promise<void> {
    const parsed = BookConfigSchema.parse(config);
    await mkdir(bookDir, { recursive: true });
    await writeFile(
      join(bookDir, "book.json"),
      JSON.stringify(parsed, null, 2),
      "utf-8",
    );
  }

  async listBooks(): Promise<ReadonlyArray<string>> {
    return (await listWorkManifests(this.projectRoot, "longform-novel")).map((work) => work.id);
  }

  async getNextChapterNumber(bookId: string): Promise<number> {
    const durableChapter = await resolveDurableStoryProgress({
      bookDir: this.bookDir(bookId),
    });
    return durableChapter + 1;
  }

  async getPersistedChapterCount(bookId: string): Promise<number> {
    const chaptersDir = join(this.bookDir(bookId), "chapters");
    const chapterNumbers = new Set<number>();

    try {
      const files = await readdir(chaptersDir);
      for (const file of files) {
        const match = file.match(/^(\d+)_.*\.md$/);
        if (!match) continue;
        chapterNumbers.add(parseInt(match[1]!, 10));
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }

    return chapterNumbers.size;
  }

  async loadChapterIndex(bookId: string): Promise<ReadonlyArray<ChapterMeta>> {
    const indexPath = join(this.bookDir(bookId), "chapters", "index.json");
    try {
      const raw = await readFile(indexPath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) throw new Error(`Chapter index is not an array: ${indexPath}`);
      return parsed.map((entry) => ChapterMetaSchema.parse(entry));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (await this.getPersistedChapterCount(bookId) > 0) {
        throw new Error(`Chapter index is missing while chapter files exist: ${indexPath}`);
      }
      return [];
    }
  }

  async saveChapterIndex(
    bookId: string,
    index: ReadonlyArray<ChapterMeta>,
    options: { readonly allowEmptyWithChapterFiles?: boolean } = {},
  ): Promise<void> {
    await this.saveChapterIndexAt(this.bookDir(bookId), index, options);
  }

  async saveChapterIndexAt(
    bookDir: string,
    index: ReadonlyArray<ChapterMeta>,
    options: { readonly allowEmptyWithChapterFiles?: boolean } = {},
  ): Promise<void> {
    const chaptersDir = join(bookDir, "chapters");
    await mkdir(chaptersDir, { recursive: true });
    if (index.length === 0 && !options.allowEmptyWithChapterFiles) {
      const files = await readdir(chaptersDir);
      if (files.some((file) => /^(\d+)_.*\.md$/u.test(file))) {
        throw new Error("Refusing to save an empty chapter index while chapter files still exist.");
      }
    }
    const validated = index.map((chapter) => ChapterMetaSchema.parse(chapter));
    await writeFile(
      join(chaptersDir, "index.json"),
      JSON.stringify(validated, null, 2),
      "utf-8",
    );
  }

  async snapshotState(bookId: string, chapterNumber: number): Promise<void> {
    await this.snapshotStateAt(this.bookDir(bookId), chapterNumber);
  }

  async snapshotStateAt(bookDir: string, chapterNumber: number): Promise<void> {
    const storyDir = join(bookDir, "story");
    const snapshotRoot = join("story", "snapshots", String(chapterNumber));
    const writes: Array<{ relativePath: string; content: string }> = [];
    for (const file of ["current_state.md", "pending_hooks.md", "chapter_summaries.md"]) {
      try {
        writes.push({ relativePath: join(snapshotRoot, file), content: await readFile(join(storyDir, file), "utf-8") });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const stateDir = join(bookDir, "story", "state");
    try {
      const stateFiles = await readdir(stateDir);
      for (const fileName of stateFiles) {
        writes.push({
          relativePath: join(snapshotRoot, "state", fileName),
          content: await readFile(join(stateDir, fileName), "utf-8"),
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!writes.some((write) => write.relativePath.startsWith(join(snapshotRoot, "state")))) {
      throw new Error(`Cannot snapshot chapter ${chapterNumber}: structured runtime state is missing.`);
    }
    await commitAtomicFileSet({ rootDir: bookDir, writes });
  }

  async isCompleteBookDirectory(bookDir: string): Promise<boolean> {
    const required = [
      join(bookDir, "book.json"),
      join(bookDir, "story", "outline", "story_frame.md"),
      join(bookDir, "story", "outline", "volume_map.md"),
      join(bookDir, "story", "book_rules.md"),
      join(bookDir, "story", "current_state.md"),
      join(bookDir, "story", "pending_hooks.md"),
      join(bookDir, "chapters", "index.json"),
    ];
    for (const requiredPath of required) {
      try {
        await stat(requiredPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    }
    return true;
  }

  async restoreState(bookId: string, chapterNumber: number): Promise<boolean> {
    const bookDir = this.bookDir(bookId);
    const prepared = await this.prepareStateRestore(bookDir, chapterNumber);
    if (!prepared) return false;
    await commitAtomicFileSet({ rootDir: bookDir, ...prepared });
    return true;
  }

  private async prepareStateRestore(
    bookDir: string,
    chapterNumber: number,
  ): Promise<{
    readonly writes: ReadonlyArray<{ readonly relativePath: string; readonly content: string }>;
    readonly deletes: ReadonlyArray<string>;
  } | null> {
    const snapshotDir = join(bookDir, "story", "snapshots", String(chapterNumber));
    const requiredFiles = ["current_state.md", "pending_hooks.md"];
    const writes: Array<{ relativePath: string; content: string }> = [];
    try {
      for (const file of requiredFiles) {
        writes.push({ relativePath: join("story", file), content: await readFile(join(snapshotDir, file), "utf-8") });
      }
      const stateFiles = await readdir(join(snapshotDir, "state"));
      if (stateFiles.length === 0) return null;
      for (const fileName of stateFiles) {
        writes.push({
          relativePath: join("story", "state", fileName),
          content: await readFile(join(snapshotDir, "state", fileName), "utf-8"),
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const deletes: string[] = [];
    try {
      writes.push({
        relativePath: join("story", "chapter_summaries.md"),
        content: await readFile(join(snapshotDir, "chapter_summaries.md"), "utf-8"),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      deletes.push(join("story", "chapter_summaries.md"));
    }
    const snapshotStateNames = new Set(writes
      .map((write) => write.relativePath)
      .filter((path) => path.startsWith(join("story", "state")))
      .map((path) => path.slice(join("story", "state").length + 1)));
    try {
      for (const fileName of await readdir(join(bookDir, "story", "state"))) {
        if (!snapshotStateNames.has(fileName)) deletes.push(join("story", "state", fileName));
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return { writes, deletes };
  }

  /**
   * Roll back state to the snapshot at `targetChapter`, removing all chapters
   * after it and their associated files (chapter markdown, snapshots, runtime).
   * Returns the list of chapter numbers that were discarded.
   */
  async rollbackToChapter(
    bookId: string,
    targetChapter: number,
  ): Promise<ReadonlyArray<number>> {
    const bookDir = this.bookDir(bookId);
    const chaptersDir = join(bookDir, "chapters");
    const index = await this.loadChapterIndex(bookId);
    const restore = await this.prepareStateRestore(bookDir, targetChapter);
    if (!restore) throw new Error(`Cannot restore snapshot for chapter ${targetChapter} in "${bookId}"`);

    const kept: ChapterMeta[] = [];
    const discarded: number[] = [];

    for (const entry of index) {
      if (entry.number <= targetChapter) {
        kept.push(entry);
      } else {
        discarded.push(entry.number);
      }
    }

    const deletes = new Set(restore.deletes);
    const collectNumberedDeletes = async (
      relativeDir: string,
      numberOf: (name: string) => number | undefined,
    ) => {
      try {
        for (const name of await readdir(join(bookDir, relativeDir))) {
          const number = numberOf(name);
          if (number !== undefined && number > targetChapter) deletes.add(join(relativeDir, name));
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    };
    await collectNumberedDeletes("chapters", (name) => {
      const match = /^(\d+)_.*\.md$/u.exec(name);
      return match ? Number.parseInt(match[1]!, 10) : undefined;
    });
    await collectNumberedDeletes(join("story", "snapshots"), (name) => {
      const value = Number.parseInt(name, 10);
      return Number.isFinite(value) ? value : undefined;
    });
    await collectNumberedDeletes(join("story", "runtime"), (name) => {
      const match = /^chapter-(\d+)\./u.exec(name);
      return match ? Number.parseInt(match[1]!, 10) : undefined;
    });
    await collectNumberedDeletes(join("story", "drafts"), (name) => {
      const match = /^(\d+)_.*\.md$/u.exec(name);
      return match ? Number.parseInt(match[1]!, 10) : undefined;
    });
    for (const file of ["memory.db", "memory.db-shm", "memory.db-wal"]) {
      deletes.add(join("story", file));
    }
    await commitAtomicFileSet({
      rootDir: bookDir,
      writes: [
        ...restore.writes,
        { relativePath: join("chapters", "index.json"), content: `${JSON.stringify(kept, null, 2)}\n` },
      ],
      deletes: [...deletes],
    });
    return discarded;
  }

  private async writeIfMissing(path: string, content: string): Promise<void> {
    try {
      await stat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await writeFile(path, content, "utf-8");
    }
  }
}
