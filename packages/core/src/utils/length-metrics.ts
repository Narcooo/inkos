import type { LengthCountingMode, LengthSpec } from "../models/length-governance.js";

import type { WritingLanguage } from "../models/book.js";

export type LengthLanguage = WritingLanguage;

// Per-chapter length default in the book's native unit: Chinese counts characters (3000字),
// English counts words (~2000 ≈ a 3000-char chapter). One cross-language number would mis-scale —
// 3000 read as English words runs ~50% long, and the hard-range guard then force-expands correct chapters.
export const DEFAULT_CHAPTER_LENGTH_ZH = 3000;
export const DEFAULT_CHAPTER_LENGTH_EN = 2000;
export const DEFAULT_CHAPTER_LENGTH_RU = 2000;

export function defaultChapterLength(language: LengthLanguage = "zh"): number {
  if (language === "ru") return DEFAULT_CHAPTER_LENGTH_RU;
  return language === "en" ? DEFAULT_CHAPTER_LENGTH_EN : DEFAULT_CHAPTER_LENGTH_ZH;
}

export function countChapterLength(
  content: string,
  countingMode: LengthCountingMode,
): number {
  const normalized = stripMarkdownMetadata(content);

  if (countingMode === "en_words") {
    const words = normalized.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g);
    return words?.length ?? 0;
  }

  if (countingMode === "ru_words") {
    // Count hyphenated compounds as one word and keep em dashes as boundaries.
    const words = normalized.normalize("NFC").match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:['’\-\u2010\u2011][\p{L}\p{N}][\p{L}\p{N}\p{M}]*)*/gu);
    return words?.length ?? 0;
  }

  return normalized.replace(/\s+/g, "").length;
}

export function resolveLengthCountingMode(
  language: LengthLanguage = "zh",
): LengthCountingMode {
  if (language === "ru") return "ru_words";
  return language === "en" ? "en_words" : "zh_chars";
}

export function lengthCountingUnit(countingMode: LengthCountingMode): string {
  if (countingMode === "ru_words") return "слов";
  return countingMode === "en_words" ? "words" : "字";
}

export function formatLengthCount(
  count: number,
  countingMode: LengthCountingMode,
): string {
  if (countingMode === "ru_words") {
    const form = new Intl.PluralRules("ru").select(count);
    return `${count} ${form === "one" ? "слово" : form === "few" ? "слова" : "слов"}`;
  }
  return countingMode === "zh_chars" ? `${count}字` : `${count} ${lengthCountingUnit(countingMode)}`;
}

export function buildLengthSpec(
  target: number,
  language: LengthLanguage = "zh",
  bounds: { readonly minChapterLength?: number; readonly maxChapterLength?: number } = {},
): LengthSpec {
  return {
    target,
    countingMode: resolveLengthCountingMode(language),
    ...(bounds.minChapterLength!==undefined?{minChapterLength:bounds.minChapterLength}:{}),
    ...(bounds.maxChapterLength!==undefined?{maxChapterLength:bounds.maxChapterLength}:{}),
  };
}

/** Explicit author bounds are hard checks; an approximate target alone is not. */
export function chapterLengthDelivery(count: number, spec: LengthSpec) {
  if(spec.minChapterLength===undefined&&spec.maxChapterLength===undefined)return undefined;
  const issues: Array<{code:string;actual:number;minimum?:number;maximum?:number}>=[];
  if((spec.minChapterLength!==undefined&&count<spec.minChapterLength)
    ||(spec.maxChapterLength!==undefined&&count>spec.maxChapterLength))issues.push({
      code:"CHAPTER_LENGTH_OUT_OF_RANGE",actual:count,minimum:spec.minChapterLength,maximum:spec.maxChapterLength,
    });
  return {status:issues.length?"needs_revision" as const:"checks_passed" as const,
    measurements:{count,countingMode:spec.countingMode},target:spec,issues};
}

export function assertChapterLength(content: string, spec?: LengthSpec): void {
  if(!spec)return;
  const delivery=chapterLengthDelivery(countChapterLength(content,spec.countingMode),spec);
  if(delivery?.issues.length)throw Object.assign(new Error(JSON.stringify({
    code:"CHAPTER_LENGTH_OUT_OF_RANGE",...delivery,
    instruction:"Revise the complete chapter into the explicit length range, preserving core events and causal continuity.",
  })),{code:"CHAPTER_LENGTH_OUT_OF_RANGE",delivery});
}

function stripMarkdownMetadata(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "").split("\n");
  const proseLines: string[] = [];
  let index = 0;

  if (lines[index]?.trim() === "---") {
    index += 1;
    while (index < lines.length && lines[index]?.trim() !== "---") {
      index += 1;
    }
    if (index < lines.length) {
      index += 1;
    }
  }

  let inFence = false;
  for (; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    if (/^#{1,6}\s+/.test(trimmed)) {
      continue;
    }
    if (trimmed === "---" || trimmed === "...") {
      continue;
    }

    proseLines.push(line);
  }

  return proseLines.join("\n");
}
