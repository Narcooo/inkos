import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseMarkdownTableRows } from "../utils/story-markdown.js";
import { readCharacterContext } from "../utils/outline-paths.js";
import { readBookRules as readStructuredBookRules } from "./rules-reader.js";
import type { StoredHook } from "../state/memory-db.js";

async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Phase 5: prefer roles/ directory; fall back to legacy character_matrix.md.
 * storyDir is <bookDir>/story, so the caller indirectly points us at bookDir
 * via dirname().
 */
export async function readCharacterMatrix(storyDir: string): Promise<string> {
  const bookDir = dirname(storyDir);
  return readCharacterContext(bookDir, "");
}

export async function readSubplotBoard(storyDir: string): Promise<string> {
  return readOrEmpty(join(storyDir, "subplot_board.md"));
}

export async function readEmotionalArcs(storyDir: string): Promise<string> {
  return readOrEmpty(join(storyDir, "emotional_arcs.md"));
}

export async function readBrief(storyDir: string): Promise<string> {
  return readOrEmpty(join(storyDir, "brief.md"));
}

/**
 * Render the structured book rules (protagonist / prohibitions / genreLock /
 * behavioral constraints) as a compact markdown block for the planner prompt.
 *
 * Phase 5 cleanup #3: reads the YAML frontmatter via readStructuredBookRules
 * (which prefers story_frame.md and falls back to legacy book_rules.md).
 * Returns "" when no structured rules are defined — the planner template
 * provides its own placeholder for that case.
 */
export async function readBookRules(storyDir: string): Promise<string> {
  const bookDir = dirname(storyDir);
  const parsed = await readStructuredBookRules(bookDir);
  if (!parsed) return "";

  const { rules, body } = parsed;
  const lines: string[] = [];

  if (rules.protagonist) {
    const proto = rules.protagonist;
    const personality = proto.personalityLock.join("、");
    const constraints = proto.behavioralConstraints.join("、");
    lines.push(`- 主角 ${proto.name}${personality ? ` / 人设锁：${personality}` : ""}${constraints ? ` / 行为约束：${constraints}` : ""}`);
  }

  if (rules.prohibitions.length > 0) {
    lines.push("- 本书禁忌：");
    for (const p of rules.prohibitions) {
      lines.push(`  - ${p}`);
    }
  }

  if (rules.genreLock) {
    const forbidden = rules.genreLock.forbidden.join("、");
    lines.push(`- 题材锁：${rules.genreLock.primary}${forbidden ? ` / 禁止混入：${forbidden}` : ""}`);
  }

  if (rules.fanficMode) {
    lines.push(`- 同人模式：${rules.fanficMode}`);
  }

  const trimmedBody = body.trim();
  // The body holds narrative guidance prose (e.g. 叙事视角). Include it verbatim
  // so the planner sees the same text as before the cleanup.
  if (trimmedBody) {
    lines.push("", trimmedBody);
  }

  return lines.join("\n").trim();
}

/**
 * Grab the last N row(s) from chapter_summaries.md formatted as markdown
 * table. Returns original table slice (with header) so the planner gets
 * column meaning implicitly.
 */
export function formatRecentSummaries(
  chapterSummariesRaw: string,
  chapterNumber: number,
  limit: number,
): string {
  const rows = parseMarkdownTableRows(chapterSummariesRaw)
    .filter((row) => /^\d+$/.test(row[0] ?? ""))
    .filter((row) => parseInt(row[0]!, 10) < chapterNumber)
    .sort((a, b) => parseInt(a[0]!, 10) - parseInt(b[0]!, 10));

  const recent = rows.slice(-limit);
  if (recent.length === 0) {
    return "（暂无前章摘要）";
  }

  const header = "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |";
  const divider = "| --- | --- | --- | --- | --- | --- | --- | --- |";
  const body = recent.map((row) => `| ${row.join(" | ")} |`).join("\n");
  return [header, divider, body].join("\n");
}

/**
 * Option A: temporarily compose current_arc prose from subplot_board.md
 * active rows + emotional_arcs.md recent rows. Phase 8 will replace this
 * source with a dedicated tier2_current_arc.md file.
 */
export function composeCurrentArcProse(
  subplotBoardRaw: string,
  emotionalArcsRaw: string,
  chapterNumber: number,
): string {
  const activeSubplots = extractActiveSubplotLines(subplotBoardRaw);
  const recentArcs = extractRecentEmotionalArcLines(emotionalArcsRaw, chapterNumber, 3);

  const parts: string[] = [];
  if (activeSubplots.length > 0) {
    parts.push("活跃支线：\n" + activeSubplots.map((line) => `- ${line}`).join("\n"));
  }
  if (recentArcs.length > 0) {
    parts.push("近期情感线：\n" + recentArcs.map((line) => `- ${line}`).join("\n"));
  }
  if (parts.length === 0) {
    return "（暂无 arc 数据——可能是新书起始阶段）";
  }
  return parts.join("\n\n");
}

function extractActiveSubplotLines(raw: string): string[] {
  const rows = parseMarkdownTableRows(raw);
  if (rows.length === 0) {
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-"))
      .map((line) => line.replace(/^-\s*/, ""))
      .filter(Boolean)
      .slice(0, 6);
  }
  return rows
    .filter((row) => !/^(id|subplot_id|subplot|status|状态)$/i.test(row[0] ?? ""))
    .filter((row) => {
      const status = (row.find((cell) => /进行|推进|高压|激活|activ|progress|partial/i.test(cell)) ?? "");
      const dormant = row.find((cell) => /暂稳待续|暂挂|dormant|paused/i.test(cell));
      return Boolean(status) && !dormant;
    })
    .map((row) => row.filter(Boolean).join(" | "))
    .slice(0, 6);
}

