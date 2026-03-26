// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BooksDashboard } from "../components/books/BooksDashboard";
import type { BookSummary } from "../../shared/contracts";

const book: BookSummary = {
  id: "book-1",
  title: "Northbound",
  status: "draft",
  platform: "web",
  genre: "fantasy",
  targetChapters: 12,
  chapters: 7,
  chapterCount: 7,
  lastChapterNumber: 7,
  totalWords: 18200,
  approvedChapters: 3,
  pendingReview: 2,
  pendingReviewChapters: 2,
  failedReview: 1,
  failedChapters: 1,
  recentRunStatus: "running",
  updatedAt: "2026-03-26T00:00:00.000Z",
};

describe("BooksDashboard", () => {
  it("shows chapter count, pending review, audit-failed count, and recent run status", () => {
    render(<BooksDashboard books={[book]} onOpenBook={vi.fn()} />);

    expect(screen.getByText("Chapter count")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("Pending review")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("Audit failed")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("Recent run")).toBeTruthy();
    expect(screen.getByText("running")).toBeTruthy();
  });
});
