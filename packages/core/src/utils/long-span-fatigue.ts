import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { analyzeChapterCadence } from "./chapter-cadence.js";
import {
  CADENCE_WINDOW_DEFAULTS,
  LONG_SPAN_FATIGUE_THRESHOLDS,
} from "./cadence-policy.js";

export interface LongSpanFatigueIssue {
  readonly severity: "warning";
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
}

export interface AnalyzeLongSpanFatigueInput {
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly chapterContent: string;
  readonly chapterSummary?: string;
  readonly language?: "zh" | "en";
}

export interface EnglishVarianceBrief {
  readonly highFrequencyPhrases: ReadonlyArray<string>;
  readonly repeatedOpeningPatterns: ReadonlyArray<string>;
  readonly repeatedEndingShapes: ReadonlyArray<string>;
  readonly sceneObligation: string;
  readonly text: string;
}

interface SummaryRow {
  readonly chapter: number;
  readonly title: string;
  readonly mood: string;
  readonly chapterType: string;
}

const CHINESE_PUNCTUATION = /[，。！？；：“”‘’（）《》、\s\-—…·]/g;
const ENGLISH_PUNCTUATION = /[^a-z0-9]+/gi;

export async function buildEnglishVarianceBrief(params: {
  readonly bookDir: string;
  readonly chapterNumber: number;
}): Promise<EnglishVarianceBrief | null> {
  const chapterBodies = await loadPreviousChapterBodies(
    params.bookDir,
    params.chapterNumber,
    CADENCE_WINDOW_DEFAULTS.englishVarianceLookback,
  );
  if (chapterBodies.length < 2) {
    return null;
  }

  const summaryRows = await loadSummaryRows(join(params.bookDir, "story", "chapter_summaries.md"));
  const recentRows = summaryRows
    .filter((row) => row.chapter < params.chapterNumber)
    .sort((left, right) => left.chapter - right.chapter)
    .slice(-CADENCE_WINDOW_DEFAULTS.summaryLookback);

  const highFrequencyPhrases = collectRepeatedEnglishPhrases(chapterBodies);
  const repeatedOpeningPatterns = collectRepeatedBoundaryPatterns(chapterBodies, "opening");
  const repeatedEndingShapes = collectRepeatedBoundaryPatterns(chapterBodies, "ending");
  const cadence = analyzeChapterCadence({
    rows: recentRows,
    language: "en",
  });
  const sceneObligation = chooseSceneObligation(cadence, repeatedOpeningPatterns, repeatedEndingShapes);

  const lines = [
    "## English Variance Brief",
    "",
    `- High-frequency phrases to avoid: ${formatEnglishList(highFrequencyPhrases)}`,
    `- Repeated opening patterns to avoid: ${formatEnglishList(repeatedOpeningPatterns)}`,
    `- Repeated ending patterns to avoid: ${formatEnglishList(repeatedEndingShapes)}`,
    `- Scene obligation: ${sceneObligation}`,
  ];

  return {
    highFrequencyPhrases,
    repeatedOpeningPatterns,
    repeatedEndingShapes,
    sceneObligation,
    text: lines.join("\n"),
  };
}

export async function analyzeLongSpanFatigue(
  input: AnalyzeLongSpanFatigueInput,
): Promise<{ readonly issues: ReadonlyArray<LongSpanFatigueIssue> }> {
  const language = input.language ?? "zh";
  const issues: LongSpanFatigueIssue[] = [];

  const summaryRows = await loadSummaryRows(join(input.bookDir, "story", "chapter_summaries.md"));
  const mergedRows = mergeCurrentSummary(summaryRows, input.chapterSummary);
  const recentRows = mergedRows
    .filter((row) => row.chapter <= input.chapterNumber)
    .sort((left, right) => left.chapter - right.chapter)
    .slice(-CADENCE_WINDOW_DEFAULTS.summaryLookback);
  const cadence = analyzeChapterCadence({
    rows: recentRows,
    language,
  });

  const chapterTypeIssue = buildChapterTypeIssue(cadence, language);
  if (chapterTypeIssue) {
    issues.push(chapterTypeIssue);
  }

  const moodIssue = buildMoodIssue(cadence, language);
  if (moodIssue) {
    issues.push(moodIssue);
  }

  const titleIssue = buildTitleIssue(cadence, language);
  if (titleIssue) {
    issues.push(titleIssue);
  }

  const recentChapterBodies = await loadRecentChapterBodies(
    input.bookDir,
    input.chapterNumber,
    input.chapterContent,
  );

  const openingIssue = buildSentencePatternIssue(recentChapterBodies, "opening", language);
  if (openingIssue) {
    issues.push(openingIssue);
  }

  const endingIssue = buildSentencePatternIssue(recentChapterBodies, "ending", language);
  if (endingIssue) {
    issues.push(endingIssue);
  }

  return { issues };
}