function extractRecentEmotionalArcLines(raw: string, chapterNumber: number, limit: number): string[] {
  const rows = parseMarkdownTableRows(raw);
  if (rows.length === 0) {
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-"))
      .slice(-limit)
      .map((line) => line.replace(/^-\s*/, ""));
  }
  // emotional_arcs.md column layout: 角色 | 章节 | 情绪状态 | 触发事件 | 强度 | 弧线方向
  // Chapter number lives in column index 1 (row[1]), not column 0.
  return rows
    .filter((row) => /^\d+$/.test(row[1] ?? ""))
    .filter((row) => parseInt(row[1]!, 10) < chapterNumber)
    .slice(-limit)
    .map((row) => row.filter(Boolean).join(" | "));
}

const CHARACTER_MATRIX_HEADER_CELLS = /^(角色|character|name|核心标签|与主角关系|relation)$/i;

function isLikelyHeaderRow(row: ReadonlyArray<string>): boolean {
  return row.some((cell) => CHARACTER_MATRIX_HEADER_CELLS.test(cell.trim()));
}

/**
 * Extract the protagonist row from character_matrix.md. Protagonist is detected
 * by a cell in the 与主角关系 column matching "主角本人" / "主角" / "protagonist"
 * (case-insensitive). Falls back to the first non-header data row if no
 * explicit match is found — that row is almost always the protagonist by
 * convention.
 */
export function extractProtagonistRow(characterMatrixRaw: string): string {
  const rows = parseMarkdownTableRows(characterMatrixRaw);
  const protagonist = rows.find((row) =>
    row.some((cell) => /^(主角本人|主角|protagonist)$/i.test(cell.trim())),
  );
  if (protagonist) {
    return `| ${protagonist.join(" | ")} |`;
  }
  const firstDataRow = rows.find((row) => !isLikelyHeaderRow(row));
  if (firstDataRow) {
    return `| ${firstDataRow.join(" | ")} |`;
  }
  return "（未找到主角行——请检查 character_matrix.md）";
}

const OPPONENT_PATTERNS = /敌对|对手|阻力|opponent|antagonist|foe/i;
const COLLABORATOR_PATTERNS = /协力|盟友|临时助力|ally|collaborator|mentor/i;

export function extractOpponentRows(characterMatrixRaw: string, limit: number): string {
  return extractRowsByRelation(characterMatrixRaw, OPPONENT_PATTERNS, limit, "（暂无明确对手登场）");
}

export function extractCollaboratorRows(characterMatrixRaw: string, limit: number): string {
  return extractRowsByRelation(characterMatrixRaw, COLLABORATOR_PATTERNS, limit, "（暂无明确协作者登场）");
}

function extractRowsByRelation(
  characterMatrixRaw: string,
  pattern: RegExp,
  limit: number,
  emptyText: string,
): string {
  const rows = parseMarkdownTableRows(characterMatrixRaw)
    .filter((row) => row.some((cell) => pattern.test(cell)))
    .filter((row) => !row.some((cell) => /^(主角|protagonist)$/i.test(cell.trim())))
    .slice(0, limit);
  if (rows.length === 0) {
    return emptyText;
  }
  return rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
}

export function formatRelevantThreads(
  hooks: ReadonlyArray<StoredHook>,
  subplotBoardRaw: string,
  language: "zh" | "en" = "zh",
): string {
  const hookRows = hooks.map((hook) => `- ${hook.hookId}: ${[
    hook.type,
    hook.status,
    hook.expectedPayoff,
    hook.payoffTiming,
    hook.notes,
  ].filter(Boolean).join(" | ")}`);
  const subplotRows = extractActiveSubplotLines(subplotBoardRaw).map((line) => `- ${line}`);
  const lines = [...hookRows, ...subplotRows];
  if (lines.length === 0) {
    return language === "en" ? "(no relevant threads)" : "（暂无相关线索）";
  }
  return lines.join("\n");
}

/**
 * Phase 9-2: render stale hooks that the planner MUST dispose of in this
 * chapter's memo ("## 本章 hook 账"). These are already filtered by
 * computeRecyclableHooks; here we just format them for the prompt.
 *
 * Language switch mirrors the rest of the planner prompt: zh by default,
 * en for English books.
 */
export function formatRecyclableHooks(
  hooks: ReadonlyArray<StoredHook>,
  chapterNumber: number,
  language: "zh" | "en" = "zh",
): string {
  if (hooks.length === 0) {
    return language === "en"
      ? "(no stale hooks — the ledger is clean)"
      : "（暂无陈旧 hook——账本干净）";
  }

  const topSlice = hooks.slice(0, 6);
  const lines = topSlice.map((hook) => {
    const lastTouch = Math.max(hook.startChapter, hook.lastAdvancedChapter);
    const silence = lastTouch <= 0 ? chapterNumber : Math.max(0, chapterNumber - lastTouch);
    const payoff = hook.expectedPayoff?.trim() || hook.notes?.trim() || "";
    const core = hook.coreHook === true ? (language === "en" ? " [core]" : " [核心]") : "";
    return language === "en"
      ? `- ${hook.hookId} "${payoff}" — status=${hook.status}, silent ${silence} ch${core}`
      : `- ${hook.hookId} "${payoff}" — 状态=${hook.status}，已沉默 ${silence} 章${core}`;
  });

  const header = language === "en"
    ? "The planner MUST place each of these under advance / resolve / defer in the hook ledger (deferring requires an explicit reason):"
    : "规划时必须把以下每个 hook 放入 advance / resolve / defer（若 defer，必须写出理由）：";
  return [header, ...lines].join("\n");
}
