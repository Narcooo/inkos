export interface ChapterLengthTarget {
  readonly target: number;
  readonly min: number;
  readonly max: number;
  readonly tolerance: number;
}

const LENGTH_TOLERANCE_STEP = 50;
const MIN_LENGTH_TOLERANCE = 200;

export function getChapterLengthTarget(target: number): ChapterLengthTarget {
  const roundedTolerance = Math.round((target * 0.1) / LENGTH_TOLERANCE_STEP) * LENGTH_TOLERANCE_STEP;
  const tolerance = Math.max(MIN_LENGTH_TOLERANCE, roundedTolerance);

  return {
    target,
    min: Math.max(1, target - tolerance),
    max: target + tolerance,
    tolerance,
  };
}

export function formatChapterLengthTarget(
  target: ChapterLengthTarget,
  language: "zh" | "en",
): string {
  if (language === "en") {
    return `target ${target.target} words, acceptable range ${target.min}-${target.max} words`;
  }

  return `目标${target.target}字，允许区间${target.min}-${target.max}字`;
}
