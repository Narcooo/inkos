import type { AuditResult } from "../agents/continuity.js";
import type { WriteChapterOutput } from "../agents/writer.js";
import type { ContextPackage } from "../models/input-governance.js";
import type { LengthSpec } from "../models/length-governance.js";
import { countChapterLength } from "../utils/length-metrics.js";

export interface ChapterReviewUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface ChapterReviewControlInput {
  readonly contextPackage: ContextPackage;
}

export interface ChapterReviewResult {
  readonly content: string;
  readonly wordCount: number;
  readonly review: AuditResult;
  readonly totalUsage: ChapterReviewUsage;
}

export async function reviewChapterDraft(params: {
  readonly book: Pick<{ genre: string }, "genre">;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly output: Pick<WriteChapterOutput, "content">;
  readonly controlInput: ChapterReviewControlInput;
  readonly lengthSpec: LengthSpec;
  readonly initialUsage: ChapterReviewUsage;
  readonly auditor: {
    auditChapter: (
      bookDir: string,
      chapterContent: string,
      chapterNumber: number,
      genre: string | undefined,
      options: {
        readonly language: "zh" | "en";
        readonly contextPackage: ContextPackage;
        readonly temperature?: number;
      },
    ) => Promise<AuditResult>;
  };
  readonly assertNotEmpty: (content: string) => void;
  readonly addUsage: (left: ChapterReviewUsage, right?: ChapterReviewUsage) => ChapterReviewUsage;
}): Promise<ChapterReviewResult> {
  const content = params.output.content;
  params.assertNotEmpty(content);
  const wordCount = countChapterLength(content, params.lengthSpec.countingMode);
  let modelReview: AuditResult;
  try {
    modelReview = await params.auditor.auditChapter(
      params.bookDir,
      content,
      params.chapterNumber,
      params.book.genre,
      {
        language: params.lengthSpec.countingMode === "en_words" ? "en" : "zh",
        contextPackage: params.controlInput.contextPackage,

      },
    );
  } catch (error) {
    const isEnglish = params.lengthSpec.countingMode === "en_words";
    modelReview = {
      unavailable: true,
      observations: [{
        code: "review-unavailable",
        summary: isEnglish
          ? `Review observation was unavailable: ${String(error)}`
          : `审稿观察暂不可用：${String(error)}`,
        evidence: [],
      }],
      summary: isEnglish ? "Review unavailable" : "审稿暂不可用",
    };
  }
  return {
    content,
    wordCount,
    review: modelReview,
    totalUsage: params.addUsage(params.initialUsage, modelReview.tokenUsage),
  };
}
