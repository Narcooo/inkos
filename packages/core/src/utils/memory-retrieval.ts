import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readCurrentStateWithFallback } from "./outline-paths.js";
import {
  ChapterSummariesStateSchema,
  CurrentStateStateSchema,
  HooksStateSchema,
} from "../models/runtime-state.js";
import { MemoryDB, type Fact, type StoredHook, type StoredSummary } from "../state/memory-db.js";
import { bootstrapStructuredStateFromMarkdown } from "../state/state-bootstrap.js";
import {
  filterActiveHooks,
  isFuturePlannedHook,
  isHookWithinChapterWindow,
  normalizeStoredHookStatus,
} from "./hook-lifecycle.js";
import {
  parseChapterSummariesMarkdown,
  parseCurrentStateFacts,
  parsePendingHooksMarkdown,
  renderHookSnapshot,
  renderSummarySnapshot,
} from "./story-markdown.js";
import {
  LocalSearchIndex,
  type SearchDocument,
  type SearchHit,
} from "../retrieval/local-search.js";
export {
  isFuturePlannedHook,
  isHookWithinChapterWindow,
} from "./hook-lifecycle.js";
export {
  parseChapterSummariesMarkdown,
  parseCurrentStateFacts,
  parsePendingHooksMarkdown,
  renderHookSnapshot,
  renderSummarySnapshot,
} from "./story-markdown.js";

export interface MemorySelection {
  readonly summaries: ReadonlyArray<StoredSummary>;
  readonly hooks: ReadonlyArray<StoredHook>;
  readonly activeHooks: ReadonlyArray<StoredHook>;
  /**
   * Hooks with recycling pressure — stale hooks that the planner must
   * advance/resolve/defer (and if deferred, justify). Sorted by staleness DESC
   * (most overdue first). See computeRecyclableHooks for the selection rule.
   */
  readonly recyclableHooks: ReadonlyArray<StoredHook>;
  readonly facts: ReadonlyArray<Fact>;
  readonly volumeSummaries: ReadonlyArray<VolumeSummarySelection>;
  readonly dbPath: string;
  readonly retrievalTrace: MemoryRetrievalTrace;
}

export interface MemoryRetrievalTrace {
  readonly engine: "sqlite-fts5-bm25";
  readonly query: string;
  readonly candidates: ReadonlyArray<{
    readonly id: string;
    readonly kind: string;
    readonly source: string;
    readonly score: number;
  }>;
  readonly semanticSelectedIds?: ReadonlyArray<string>;
}

export interface MemorySemanticSelectionRequest {
  readonly chapterNumber: number;
  readonly query: string;
  readonly candidates: ReadonlyArray<{
    readonly id: string;
    readonly kind: string;
    readonly source: string;
    readonly title: string;
    readonly excerpt: string;
  }>;
}

