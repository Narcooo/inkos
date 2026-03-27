export type LengthLanguage = "zh" | "en";
export type LengthCountingMode = "zh_chars" | "en_words";

interface FormatLengthOptions {
  readonly context?: "draft";
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

  return normalized.replace(/\s+/g, "").length;
}

export function resolveLengthCountingMode(
  language: LengthLanguage = "zh",
): LengthCountingMode {
  return language === "en" ? "en_words" : "zh_chars";
}

export function formatLengthMetric(
  count: number,
  language: LengthLanguage = "zh",
  options: FormatLengthOptions = {},
): string {
  return formatLengthMetricForMode(count, resolveLengthCountingMode(language), options);
}

export function formatLengthMetricForMode(
  count: number,
  countingMode: LengthCountingMode,
  options: FormatLengthOptions = {},
): string {
  const unit = getLengthMetricUnit(count, countingMode);
  const formattedCount = count.toLocaleString();

  if (options.context === "draft") {
    return `${formattedCount} ${unit} in this draft`;
  }

  return `${formattedCount} ${unit}`;
}

export function getLengthMetricUnit(
  count: number,
  countingMode: LengthCountingMode,
): string {
  return countingMode === "en_words" ? (count === 1 ? "word" : "words") : (count === 1 ? "character" : "characters");
}

export function getLengthMetricUnitForLanguage(
  count: number,
  language: LengthLanguage = "zh",
): string {
  return getLengthMetricUnit(count, resolveLengthCountingMode(language));
}

export function getLengthMetricLabel(language: LengthLanguage = "zh"): string {
  return resolveLengthCountingMode(language) === "en_words" ? "Words" : "Characters";
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
