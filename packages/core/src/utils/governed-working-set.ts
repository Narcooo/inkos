import type { ContextPackage } from "../models/input-governance.js";
import {
  parsePendingHooksMarkdown,
  renderHookSnapshot,
} from "./memory-retrieval.js";
import {
  isHookWithinChapterWindow,
} from "./hook-agenda.js";

export function buildGovernedHookWorkingSet(params: {
  readonly hooksMarkdown: string;
  readonly contextPackage: ContextPackage;
  readonly chapterIntent?: string;
  readonly chapterNumber: number;
  readonly language: "zh" | "en";
  readonly keepRecent?: number;
}): string {
  const { hooksMarkdown } = params;
  if (!hooksMarkdown || hooksMarkdown === "(文件不存在)" || hooksMarkdown === "(文件尚未创建)") {
    return hooksMarkdown;
  }

  const hooks = parsePendingHooksMarkdown(hooksMarkdown);
  if (hooks.length === 0) {
    return hooksMarkdown;
  }

  const selectedIds = new Set(
    params.contextPackage.selectedContext
      .filter((entry) => entry.source.startsWith("story/pending_hooks.md#"))
      .map((entry) => entry.source.slice("story/pending_hooks.md#".length))
      .filter(Boolean),
  );
  const agendaIds = collectHookAgendaIds(params.chapterIntent);
  const workingSet = hooks.filter((hook) =>
    selectedIds.has(hook.hookId)
      || agendaIds.has(hook.hookId)
      || isHookWithinChapterWindow(
          hook,
          params.chapterNumber,
          params.keepRecent ?? 5,
        ),
  );

  if (workingSet.length === 0 || workingSet.length >= hooks.length) {
    return hooksMarkdown;
  }

  return renderHookSnapshot(workingSet, params.language);
}

function collectHookAgendaIds(chapterIntent?: string): Set<string> {
  if (!chapterIntent || chapterIntent.trim().length === 0) {
    return new Set();
  }

  const ids = new Set<string>();
  const lines = chapterIntent.split("\n");
  let inHookAgenda = false;
  let captureIds = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line === "## Hook Agenda") {
      inHookAgenda = true;
      captureIds = false;
      continue;
    }

    if (!inHookAgenda) {
      continue;
    }

    if (line.startsWith("## ") && line !== "## Hook Agenda") {
      break;
    }

    if (line === "### Must Advance" || line === "### Eligible Resolve" || line === "### Stale Debt") {
      captureIds = true;
      continue;
    }

    if (line.startsWith("### ")) {
      captureIds = false;
      continue;
    }

    if (!captureIds || !line.startsWith("- ")) {
      continue;
    }

    const value = line.slice(2).trim();
    if (value && value.toLowerCase() !== "none") {
      ids.add(value);
    }
  }

  return ids;
}

export function mergeTableMarkdownByKey(
  original: string,
  updated: string,
  keyColumns: ReadonlyArray<number>,
): string {
  const originalTable = parseSingleTable(original);
  const updatedTable = parseSingleTable(updated);
  if (!originalTable || !updatedTable || updatedTable.dataRows.length === 0) {
    return updated;
  }

  const mergedRows = [...originalTable.dataRows];
  const originalIndex = new Map<string, number>();
  mergedRows.forEach((row, index) => {
    originalIndex.set(buildKey(row, keyColumns), index);
  });

  for (const row of updatedTable.dataRows) {
    const key = buildKey(row, keyColumns);
    const existing = originalIndex.get(key);
    if (existing === undefined) {
      originalIndex.set(key, mergedRows.length);
      mergedRows.push(row);
    } else {
      mergedRows[existing] = row;
    }
  }

  return [
    ...pickScaffold(originalTable.leadingLines, updatedTable.leadingLines),
    ...mergedRows.map(renderRow),
    ...pickScaffold(originalTable.trailingLines, updatedTable.trailingLines),
  ].join("\n").trimEnd();
}

export function mergeCharacterMatrixMarkdown(original: string, updated: string): string {
  const originalSections = parseSections(original);
  const updatedSections = parseSections(updated);
  if (originalSections.sections.length === 0 || updatedSections.sections.length === 0) {
    return updated;
  }

  const sectionKeyColumns: ReadonlyArray<ReadonlyArray<number>> = [
    [0],
    [0, 1],
    [0, 3],
  ];

  const mergedSections = originalSections.sections.map((section, index) => {
    const next = updatedSections.sections[index];
    if (!next) return section;

    const keyColumns = sectionKeyColumns[index] ?? [0];
    return {
      heading: section.heading,
      body: mergeTableMarkdownByKey(section.body, next.body, keyColumns),
    };
  });

  for (let index = originalSections.sections.length; index < updatedSections.sections.length; index += 1) {
    mergedSections.push(updatedSections.sections[index]!);
  }

  return [
    ...pickScaffold(originalSections.topLines, updatedSections.topLines),
    ...mergedSections.flatMap((section) => [section.heading, section.body]),
  ].join("\n").trimEnd();
}

export function buildGovernedCharacterMatrixWorkingSet(params: {
  readonly matrixMarkdown: string;
  readonly chapterIntent: string;
  readonly contextPackage: ContextPackage;
  readonly protagonistName?: string;
}): string {
  const { matrixMarkdown } = params;
  if (!matrixMarkdown || matrixMarkdown === "(文件不存在)" || matrixMarkdown === "(文件尚未创建)") {
    return matrixMarkdown;
  }

  const parsed = parseSections(matrixMarkdown);
  if (parsed.sections.length === 0) {
    return matrixMarkdown;
  }

  const activeNames = collectGovernedCharacterNames(params);
  const filteredSections = parsed.sections.map((section, index) => ({
    heading: section.heading,
    body: filterMatrixSection(section.body, index, activeNames),
  }));

  return [
    ...parsed.topLines,
    ...filteredSections.flatMap((section) => [section.heading, section.body]),
  ].join("\n").trimEnd();
}

