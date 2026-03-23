import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MemoryDB, type Fact, type StoredHook, type StoredSummary } from "../state/memory-db.js";

export interface MemorySelection {
  readonly summaries: ReadonlyArray<StoredSummary>;
  readonly hooks: ReadonlyArray<StoredHook>;
  readonly facts: ReadonlyArray<Fact>;
  readonly dbPath?: string;
}

export async function retrieveMemorySelection(params: {
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly goal: string;
  readonly outlineNode?: string;
  readonly mustKeep?: ReadonlyArray<string>;
}): Promise<MemorySelection> {
  const storyDir = join(params.bookDir, "story");
  const [summariesMarkdown, hooksMarkdown, currentStateMarkdown] = await Promise.all([
    readFile(join(storyDir, "chapter_summaries.md"), "utf-8").catch(() => ""),
    readFile(join(storyDir, "pending_hooks.md"), "utf-8").catch(() => ""),
    readFile(join(storyDir, "current_state.md"), "utf-8").catch(() => ""),
  ]);

  const summaries = parseChapterSummariesMarkdown(summariesMarkdown);
  const hooks = parsePendingHooksMarkdown(hooksMarkdown);
  const facts = parseCurrentStateFacts(
    currentStateMarkdown,
    Math.max(0, params.chapterNumber - 1),
  );
  const queryTerms = extractQueryTerms(
    params.goal,
    params.outlineNode,
    params.mustKeep ?? [],
  );

  const memoryDb = openMemoryDB(params.bookDir);
  if (memoryDb) {
    try {
      memoryDb.replaceSummaries(summaries);
      memoryDb.replaceHooks(hooks);
      memoryDb.replaceCurrentFacts(facts);

      return {
        summaries: selectRelevantSummaries(
          memoryDb.getSummaries(1, Math.max(1, params.chapterNumber - 1)),
          params.chapterNumber,
          queryTerms,
        ),
        hooks: selectRelevantHooks(memoryDb.getActiveHooks(), queryTerms),
        facts: selectRelevantFacts(memoryDb.getCurrentFacts(), queryTerms),
        dbPath: join(storyDir, "memory.db"),
      };
    } finally {
      memoryDb.close();
    }
  }

  return {
    summaries: selectRelevantSummaries(summaries, params.chapterNumber, queryTerms),
    hooks: selectRelevantHooks(hooks, queryTerms),
    facts: selectRelevantFacts(facts, queryTerms),
  };
}

export function renderSummarySnapshot(summaries: ReadonlyArray<StoredSummary>): string {
  if (summaries.length === 0) return "- none";

  return [
    "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...summaries.map((summary) => [
      summary.chapter,
      summary.title,
      summary.characters,
      summary.events,
      summary.stateChanges,
      summary.hookActivity,
      summary.mood,
      summary.chapterType,
    ].map(escapeTableCell).join(" | ")).map((row) => `| ${row} |`),
  ].join("\n");
}

export function renderHookSnapshot(hooks: ReadonlyArray<StoredHook>): string {
  if (hooks.length === 0) return "- none";

  return [
    "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...hooks.map((hook) => [
      hook.hookId,
      hook.startChapter,
      hook.type,
      hook.status,
      hook.lastAdvancedChapter,
      hook.expectedPayoff,
      hook.notes,
    ].map((cell) => escapeTableCell(String(cell))).join(" | ")).map((row) => `| ${row} |`),
  ].join("\n");
}

function openMemoryDB(bookDir: string): MemoryDB | null {
  try {
    return new MemoryDB(bookDir);
  } catch {
    return null;
  }
}

function extractQueryTerms(goal: string, outlineNode: string | undefined, mustKeep: ReadonlyArray<string>): string[] {
  const stopWords = new Set([
    "bring", "focus", "back", "chapter", "clear", "narrative", "before", "opening",
    "track", "the", "with", "from", "that", "this", "into", "still", "cannot",
    "current", "state", "advance", "conflict", "story", "keep", "must", "local",
  ]);

  const source = [goal, outlineNode ?? "", ...mustKeep].join(" ");
  const english = source.match(/[a-z]{4,}/gi) ?? [];
  const chinese = source.match(/[\u4e00-\u9fff]{2,4}/g) ?? [];

  return [...new Set(
    [...english, ...chinese]
      .map((term) => term.trim())
      .filter((term) => term.length >= 2)
      .filter((term) => !stopWords.has(term.toLowerCase())),
  )].slice(0, 12);
}

