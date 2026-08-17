import { ChapterMemoSchema, type ChapterMemo } from "../models/input-governance.js";

export class PlannerParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlannerParseError";
  }
}

// Phase hotfix 4: each required section is a (zh, en) heading pair.
// The English headings come from PLANNER_MEMO_SYSTEM_PROMPT_EN — we accept
// EITHER language at parse time so the same parser works for both.
//
// Phase hotfix 7: minContentChars enforces non-emptiness per section so
// "all required headings + blank payload" no longer slips through. The "do not"
// section uses a relaxed threshold because "无 / N/A / none." is legitimate
// for chapters with no extra prohibitions.
//
// Threshold rationale:
// - 20 chars: long enough to catch obvious empty sections (whitespace,
//   "(略)", "TODO") but short enough to accept genuinely sparse memos for
//   breath/transition chapters (Phase 6 sparse-memo principle).
// - 1 char for "## 不要做" / "## Do not" because "无" / "N/A" / "none" /
//   "—" are all legitimate for a chapter with no extra prohibitions; we
//   only need to ensure the section is not whitespace-only.
interface RequiredSection {
  readonly zh: string;
  readonly en: string;
  readonly minContentChars: number;
}

const REQUIRED_SECTIONS: ReadonlyArray<RequiredSection> = [
  { zh: "## 场景与篇幅预算", en: "## Scene and length budget", minContentChars: 20 },
  { zh: "## 当前任务", en: "## Current task", minContentChars: 20 },
  { zh: "## 读者此刻在等什么", en: "## What the reader is waiting for right now", minContentChars: 20 },
  { zh: "## 该兑现的 / 暂不掀的", en: "## To pay off / to keep buried", minContentChars: 20 },
  { zh: "## 日常/过渡承担什么任务", en: "## What the slow / transitional beats carry", minContentChars: 20 },
  { zh: "## 关键抉择过三连问", en: "## Three-question check on the key choice", minContentChars: 20 },
  { zh: "## 章尾必须发生的改变", en: "## Required end-of-chapter change", minContentChars: 20 },
  { zh: "## 本章 hook 账", en: "## Hook ledger for this chapter", minContentChars: 20 },
  { zh: "## 不要做", en: "## Do not", minContentChars: 1 },
];

const GOAL_HEADINGS = ["## 本章目标", "## Chapter goal"] as const;
const THREAD_HEADINGS = ["## 关联线索", "## Thread refs", "## Related threads"] as const;

/**
 * Extract the content between `heading` and the next `## ...` heading (or
 * end-of-body). Strips whitespace and returns "" if the section payload is
 * absent. The heading itself is NOT included.
 */