async function loadSummaryRows(path: string): Promise<SummaryRow[]> {
  try {
    const raw = await readFile(path, "utf-8");
    return raw
      .split("\n")
      .map((line) => parseSummaryRow(line))
      .filter((row): row is SummaryRow => row !== null);
  } catch {
    return [];
  }
}

async function loadPreviousChapterBodies(
  bookDir: string,
  currentChapter: number,
  limit: number,
): Promise<string[]> {
  const chaptersDir = join(bookDir, "chapters");
  try {
    const files = await readdir(chaptersDir);
    const previousFiles = files
      .map((file) => ({ file, chapter: Number.parseInt(file.slice(0, 4), 10) }))
      .filter((entry) => Number.isFinite(entry.chapter) && entry.chapter < currentChapter && entry.file.endsWith(".md"))
      .sort((left, right) => left.chapter - right.chapter)
      .slice(-limit);

    return Promise.all(
      previousFiles.map((entry) => readFile(join(chaptersDir, entry.file), "utf-8")),
    );
  } catch {
    return [];
  }
}

function mergeCurrentSummary(rows: ReadonlyArray<SummaryRow>, currentSummary?: string): SummaryRow[] {
  const parsedCurrent = currentSummary ? parseSummaryRow(currentSummary) : null;
  if (!parsedCurrent) return [...rows];

  const nextRows = rows.filter((row) => row.chapter !== parsedCurrent.chapter);
  nextRows.push(parsedCurrent);
  return nextRows;
}

function parseSummaryRow(line: string): SummaryRow | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || trimmed.includes("章节 |") || trimmed.includes("Chapter |") || trimmed.includes("---")) {
    return null;
  }

  const cells = trimmed
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
  if (cells.length < 8) {
    return null;
  }

  const chapter = Number.parseInt(cells[0] ?? "", 10);
  if (!Number.isFinite(chapter) || chapter <= 0) {
    return null;
  }

  return {
    chapter,
    title: cells[1] ?? "",
    mood: cells[6] ?? "",
    chapterType: cells[7] ?? "",
  };
}

function buildChapterTypeIssue(
  cadence: ReturnType<typeof analyzeChapterCadence>,
  language: "zh" | "en",
): LongSpanFatigueIssue | null {
  if (cadence.scenePressure?.pressure !== "high") {
    return null;
  }
  const { repeatedType, streak } = cadence.scenePressure;

  if (language === "en") {
    return {
      severity: "warning",
      category: "Pacing Monotony",
      description: `The last ${streak} chapter types have stayed on ${repeatedType}, which suggests macro pacing monotony.`,
      suggestion: "Switch the next chapter's function instead of extending the same beat again. Rotate setup, payoff, reversal, and fallout more deliberately.",
    };
  }

  return {
    severity: "warning",
    category: "节奏单调",
    description: `最近${streak}章章节类型持续停留在“${repeatedType}”，长篇节奏可能开始固化。`,
    suggestion: "下一章应切换章节功能，不要连续重复同一种布局/推进节拍。",
  };
}

function buildMoodIssue(
  cadence: ReturnType<typeof analyzeChapterCadence>,
  language: "zh" | "en",
): LongSpanFatigueIssue | null {
  if (cadence.moodPressure?.pressure !== "high") {
    return null;
  }
  const { highTensionStreak, recentMoods } = cadence.moodPressure;

  if (language === "en") {
    return {
      severity: "warning",
      category: "Mood Monotony",
      description: `High-tension mood has locked in for ${highTensionStreak} chapters (${recentMoods.join(" -> ")}), with no visible emotional release.`,
      suggestion: "Insert a release beat, warmth, humor, intimacy, or reflective quiet before escalating again.",
    };
  }

  return {
    severity: "warning",
    category: "情绪单调",
    description: `最近${highTensionStreak}章持续高压（${recentMoods.join(" -> ")}），缺少明显的情绪释放。`,
    suggestion: "下一章安排一次喘息、温情、幽默或静场释放，再继续加压。",
  };
}

