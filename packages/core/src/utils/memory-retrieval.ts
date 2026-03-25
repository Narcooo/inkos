import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ChapterSummariesStateSchema,
  CurrentStateStateSchema,
  HooksStateSchema,
} from "../models/runtime-state.js";
import { MemoryDB, type Fact, type StoredHook, type StoredSummary } from "../state/memory-db.js";
import { bootstrapStructuredStateFromMarkdown } from "../state/state-bootstrap.js";

export interface MemorySelection {
  readonly summaries: ReadonlyArray<StoredSummary>;
  readonly hooks: ReadonlyArray<StoredHook>;
  readonly facts: ReadonlyArray<Fact>;
  readonly volumeSummaries: ReadonlyArray<VolumeSummarySelection>;
  readonly dbPath?: string;
}

export interface VolumeSummarySelection {
  readonly heading: string;
  readonly content: string;
  readonly anchor: string;
}

export async function retrieveMemorySelection(params: {
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly goal: string;
  readonly outlineNode?: string;
  readonly mustKeep?: ReadonlyArray<string>;
}): Promise<MemorySelection> {
  const storyDir = join(params.bookDir, "story");
  const stateDir = join(storyDir, "state");
  const fallbackChapter = Math.max(0, params.chapterNumber - 1);

  await bootstrapStructuredStateFromMarkdown({
    bookDir: params.bookDir,
    fallbackChapter,
  }).catch(() => undefined);

  const [
    currentStateMarkdown,
    volumeSummariesMarkdown,
    structuredCurrentState,
    structuredHooks,
    structuredSummaries,
  ] = await Promise.all([
    readFile(join(storyDir, "current_state.md"), "utf-8").catch(() => ""),
    readFile(join(storyDir, "volume_summaries.md"), "utf-8").catch(() => ""),
    readStructuredState(join(stateDir, "current_state.json"), CurrentStateStateSchema),
    readStructuredState(join(stateDir, "hooks.json"), HooksStateSchema),
    readStructuredState(join(stateDir, "chapter_summaries.json"), ChapterSummariesStateSchema),
  ]);
  const facts = structuredCurrentState?.facts ?? parseCurrentStateFacts(
    currentStateMarkdown,
    fallbackChapter,
  );
  const queryTerms = extractQueryTerms(
    params.goal,
    params.outlineNode,
    params.mustKeep ?? [],
  );
  const volumeSummaries = selectRelevantVolumeSummaries(
    parseVolumeSummariesMarkdown(volumeSummariesMarkdown),
    queryTerms,
  );

  const memoryDb = openMemoryDB(params.bookDir);
  if (memoryDb) {
    try {
      if (memoryDb.getChapterCount() === 0) {
        const summaries = structuredSummaries?.rows ?? parseChapterSummariesMarkdown(
          await readFile(join(storyDir, "chapter_summaries.md"), "utf-8").catch(() => ""),
        );
        if (summaries.length > 0) {
          memoryDb.replaceSummaries(summaries);
        }
      }
      if (memoryDb.getActiveHooks().length === 0) {
        const hooks = structuredHooks?.hooks ?? parsePendingHooksMarkdown(
          await readFile(join(storyDir, "pending_hooks.md"), "utf-8").catch(() => ""),
        );
        if (hooks.length > 0) {
          memoryDb.replaceHooks(hooks);
        }
      }
      if (memoryDb.getCurrentFacts().length === 0 && facts.length > 0) {
        memoryDb.replaceCurrentFacts(facts);
      }

      return {
        summaries: selectRelevantSummaries(
          memoryDb.getSummaries(1, Math.max(1, params.chapterNumber - 1)),
          params.chapterNumber,
          queryTerms,
        ),
        hooks: selectRelevantHooks(memoryDb.getActiveHooks(), queryTerms, params.chapterNumber),
        facts: selectRelevantFacts(memoryDb.getCurrentFacts(), queryTerms),
        volumeSummaries,
        dbPath: join(storyDir, "memory.db"),
      };
    } finally {
      memoryDb.close();
    }
  }

  const [summariesMarkdown, hooksMarkdown] = await Promise.all([
    readFile(join(storyDir, "chapter_summaries.md"), "utf-8").catch(() => ""),
    readFile(join(storyDir, "pending_hooks.md"), "utf-8").catch(() => ""),
  ]);
  const summaries = structuredSummaries?.rows ?? parseChapterSummariesMarkdown(summariesMarkdown);
  const hooks = structuredHooks?.hooks ?? parsePendingHooksMarkdown(hooksMarkdown);

  return {
    summaries: selectRelevantSummaries(summaries, params.chapterNumber, queryTerms),
    hooks: selectRelevantHooks(hooks, queryTerms, params.chapterNumber),
    facts: selectRelevantFacts(facts, queryTerms),
    volumeSummaries,
  };
}

export function extractQueryTerms(goal: string, outlineNode: string | undefined, mustKeep: ReadonlyArray<string>): string[] {
  const primaryTerms = uniqueTerms([
    ...extractTermsFromText(stripNegativeGuidance(goal)),
    ...mustKeep.flatMap((item) => extractTermsFromText(item)),
  ]);

  if (primaryTerms.length >= 2) {
    return primaryTerms.slice(0, 12);
  }

  return uniqueTerms([
    ...primaryTerms,
    ...extractTermsFromText(stripNegativeGuidance(outlineNode ?? "")),
  ]).slice(0, 12);
}