function extractSectionContent(body: string, heading: string): string {
  const startIndex = body.indexOf(heading);
  if (startIndex < 0) return "";
  const after = body.slice(startIndex + heading.length);
  // Find the next H2 heading on its own line. The leading newline + ## guards
  // against false matches inside the current section's prose.
  const nextHeadingMatch = after.match(/\n##\s/);
  const sectionRaw = nextHeadingMatch
    ? after.slice(0, nextHeadingMatch.index)
    : after;
  return sectionRaw.replace(/\s+/g, " ").trim();
}

function stripWrappingFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:md|markdown)?\s*\n([\s\S]*?)\n```\s*$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function dropLeadingProse(raw: string): string {
  const markers = [
    "# 第 ",
    "# Chapter ",
    ...GOAL_HEADINGS,
    ...THREAD_HEADINGS,
    ...REQUIRED_SECTIONS.flatMap((section) => [section.zh, section.en]),
  ];
  let first = -1;
  for (const marker of markers) {
    const index = raw.indexOf(marker);
    if (index >= 0 && (first < 0 || index < first)) {
      first = index;
    }
  }
  return first >= 0 ? raw.slice(first).trim() : raw.trim();
}

function extractAnyHeading(body: string, headings: ReadonlyArray<string>): string {
  for (const heading of headings) {
    const content = extractSectionContent(body, heading);
    if (content) return content;
  }
  return "";
}

function extractGoal(body: string): string {
  const explicitGoal = extractAnyHeading(body, GOAL_HEADINGS);
  if (explicitGoal) {
    return explicitGoal.split(/\n|。|\. /)[0]?.trim() ?? "";
  }
  return "";
}

function extractThreadRefs(body: string): string[] {
  const block = extractAnyHeading(body, THREAD_HEADINGS);
  if (!block || /^(无|none|n\/a|na|—|-|\(none\))$/i.test(block.trim())) {
    return [];
  }
  const matches = block.match(/\b[A-Za-z][A-Za-z0-9_-]*\d+[A-Za-z0-9_-]*\b/g) ?? [];
  return [...new Set(matches)];
}

function extractMemoBody(markdown: string): string {
  const starts = REQUIRED_SECTIONS
    .flatMap((section) => [section.zh, section.en])
    .map((heading) => markdown.indexOf(heading))
    .filter((index) => index >= 0);
  if (starts.length === 0) return markdown.trim();
  return markdown.slice(Math.min(...starts)).trim();
}

function makeDisplayGoal(goal: string): string {
  if (goal.length <= 50) return goal;
  return `${goal.slice(0, 47).trimEnd()}...`;
}

function prependFullGoalIfNeeded(markdown: string, body: string, fullGoal: string, displayGoal: string): string {
  if (fullGoal === displayGoal) return body;
  const heading = markdown.includes("## Chapter goal") ? "## Chapter goal" : "## 本章目标";
  return `${heading}\n${fullGoal}\n\n${body}`;
}

/**
 * Parse a planner memo produced by the LLM.
 *
 * Format: plain Markdown containing a `## 本章目标` / `## Chapter goal`
 * section, an optional thread-ref section, and the required memo section
 * headings.
 *
 * Strict on the LLM-owned memo sections. Caller-owned fields (chapter /
 * golden-opening) come from the host, not from the model. A long chapter goal
 * is kept in the memo body and reduced only to a short display label for the
 * schema field, so parser robustness does not silently delete planning intent.
 *
 * The parser strips a wrapping Markdown code fence and any leading assistant
 * prose ("好的，下面是...") before the first memo heading. It does not accept
 * YAML frontmatter as a required model protocol anymore.
 */
export function parseMemo(
  raw: string,
  expectedChapter: number,
  isGoldenOpening: boolean,
): ChapterMemo {
  const markdown = dropLeadingProse(stripWrappingFence(raw));
  const goal = extractGoal(markdown);
  const body = extractMemoBody(markdown);
  const threadRefs = extractThreadRefs(markdown);

  if (goal.length === 0) {
    throw new PlannerParseError("goal must be a non-empty string");
  }
  const displayGoal = makeDisplayGoal(goal);

  const missing = REQUIRED_SECTIONS.filter(
    (section) => !body.includes(section.zh) && !body.includes(section.en),
  );
  if (missing.length > 0) {
    // Report by zh heading (canonical) so the LLM-feedback loop stays stable.
    throw new PlannerParseError(
      `missing sections: ${missing.map((s) => s.zh).join(", ")}`,
    );
  }

  // Phase hotfix 7: each section's payload must be non-empty (≥ minContentChars).
  // Headings present + blank payload was previously accepted, allowing useless
  // "shell" memos to flow downstream. Threshold differs per section: most need
  // 20 chars (one short sentence) while "## 不要做" / "## Do not" allows 1
  // (e.g. "无", "N/A") since "no extra prohibitions" is a legitimate state.
  const empty = REQUIRED_SECTIONS.filter((section) => {
    const heading = body.includes(section.zh) ? section.zh : section.en;
    const content = extractSectionContent(body, heading);
    return content.length < section.minContentChars;
  });
  if (empty.length > 0) {
    const detail = empty
      .map((s) => `${s.zh} (need ≥ ${s.minContentChars} chars)`)
      .join(", ");
    throw new PlannerParseError(`empty sections: ${detail}`);
  }

  return ChapterMemoSchema.parse({
    chapter: expectedChapter,
    goal: displayGoal,
    isGoldenOpening,
    body: prependFullGoalIfNeeded(markdown, body, goal, displayGoal),
    threadRefs,
  });
}
