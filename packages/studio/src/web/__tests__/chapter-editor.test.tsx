// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChapterDetail, ChapterSummary } from "../../shared/contracts";
import { ChapterEditor } from "../components/chapters/ChapterEditor";

function createChapterSummary(overrides: Partial<ChapterSummary> = {}): ChapterSummary {
  return {
    number: overrides.number ?? 2,
    title: overrides.title ?? "Signals",
    status: overrides.status ?? "draft",
    wordCount: overrides.wordCount ?? 1200,
    auditIssueCount: overrides.auditIssueCount ?? 1,
    updatedAt: overrides.updatedAt ?? "2026-03-26T00:00:00.000Z",
    fileName: overrides.fileName ?? "0002_signals.md",
  };
}

function createChapterDetail(summary: ChapterSummary): ChapterDetail {
  return {
    ...summary,
    auditIssues: ["Tighten midpoint turn"],
    content: `# ${summary.title}\n\nDraft body.`,
  };
}

describe("ChapterEditor", () => {
  it("tracks local dirty state and saves explicitly", () => {
    const chapter = createChapterSummary();
    const detail = createChapterDetail(chapter);
    const onDirtyChange = vi.fn();
    const onSave = vi.fn(async () => undefined);

    render(
      <ChapterEditor
        selectedChapter={chapter}
        chapter={detail}
        saving={false}
        onDirtyChange={onDirtyChange}
        onSave={onSave}
      />,
    );

    const editor = screen.getByLabelText("Chapter markdown");
    fireEvent.change(editor, { target: { value: "# Signals\n\nRevised body." } });

    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText("Unsaved changes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save chapter" }));

    expect(onSave).toHaveBeenCalledWith("# Signals\n\nRevised body.");
  });
});
