// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChapterDetail, ChapterSummary } from "../../shared/contracts";
import { ChapterEditor } from "../components/chapters/ChapterEditor";
import { ChapterList } from "../components/chapters/ChapterList";
import { countChapterLength } from "../utils/length-metrics";

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

afterEach(() => {
  cleanup();
});

describe("ChapterEditor", () => {
  it("frames the manuscript as the main drafting surface with writing context", () => {
    const chapter = createChapterSummary({ wordCount: 2 });
    const detail = createChapterDetail(chapter);

    render(
      <ChapterEditor
        selectedChapter={chapter}
        chapter={detail}
        language="en"
        saving={false}
        onDirtyChange={vi.fn()}
        onDraftWordCountChange={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    const editor = screen.getByRole("region", { name: "Chapter 2 manuscript" });

    expect(within(editor).getByText("Drafting desk")).toBeTruthy();
    expect(within(editor).getByRole("heading", { name: "Chapter 2: Signals" })).toBeTruthy();
    expect(within(editor).getByText("Shape the live manuscript here, with the chapter title, draft state, and word count kept in view.")).toBeTruthy();
    const context = editor.querySelector('[aria-label="Manuscript context"]');

    expect(context).toBeTruthy();
    if (!(context instanceof HTMLElement)) {
      throw new Error("Expected manuscript context block");
    }

    expect(within(context).getByText("Manuscript status")).toBeTruthy();
    expect(within(context).getByText("Draft saved to manuscript")).toBeTruthy();
    expect(within(context).getByText("Draft length")).toBeTruthy();
    expect(context.textContent).toContain("2 words in this draft");
    expect(within(context).getByText("Source file")).toBeTruthy();
    expect(within(context).getByText("0002_signals.md")).toBeTruthy();
    expect(within(context).getByText("Last updated")).toBeTruthy();
    expect(within(context).getByText("Mar 26, 2026")).toBeTruthy();
  });

  it("tracks local dirty state and saves explicitly", () => {
    const chapter = createChapterSummary({ wordCount: 2 });
    const detail = createChapterDetail(chapter);
    const onDirtyChange = vi.fn();
    const onSave = vi.fn(async () => undefined);

    render(
      <ChapterEditor
        selectedChapter={chapter}
        chapter={detail}
        language="en"
        saving={false}
        onDirtyChange={onDirtyChange}
        onDraftWordCountChange={vi.fn()}
        onSave={onSave}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "Chapter markdown" });
    fireEvent.change(editor, { target: { value: "# Signals\n\nRevised body." } });

    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(screen.getAllByText("Draft in progress").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Save chapter" }));

    expect(onSave).toHaveBeenCalledWith("# Signals\n\nRevised body.");
  });

  it("updates local manuscript metadata when the draft diverges from saved content", () => {
    const chapter = createChapterSummary({ wordCount: 2 });
    const detail = createChapterDetail(chapter);
    const onDraftWordCountChange = vi.fn();

    render(
      <ChapterEditor
        selectedChapter={chapter}
        chapter={detail}
        language="en"
        saving={false}
        onDirtyChange={vi.fn()}
        onDraftWordCountChange={onDraftWordCountChange}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "Chapter markdown" });
    const context = screen.getByLabelText("Manuscript context");

    expect(within(context).getByText("Draft saved to manuscript")).toBeTruthy();
    expect(context.textContent).toContain("2 words in this draft");

    fireEvent.change(editor, { target: { value: "# Signals\n\nRevised body grows now." } });

    expect(within(context).getByText("Draft in progress")).toBeTruthy();
    expect(context.textContent).toContain("4 words in this draft");
    expect(onDraftWordCountChange).toHaveBeenLastCalledWith(4);
  });

  it("uses InkOS canonical counting for markdown and Chinese drafts", () => {
    const chapter = createChapterSummary({ title: "North Gate", wordCount: 0 });
    const detail = createChapterDetail(chapter);

    render(
      <ChapterEditor
        selectedChapter={chapter}
        chapter={detail}
        language="zh"
        saving={false}
        onDirtyChange={vi.fn()}
        onDraftWordCountChange={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Chapter markdown" }), {
      target: { value: "# North Gate\n\n陈风抬头看天。" },
    });

    expect(screen.getByLabelText("Manuscript context").textContent).toContain(
      `${countChapterLength("# North Gate\n\n陈风抬头看天。", "zh_chars")} characters in this draft`,
    );
  });

  it("offers a start-writing path when no chapter is open", () => {
    render(
      <ChapterEditor
        selectedChapter={null}
        chapter={null}
        saving={false}
        onDirtyChange={vi.fn()}
        onDraftWordCountChange={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByText("Start writing chapter one from the inspector with Write next, then return here to keep drafting.")).toBeTruthy();
  });
});

describe("ChapterList", () => {
  it("shows drafting metadata for each chapter in the navigator", () => {
    render(
      <ChapterList chapters={[createChapterSummary()]} selectedChapterNumber={2} onSelectChapter={vi.fn()} language="en" />,
    );

    expect(screen.getByText("Draft navigator")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Chapter path" })).toBeTruthy();
    const chapterButton = screen.getByRole("button", { name: /signals/i });

    expect(within(chapterButton).getByText("Signals")).toBeTruthy();
    expect(within(chapterButton).getByText("1,200 draft words")).toBeTruthy();
    expect(within(chapterButton).getByText("Last updated Mar 26, 2026")).toBeTruthy();
    expect(within(chapterButton).getByText("draft")).toBeTruthy();
  });

  it("labels Chinese chapter counts as characters in the navigator", () => {
    render(
      <ChapterList chapters={[createChapterSummary()]} selectedChapterNumber={2} onSelectChapter={vi.fn()} language="zh" />,
    );

    const chapterButton = screen.getByRole("button", { name: /signals/i });

    expect(within(chapterButton).getByText("1,200 draft characters")).toBeTruthy();
  });

  it("gives an actionable start-writing path when no chapters are available", () => {
    render(<ChapterList chapters={[]} selectedChapterNumber={null} onSelectChapter={vi.fn()} />);

    expect(screen.getByText("Use Write next in the inspector to draft chapter one, then pick it up here once it lands.")).toBeTruthy();
  });
});
