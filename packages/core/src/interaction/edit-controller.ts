import { access, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import type { ChapterMeta } from "../models/chapter.js";
import {
  archiveChapterVersion,
  type ChapterVersionSource,
} from "../state/chapter-workspace.js";
import { classifyTruthAuthority, normalizeTruthFileName, type TruthAuthority } from "./truth-authority.js";

export type EditRequest =
  | {
      readonly kind: "entity-rename";
      readonly bookId: string;
      readonly entityType: "protagonist" | "character" | "location" | "organization";
      readonly oldValue: string;
      readonly newValue: string;
    }
  | {
      readonly kind: "chapter-rewrite";
      readonly bookId: string;
      readonly chapterNumber: number;
      readonly instruction: string;
    }
  | {
      readonly kind: "chapter-replace";
      readonly bookId: string;
      readonly chapterNumber: number;
      readonly fullText: string;
      readonly versionSource?: ChapterVersionSource;
    }
  | {
      readonly kind: "chapter-local-edit";
      readonly bookId: string;
      readonly chapterNumber: number;
      readonly instruction: string;
      readonly targetText?: string;
      readonly replacementText?: string;
    }
  | {
      readonly kind: "truth-file-edit";
      readonly bookId: string;
      readonly fileName: string;
      readonly instruction: string;
    }
  | {
      readonly kind: "focus-edit";
      readonly bookId: string;
      readonly instruction: string;
    };

export interface PlannedEditTransaction {
  readonly transactionType: EditRequest["kind"];
  readonly bookId: string;
  readonly chapterNumber?: number;
  readonly truthAuthority?: TruthAuthority;
  readonly normalizedFileName?: string;
  readonly affectedScope: "chapter" | "downstream" | "future" | "book";
  readonly requiresTruthRebuild: boolean;
}

export interface EditExecutionDeps {
  readonly bookDir: (bookId: string) => string;
  readonly loadChapterIndex: (bookId: string) => Promise<ReadonlyArray<ChapterMeta>>;
  readonly saveChapterIndex: (bookId: string, index: ReadonlyArray<ChapterMeta>) => Promise<void>;
}

export interface ExecutedEditTransaction {
  readonly transactionType: EditRequest["kind"];
  readonly bookId: string;
  readonly chapterNumber?: number;
  readonly touchedFiles: ReadonlyArray<string>;
  readonly reviewRequired: boolean;
  readonly summary: string;
}

function isMissingDirectoryError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}

export function planEditTransaction(request: EditRequest): PlannedEditTransaction {
  switch (request.kind) {
    case "entity-rename":
      return {
        transactionType: request.kind,
        bookId: request.bookId,
        affectedScope: "book",
        requiresTruthRebuild: true,
      };
    case "chapter-rewrite":
      return {
        transactionType: request.kind,
        bookId: request.bookId,
        chapterNumber: request.chapterNumber,
        affectedScope: "downstream",
        requiresTruthRebuild: true,
      };
    case "chapter-replace":
      return {
        transactionType: request.kind,
        bookId: request.bookId,
        chapterNumber: request.chapterNumber,
        affectedScope: "chapter",
        requiresTruthRebuild: true,
      };
    case "chapter-local-edit":
      return {
        transactionType: request.kind,
        bookId: request.bookId,
        chapterNumber: request.chapterNumber,
        affectedScope: "chapter",
        requiresTruthRebuild: true,
      };
    case "truth-file-edit": {
      const normalizedFileName = normalizeTruthFileName(request.fileName);
      const truthAuthority = classifyTruthAuthority(normalizedFileName);
      return {
        transactionType: request.kind,
        bookId: request.bookId,
        normalizedFileName,
        truthAuthority,
        affectedScope: truthAuthority === "runtime-truth" ? "book" : truthAuthority === "memory" ? "book" : "book",
        requiresTruthRebuild: truthAuthority === "runtime-truth" || truthAuthority === "memory",
      };
    }
    case "focus-edit":
      return {
        transactionType: request.kind,
        bookId: request.bookId,
        truthAuthority: "direction",
        normalizedFileName: "current_focus.md",
        affectedScope: "future",
        requiresTruthRebuild: false,
      };
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function collectEditableFiles(dir: string): Promise<ReadonlyArray<string>> {
  const entries = await readdir(dir, { withFileTypes: true }).catch((error) => {
    if (isMissingDirectoryError(error)) {
      return [];
    }
    throw error;
  });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Snapshots are frozen history; dot-directories (e.g. chapters/.trash)
      // hold discarded content — neither may be rewritten by edits.
      if (entry.name === "snapshots" || entry.name.startsWith(".")) return [];
      return collectEditableFiles(fullPath);
    }
    if (!/\.(md|json|ya?ml|txt)$/i.test(entry.name)) {
      return [];
    }
    return [fullPath];
  }));
  return files.flat();
}

