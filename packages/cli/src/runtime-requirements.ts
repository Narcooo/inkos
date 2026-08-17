import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const MIN_NODE_MAJOR = 22;
export const NODE_PIN_VERSION = String(MIN_NODE_MAJOR);
export const NODE_PIN_FILES = [".nvmrc", ".node-version"] as const;

export interface NodeRuntimeSupportResult {
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

export async function inspectNodeRuntimePinFiles(root: string): Promise<NodeRuntimePinStatus> {
  const missing: string[] = [];

  for (const file of NODE_PIN_FILES) {
    try {
      const content = await readFile(join(root, file), "utf-8");
      if (content.trim() !== NODE_PIN_VERSION) {
        missing.push(file);
      }
    } catch {
      missing.push(file);
    }
  }

  if (missing.length === 0) {
    return {
      ok: true,
      detail: `Pinned to Node ${NODE_PIN_VERSION} via ${NODE_PIN_FILES.join(", ")}.`,
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

  for (const file of NODE_PIN_FILES) {
    const path = join(root, file);
    let content = "";
    try {
      content = await readFile(path, "utf-8");
    } catch {
      content = "";
    }

    if (content.trim() === NODE_PIN_VERSION) {
      continue;
    }

    await writeFile(path, `${NODE_PIN_VERSION}\n`, "utf-8");
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

export function evaluateNodeRuntimeSupport(options?: {
  readonly nodeVersion?: string;
  readonly hasNodeSqlite?: boolean;
}): NodeRuntimeSupportResult {
  const nodeVersion = options?.nodeVersion ?? process.version;
  const major = parseNodeMajor(nodeVersion);

  if (major < MIN_NODE_MAJOR) {
    return {
      ok: false,
      detail: `Unsupported runtime ${nodeVersion}. InkOS requires Node ${MIN_NODE_MAJOR}+.`,
    };
  }

  const hasNodeSqlite = options?.hasNodeSqlite ?? hasNodeSqliteBuiltin();
  if (!hasNodeSqlite) {
    return {
      ok: false,
      detail: `${nodeVersion} detected, but the required node:sqlite module is unavailable.`,
    };
  }

  return {
    ok: true,
    detail: `Available on ${nodeVersion}.`,
  };
}
