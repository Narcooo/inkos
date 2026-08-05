import {
  access,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";

export interface AtomicFileWrite {
  readonly relativePath: string;
  readonly content: string | Uint8Array;
}

export interface AtomicFileSet {
  readonly rootDir: string;
  readonly writes: ReadonlyArray<AtomicFileWrite>;
  readonly deletes?: ReadonlyArray<string>;
  readonly renameFile?: (from: string, to: string) => Promise<void>;
}

function safeRelativePath(relativePath: string): string {
  const normalized = normalize(relativePath);
  if (
    !relativePath.trim()
    || isAbsolute(relativePath)
    || normalized === ".."
    || normalized.startsWith(`..${sep}`)
  ) {
    throw new Error(`Atomic file path must stay inside rootDir: ${relativePath}`);
  }
  return normalized;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function commitAtomicFileSet(input: AtomicFileSet): Promise<void> {
  const renameFile = input.renameFile ?? rename;
  const writes = input.writes.map((entry) => ({
    ...entry,
    relativePath: safeRelativePath(entry.relativePath),
  }));
  const deletes = (input.deletes ?? []).map(safeRelativePath);
  const writePaths = new Set(writes.map((entry) => entry.relativePath));
  if (writePaths.size !== writes.length) {
    throw new Error("Atomic file set contains duplicate write paths");
  }
  if (deletes.some((relativePath) => writePaths.has(relativePath))) {
    throw new Error("Atomic file set cannot write and delete the same path");
  }

  await mkdir(input.rootDir, { recursive: true });
  const transactionDir = await mkdtemp(join(input.rootDir, ".inkos-file-txn-"));
  const stagedDir = join(transactionDir, "staged");
  const backupDir = join(transactionDir, "backup");
  const touchedPaths = [...writePaths, ...deletes];
  const backups: Array<{ readonly target: string; readonly backup: string }> = [];
  const committedTargets: string[] = [];

  try {
    for (const entry of writes) {
      const stagedPath = join(stagedDir, entry.relativePath);
      await mkdir(dirname(stagedPath), { recursive: true });
      await writeFile(stagedPath, entry.content);
    }

    for (const relativePath of touchedPaths) {
      const target = join(input.rootDir, relativePath);
      await mkdir(dirname(target), { recursive: true });
      if (!(await exists(target))) continue;

      const backup = join(backupDir, relativePath);
      await mkdir(dirname(backup), { recursive: true });
      await renameFile(target, backup);
      backups.push({ target, backup });
    }

    for (const entry of writes) {
      const target = join(input.rootDir, entry.relativePath);
      await renameFile(join(stagedDir, entry.relativePath), target);
      committedTargets.push(target);
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const target of committedTargets.reverse()) {
      await rm(target, { recursive: true, force: true }).catch((rollbackError) => {
        rollbackErrors.push(rollbackError);
      });
    }
    for (const entry of backups.reverse()) {
      try {
        await rm(entry.target, { recursive: true, force: true });
        await mkdir(dirname(entry.target), { recursive: true });
        await renameFile(entry.backup, entry.target);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }

    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], "Atomic file commit failed and rollback was incomplete");
    }
    throw error;
  } finally {
    await rm(transactionDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