export type MemorySemanticSelector = (
  request: MemorySemanticSelectionRequest,
) => Promise<ReadonlyArray<string>>;

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
  readonly semanticSelector?: MemorySemanticSelector;
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
    hooksMarkdown,
    volumeSummariesMarkdown,
    structuredCurrentState,
    structuredHooks,
    structuredSummaries,
  ] = await Promise.all([
    readCurrentStateWithFallback(params.bookDir),
    readFile(join(storyDir, "pending_hooks.md"), "utf-8").catch(() => ""),
    readFile(join(storyDir, "volume_summaries.md"), "utf-8").catch(() => ""),
    readStructuredState(join(stateDir, "current_state.json"), CurrentStateStateSchema),
    readStructuredState(join(stateDir, "hooks.json"), HooksStateSchema),
    readStructuredState(join(stateDir, "chapter_summaries.json"), ChapterSummariesStateSchema),
  ]);
  const facts = structuredCurrentState?.facts ?? parseCurrentStateFacts(
    currentStateMarkdown,
    fallbackChapter,
  );
  const narrativeQuery = [params.goal, params.outlineNode ?? ""].filter(Boolean).join("\n");
  const retrievalQuery = [narrativeQuery, ...(params.mustKeep ?? [])].filter(Boolean).join("\n");
  const parsedVolumeSummaries = parseVolumeSummariesMarkdown(volumeSummariesMarkdown);
  // Hooks stay on the authority path instead of the SQLite acceleration path:
  // the DB table intentionally stores only a small subset and cannot preserve
  // promoted/core/dependency metadata, which is load-bearing for hook debt.
  const hooks = structuredHooks?.hooks ?? parsePendingHooksMarkdown(hooksMarkdown);
  const activeHooks = filterActiveHooks(hooks);
  // Dormant architect seeds are not active debt, but they remain searchable
  // canon. A chapter can explicitly activate one of them; excluding deferred
  // rows from retrieval makes the planner invent a duplicate hook instead.
  const searchableHooks = hooks.filter((hook) => normalizeStoredHookStatus(hook.status) !== "resolved");

  const summaries = structuredSummaries?.rows ?? parseChapterSummariesMarkdown(
    await readFile(join(storyDir, "chapter_summaries.md"), "utf-8").catch(() => ""),
  );
  const memoryDb = new MemoryDB(params.bookDir);
  try {
    memoryDb.replaceSummaries(summaries);
    memoryDb.replaceCurrentFacts(facts);

    // Markdown/structured hook state is authoritative. SQLite is a rebuildable
    // search projection and is never allowed to resurrect stale hook rows.
    const effectiveActiveHooks = activeHooks;
    const dbPath = join(storyDir, "memory.db");
    const searchIndex = new LocalSearchIndex(dbPath);
    try {
      searchIndex.replaceScope(
        STORY_MEMORY_SCOPE,
        buildMemorySearchDocuments({
          summaries,
          hooks: searchableHooks,
          facts,
          volumeSummaries: parsedVolumeSummaries,
        }),
      );
      const hits = searchIndex.search(retrievalQuery, {
        scope: STORY_MEMORY_SCOPE,
        limit: 32,
      });
      const semanticSelectedIds = await selectSemanticCandidateIds({
        selector: params.semanticSelector,
        chapterNumber: params.chapterNumber,
        query: retrievalQuery,
        hits,
      });
      const selectedSet = semanticSelectedIds ? new Set(semanticSelectedIds) : null;
      const rankedHits = selectedSet ? hits.filter((hit) => selectedSet.has(hit.id)) : hits;
      const rankScores = buildRankScores(rankedHits);

      return {
        summaries: selectRelevantSummaries(summaries, params.chapterNumber, rankScores),
        hooks: selectRelevantHooks(
          searchableHooks,
          effectiveActiveHooks,
          rankScores,
          params.chapterNumber,
        ),
        activeHooks: effectiveActiveHooks,
        recyclableHooks: computeRecyclableHooks(effectiveActiveHooks, params.chapterNumber),
        facts: selectRelevantFacts(facts, rankScores),
        volumeSummaries: selectRelevantVolumeSummaries(parsedVolumeSummaries, rankScores),
        dbPath,
        retrievalTrace: {
          engine: "sqlite-fts5-bm25",
          query: retrievalQuery,
          candidates: hits.map(({ id, kind, source, score }) => ({ id, kind, source, score })),
          ...(semanticSelectedIds ? { semanticSelectedIds } : {}),
        },
      };
    } finally {
      searchIndex.close();
    }
  } finally {
    memoryDb.close();
  }
}

const STORY_MEMORY_SCOPE = "story-memory";

async function selectSemanticCandidateIds(params: {
  readonly selector?: MemorySemanticSelector;
  readonly chapterNumber: number;
  readonly query: string;
  readonly hits: ReadonlyArray<SearchHit>;
}): Promise<ReadonlyArray<string> | undefined> {
  if (!params.selector || params.hits.length <= 1) return undefined;
  try {
    const allowed = new Set(params.hits.map((hit) => hit.id));
    const selected = await params.selector({
      chapterNumber: params.chapterNumber,
      query: params.query,
      candidates: params.hits.map((hit) => ({
        id: hit.id,
        kind: hit.kind,
        source: hit.source,
        title: hit.title,
        excerpt: hit.body,
      })),
    });
    return [...new Set(selected)].filter((id) => allowed.has(id));
  } catch {
    // Retrieval remains available if the semantic selector is temporarily
    // unavailable; BM25 and deterministic story-state priorities still apply.
    return undefined;
  }
}

/**
 * Phase 9-2: Hooks that the planner MUST address this chapter.
 *
 * An active hook is "recyclable" (i.e., stale enough to force an
 * advance/resolve/defer decision) when any of the following holds:
 *
 *   - pressured / near_payoff / progressing: silent for ≥ 5 chapters
 *   - planted / open: silent for ≥ 10 chapters
 *   - coreHook === true:                      silent for ≥ 8 chapters
 *
 * "Silent" = (chapterNumber − max(startChapter, lastAdvancedChapter)).
 * Future-planted hooks are excluded (they aren't overdue yet).
 * Sorted by silence DESC — most overdue first — so the planner sees the
 * worst debt at the top of its prompt slice.
 */
