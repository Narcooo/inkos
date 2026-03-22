import type { GenreProfile } from "../models/genre-profile.js";
import type { LengthCountingMode } from "../models/length-governance.js";
import type { WriteChapterOutput } from "./writer.js";
import { countChapterLength } from "../utils/length-metrics.js";

export interface CreativeOutput {
  readonly title: string;
  readonly content: string;
  readonly wordCount: number;
  readonly preWriteCheck: string;
}

export function parseCreativeOutput(
  chapterNumber: number,
  content: string,
  countingMode: LengthCountingMode = "zh_chars",
): CreativeOutput {
  const extract = (tag: string): string => {
    const regex = new RegExp(
      `=== ${tag} ===\\s*([\\s\\S]*?)(?==== [A-Z_]+ ===|$)`,
    );
    const match = content.match(regex);
    return match?.[1]?.trim() ?? "";
  };

  let chapterContent = extract("CHAPTER_CONTENT");

  // Fallback: if === TAG === parsing fails (common with local/small models),
  // try to extract usable content from the raw output
  if (!chapterContent) {
    chapterContent = fallbackExtractContent(content);
  }

  let title = extract("CHAPTER_TITLE");
  if (!title) {
    title = fallbackExtractTitle(content, chapterNumber);
  }

  return {
    title,
    content: chapterContent,
    wordCount: countChapterLength(chapterContent, countingMode),
    preWriteCheck: extract("PRE_WRITE_CHECK"),
  };
}

/**
 * Fallback content extraction when === CHAPTER_CONTENT === tag is missing.
 * Tries common patterns from local/small models, then falls back to
 * stripping metadata and returning the longest prose block.
 */
function fallbackExtractContent(raw: string): string {
  // Try markdown heading: # 第N章 ... followed by content
  const headingMatch = raw.match(/^#\s*第\d+章[^\n]*\n+([\s\S]+)/m);
  if (headingMatch) {
    return headingMatch[1]!.trim();
  }

  // Try "正文" or "内容" labeled section
  const labelMatch = raw.match(/(?:正文|内容|章节内容)[：:]\s*\n+([\s\S]+)/);
  if (labelMatch) {
    return labelMatch[1]!.trim();
  }

  // Last resort: strip lines that look like metadata/tags, keep the rest
  const lines = raw.split("\n");
  const proseLines = lines.filter((line) => {
    const trimmed = line.trim();
    // Skip tag-like lines, empty lines at boundaries, and short key-value lines
    if (/^===\s*[A-Z_]+\s*===/.test(trimmed)) return false;
    if (/^(PRE_WRITE_CHECK|CHAPTER_TITLE|章节标题|写作自检)[：:]/.test(trimmed)) return false;
    return true;
  });
  const result = proseLines.join("\n").trim();
  // Only use fallback if we got meaningful content (>100 chars)
  return result.length > 100 ? result : "";
}

/**
 * Fallback title extraction when === CHAPTER_TITLE === tag is missing.
 */
function fallbackExtractTitle(raw: string, chapterNumber: number): string {
  // Try: # 第N章 Title
  const headingMatch = raw.match(/^#\s*第\d+章\s*(.+)/m);
  if (headingMatch) {
    return headingMatch[1]!.trim();
  }
  // Try: 章节标题：Title or CHAPTER_TITLE: Title (without === delimiters)
  const labelMatch = raw.match(/(?:章节标题|CHAPTER_TITLE)[：:]\s*(.+)/);
  if (labelMatch) {
    return labelMatch[1]!.trim();
  }
  return `第${chapterNumber}章`;
}

export type ParsedWriterOutput = Omit<WriteChapterOutput, "postWriteErrors" | "postWriteWarnings">;

/**
 * Parse LLM output that uses === TAG === delimiters into structured chapter data.
 * Shared by WriterAgent (writing new chapters) and ChapterAnalyzerAgent (analyzing existing chapters).
 */
export function parseWriterOutput(
  chapterNumber: number,
  content: string,
  genreProfile: GenreProfile,
  countingMode: LengthCountingMode = "zh_chars",
): ParsedWriterOutput {
  const extract = (tag: string): string => {
    const regex = new RegExp(
      `=== ${tag} ===\\s*([\\s\\S]*?)(?==== [A-Z_]+ ===|$)`,
    );
    const match = content.match(regex);
    return match?.[1]?.trim() ?? "";
  };

  const chapterContent = extract("CHAPTER_CONTENT");

  return {
    chapterNumber,
    title: extract("CHAPTER_TITLE") || `第${chapterNumber}章`,
    content: chapterContent,
    wordCount: countChapterLength(chapterContent, countingMode),
    preWriteCheck: extract("PRE_WRITE_CHECK"),
    postSettlement: extract("POST_SETTLEMENT"),
    updatedState: extract("UPDATED_STATE") || "(状态卡未更新)",
    updatedLedger: genreProfile.numericalSystem
      ? (extract("UPDATED_LEDGER") || "(账本未更新)")
      : "",
    updatedHooks: extract("UPDATED_HOOKS") || "(伏笔池未更新)",
    chapterSummary: extract("CHAPTER_SUMMARY"),
    updatedSubplots: extract("UPDATED_SUBPLOTS"),
    updatedEmotionalArcs: extract("UPDATED_EMOTIONAL_ARCS"),
    updatedCharacterMatrix: extract("UPDATED_CHARACTER_MATRIX"),
  };
}