export function renderSummarySnapshot(
  summaries: ReadonlyArray<StoredSummary>,
  language: "zh" | "en" = "zh",
): string {
  if (summaries.length === 0) return "- none";

  const headers = language === "en"
    ? [
      "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    : [
      "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ];

  return [
    ...headers,
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

export function renderHookSnapshot(
  hooks: ReadonlyArray<StoredHook>,
  language: "zh" | "en" = "zh",
): string {
  if (hooks.length === 0) return "- none";

  const headers = language === "en"
    ? [
      "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
      "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    : [
      "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
      "| --- | --- | --- | --- | --- | --- | --- |",
    ];

  return [
    ...headers,
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

async function readStructuredState<T>(
  path: string,
  schema: { parse(value: unknown): T },
): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf-8");
    return schema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function buildLegacyQueryTerms(goal: string, outlineNode: string | undefined, mustKeep: ReadonlyArray<string>): string[] {
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

function extractTermsFromText(text: string): string[] {
  if (!text.trim()) return [];

  const stopWords = new Set([
    "bring", "focus", "back", "chapter", "clear", "narrative", "before", "opening",
    "track", "the", "with", "from", "that", "this", "into", "still", "cannot",
    "current", "state", "advance", "conflict", "story", "keep", "must", "local",
    "does", "not", "only", "just", "then", "than",
  ]);

  const normalized = text.replace(/第\d+章/g, " ");
  const english = (normalized.match(/[a-z]{4,}/gi) ?? [])
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .filter((term) => !stopWords.has(term.toLowerCase()));

  const chineseSegments = normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const chinese = chineseSegments.flatMap((segment) => extractChineseFocusTerms(segment));

  return [...english, ...chinese];
}

function extractChineseFocusTerms(segment: string): string[] {
  const stripped = segment
    .replace(/^(本章|继续|重新|拉回|回到|推进|优先|围绕|聚焦|坚持|保持|把注意力|注意力|将注意力|请把注意力|先把注意力)+/, "")
    .replace(/^(处理|推进|回拉|拉回到)+/, "")
    .trim();

  const target = stripped.length >= 2 ? stripped : segment;
  const terms = new Set<string>();

  if (target.length <= 4) {
    terms.add(target);
  }

  for (let size = 2; size <= 4; size += 1) {
    if (target.length >= size) {
      terms.add(target.slice(-size));
    }
  }

  return [...terms].filter((term) => term.length >= 2);
}

function stripNegativeGuidance(text: string): string {
  if (!text) return "";

  return text
    .replace(/\b(do not|don't|avoid|without|instead of)\b[\s\S]*$/i, " ")
    .replace(/(?:不要|不让|别|禁止|避免|但不允许)[\s\S]*$/u, " ")
    .trim();
}

function uniqueTerms(terms: ReadonlyArray<string>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const term of terms) {
    const normalized = term.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(term.trim());
  }

  return result;
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

function parseVolumeSummariesMarkdown(markdown: string): VolumeSummarySelection[] {
  if (!markdown.trim()) return [];

  const sections = markdown
    .split(/^##\s+/m)
    .map((section) => section.trim())
    .filter(Boolean);

  return sections.map((section) => {
    const [headingLine, ...bodyLines] = section.split("\n");
    const heading = headingLine?.trim() ?? "";
    const content = bodyLines.join("\n").trim();

    return {
      heading,
      content,
      anchor: slugifyAnchor(heading),
    };
  }).filter((section) => section.heading.length > 0 && section.content.length > 0);
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

function isUnresolvedHook(status: string): boolean {
  return status.trim().length === 0 || /open|待定|推进|active|progressing/i.test(status);
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
  chapterNumber: number,
): StoredHook[] {
  const ranked = hooks
    .map((hook) => ({
      hook,
      score: scoreHook(hook, queryTerms),
      matched: matchesAny(
        [hook.hookId, hook.type, hook.expectedPayoff, hook.notes].join(" "),
        queryTerms,
      ),
    }))
    .filter((entry) => entry.matched || isUnresolvedHook(entry.hook.status));

  const recentCutoff = Math.max(0, chapterNumber - 5);
  const staleCutoff = Math.max(0, chapterNumber - 10);
  const primary = ranked
    .filter((entry) => (
      entry.matched
      || entry.hook.lastAdvancedChapter >= recentCutoff
      || entry.hook.startChapter >= recentCutoff
    ))
    .sort((left, right) => right.score - left.score || right.hook.lastAdvancedChapter - left.hook.lastAdvancedChapter)
    .slice(0, 3);

  const selectedIds = new Set(primary.map((entry) => entry.hook.hookId));
  const stale = ranked
    .filter((entry) => (
      !selectedIds.has(entry.hook.hookId)
      && entry.hook.lastAdvancedChapter <= staleCutoff
      && isUnresolvedHook(entry.hook.status)
    ))
    .sort((left, right) => left.hook.lastAdvancedChapter - right.hook.lastAdvancedChapter || right.score - left.score)
    .slice(0, 1);

  return [...primary, ...stale].map((entry) => entry.hook);
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

function selectRelevantVolumeSummaries(
  summaries: ReadonlyArray<VolumeSummarySelection>,
  queryTerms: ReadonlyArray<string>,
): VolumeSummarySelection[] {
  if (summaries.length === 0) return [];

  const ranked = summaries
    .map((summary, index) => {
      const text = `${summary.heading} ${summary.content}`;
      const termScore = queryTerms.reduce(
        (score, term) => score + (includesTerm(text, term) ? Math.max(8, term.length * 2) : 0),
        0,
      );

      return {
        index,
        summary,
        score: termScore + index,
        matched: matchesAny(text, queryTerms),
      };
    })
    .filter((entry, index, all) => entry.matched || index === all.length - 1)
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.summary);

  return ranked;
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

function slugifyAnchor(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "volume-summary";
}