interface ParsedTable {
  readonly leadingLines: string[];
  readonly dataRows: string[][];
  readonly trailingLines: string[];
}

function parseSingleTable(content: string): ParsedTable | null {
  const lines = content.split("\n");
  const tableIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter((entry) => entry.line.trim().startsWith("|"))
    .map((entry) => entry.index);
  if (tableIndexes.length === 0) return null;

  const headerStart = tableIndexes[0]!;
  const nextIndex = tableIndexes[1];
  const headerEnd = nextIndex !== undefined && lines[nextIndex]!.includes("---")
    ? nextIndex
    : headerStart;
  const dataIndexes = tableIndexes.filter((index) => index > headerEnd);
  const lastDataIndex = dataIndexes.length > 0 ? dataIndexes[dataIndexes.length - 1]! : headerEnd;

  return {
    leadingLines: lines.slice(0, headerEnd + 1),
    dataRows: dataIndexes.map((index) => parseRow(lines[index]!)),
    trailingLines: lines.slice(lastDataIndex + 1),
  };
}

function parseSections(content: string): {
  readonly topLines: string[];
  readonly sections: Array<{ readonly heading: string; readonly body: string }>;
} {
  const lines = content.split("\n");
  const topLines: string[] = [];
  const sections: Array<{ heading: string; body: string }> = [];
  let currentHeading: string | null = null;
  let currentBody: string[] = [];

  const flush = () => {
    if (!currentHeading) return;
    sections.push({
      heading: currentHeading,
      body: currentBody.join("\n").trimEnd(),
    });
  };

  for (const line of lines) {
    if (line.startsWith("### ")) {
      flush();
      currentHeading = line;
      currentBody = [];
      continue;
    }

    if (currentHeading) {
      currentBody.push(line);
    } else {
      topLines.push(line);
    }
  }

  flush();
  return { topLines, sections };
}

function parseRow(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function renderRow(row: ReadonlyArray<string>): string {
  return `| ${row.join(" | ")} |`;
}

function buildKey(row: ReadonlyArray<string>, keyColumns: ReadonlyArray<number>): string {
  return keyColumns.map((index) => row[index] ?? "").join("::");
}

function pickScaffold(primary: string[], fallback: string[]): string[] {
  return primary.length > 0 ? primary : fallback;
}

function collectGovernedCharacterNames(params: {
  readonly matrixMarkdown: string;
  readonly chapterIntent: string;
  readonly contextPackage: ContextPackage;
  readonly protagonistName?: string;
}): Set<string> {
  const candidates = extractCharacterCandidatesFromMatrix(params.matrixMarkdown);
  const corpus = [
    params.chapterIntent,
    ...params.contextPackage.selectedContext.flatMap((entry) => [
      entry.reason,
      entry.excerpt ?? "",
    ]),
  ].join("\n");

  const activeNames = new Set<string>();
  for (const candidate of candidates) {
    if (params.protagonistName && matchesName(candidate, params.protagonistName)) {
      activeNames.add(candidate);
      continue;
    }
    if (isNameMentioned(candidate, corpus)) {
      activeNames.add(candidate);
    }
  }

  if (params.protagonistName) {
    for (const candidate of candidates) {
      if (matchesName(candidate, params.protagonistName)) {
        activeNames.add(candidate);
      }
    }
  }

  return activeNames;
}

function extractCharacterCandidatesFromMatrix(matrixMarkdown: string): string[] {
  const parsed = parseSections(matrixMarkdown);
  const names = new Set<string>();

  parsed.sections.forEach((section, index) => {
    const table = parseSingleTable(section.body);
    if (!table) return;

    for (const row of table.dataRows) {
      const candidates = index === 1
        ? [row[0], row[1]]
        : [row[0]];
      for (const candidate of candidates) {
        const normalized = candidate?.trim();
        if (normalized) {
          names.add(normalized);
        }
      }
    }
  });

  return [...names];
}

function filterMatrixSection(
  sectionBody: string,
  sectionIndex: number,
  activeNames: ReadonlySet<string>,
): string {
  const table = parseSingleTable(sectionBody);
  if (!table) {
    return sectionBody;
  }

  const filteredRows = table.dataRows.filter((row) => {
    if (row.length === 0) return false;

    if (sectionIndex === 1) {
      const left = row[0] ?? "";
      const right = row[1] ?? "";
      return activeNames.has(left) && (right.length === 0 || activeNames.has(right));
    }

    return activeNames.has(row[0] ?? "");
  });

  return [
    ...table.leadingLines,
    ...filteredRows.map(renderRow),
    ...table.trailingLines,
  ].join("\n").trimEnd();
}

function isNameMentioned(candidate: string, corpus: string): boolean {
  if (!candidate || !corpus) return false;

  if (containsCjk(candidate)) {
    return corpus.includes(candidate);
  }

  return new RegExp(`\\b${escapeRegExp(candidate)}\\b`, "i").test(corpus);
}

function matchesName(left: string, right: string): boolean {
  if (!left || !right) return false;
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function containsCjk(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