function buildTitleIssue(
  cadence: ReturnType<typeof analyzeChapterCadence>,
  language: "zh" | "en",
): LongSpanFatigueIssue | null {
  if (cadence.titlePressure?.pressure !== "high") {
    return null;
  }
  const { repeatedToken, count } = cadence.titlePressure;

  if (language === "en") {
    return {
      severity: "warning",
      category: "Title Collapse",
      description: `Recent titles keep collapsing around "${repeatedToken}" (${count} hits in the current window), which makes chapter naming feel formulaic.`,
      suggestion: "Change the next title anchor. Use a new image, action, consequence, or character vector instead of the same keyword shell.",
    };
  }

  return {
    severity: "warning",
    category: "标题重复",
    description: `最近标题持续围绕“${repeatedToken}”命名（当前窗口命中${count}次），命名开始坍缩。`,
    suggestion: "下一章标题换一个新的意象、动作、后果或人物焦点，不要继续套同一个关键词壳。",
  };
}

async function loadRecentChapterBodies(
  bookDir: string,
  currentChapter: number,
  currentContent: string,
): Promise<string[]> {
  const chaptersDir = join(bookDir, "chapters");
  try {
    const files = await readdir(chaptersDir);
    const previousFiles = files
      .map((file) => ({ file, chapter: Number.parseInt(file.slice(0, 4), 10) }))
      .filter((entry) => Number.isFinite(entry.chapter) && entry.chapter < currentChapter && entry.file.endsWith(".md"))
      .sort((left, right) => left.chapter - right.chapter)
      .slice(-CADENCE_WINDOW_DEFAULTS.recentBoundaryPatternBodies);

    if (previousFiles.length < CADENCE_WINDOW_DEFAULTS.recentBoundaryPatternBodies) {
      return [];
    }

    const previousBodies = await Promise.all(
      previousFiles.map((entry) => readFile(join(chaptersDir, entry.file), "utf-8")),
    );

    return [...previousBodies, currentContent];
  } catch {
    return [];
  }
}

function buildSentencePatternIssue(
  chapterBodies: ReadonlyArray<string>,
  boundary: "opening" | "ending",
  language: "zh" | "en",
): LongSpanFatigueIssue | null {
  if (chapterBodies.length < LONG_SPAN_FATIGUE_THRESHOLDS.boundaryPatternMinBodies) return null;

  const sentences = chapterBodies.map((body) => extractBoundarySentence(body, boundary));
  if (sentences.some((sentence) => sentence === null)) {
    return null;
  }

  const normalized = sentences
    .map((sentence) => normalizeSentence(sentence!, language));
  if (normalized.some((sentence) => sentence.length < LONG_SPAN_FATIGUE_THRESHOLDS.boundarySentenceMinLength)) {
    return null;
  }

  const similarities = [
    diceCoefficient(normalized[0]!, normalized[1]!),
    diceCoefficient(normalized[1]!, normalized[2]!),
  ];
  if (Math.min(...similarities) < LONG_SPAN_FATIGUE_THRESHOLDS.boundarySimilarityFloor) {
    return null;
  }

  const sample = summarizeSentence(sentences[2]!, language);
  const pairText = similarities.map((value) => value.toFixed(2)).join("/");

  if (language === "en") {
    const category = boundary === "opening" ? "Opening Pattern Repetition" : "Ending Pattern Repetition";
    const position = boundary === "opening" ? "openings" : "endings";
    return {
      severity: "warning",
      category,
      description: `The last 3 chapter ${position} are highly similar (adjacent similarity ${pairText}), which risks a formulaic rhythm. Current ${boundary} signature: "${sample}".`,
      suggestion: boundary === "opening"
        ? "Change the next chapter opening vector. Start from action, consequence, or surprise instead of repeating the same camera move."
        : "Change the next chapter landing pattern. End on consequence, decision, or a new variable instead of repeating the same explanatory cadence.",
    };
  }

  return {
    severity: "warning",
    category: boundary === "opening" ? "开头同构" : "结尾同构",
    description: `最近3章${boundary === "opening" ? "开头" : "结尾"}句式高度相似（相邻相似度${pairText}），容易形成模板化${boundary === "opening" ? "开篇" : "章尾"}。当前句式近似“${sample}”。`,
    suggestion: boundary === "opening"
      ? "下一章换一个开篇入口，用动作、后果或异常信息切入，不要连续沿用同一种抬镜句。"
      : "下一章换一个收束方式，用行动后果、角色决断或新变量落板，不要连续用解释性句子收尾。",
  };
}

