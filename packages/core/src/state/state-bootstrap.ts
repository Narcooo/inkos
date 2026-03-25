import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ChapterSummariesStateSchema,
  CurrentStateStateSchema,
  HooksStateSchema,
  StateManifestSchema,
  type ChapterSummariesState,
  type CurrentStateState,
  type HookStatus,
  type StateManifest,
} from "../models/runtime-state.js";
import type { Fact, StoredHook, StoredSummary } from "./memory-db.js";

export interface BootstrapStructuredStateResult {
  readonly createdFiles: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly manifest: StateManifest;
}

export async function bootstrapStructuredStateFromMarkdown(params: {
  readonly bookDir: string;
  readonly fallbackChapter?: number;
}): Promise<BootstrapStructuredStateResult> {
  const storyDir = join(params.bookDir, "story");
  const stateDir = join(storyDir, "state");
  const manifestPath = join(stateDir, "manifest.json");
  const currentStatePath = join(stateDir, "current_state.json");
  const hooksPath = join(stateDir, "hooks.json");
  const summariesPath = join(stateDir, "chapter_summaries.json");

  await mkdir(stateDir, { recursive: true });

  const createdFiles: string[] = [];
  const warnings: string[] = [];
  const existingManifest = await loadJsonIfValid(manifestPath, StateManifestSchema, warnings, "manifest.json");
  const language = existingManifest?.language ?? await resolveRuntimeLanguage(params.bookDir);

  const summariesState = await loadOrBootstrapSummaries({
    storyDir,
    statePath: summariesPath,
    createdFiles,
    warnings,
  });
  const hooksState = await loadOrBootstrapHooks({
    storyDir,
    statePath: hooksPath,
    createdFiles,
    warnings,
  });
  const inferredFallbackChapter = Math.max(
    params.fallbackChapter ?? 0,
    maxSummaryChapter(summariesState),
    maxHookChapter(hooksState.hooks),
  );
  const currentState = await loadOrBootstrapCurrentState({
    storyDir,
    statePath: currentStatePath,
    fallbackChapter: inferredFallbackChapter,
    createdFiles,
    warnings,
  });

  const manifest = StateManifestSchema.parse({
    schemaVersion: 2,
    language,
    lastAppliedChapter: Math.max(
      existingManifest?.lastAppliedChapter ?? 0,
      currentState.chapter,
      maxSummaryChapter(summariesState),
      maxHookChapter(hooksState.hooks),
    ),
    projectionVersion: existingManifest?.projectionVersion ?? 1,
    migrationWarnings: uniqueStrings([
      ...(existingManifest?.migrationWarnings ?? []),
      ...warnings,
    ]),
  });

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  if (!existingManifest) {
    createdFiles.push("manifest.json");
  }

  return {
    createdFiles,
    warnings: manifest.migrationWarnings,
    manifest,
  };
}

export function parseChapterSummariesMarkdown(markdown: string): StoredSummary[] {
  const rows = parseMarkdownTableRows(markdown)
    .filter((row) => /^\d+$/.test(row[0] ?? ""));

  return rows.map((row) => ({
    chapter: parseInt(row[0]!, 10),
    title: row[1] ?? "",
    characters: row[2] ?? "",
    events: row[3] ?? "",
    stateChanges: row[4] ?? "",
    hookActivity: row[5] ?? "",
    mood: row[6] ?? "",
    chapterType: row[7] ?? "",
  }));
}

export function parsePendingHooksMarkdown(markdown: string): StoredHook[] {
  const tableRows = parseMarkdownTableRows(markdown)
    .filter((row) => (row[0] ?? "").toLowerCase() !== "hook_id");

  if (tableRows.length > 0) {
    return tableRows
      .filter((row) => (row[0] ?? "").length > 0)
      .map((row) => ({
        hookId: row[0] ?? "",
        startChapter: parseInteger(row[1]),
        type: row[2] ?? "",
        status: row[3] ?? "open",
        lastAdvancedChapter: parseInteger(row[4]),
        expectedPayoff: row[5] ?? "",
        notes: row[6] ?? "",
      }));
  }

  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.replace(/^-\s*/, ""))
    .filter(Boolean)
    .map((line, index) => ({
      hookId: `hook-${index + 1}`,
      startChapter: 0,
      type: "unspecified",
      status: "open",
      lastAdvancedChapter: 0,
      expectedPayoff: "",
      notes: line,
    }));
}

export function parseCurrentStateFacts(
  markdown: string,
  fallbackChapter: number,
): Fact[] {
  return parseCurrentStateStateMarkdown(markdown, fallbackChapter, []).facts;
}