interface PlannedFileRename {
  readonly fromAbs: string;
  readonly toAbs: string;
  readonly from: string;
  readonly to: string;
}

// newValue is LLM-supplied (system boundary). A name embedded into a filename must stay a single
// path component — reject path separators so a rename target can never escape its directory.
function assertEntityRenameTargetIsSafe(newValue: string): void {
  if (/[/\\]/.test(newValue)) {
    throw new Error(`Invalid rename target "${newValue}": entity names cannot contain path separators.`);
  }
}

// Entity files are addressed by path elsewhere (e.g. roles/主要角色/<name>.md). When the content pass
// rewrites those path references from oldValue to newValue, the files themselves must be renamed too,
// or the references dangle. Plan the disk renames up front (before any write) so a name collision
// aborts the whole transaction cleanly instead of leaving content half-rewritten.
async function planEntityFileRenames(
  root: string,
  files: ReadonlyArray<string>,
  oldValue: string,
  newValue: string,
): Promise<ReadonlyArray<PlannedFileRename>> {
  const planned: PlannedFileRename[] = [];
  for (const filePath of files) {
    const base = basename(filePath);
    if (!base.includes(oldValue)) {
      continue;
    }
    const nextBase = base.split(oldValue).join(newValue);
    if (nextBase === base) {
      continue;
    }
    const toAbs = join(dirname(filePath), nextBase);
    const targetExists = await access(toAbs).then(() => true).catch(() => false);
    if (targetExists) {
      throw new Error(
        `Cannot rename "${relative(root, filePath)}" to "${nextBase}": a file with that name already exists.`,
      );
    }
    planned.push({ fromAbs: filePath, toAbs, from: relative(root, filePath), to: relative(root, toAbs) });
  }
  return planned;
}

async function executeEntityRename(
  deps: EditExecutionDeps,
  request: Extract<EditRequest, { kind: "entity-rename" }>,
): Promise<ExecutedEditTransaction> {
  const root = deps.bookDir(request.bookId);
  assertEntityRenameTargetIsSafe(request.newValue);
  const files = await collectEditableFiles(root);
  const plannedRenames = await planEntityFileRenames(root, files, request.oldValue, request.newValue);
  const matcher = new RegExp(escapeRegExp(request.oldValue), "g");
  const touched = new Set<string>();

  for (const filePath of files) {
    const content = await readFile(filePath, "utf-8");
    const nextContent = content.replace(matcher, request.newValue);
    if (nextContent === content) {
      continue;
    }
    await writeFile(filePath, nextContent, "utf-8");
    touched.add(relative(root, filePath));
  }

  for (const planned of plannedRenames) {
    await rename(planned.fromAbs, planned.toAbs);
    touched.delete(planned.from);
    touched.add(planned.to);
  }

  if (touched.size === 0) {
    throw new Error(`No occurrences of "${request.oldValue}" were found in "${request.bookId}".`);
  }

  const touchedFiles = [...touched];
  const renameNote = plannedRenames.length > 0
    ? ` (${plannedRenames.length} file${plannedRenames.length === 1 ? "" : "s"} renamed on disk)`
    : "";
  return {
    transactionType: request.kind,
    bookId: request.bookId,
    touchedFiles,
    reviewRequired: false,
    summary: `Renamed ${request.oldValue} to ${request.newValue} across ${touchedFiles.length} files${renameNote}.`,
  };
}

async function findChapterPath(root: string, chapterNumber: number): Promise<{ readonly chaptersDir: string; readonly chapterPath: string; readonly chapterFile: string }> {
  const chaptersDir = join(root, "chapters");
  const paddedChapter = String(chapterNumber).padStart(4, "0");
  const chapterFile = (await readdir(chaptersDir).catch((error) => {
    if (isMissingDirectoryError(error)) {
      return [];
    }
    throw error;
  }))
    .find((file) => file.startsWith(`${paddedChapter}_`) && file.endsWith(".md"));

  if (!chapterFile) {
    throw new Error(`Chapter ${chapterNumber} not found.`);
  }
  return { chaptersDir, chapterPath: join(chaptersDir, chapterFile), chapterFile };
}