function parseChapterSummariesMarkdown(markdown: string): StoredSummary[] {
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

function parsePendingHooksMarkdown(markdown: string): StoredHook[] {
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
  const tableRows = parseMarkdownTableRows(markdown);
  const fieldValueRows = tableRows
    .filter((row) => row.length >= 2)
    .filter((row) => !isStateTableHeaderRow(row));

  if (fieldValueRows.length > 0) {
    const chapterFromTable = fieldValueRows.find((row) => isCurrentChapterLabel(row[0] ?? ""));
    const stateChapter = parseInteger(chapterFromTable?.[1]) || fallbackChapter;

    return fieldValueRows
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
      });
  }

  const bulletFacts = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.replace(/^-\s*/, ""))
    .filter(Boolean);

  return bulletFacts.map((line, index) => ({
    subject: "current_state",
    predicate: `note_${index + 1}`,
    object: line,
    validFromChapter: fallbackChapter,
    validUntilChapter: null,
    sourceChapter: fallbackChapter,
  }));
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

function selectRelevantSummaries(
  summaries: ReadonlyArray<StoredSummary>,
  chapterNumber: number,
  queryTerms: ReadonlyArray<string>,
): StoredSummary[] {
  return summaries
    .filter((summary) => summary.chapter < chapterNumber)
    .map((summary) => ({
      summary,
      score: scoreSummary(summary, chapterNumber, queryTerms),
      matched: matchesAny([
        summary.title,
        summary.characters,
        summary.events,
        summary.stateChanges,
        summary.hookActivity,
        summary.chapterType,
      ].join(" "), queryTerms),
    }))
    .filter((entry) => entry.matched || entry.summary.chapter >= chapterNumber - 3)
    .sort((left, right) => right.score - left.score || right.summary.chapter - left.summary.chapter)
    .slice(0, 4)
    .map((entry) => entry.summary)
    .sort((left, right) => left.chapter - right.chapter);
}

function selectRelevantHooks(
  hooks: ReadonlyArray<StoredHook>,
  queryTerms: ReadonlyArray<string>,
): StoredHook[] {
  return hooks
    .map((hook) => ({
      hook,
      score: scoreHook(hook, queryTerms),
      matched: matchesAny(
        [hook.hookId, hook.type, hook.expectedPayoff, hook.notes].join(" "),
        queryTerms,
      ),
    }))
    .filter((entry) => entry.matched || entry.hook.status.trim().length === 0 || /open|待定|推进|active/i.test(entry.hook.status))
    .sort((left, right) => right.score - left.score || right.hook.lastAdvancedChapter - left.hook.lastAdvancedChapter)
    .slice(0, 3)
    .map((entry) => entry.hook);
}

function selectRelevantFacts(
  facts: ReadonlyArray<Fact>,
  queryTerms: ReadonlyArray<string>,
): Fact[] {
  const prioritizedPredicates = [
    /^(当前冲突|current conflict)$/i,
    /^(当前目标|current goal)$/i,
    /^(主角状态|protagonist state)$/i,
    /^(当前限制|current constraint)$/i,
    /^(当前位置|current location)$/i,
    /^(当前敌我|current alliances|current relationships)$/i,
  ];

  return facts
    .map((fact) => {
      const text = [fact.subject, fact.predicate, fact.object].join(" ");
      const priority = prioritizedPredicates.findIndex((pattern) => pattern.test(fact.predicate));
      const baseScore = priority === -1 ? 5 : 20 - priority * 2;
      const termScore = queryTerms.reduce(
        (score, term) => score + (includesTerm(text, term) ? Math.max(8, term.length * 2) : 0),
        0,
      );

      return {
        fact,
        score: baseScore + termScore,
        matched: matchesAny(text, queryTerms),
      };
    })
    .filter((entry) => entry.matched || entry.score >= 14)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((entry) => entry.fact);
}

function scoreSummary(summary: StoredSummary, chapterNumber: number, queryTerms: ReadonlyArray<string>): number {
  const text = [
    summary.title,
    summary.characters,
    summary.events,
    summary.stateChanges,
    summary.hookActivity,
    summary.chapterType,
  ].join(" ");
  const age = Math.max(0, chapterNumber - summary.chapter);
  const recencyScore = Math.max(0, 12 - age);
  const termScore = queryTerms.reduce((score, term) => score + (includesTerm(text, term) ? Math.max(8, term.length * 2) : 0), 0);
  return recencyScore + termScore;
}

function scoreHook(hook: StoredHook, queryTerms: ReadonlyArray<string>): number {
  const text = [hook.hookId, hook.type, hook.expectedPayoff, hook.notes].join(" ");
  const freshness = Math.max(0, hook.lastAdvancedChapter);
  const termScore = queryTerms.reduce((score, term) => score + (includesTerm(text, term) ? Math.max(8, term.length * 2) : 0), 0);
  return termScore + freshness;
}

function matchesAny(text: string, queryTerms: ReadonlyArray<string>): boolean {
  return queryTerms.some((term) => includesTerm(text, term));
}

function includesTerm(text: string, term: string): boolean {
  return text.toLowerCase().includes(term.toLowerCase());
}

function parseInteger(value: string | undefined): number {
  if (!value) return 0;
  const match = value.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

function escapeTableCell(value: string | number): string {
  return String(value).replace(/\|/g, "\\|").trim();
}
