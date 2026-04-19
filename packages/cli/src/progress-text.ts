import {
  formatImportChaptersComplete,
  formatImportChaptersDiscovery,
  formatImportChaptersResume,
  formatWriteNextComplete,
  formatWriteNextProgress,
  formatWriteNextResultLines,
  type CliLanguage,
} from "./localization.js";

export { type CliLanguage };

export function formatWriteStartLine(
  language: CliLanguage,
  current: number,
  total: number,
  bookId: string,
): string {
  return formatWriteNextProgress(language, current, total, bookId);
}

export function formatWriteCompletionLines(
  language: CliLanguage,
  result: {
    readonly chapterNumber: number;
    readonly title: string;
    readonly wordCount: number;
    readonly passedAudit: boolean;
    readonly revised: boolean;
    readonly status: string;
    readonly issues: ReadonlyArray<{
      readonly severity: string;
      readonly category: string;
      readonly description: string;
    }>;
  },
): string[] {
  return [...formatWriteNextResultLines(language, result), ""];
}

export function formatWriteDoneLine(language: CliLanguage): string {
  return formatWriteNextComplete(language);
}

export function formatImportDiscoveryLine(
  language: CliLanguage,
  chapterCount: number,
  bookId: string,
): string {
  return formatImportChaptersDiscovery(language, chapterCount, bookId);
}

export function formatImportResumeLine(
  language: CliLanguage,
  resumeFrom: number,
): string {
  return formatImportChaptersResume(language, resumeFrom);
}

export function formatImportCompletionLines(
  language: CliLanguage,
  result: {
    readonly importedCount: number;
    readonly totalCountLabel: string;
    readonly nextChapter: number;
    readonly bookId: string;
  },
): string[] {
  return [
    language === "en" ? "Import complete:" : "导入完成：",
    language === "en"
      ? `  Chapters imported: ${result.importedCount}`
      : `  已导入章节：${result.importedCount}`,
    language === "en"
      ? `  Total length: ${result.totalCountLabel}`
      : `  总长度：${result.totalCountLabel}`,
    language === "en"
      ? `  Next chapter number: ${result.nextChapter}`
      : `  下一章编号：${result.nextChapter}`,
    "",
    language === "en"
      ? `Run "inkos write next ${result.bookId}" to continue writing.`
      : `运行 "inkos write next ${result.bookId}" 继续写作。`,
  ];
}
