export interface SplitChapter {
  readonly title: string;
  readonly content: string;
}

/**
 * Split a single text file into chapters by matching title lines.
 *
 * Default pattern matches:
 * - "第一章 xxxx" / "第1章 xxxx"
 * - "第一回 xxxx" / "第1回 xxxx"
 * - "# 第1章 xxxx" / "## 第23章 xxxx"
 * - "CHAPTER I." / "CHAPTER II."
 *
 * Each match marks the start of a new chapter. Content between matches
 * belongs to the preceding chapter.
 */
export function splitChapters(
  text: string,
  pattern?: string,
): ReadonlyArray<SplitChapter> {
  const defaultPattern = /^#{0,2}\s*(?:第[零〇○Ｏ０一二三四五六七八九十百千万\d]+(?:章|回)(?:[:：]|\s+)?\s*(.*)|Chapter\s+(?:\d+|[IVXLCDM]+)(?:\.|:|\s+)?\s*(.*))/i;
  const regex = pattern ? new RegExp(pattern, "m") : defaultPattern;

  const lines = text.split("\n");
  const chapters: Array<{ title: string; startLine: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(regex);
    if (match) {
      chapters.push({
        title: (match[1] ?? match[2] ?? "").trim(),
        startLine: i,
      });
    }
  }

  if (chapters.length === 0) {
    return [];
  }

  const result: SplitChapter[] = [];

  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i]!;
    const nextStart = i + 1 < chapters.length ? chapters[i + 1]!.startLine : lines.length;

    // Content starts after the title line
    const contentLines = lines.slice(chapter.startLine + 1, nextStart);
    const content = stripTrailingLicense(contentLines.join("\n")).trim();

    result.push({
      title: chapter.title || inferFallbackTitle(lines[chapter.startLine] ?? "", i + 1),
      content,
    });
  }

  return result;
}

function stripTrailingLicense(content: string): string {
  const trailerMatch = content.match(/^\s*Project Gutenberg(?:™|\(TM\))?.*$/im);
  if (!trailerMatch || trailerMatch.index === undefined) {
    return content;
  }

  return content.slice(0, trailerMatch.index).trimEnd();
}

function inferFallbackTitle(headingLine: string, chapterNumber: number): string {
  if (/chapter\s+(?:\d+|[ivxlcdm]+)/i.test(headingLine)) {
    return `Chapter ${chapterNumber}`;
  }

  if (/第[零一二三四五六七八九十百千万\d]+回/.test(headingLine)) {
    return `第${chapterNumber}回`;
  }

  return `第${chapterNumber}章`;
}