export function computeRecyclableHooks(
  hooks: ReadonlyArray<StoredHook>,
  chapterNumber: number,
): StoredHook[] {
  return hooks
    .filter((hook) => !isRecycleTerminalStatus(hook.status))
    .filter((hook) => !isFuturePlannedHook(hook, chapterNumber))
    .map((hook) => ({ hook, silence: hookSilence(hook, chapterNumber) }))
    .filter(({ hook, silence }) => silence >= recycleThreshold(hook))
    .sort((a, b) => b.silence - a.silence || a.hook.startChapter - b.hook.startChapter)
    .map(({ hook }) => hook);
}

function isRecycleTerminalStatus(status: string): boolean {
  return /^(resolved|closed|done|已回收|已解决|deferred|paused|hold|延后|延期|搁置|暂缓)$/i.test(status.trim());
}

function hookSilence(hook: StoredHook, chapterNumber: number): number {
  const lastTouch = Math.max(hook.startChapter, hook.lastAdvancedChapter);
  if (lastTouch <= 0) return chapterNumber;
  return Math.max(0, chapterNumber - lastTouch);
}

function recycleThreshold(hook: StoredHook): number {
  const status = hook.status.trim().toLowerCase();
  if (/pressured|near[_\s-]?payoff|progressing|重大推进|持续推进/.test(status)) return 5;
  if (hook.coreHook === true) return 8;
  return 10;
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

function buildMemorySearchDocuments(input: {
  readonly summaries: ReadonlyArray<StoredSummary>;
  readonly hooks: ReadonlyArray<StoredHook>;
  readonly facts: ReadonlyArray<Fact>;
  readonly volumeSummaries: ReadonlyArray<VolumeSummarySelection>;
}): SearchDocument[] {
  return [
    ...input.summaries.map((summary) => ({
      id: summaryDocumentId(summary.chapter),
      scope: STORY_MEMORY_SCOPE,
      kind: "chapter-summary",
      source: `story/chapter_summaries.md#${summary.chapter}`,
      title: summary.title || `Chapter ${summary.chapter}`,
      body: [
        summary.characters,
        summary.events,
        summary.stateChanges,
        summary.hookActivity,
        summary.mood,
        summary.chapterType,
      ].filter(Boolean).join("\n"),
      metadata: { chapter: summary.chapter },
    })),
    ...input.hooks.map((hook) => ({
      id: hookDocumentId(hook.hookId),
      scope: STORY_MEMORY_SCOPE,
      kind: "hook",
      source: `story/pending_hooks.md#${hook.hookId}`,
      title: [hook.hookId, hook.type].filter(Boolean).join(" "),
      body: [hook.status, hook.expectedPayoff, hook.payoffTiming, hook.notes].filter(Boolean).join("\n"),
      metadata: { hookId: hook.hookId },
    })),
    ...input.facts.map((fact, index) => ({
      id: factDocumentId(index),
      scope: STORY_MEMORY_SCOPE,
      kind: "fact",
      source: `story/current_state.md#${toFactSourceAnchor(fact.predicate)}`,
      title: [fact.subject, fact.predicate].filter(Boolean).join(" "),
      body: fact.object,
      metadata: { index },
    })),
    ...input.volumeSummaries.map((summary, index) => ({
      id: volumeSummaryDocumentId(index),
      scope: STORY_MEMORY_SCOPE,
      kind: "volume-summary",
      source: `story/volume_summaries.md#${summary.anchor}`,
      title: summary.heading,
      body: summary.content,
      metadata: { index },
    })),
  ];
}

function buildRankScores(hits: ReadonlyArray<SearchHit>): ReadonlyMap<string, number> {
  return new Map(hits.map((hit, index) => [hit.id, (hits.length - index) * 10]));
}

function summaryDocumentId(chapter: number): string {
  return `summary:${chapter}`;
}

function hookDocumentId(hookId: string): string {
  return `hook:${hookId}`;
}

function factDocumentId(index: number): string {
  return `fact:${index}`;
}

function volumeSummaryDocumentId(index: number): string {
  return `volume-summary:${index}`;
}

function toFactSourceAnchor(value: string): string {
  return value.trim().replaceAll(/\s+/g, "-") || "fact";
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

function isUnresolvedHook(status: string): boolean {
  return status.trim().length === 0 || /open|待定|推进|active|progressing/i.test(status);
}

function selectRelevantSummaries(
  summaries: ReadonlyArray<StoredSummary>,
  chapterNumber: number,
  rankScores: ReadonlyMap<string, number>,
): StoredSummary[] {
  const ranked = summaries
    .filter((summary) => summary.chapter < chapterNumber)
    .map((summary) => {
      const age = Math.max(0, chapterNumber - summary.chapter);
      const retrievalScore = rankScores.get(summaryDocumentId(summary.chapter)) ?? 0;
      return {
        summary,
        score: retrievalScore + Math.max(0, 12 - age),
        retrieved: retrievalScore > 0,
      };
    });
  const recent = ranked
    .filter((entry) => entry.summary.chapter >= chapterNumber - 3)
    .sort((left, right) => right.summary.chapter - left.summary.chapter)
    .slice(0, 3);
  const recalled = ranked
    .filter((entry) => entry.retrieved)
    .sort((left, right) => right.score - left.score || right.summary.chapter - left.summary.chapter)
    .slice(0, 1);

  return [...new Map([...recent, ...recalled].map((entry) => [entry.summary.chapter, entry.summary])).values()]
    .sort((left, right) => left.chapter - right.chapter);
}

function selectRelevantHooks(
  hooks: ReadonlyArray<StoredHook>,
  activeHooks: ReadonlyArray<StoredHook>,
  rankScores: ReadonlyMap<string, number>,
  chapterNumber: number,
): StoredHook[] {
  const activeHookIds = new Set(activeHooks.map((hook) => hook.hookId));
  const ranked = hooks
    .map((hook) => {
      const retrievalScore = rankScores.get(hookDocumentId(hook.hookId)) ?? 0;
      return {
        hook,
        score: retrievalScore + Math.max(0, hook.lastAdvancedChapter),
        retrieved: retrievalScore > 0,
      };
    })
    .filter((entry) => entry.retrieved || activeHookIds.has(entry.hook.hookId));

  const primary = ranked
    .filter((entry) =>
      entry.retrieved
      || (activeHookIds.has(entry.hook.hookId) && isHookWithinChapterWindow(entry.hook, chapterNumber, 5)),
    )
    .sort((left, right) => right.score - left.score || right.hook.lastAdvancedChapter - left.hook.lastAdvancedChapter)
    .slice(0, 6);

  const selectedIds = new Set(primary.map((entry) => entry.hook.hookId));
  const stale = ranked
    .filter((entry) =>
      !selectedIds.has(entry.hook.hookId)
      && activeHookIds.has(entry.hook.hookId)
      && !isFuturePlannedHook(entry.hook, chapterNumber)
      && isUnresolvedHook(entry.hook.status),
    )
    .sort((left, right) => left.hook.lastAdvancedChapter - right.hook.lastAdvancedChapter || right.score - left.score)
    .slice(0, 2);

  return [...primary, ...stale].map((entry) => entry.hook);
}

function selectRelevantFacts(
  facts: ReadonlyArray<Fact>,
  rankScores: ReadonlyMap<string, number>,
): Fact[] {
  const prioritizedPredicates = [
    ["当前冲突", "current conflict"],
    ["当前目标", "current goal"],
    ["主角状态", "protagonist state"],
    ["当前限制", "current constraint"],
    ["当前位置", "current location"],
    ["当前敌我", "current alliances", "current relationships"],
  ];

  return facts
    .map((fact, index) => {
      const normalizedPredicate = fact.predicate.trim().toLocaleLowerCase();
      const priority = prioritizedPredicates.findIndex((values) => values.includes(normalizedPredicate));
      const baseScore = priority === -1 ? 5 : 20 - priority * 2;
      const retrievalScore = rankScores.get(factDocumentId(index)) ?? 0;

      return {
        fact,
        score: baseScore + retrievalScore,
        retrieved: retrievalScore > 0,
      };
    })
    .filter((entry) => entry.retrieved || entry.score >= 14)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((entry) => entry.fact);
}

function selectRelevantVolumeSummaries(
  summaries: ReadonlyArray<VolumeSummarySelection>,
  rankScores: ReadonlyMap<string, number>,
): VolumeSummarySelection[] {
  if (summaries.length === 0) return [];

  const ranked = summaries
    .map((summary, index) => {
      const retrievalScore = rankScores.get(volumeSummaryDocumentId(index)) ?? 0;
      return {
        index,
        summary,
        score: retrievalScore + index,
        retrieved: retrievalScore > 0,
      };
    })
    .filter((entry, index, all) => entry.retrieved || index === all.length - 1)
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.summary);

  return ranked;
}

function slugifyAnchor(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "volume-summary";
}