async function clearChapterRuntimeFiles(root: string, chapterNumber: number): Promise<ReadonlyArray<string>> {
  const paddedChapter = String(chapterNumber).padStart(4, "0");
  const runtimeDir = join(root, "story", "runtime");
  const runtimeFiles = (await readdir(runtimeDir).catch((error) => {
    if (isMissingDirectoryError(error)) {
      return [];
    }
    throw error;
  }))
    .filter((file) => (
      file.startsWith(`chapter-${paddedChapter}.`)
      && file !== `chapter-${paddedChapter}.user-brief.md`
    ));
  await Promise.all(runtimeFiles.map((file) => unlink(join(runtimeDir, file)).catch(() => undefined)));
  return runtimeFiles.map((file) => relative(root, join(runtimeDir, file)));
}

function markChapterForManualReview(
  index: ReadonlyArray<ChapterMeta>,
  chapterNumber: number,
  issue: string,
  wordCount?: number,
): ReadonlyArray<ChapterMeta> {
  const now = new Date().toISOString();
  return index.map((chapter) => chapter.number === chapterNumber
    ? {
        ...chapter,
        status: "audit-failed" as const,
        updatedAt: now,
        ...(typeof wordCount === "number" ? { wordCount } : {}),
        auditIssues: [
          ...chapter.auditIssues.filter((existing) => !existing.includes(issue)),
          `[warning] ${issue}`,
        ],
      }
    : chapter);
}

function roughChapterLength(content: string): number {
  return content
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/\s+/g, "")
    .length;
}

async function executeChapterReplace(
  deps: EditExecutionDeps,
  request: Extract<EditRequest, { kind: "chapter-replace" }>,
): Promise<ExecutedEditTransaction> {
  const root = deps.bookDir(request.bookId);
  const fullText = request.fullText.trim();
  if (!fullText) {
    throw new Error("Chapter replacement requires fullText.");
  }
  const { chapterPath } = await findChapterPath(root, request.chapterNumber);
  const previousContent = await readFile(chapterPath, "utf-8");
  await archiveChapterVersion(
    root,
    request.chapterNumber,
    previousContent,
    request.versionSource ?? "agent",
  );
  await writeFile(chapterPath, fullText.endsWith("\n") ? fullText : `${fullText}\n`, "utf-8");
  const removedRuntimeFiles = await clearChapterRuntimeFiles(root, request.chapterNumber);

  const updatedIndex = markChapterForManualReview(
    await deps.loadChapterIndex(request.bookId),
    request.chapterNumber,
    "Manual chapter replacement requires review before continuation.",
    roughChapterLength(fullText),
  );
  await deps.saveChapterIndex(request.bookId, updatedIndex);

  return {
    transactionType: request.kind,
    bookId: request.bookId,
    chapterNumber: request.chapterNumber,
    touchedFiles: [
      relative(root, chapterPath),
      ...removedRuntimeFiles,
      "chapters/index.json",
    ],
    reviewRequired: true,
    summary: `Replaced chapter ${request.chapterNumber} and marked it for review.`,
  };
}

async function executeChapterLocalEdit(
  deps: EditExecutionDeps,
  request: Extract<EditRequest, { kind: "chapter-local-edit" }>,
): Promise<ExecutedEditTransaction> {
  const root = deps.bookDir(request.bookId);
  const { chapterPath } = await findChapterPath(root, request.chapterNumber);
  if (!request.targetText || request.replacementText === undefined) {
    throw new Error("Chapter-local edits require targetText and replacementText.");
  }

  const content = await readFile(chapterPath, "utf-8");
  const nextContent = replaceChapterTargetText(content, request.targetText, request.replacementText);
  if (nextContent === content) {
    throw new Error(`Target text was not found in chapter ${request.chapterNumber}.`);
  }
  await archiveChapterVersion(root, request.chapterNumber, content, "agent");
  await writeFile(chapterPath, nextContent, "utf-8");

  const removedRuntimeFiles = await clearChapterRuntimeFiles(root, request.chapterNumber);
  const updatedIndex = markChapterForManualReview(
    await deps.loadChapterIndex(request.bookId),
    request.chapterNumber,
    "Manual text edit requires review before continuation.",
    roughChapterLength(nextContent),
  );
  await deps.saveChapterIndex(request.bookId, updatedIndex);

  return {
    transactionType: request.kind,
    bookId: request.bookId,
    chapterNumber: request.chapterNumber,
    touchedFiles: [
      relative(root, chapterPath),
      ...removedRuntimeFiles,
      "chapters/index.json",
    ],
    reviewRequired: true,
    summary: `Patched chapter ${request.chapterNumber} and marked it for review.`,
  };
}

