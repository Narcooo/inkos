// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BooksDashboard } from "../components/books/BooksDashboard";
import { HealthView } from "../components/health/HealthView";
import type { BookSummary } from "../../shared/contracts";
import type { HealthStatus } from "../../shared/contracts";

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

const health: HealthStatus = {
  status: "ok",
  projectRoot: "/tmp/inkos-project",
  bookCount: 2,
  provider: "openai",
  model: "gpt-5",
  projectConfigFound: true,
  envFound: true,
  projectEnvFound: true,
  globalConfigFound: true,
  configReady: true,
};

afterEach(() => {
  cleanup();
});

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

  it("describes the shelf as a secondary library view", () => {
    render(<BooksDashboard books={[book]} onOpenBook={vi.fn()} />);

    expect(screen.getAllByRole("heading", { name: "Library shelf" }).length).toBeGreaterThan(0);
    expect(
      screen.getByText("Use the shelf to switch books, review progress, and reopen a workspace when you need broader project management."),
    ).toBeTruthy();
  });
});

describe("HealthView", () => {
  it("frames diagnostics as a secondary status surface", () => {
    render(<HealthView health={health} />);

    expect(screen.getByText("Diagnostics snapshot")).toBeTruthy();
    expect(screen.getByText("Reference-only diagnostics for this local Studio session.")).toBeTruthy();
  });
});
