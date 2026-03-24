import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const SQLITE_MEMORY_MIN_NODE_MAJOR = 22;
export const SQLITE_MEMORY_PIN_VERSION = String(SQLITE_MEMORY_MIN_NODE_MAJOR);
export const SQLITE_MEMORY_PIN_FILES = [".nvmrc", ".node-version"] as const;

export interface SqliteMemorySupportResult {
  readonly ok: boolean;
  readonly detail: string;
}

export interface NodeRuntimePinStatus {
  readonly ok: boolean;
  readonly detail: string;
  readonly missing: ReadonlyArray<string>;
}

export interface NodeRuntimePinRepairResult {
  readonly updated: boolean;
  readonly written: ReadonlyArray<string>;
}

export function formatSqliteMemorySupportWarning(options?: {
  readonly nodeVersion?: string;
  readonly hasNodeSqlite?: boolean;
}): string | null {
  const nodeVersion = options?.nodeVersion ?? process.version;
  const result = evaluateSqliteMemorySupport({
    nodeVersion,
    hasNodeSqlite: options?.hasNodeSqlite,
  });
  if (result.ok) return null;

  return `Node ${nodeVersion} does not support SQLite memory index; memory.db live sync will fall back to Markdown. Use Node 22+ or run 'inkos doctor'.`;
}

export async function inspectNodeRuntimePinFiles(root: string): Promise<NodeRuntimePinStatus> {
  const missing: string[] = [];

  for (const file of SQLITE_MEMORY_PIN_FILES) {
    try {
      const content = await readFile(join(root, file), "utf-8");
      if (content.trim() !== SQLITE_MEMORY_PIN_VERSION) {
        missing.push(file);
      }
    } catch {
      missing.push(file);
    }
  }

  if (missing.length === 0) {
    return {
      ok: true,
      detail: `Pinned to Node ${SQLITE_MEMORY_PIN_VERSION} via ${SQLITE_MEMORY_PIN_FILES.join(", ")}.`,
      missing,
    };
  }

  return {
    ok: false,
    detail: `Missing or outdated: ${missing.join(", ")}. Run 'inkos doctor --repair-node-runtime'.`,
    missing,
  };
}

export async function ensureNodeRuntimePinFiles(root: string): Promise<NodeRuntimePinRepairResult> {
  const written: string[] = [];

  for (const file of SQLITE_MEMORY_PIN_FILES) {
    const path = join(root, file);
    let content = "";
    try {
      content = await readFile(path, "utf-8");
    } catch {
      content = "";
    }

    if (content.trim() === SQLITE_MEMORY_PIN_VERSION) {
      continue;
    }

    await writeFile(path, `${SQLITE_MEMORY_PIN_VERSION}\n`, "utf-8");
    written.push(file);
  }

  return {
    updated: written.length > 0,
    written,
  };
}

export function parseNodeMajor(version: string): number {
  return parseInt(version.replace(/^v/i, "").split(".")[0] ?? "0", 10);
}

function hasNodeSqliteBuiltin(): boolean {
  try {
    require("node:sqlite");
    return true;
  } catch {
    return false;
  }
}

export function evaluateSqliteMemorySupport(options?: {
  readonly nodeVersion?: string;
  readonly hasNodeSqlite?: boolean;
}): SqliteMemorySupportResult {
  const nodeVersion = options?.nodeVersion ?? process.version;
  const major = parseNodeMajor(nodeVersion);

  if (major < SQLITE_MEMORY_MIN_NODE_MAJOR) {
    return {
      ok: false,
      detail: `Unavailable on ${nodeVersion}. Long-book memory.db acceleration requires Node ${SQLITE_MEMORY_MIN_NODE_MAJOR}+.`,
    };
  }

  const hasNodeSqlite = options?.hasNodeSqlite ?? hasNodeSqliteBuiltin();
  if (!hasNodeSqlite) {
    return {
      ok: false,
      detail: `${nodeVersion} detected, but node:sqlite is unavailable on this runtime. memory.db acceleration will stay disabled.`,
    };
  }

  return {
    ok: true,
    detail: `Available on ${nodeVersion}.`,
  };
}