function replaceChapterTargetText(content: string, targetText: string, replacementText: string): string {
  const exact = content.split(targetText).join(replacementText);
  if (exact !== content) return exact;

  const pattern = flexibleWhitespacePattern(targetText);
  if (pattern) {
    let matched = false;
    const replaced = content.replace(pattern, () => {
      matched = true;
      return replacementText;
    });
    if (matched) return replaced;
  }

  return replaceApproximateParagraph(content, targetText, replacementText);
}

function flexibleWhitespacePattern(targetText: string): RegExp | null {
  const parts = targetText.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const escaped = parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(escaped.join("\\s+"), "g");
}

function replaceApproximateParagraph(content: string, targetText: string, replacementText: string): string {
  const target = normalizeApproximateText(targetText);
  if (target.length < 24) return content;

  let best: { readonly start: number; readonly end: number; readonly score: number } | undefined;
  let secondBestScore = 0;
  const paragraphPattern = /\S[\s\S]*?(?=\n\s*\n|$)/g;
  for (const match of content.matchAll(paragraphPattern)) {
    const raw = match[0] ?? "";
    const start = match.index ?? 0;
    const normalized = normalizeApproximateText(raw);
    if (normalized.length < 24) continue;
    if (normalized.length < target.length * 0.35 || normalized.length > target.length * 3) continue;
    const score = approximateTextScore(target, normalized);
    if (!best || score > best.score) {
      secondBestScore = best?.score ?? secondBestScore;
      best = { start, end: start + raw.length, score };
    } else if (score > secondBestScore) {
      secondBestScore = score;
    }
  }

  // High threshold + margin keeps this as a target locator, not a semantic rewrite engine.
  if (!best || best.score < 0.72 || (best.score < 0.86 && best.score - secondBestScore < 0.06)) {
    return content;
  }

  return `${content.slice(0, best.start)}${replacementText}${content.slice(best.end)}`;
}

function normalizeApproximateText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function approximateTextScore(target: string, candidate: string): number {
  if (candidate.includes(target) || target.includes(candidate)) {
    return Math.min(target.length, candidate.length) / Math.max(target.length, candidate.length);
  }
  return diceCoefficient(toBigrams(target), toBigrams(candidate));
}

function toBigrams(text: string): string[] {
  if (text.length < 2) return text ? [text] : [];
  const out: string[] = [];
  for (let i = 0; i < text.length - 1; i += 1) {
    out.push(text.slice(i, i + 2));
  }
  return out;
}

function diceCoefficient(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const item of left) counts.set(item, (counts.get(item) ?? 0) + 1);
  let overlap = 0;
  for (const item of right) {
    const count = counts.get(item) ?? 0;
    if (count <= 0) continue;
    overlap += 1;
    counts.set(item, count - 1);
  }
  return (2 * overlap) / (left.length + right.length);
}

export async function executeEditTransaction(
  deps: EditExecutionDeps,
  request: EditRequest,
): Promise<ExecutedEditTransaction> {
  switch (request.kind) {
    case "entity-rename":
      return executeEntityRename(deps, request);
    case "chapter-replace":
      return executeChapterReplace(deps, request);
    case "chapter-local-edit":
      return executeChapterLocalEdit(deps, request);
    case "truth-file-edit": {
      const root = deps.bookDir(request.bookId);
      const normalizedFileName = normalizeTruthFileName(request.fileName);
      const filePath = join(root, "story", normalizedFileName);
      await writeFile(filePath, request.instruction, "utf-8");
      return {
        transactionType: request.kind,
        bookId: request.bookId,
        touchedFiles: [relative(root, filePath)],
        reviewRequired: false,
        summary: `Updated ${normalizedFileName}.`,
      };
    }
    default:
      throw new Error(`Edit transaction "${request.kind}" is not executable yet.`);
  }
}
