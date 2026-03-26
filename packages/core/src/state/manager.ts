import { readFile, writeFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { BookConfig } from "../models/book.js";
import type { ChapterMeta } from "../models/chapter.js";

/** Duración máxima de un lock antes de considerarlo stale (30 min por defecto). */
const DEFAULT_STALE_LOCK_MS = 30 * 60 * 1000;

export class StateManager {
  constructor(private readonly projectRoot: string) {}

  /**
   * Adquiere un lock exclusivo para un libro.
   *
   * Usa `writeFile` con flag `wx` (O_CREAT | O_EXCL) para creación atómica:
   * si el archivo ya existe, falla inmediatamente — sin ventana de carrera.
   *
   * También detecta locks stale: si el PID del lock ya no corre, o si el lock
   * supera `staleLockMs`, se elimina automáticamente y se reintenta.
   */
  async acquireBookLock(
    bookId: string,
    staleLockMs = DEFAULT_STALE_LOCK_MS,
  ): Promise<() => Promise<void>> {
    const lockPath = join(this.bookDir(bookId), ".write.lock");
    const lockData = `pid:${process.pid} ts:${Date.now()}`;

    // Asegurar que el directorio del libro existe
    await mkdir(this.bookDir(bookId), { recursive: true });

    try {
      // Intento atómico: flag 'wx' = O_CREAT | O_EXCL — falla si ya existe
      await writeFile(lockPath, lockData, { encoding: "utf-8", flag: "wx" });
    } catch (createError) {
      // El archivo ya existe — verificar si es stale
      if (isFileExistsError(createError)) {
        const cleaned = await this.tryCleanStaleLock(lockPath, bookId, staleLockMs);
        if (cleaned) {
          // Lock stale eliminado — reintentar creación atómica
          try {
            await writeFile(lockPath, lockData, { encoding: "utf-8", flag: "wx" });
          } catch (retryError) {
            if (isFileExistsError(retryError)) {
              throw new Error(
                `Book "${bookId}" is locked by another process (race on retry). ` +
                  `If this is stale, delete ${lockPath}`,
              );
            }
            throw retryError;
          }
        } else {
          // Lock activo de otro proceso
          let existingLockInfo = "(unknown)";
          try {
            existingLockInfo = await readFile(lockPath, "utf-8");
          } catch { /* archivo podría haber sido eliminado entre medias */ }
          throw new Error(
            `Book "${bookId}" is locked by another process (${existingLockInfo}). ` +
              `If this is stale, delete ${lockPath}`,
          );
        }
      } else {
        throw createError;
      }
    }

    return async () => {
      try {
        await unlink(lockPath);
      } catch {
        // Archivo ya eliminado — ignorar
      }
    };
  }

  /**
   * Intenta limpiar un lock stale. Retorna true si se eliminó.
   *
   * Un lock es stale si:
   * 1. El PID registrado ya no tiene un proceso corriendo, O
   * 2. El timestamp supera staleLockMs.
   */
  private async tryCleanStaleLock(
    lockPath: string,
    bookId: string,
    staleLockMs: number,
  ): Promise<boolean> {
    try {
      const raw = await readFile(lockPath, "utf-8");
      const pidMatch = raw.match(/pid:(\d+)/);
      const tsMatch = raw.match(/ts:(\d+)/);

      const lockPid = pidMatch ? Number(pidMatch[1]) : 0;
      const lockTs = tsMatch ? Number(tsMatch[1]) : 0;

      // Condición 1: PID muerto
      const pidDead = lockPid > 0 && !isProcessAlive(lockPid);

      // Condición 2: Lock demasiado viejo
      const tooOld = lockTs > 0 && (Date.now() - lockTs) > staleLockMs;

      if (pidDead || tooOld) {
        await unlink(lockPath);
        return true;
      }

      return false;
    } catch {
      // No se pudo leer/eliminar — considerar como no stale
      return false;
    }
  }

  get booksDir(): string {
    return join(this.projectRoot, "books");
  }

  bookDir(bookId: string): string {
    return join(this.booksDir, bookId);
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
    return JSON.parse(raw) as BookConfig;
  }

  async saveBookConfig(bookId: string, config: BookConfig): Promise<void> {
    const dir = this.bookDir(bookId);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "book.json"),
      JSON.stringify(config, null, 2),
      "utf-8",
    );
  }

  async listBooks(): Promise<ReadonlyArray<string>> {
    try {
      const entries = await readdir(this.booksDir);
      const bookIds: string[] = [];
      for (const entry of entries) {
        const bookJsonPath = join(this.booksDir, entry, "book.json");
        try {
          await stat(bookJsonPath);
          bookIds.push(entry);
        } catch {
          // not a book directory
        }
      }
      return bookIds;
    } catch {
      return [];
    }
  }

  async getNextChapterNumber(bookId: string): Promise<number> {
    const index = await this.loadChapterIndex(bookId);
    if (index.length === 0) return 1;
    const maxNum = Math.max(...index.map((ch) => ch.number));
    return maxNum + 1;
  }

  async loadChapterIndex(bookId: string): Promise<ReadonlyArray<ChapterMeta>> {
    const indexPath = join(this.bookDir(bookId), "chapters", "index.json");
    try {
      const raw = await readFile(indexPath, "utf-8");
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  async saveChapterIndex(
    bookId: string,
    index: ReadonlyArray<ChapterMeta>,
  ): Promise<void> {
    const chaptersDir = join(this.bookDir(bookId), "chapters");
    await mkdir(chaptersDir, { recursive: true });
    await writeFile(
      join(chaptersDir, "index.json"),
      JSON.stringify(index, null, 2),
      "utf-8",
    );
  }

  async snapshotState(bookId: string, chapterNumber: number): Promise<void> {
    const storyDir = join(this.bookDir(bookId), "story");
    const snapshotDir = join(storyDir, "snapshots", String(chapterNumber));
    await mkdir(snapshotDir, { recursive: true });

    const files = [
      "current_state.md", "particle_ledger.md", "pending_hooks.md",
      "chapter_summaries.md", "subplot_board.md", "emotional_arcs.md", "character_matrix.md",
    ];
    await Promise.all(
      files.map(async (f) => {
        try {
          const content = await readFile(join(storyDir, f), "utf-8");
          await writeFile(join(snapshotDir, f), content, "utf-8");
        } catch {
          // file doesn't exist yet
        }
      }),
    );
  }

  async restoreState(bookId: string, chapterNumber: number): Promise<boolean> {
    const storyDir = join(this.bookDir(bookId), "story");
    const snapshotDir = join(storyDir, "snapshots", String(chapterNumber));

    const files = [
      "current_state.md", "particle_ledger.md", "pending_hooks.md",
      "chapter_summaries.md", "subplot_board.md", "emotional_arcs.md", "character_matrix.md",
    ];
    try {
      // current_state.md and pending_hooks.md are required;
      // particle_ledger.md is optional (numericalSystem=false genres don't have it)
      // the rest are optional (may not exist in older snapshots)
      const requiredFiles = ["current_state.md", "pending_hooks.md"];
      const optionalFiles = files.filter((f) => !requiredFiles.includes(f));

      await Promise.all(
        requiredFiles.map(async (f) => {
          const content = await readFile(join(snapshotDir, f), "utf-8");
          await writeFile(join(storyDir, f), content, "utf-8");
        }),
      );

      await Promise.all(
        optionalFiles.map(async (f) => {
          try {
            const content = await readFile(join(snapshotDir, f), "utf-8");
            await writeFile(join(storyDir, f), content, "utf-8");
          } catch {
            // Optional file missing — skip
          }
        }),
      );

      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Chapter content helpers
  // ---------------------------------------------------------------------------

  /**
   * Lee el contenido de un capítulo, eliminando la línea de título.
   * Centraliza la lógica duplicada en runner.ts y scheduler.ts.
   */
  async readChapterContent(bookId: string, chapterNumber: number): Promise<string> {
    const chaptersDir = join(this.bookDir(bookId), "chapters");
    const files = await readdir(chaptersDir);
    const paddedNum = String(chapterNumber).padStart(4, "0");
    const chapterFile = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
    if (!chapterFile) {
      throw new Error(`Chapter ${chapterNumber} file not found in ${chaptersDir}`);
    }
    const raw = await readFile(join(chaptersDir, chapterFile), "utf-8");
    // Eliminar la línea de título y la línea en blanco siguiente
    const lines = raw.split("\n");
    const contentStart = lines.findIndex((l, i) => i > 0 && l.trim().length > 0);
    return contentStart >= 0 ? lines.slice(contentStart).join("\n") : raw;
  }

  /**
   * Guarda una copia del contenido del capítulo antes de sobrescribirlo.
   * Devuelve el número de versión asignado.
   */
  async saveChapterRevision(
    bookId: string,
    chapterNumber: number,
    content: string,
  ): Promise<number> {
    const revisionsDir = join(
      this.bookDir(bookId), "chapters", "revisions", String(chapterNumber),
    );
    await mkdir(revisionsDir, { recursive: true });
    const existing = await readdir(revisionsDir).catch(() => []);
    const version = existing.filter((f) => f.startsWith("v") && f.endsWith(".md")).length + 1;
    await writeFile(join(revisionsDir, `v${version}.md`), content, "utf-8");
    return version;
  }

  /**
   * Lista todas las revisiones archivadas de un capítulo.
   * Devuelve un array ordenado por versión (ascendente).
   */
  async listChapterRevisions(
    bookId: string,
    chapterNumber: number,
  ): Promise<ReadonlyArray<{ readonly version: number; readonly filePath: string }>> {
    const revisionsDir = join(
      this.bookDir(bookId), "chapters", "revisions", String(chapterNumber),
    );
    try {
      const files = await readdir(revisionsDir);
      return files
        .filter((f) => f.startsWith("v") && f.endsWith(".md"))
        .map((f) => {
          const version = parseInt(f.slice(1, -3), 10);
          return { version, filePath: join(revisionsDir, f) };
        })
        .sort((a, b) => a.version - b.version);
    } catch {
      return [];
    }
  }
}

// --- Helpers del módulo ---

/** Verifica si un error de fs es EEXIST (archivo ya existe — lanzado por flag 'wx'). */
function isFileExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}

/** Verifica si un proceso con el PID dado sigue corriendo. */
function isProcessAlive(pid: number): boolean {
  try {
    // process.kill(pid, 0) no envía señal — solo verifica existencia
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
