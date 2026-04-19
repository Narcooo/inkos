import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { ChapterMeta } from "../models/chapter.js";
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
      return collectEditableFiles(fullPath);
    }
    if (!/\.(md|json|ya?ml|txt)$/i.test(entry.name)) {
      return [];
    }
    return [fullPath];
  }));
  return files.flat();
}

async function executeEntityRename(
  deps: EditExecutionDeps,
  request: Extract<EditRequest, { kind: "entity-rename" }>,
): Promise<ExecutedEditTransaction> {
  const root = deps.bookDir(request.bookId);
  const files = await collectEditableFiles(root);
  const touchedFiles: string[] = [];
  const matcher = new RegExp(escapeRegExp(request.oldValue), "g");

  for (const filePath of files) {
    const content = await readFile(filePath, "utf-8");
    const nextContent = content.replace(matcher, request.newValue);
    if (nextContent === content) {
      continue;
    }
    await writeFile(filePath, nextContent, "utf-8");
    touchedFiles.push(relative(root, filePath));
  }

  if (touchedFiles.length === 0) {
    throw new Error(`No occurrences of "${request.oldValue}" were found in "${request.bookId}".`);
  }

  return {
    transactionType: request.kind,
    bookId: request.bookId,
    touchedFiles,
    reviewRequired: false,
    summary: `Renamed ${request.oldValue} to ${request.newValue} across ${touchedFiles.length} files.`,
  };
}

async function executeChapterLocalEdit(
  deps: EditExecutionDeps,
  request: Extract<EditRequest, { kind: "chapter-local-edit" }>,
): Promise<ExecutedEditTransaction> {
  const root = deps.bookDir(request.bookId);
  const chaptersDir = join(root, "chapters");
  const paddedChapter = String(request.chapterNumber).padStart(4, "0");
  const chapterFile = (await readdir(chaptersDir).catch((error) => {
    if (isMissingDirectoryError(error)) {
      return [];
    }
    throw error;
  }))
    .find((file) => file.startsWith(`${paddedChapter}_`) && file.endsWith(".md"));

  if (!chapterFile) {
    throw new Error(`Chapter ${request.chapterNumber} not found in "${request.bookId}".`);
  }
  if (!request.targetText || request.replacementText === undefined) {
    throw new Error("Chapter-local edits require targetText and replacementText.");
  }

  const chapterPath = join(chaptersDir, chapterFile);
  const content = await readFile(chapterPath, "utf-8");
  const nextContent = content.split(request.targetText).join(request.replacementText);
  if (nextContent === content) {
    throw new Error(`Target text was not found in chapter ${request.chapterNumber}.`);
  }
  await writeFile(chapterPath, nextContent, "utf-8");

  const runtimeDir = join(root, "story", "runtime");
  const runtimeFiles = (await readdir(runtimeDir).catch((error) => {
    if (isMissingDirectoryError(error)) {
      return [];
    }
    throw error;
  }))
    .filter((file) => file.startsWith(`chapter-${paddedChapter}.`));
  await Promise.all(runtimeFiles.map((file) => unlink(join(runtimeDir, file)).catch(() => undefined)));

  const index = [...(await deps.loadChapterIndex(request.bookId))];
  const updatedIndex = index.map((chapter) => chapter.number === request.chapterNumber
    ? {
        ...chapter,
        status: "audit-failed" as const,
        updatedAt: new Date().toISOString(),
        auditIssues: [
          ...chapter.auditIssues.filter((issue) => !issue.includes("Manual text edit requires review")),
          "[warning] Manual text edit requires review before continuation.",
        ],
      }
    : chapter);
  await deps.saveChapterIndex(request.bookId, updatedIndex);

  return {
    transactionType: request.kind,
    bookId: request.bookId,
    chapterNumber: request.chapterNumber,
    touchedFiles: [
      relative(root, chapterPath),
      ...runtimeFiles.map((file) => relative(root, join(runtimeDir, file))),
      "chapters/index.json",
    ],
    reviewRequired: true,
    summary: `Patched chapter ${request.chapterNumber} and marked it for review.`,
  };
}

export async function executeEditTransaction(
  deps: EditExecutionDeps,
  request: EditRequest,
): Promise<ExecutedEditTransaction> {
  switch (request.kind) {
    case "entity-rename":
      return executeEntityRename(deps, request);
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
