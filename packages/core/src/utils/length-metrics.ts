import type { LengthCountingMode, LengthNormalizeMode, LengthSpec } from "../models/length-governance.js";

export type LengthLanguage = "zh" | "en";

const REFERENCE_TARGET = 2200;
const SOFT_RANGE_DELTA = 300;
const HARD_RANGE_DELTA = 600;

export function countChapterLength(
  content: string,
  countingMode: LengthCountingMode,
): number {
  const normalized = stripMarkdownMetadata(content);

  if (countingMode === "en_words") {
    const words = normalized.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g);
    return words?.length ?? 0;
  }

  return normalized.replace(/\s+/g, "").length;
}

export function resolveLengthCountingMode(
  language: LengthLanguage = "zh",
): LengthCountingMode {
  return language === "en" ? "en_words" : "zh_chars";
}

export function formatLengthCount(
  count: number,
  countingMode: LengthCountingMode,
): string {
  return countingMode === "en_words" ? `${count} words` : `${count}字`;
}

export function buildLengthSpec(
  target: number,
  language: LengthLanguage = "zh",
): LengthSpec {
  const softDelta = scaleRangeDelta(target, SOFT_RANGE_DELTA);
  const hardDelta = Math.max(softDelta, scaleRangeDelta(target, HARD_RANGE_DELTA));
  const softMin = Math.max(1, target - softDelta);
  const softMax = target + softDelta;
  const hardMin = Math.max(1, target - hardDelta);
  const hardMax = target + hardDelta;

  return {
    target,
    softMin,
    softMax,
    hardMin,
    hardMax,
    countingMode: resolveLengthCountingMode(language),
    normalizeMode: "none",
  };
}

function scaleRangeDelta(target: number, referenceDelta: number): number {
  return Math.max(1, Math.floor((target * referenceDelta) / REFERENCE_TARGET));
}

export function isOutsideSoftRange(
  count: number,
  spec: Pick<LengthSpec, "softMin" | "softMax">,
): boolean {
  return count < spec.softMin || count > spec.softMax;
}

export function isOutsideHardRange(
  count: number,
  spec: Pick<LengthSpec, "hardMin" | "hardMax">,
): boolean {
  return count < spec.hardMin || count > spec.hardMax;
}

export function chooseNormalizeMode(
  count: number,
  spec: Pick<LengthSpec, "softMin" | "softMax">,
): LengthNormalizeMode {
  if (count < spec.softMin) return "expand";
  if (count > spec.softMax) return "compress";
  return "none";
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
