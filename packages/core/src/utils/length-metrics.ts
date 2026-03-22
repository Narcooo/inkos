import type { LengthCountingMode, LengthNormalizeMode, LengthSpec } from "../models/length-governance.js";

export type LengthLanguage = "zh" | "en";

const SOFT_RANGE_DELTA = 300;
const HARD_RANGE_DELTA = 600;

export function countChapterLength(
  content: string,
  countingMode: LengthCountingMode,
): number {
  const normalized = content.replace(/\r\n/g, "\n");

  if (countingMode === "en_words") {
    const words = normalized.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g);
    return words?.length ?? 0;
  }

  return normalized.replace(/\s+/g, "").length;
}

export function buildLengthSpec(
  target: number,
  language: LengthLanguage = "zh",
): LengthSpec {
  const softMin = Math.max(1, target - SOFT_RANGE_DELTA);
  const softMax = target + SOFT_RANGE_DELTA;
  const hardMin = Math.max(1, target - HARD_RANGE_DELTA);
  const hardMax = target + HARD_RANGE_DELTA;

  return {
    target,
    softMin,
    softMax,
    hardMin,
    hardMax,
    countingMode: language === "en" ? "en_words" : "zh_chars",
    normalizeMode: "none",
  };
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