async function loadOrBootstrapCurrentState(params: {
  readonly storyDir: string;
  readonly statePath: string;
  readonly fallbackChapter: number;
  readonly createdFiles: string[];
  readonly warnings: string[];
}): Promise<CurrentStateState> {
  const existing = await loadJsonIfValid(
    params.statePath,
    CurrentStateStateSchema,
    params.warnings,
    "current_state.json",
  );
  if (existing) {
    return existing;
  }

  const markdown = await readFile(join(params.storyDir, "current_state.md"), "utf-8").catch(() => "");
  const currentState = parseCurrentStateStateMarkdown(markdown, params.fallbackChapter, params.warnings);
  await writeFile(params.statePath, JSON.stringify(currentState, null, 2), "utf-8");
  params.createdFiles.push("current_state.json");
  return currentState;
}

async function loadOrBootstrapHooks(params: {
  readonly storyDir: string;
  readonly statePath: string;
  readonly createdFiles: string[];
  readonly warnings: string[];
}) {
  const existing = await loadJsonIfValid(
    params.statePath,
    HooksStateSchema,
    params.warnings,
    "hooks.json",
  );
  if (existing) {
    return existing;
  }

  const markdown = await readFile(join(params.storyDir, "pending_hooks.md"), "utf-8").catch(() => "");
  const hooksState = parsePendingHooksStateMarkdown(markdown, params.warnings);
  await writeFile(params.statePath, JSON.stringify(hooksState, null, 2), "utf-8");
  params.createdFiles.push("hooks.json");
  return hooksState;
}

async function loadOrBootstrapSummaries(params: {
  readonly storyDir: string;
  readonly statePath: string;
  readonly createdFiles: string[];
  readonly warnings: string[];
}): Promise<ChapterSummariesState> {
  const existing = await loadJsonIfValid(
    params.statePath,
    ChapterSummariesStateSchema,
    params.warnings,
    "chapter_summaries.json",
  );
  if (existing) {
    return existing;
  }

  const markdown = await readFile(join(params.storyDir, "chapter_summaries.md"), "utf-8").catch(() => "");
  const summariesState = ChapterSummariesStateSchema.parse({
    rows: parseChapterSummariesMarkdown(markdown),
  });
  await writeFile(params.statePath, JSON.stringify(summariesState, null, 2), "utf-8");
  params.createdFiles.push("chapter_summaries.json");
  return summariesState;
}

function parsePendingHooksStateMarkdown(markdown: string, warnings: string[]) {
  const tableRows = parseMarkdownTableRows(markdown)
    .filter((row) => (row[0] ?? "").toLowerCase() !== "hook_id");

  if (tableRows.length > 0) {
    return HooksStateSchema.parse({
      hooks: tableRows
        .filter((row) => (row[0] ?? "").length > 0)
        .map((row) => {
          const hookId = row[0] ?? "";
          return {
            hookId,
            startChapter: parseIntegerWithWarning(row[1], warnings, `${hookId}:startChapter`),
            type: row[2] ?? "unspecified",
            status: normalizeHookStatus(row[3], warnings, hookId),
            lastAdvancedChapter: parseIntegerWithWarning(row[4], warnings, `${hookId}:lastAdvancedChapter`),
            expectedPayoff: row[5] ?? "",
            notes: row[6] ?? "",
          };
        }),
    });
  }

  return HooksStateSchema.parse({
    hooks: markdown
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-"))
      .map((line) => line.replace(/^-\s*/, ""))
      .filter(Boolean)
      .map((line, index) => ({
        hookId: `hook-${index + 1}`,
        startChapter: 0,
        type: "unspecified",
        status: "open" as HookStatus,
        lastAdvancedChapter: 0,
        expectedPayoff: "",
        notes: line,
      })),
  });
}

function parseCurrentStateStateMarkdown(
  markdown: string,
  fallbackChapter: number,
  warnings: string[],
): CurrentStateState {
  const tableRows = parseMarkdownTableRows(markdown);
  const fieldValueRows = tableRows
    .filter((row) => row.length >= 2)
    .filter((row) => !isStateTableHeaderRow(row));

  if (fieldValueRows.length > 0) {
    const chapterFromTable = fieldValueRows.find((row) => isCurrentChapterLabel(row[0] ?? ""));
    const stateChapter = parseIntegerWithFallback(
      chapterFromTable?.[1],
      fallbackChapter,
      warnings,
      "current_state:chapter",
    );

    return CurrentStateStateSchema.parse({
      chapter: stateChapter,
      facts: fieldValueRows
        .filter((row) => !isCurrentChapterLabel(row[0] ?? ""))
        .flatMap((row): Fact[] => {
          const label = (row[0] ?? "").trim();
          const value = (row[1] ?? "").trim();
          if (!label || !value) return [];

          return [{
            subject: inferFactSubject(label),
            predicate: label,
            object: value,
            validFromChapter: stateChapter,
            validUntilChapter: null,
            sourceChapter: stateChapter,
          }];
        }),
    });
  }

  const bulletFacts = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.replace(/^-\s*/, ""))
    .filter(Boolean);

  return CurrentStateStateSchema.parse({
    chapter: Math.max(0, fallbackChapter),
    facts: bulletFacts.map((line, index) => ({
      subject: "current_state",
      predicate: `note_${index + 1}`,
      object: line,
      validFromChapter: Math.max(0, fallbackChapter),
      validUntilChapter: null,
      sourceChapter: Math.max(0, fallbackChapter),
    })),
  });
}

