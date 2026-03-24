import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

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

interface SummaryRow {
  readonly chapter: number;
  readonly title: string;
  readonly mood: string;
  readonly chapterType: string;
}

const SENTENCE_SIMILARITY_THRESHOLD = 0.72;
const CHINESE_PUNCTUATION = /[，。！？；：“”‘’（）《》、\s\-—…·]/g;
const ENGLISH_PUNCTUATION = /[^a-z0-9]+/gi;

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
    .slice(-3);

  const chapterTypeIssue = buildChapterTypeIssue(recentRows, language);
  if (chapterTypeIssue) {
    issues.push(chapterTypeIssue);
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
  rows: ReadonlyArray<SummaryRow>,
  language: "zh" | "en",
): LongSpanFatigueIssue | null {
  if (rows.length < 3) return null;

  const types = rows
    .map((row) => row.chapterType.trim())
    .filter((value) => isMeaningfulValue(value));
  if (types.length < 3) return null;

  const normalized = types.map((value) => value.toLowerCase());
  if (!normalized.every((value) => value === normalized[0])) {
    return null;
  }

  if (language === "en") {
    return {
      severity: "warning",
      category: "Pacing Monotony",
      description: `The last 3 chapter types are identical: ${types.join(" -> ")}, which suggests macro pacing monotony.`,
      suggestion: "Switch the next chapter's function instead of extending the same beat again. Rotate setup, payoff, reversal, and fallout more deliberately.",
    };
  }

  return {
    severity: "warning",
    category: "节奏单调",
    description: `最近3章章节类型完全一致：${types.join(" -> ")}，长篇节奏可能开始固化。`,
    suggestion: "下一章应切换章节功能，不要连续重复同一种布局/推进节拍。",
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
      .slice(-2);

    if (previousFiles.length < 2) {
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
  if (chapterBodies.length < 3) return null;

  const sentences = chapterBodies.map((body) => extractBoundarySentence(body, boundary));
  if (sentences.some((sentence) => sentence === null)) {
    return null;
  }

  const normalized = sentences
    .map((sentence) => normalizeSentence(sentence!, language));
  if (normalized.some((sentence) => sentence.length < 18)) {
    return null;
  }

  const similarities = [
    diceCoefficient(normalized[0]!, normalized[1]!),
    diceCoefficient(normalized[1]!, normalized[2]!),
  ];
  if (Math.min(...similarities) < SENTENCE_SIMILARITY_THRESHOLD) {
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