function collectRepeatedEnglishPhrases(chapterBodies: ReadonlyArray<string>): string[] {
  const counts = new Map<string, number>();

  for (const body of chapterBodies) {
    const tokens = body
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/gi, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3)
      .filter((token) => !ENGLISH_STOP_WORDS.has(token));
    const seen = new Set<string>();

    for (let index = 0; index <= tokens.length - 3; index += 1) {
      const phrase = `${tokens[index]} ${tokens[index + 1]} ${tokens[index + 2]}`;
      seen.add(phrase);
    }

    for (const phrase of seen) {
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([phrase]) => phrase);
}

function collectRepeatedBoundaryPatterns(
  chapterBodies: ReadonlyArray<string>,
  boundary: "opening" | "ending",
): string[] {
  const counts = new Map<string, number>();

  for (const body of chapterBodies) {
    const sentence = extractBoundarySentence(body, boundary);
    if (!sentence) continue;

    const tokens = sentence
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/gi, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4);
    if (tokens.length < 2) continue;

    const pattern = tokens.join(" ");
    counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([pattern]) => pattern);
}

function chooseSceneObligation(
  cadence: ReturnType<typeof analyzeChapterCadence>,
  repeatedOpenings: ReadonlyArray<string>,
  repeatedEndings: ReadonlyArray<string>,
): string {
  if (cadence.scenePressure?.pressure === "high") {
    return "confrontation under pressure";
  }
  if (repeatedEndings.length > 0) {
    return "discovery under pressure";
  }
  if (repeatedOpenings.length > 0) {
    return "negotiation with withholding";
  }
  return "concealment with active pushback";
}

function extractBoundarySentence(content: string, boundary: "opening" | "ending"): string | null {
  const flattened = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .join(" ");

  const sentences = flattened
    .split(/(?<=[。！？!?\.])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

  if (sentences.length === 0) {
    return null;
  }

  return boundary === "opening" ? sentences[0]! : sentences[sentences.length - 1]!;
}

function normalizeSentence(sentence: string, language: "zh" | "en"): string {
  if (language === "en") {
    return sentence
      .toLowerCase()
      .replace(ENGLISH_PUNCTUATION, "")
      .trim();
  }

  return sentence
    .replace(CHINESE_PUNCTUATION, "")
    .toLowerCase();
}

function summarizeSentence(sentence: string, language: "zh" | "en"): string {
  if (language === "en") {
    const words = sentence
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/gi, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 6)
      .join(" ");
    return words.length > 0 ? words : sentence.slice(0, 32);
  }

  const collapsed = sentence.replace(CHINESE_PUNCTUATION, "");
  return collapsed.slice(0, 12);
}

function formatEnglishList(values: ReadonlyArray<string>): string {
  return values.length > 0 ? values.join(", ") : "none";
}

function diceCoefficient(left: string, right: string): number {
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;

  const leftBigrams = buildBigrams(left);
  const rightBigrams = buildBigrams(right);
  let overlap = 0;

  for (const [bigram, count] of leftBigrams) {
    overlap += Math.min(count, rightBigrams.get(bigram) ?? 0);
  }

  const leftCount = [...leftBigrams.values()].reduce((sum, value) => sum + value, 0);
  const rightCount = [...rightBigrams.values()].reduce((sum, value) => sum + value, 0);
  return (2 * overlap) / (leftCount + rightCount);
}

function buildBigrams(value: string): Map<string, number> {
  const result = new Map<string, number>();
  for (let index = 0; index < value.length - 1; index++) {
    const bigram = value.slice(index, index + 2);
    result.set(bigram, (result.get(bigram) ?? 0) + 1);
  }
  return result;
}

function isMeaningfulValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && normalized !== "none" && normalized !== "(none)" && normalized !== "无";
}

const ENGLISH_STOP_WORDS = new Set([
  "the",
  "and",
  "but",
  "with",
  "from",
  "into",
  "that",
  "this",
  "there",
  "again",
  "while",
  "after",
  "before",
  "were",
  "was",
  "had",
  "has",
  "have",
  "kept",
]);