async function resolveRuntimeLanguage(bookDir: string): Promise<"zh" | "en"> {
  try {
    const raw = await readFile(join(bookDir, "book.json"), "utf-8");
    const parsed = JSON.parse(raw) as { language?: unknown };
    return parsed.language === "zh" ? "zh" : "en";
  } catch {
    return "en";
  }
}

async function loadJsonIfValid<T>(
  path: string,
  schema: { parse(value: unknown): T },
  warnings: string[],
  fileLabel: string,
): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf-8");
    return schema.parse(JSON.parse(raw));
  } catch (error) {
    const message = String(error);
    if (!/ENOENT/.test(message)) {
      appendWarning(warnings, `${fileLabel} invalid, rebuilt from markdown`);
    }
    return null;
  }
}

function maxSummaryChapter(state: ChapterSummariesState): number {
  return state.rows.reduce((max, row) => Math.max(max, row.chapter), 0);
}

function maxHookChapter(hooks: ReadonlyArray<StoredHook>): number {
  return hooks.reduce(
    (max, hook) => Math.max(max, hook.startChapter, hook.lastAdvancedChapter),
    0,
  );
}

function normalizeHookStatus(value: string | undefined, warnings: string[], hookId: string): HookStatus {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return "open";
  if (/(resolved|closed|done|已回收|回收|完成)/i.test(normalized)) return "resolved";
  if (/(deferred|paused|hold|搁置|延后|延期)/i.test(normalized)) return "deferred";
  if (/(progress|active|推进|进行中)/i.test(normalized)) return "progressing";
  if (/(open|pending|待定|未回收)/i.test(normalized)) return "open";
  appendWarning(warnings, `${hookId}:status normalized from "${value ?? ""}" to "open"`);
  return "open";
}

function parseIntegerWithWarning(value: string | undefined, warnings: string[], fieldLabel: string): number {
  if (!value) return 0;
  const match = value.match(/\d+/);
  if (!match) {
    appendWarning(warnings, `${fieldLabel} normalized from "${value}" to 0`);
    return 0;
  }
  return parseInt(match[0], 10);
}

function parseIntegerWithFallback(
  value: string | undefined,
  fallback: number,
  warnings: string[],
  fieldLabel: string,
): number {
  if (!value) return Math.max(0, fallback);
  const match = value.match(/\d+/);
  if (!match) {
    appendWarning(warnings, `${fieldLabel} normalized from "${value}" to ${Math.max(0, fallback)}`);
    return Math.max(0, fallback);
  }
  return parseInt(match[0], 10);
}

function parseMarkdownTableRows(markdown: string): string[][] {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"))
    .filter((line) => !line.includes("---"))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.some(Boolean));
}

function isStateTableHeaderRow(row: ReadonlyArray<string>): boolean {
  const first = (row[0] ?? "").trim().toLowerCase();
  const second = (row[1] ?? "").trim().toLowerCase();
  return (first === "字段" && second === "值") || (first === "field" && second === "value");
}

function isCurrentChapterLabel(label: string): boolean {
  return /^(当前章节|current chapter)$/i.test(label.trim());
}

function inferFactSubject(label: string): string {
  if (/^(当前位置|current location)$/i.test(label)) return "protagonist";
  if (/^(主角状态|protagonist state)$/i.test(label)) return "protagonist";
  if (/^(当前目标|current goal)$/i.test(label)) return "protagonist";
  if (/^(当前限制|current constraint)$/i.test(label)) return "protagonist";
  if (/^(当前敌我|current alliances|current relationships)$/i.test(label)) return "protagonist";
  if (/^(当前冲突|current conflict)$/i.test(label)) return "protagonist";
  return "current_state";
}

function parseInteger(value: string | undefined): number {
  if (!value) return 0;
  const match = value.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

function appendWarning(warnings: string[], warning: string): void {
  if (!warnings.includes(warning)) {
    warnings.push(warning);
  }
}

function uniqueStrings(values: ReadonlyArray<string>): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
