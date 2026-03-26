// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookWorkspace } from "../components/workspace/BookWorkspace";
import type { BookDetail, ChapterDetail, ChapterSummary } from "../../shared/contracts";

function createChapterSummary(overrides: Partial<ChapterSummary> = {}): ChapterSummary {
  return {
    number: overrides.number ?? 1,
    title: overrides.title ?? "Chapter 1",
    status: overrides.status ?? "ready-for-review",
    wordCount: overrides.wordCount ?? 1200,
    auditIssueCount: overrides.auditIssueCount ?? 2,
    updatedAt: overrides.updatedAt ?? "2026-03-26T00:00:00.000Z",
    fileName: overrides.fileName ?? "0001_chapter.md",
  };
}

function createChapterDetail(summary: ChapterSummary): ChapterDetail {
  return {
    ...summary,
    auditIssues: ["Continuity drift", "POV slip"],
    reviewNote: "Hold tension in the bridge scene.",
    content: "# Chapter 1\n\nBody text",
  };
}

const selectedChapter = createChapterSummary();
const chapterDetail = createChapterDetail(selectedChapter);
const book: BookDetail = {
  id: "book-1",
  title: "Northbound",
  status: "draft",
  platform: "web",
  genre: "fantasy",
  targetChapters: 12,
  chapters: 1,
  chapterCount: 1,
  lastChapterNumber: 1,
  totalWords: 1200,
  approvedChapters: 0,
  pendingReview: 1,
  pendingReviewChapters: 1,
  failedReview: 0,
  failedChapters: 0,
  recentRunStatus: null,
  updatedAt: "2026-03-26T00:00:00.000Z",
  createdAt: "2026-03-01T00:00:00.000Z",
  chapterWordCount: 1200,
  language: "en",
};

afterEach(() => {
  cleanup();
});

describe("BookWorkspace", () => {
  it("renders a distinct chapter-reading view for the Chapters tab", () => {
    render(
      <BookWorkspace
        book={book}
        activeTab="chapters"
        chapters={[selectedChapter]}
        selectedChapterNumber={selectedChapter.number}
        selectedChapter={selectedChapter}
        chapterDetail={chapterDetail}
        truthFiles={[]}
        selectedTruthFile={null}
        truthFile={null}
        chapterSaving={false}
        reviewSubmitting={false}
        onSelectTab={vi.fn()}
        onSelectChapter={vi.fn()}
        onChapterDirtyChange={vi.fn()}
        onSaveChapter={vi.fn(async () => undefined)}
        onApproveReview={vi.fn(async () => undefined)}
        onRejectReview={vi.fn(async () => undefined)}
        onSelectTruthFile={vi.fn()}
      />,
    );

    expect(screen.getByText("Chapter editor")).toBeTruthy();
    expect(screen.getByText("Editable manuscript view with explicit save and local draft tracking.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save chapter" })).toBeTruthy();
  });

  it("renders audit issue details in the Review tab", () => {
    render(
      <BookWorkspace
        book={book}
        activeTab="review"
        chapters={[selectedChapter]}
        selectedChapterNumber={selectedChapter.number}
        selectedChapter={selectedChapter}
        chapterDetail={chapterDetail}
        truthFiles={[]}
        selectedTruthFile={null}
        truthFile={null}
        chapterSaving={false}
        reviewSubmitting={false}
        onSelectTab={vi.fn()}
        onSelectChapter={vi.fn()}
        onChapterDirtyChange={vi.fn()}
        onSaveChapter={vi.fn(async () => undefined)}
        onApproveReview={vi.fn(async () => undefined)}
        onRejectReview={vi.fn(async () => undefined)}
        onSelectTruthFile={vi.fn()}
      />,
    );

    expect(screen.getByText("Audit issues")).toBeTruthy();
    expect(screen.getByText("Continuity drift")).toBeTruthy();
    expect(screen.getByText("POV slip")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve chapter" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject chapter" })).toBeTruthy();
  });
});
