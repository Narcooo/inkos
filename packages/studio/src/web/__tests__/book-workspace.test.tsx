// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { StudioShell } from "../components/layout/StudioShell";
import { BookWorkspace } from "../components/workspace/BookWorkspace";
import { RunConsole } from "../components/runs/RunConsole";
import type { BootstrapStatus, BookDetail, ChapterDetail, ChapterSummary, HealthStatus, StudioRun, TruthFileDetail, TruthFileSummary } from "../../shared/contracts";
import type { StudioApiClient } from "../api/client";
import { useRunStream } from "../hooks/useRunStream";
import { useStudioState } from "../hooks/useStudioState";

vi.mock("../hooks/useStudioState", async () => {
  const actual = await vi.importActual<typeof import("../hooks/useStudioState")>("../hooks/useStudioState");

  return {
    ...actual,
    useStudioState: vi.fn(),
  };
});

vi.mock("../hooks/useRunStream", () => ({
  useRunStream: vi.fn(() => ({ run: null, streamError: null })),
}));

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
const truthFileSummary: TruthFileSummary = {
  name: "current_state.md",
  label: "Current State",
  exists: true,
  path: "story/current_state.md",
  optional: false,
  available: true,
};
const truthFileDetail: TruthFileDetail = {
  ...truthFileSummary,
  content: "# Current state\n\nImportant facts",
};

function createReadyBootstrapStatus(health: HealthStatus, bookId = "book-1"): BootstrapStatus {
  return {
    health,
    project: {
      initialized: true,
      name: "Project",
      bookCount: health.bookCount,
      firstBookId: bookId,
    },
    readiness: {
      ready: true,
      code: "READY",
      title: "Studio is ready",
      message: "Your project is ready for the next setup step.",
      action: "Continue",
    },
  };
}

async function normalizeIdeaPayload({ idea }: { readonly idea: string }) {
  return {
    type: "idea" as const,
    titleSuggestion: idea.trim(),
    sourceText: idea.trim(),
    prompt: idea.trim(),
  };
}

async function summarizeUploadPayload({ files }: { readonly files: ReadonlyArray<{ readonly name: string; readonly size: number; readonly type?: string; readonly content: string }> }) {
  return {
    type: "upload" as const,
    titleSuggestion: "Imported materials intake",
    sourceText: files.map((file) => file.content).join("\n\n"),
    prompt: `${files.length} files imported`,
    summary: {
      fileCount: files.length,
      totalBytes: files.reduce((total, file) => total + file.size, 0),
      totalCharacters: files.reduce((total, file) => total + file.content.length, 0),
      fileNames: files.map((file) => file.name),
      formats: [],
      kinds: [],
    },
    files: files.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type ?? "",
      format: file.type ?? "",
      kind: "Other",
      contentLength: file.content.length,
      excerpt: file.content,
    })),
  };
}
const unavailableTruthFileSummary: TruthFileSummary = {
  name: "canon.md",
  label: "Canon Ledger",
  exists: false,
  path: "story/canon.md",
  optional: false,
  available: false,
};
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
  vi.mocked(useRunStream).mockReturnValue({ run: null, streamError: null });
});

describe("BookWorkspace", () => {
  it("renders inspector support sections together while the manuscript stays central", () => {
    const { container } = render(
      <BookWorkspace
        book={book}
        activeTab="chapters"
        chapters={[selectedChapter]}
        selectedChapterNumber={selectedChapter.number}
        selectedChapter={selectedChapter}
        chapterDetail={chapterDetail}
        truthFiles={[truthFileSummary, unavailableTruthFileSummary]}
        selectedTruthFile={unavailableTruthFileSummary}
        truthFile={null}
        chapterDirty={false}
        chapterSaving={false}
        reviewSubmitting={false}
        onSelectTab={vi.fn()}
        onSelectChapter={vi.fn()}
        onChapterDirtyChange={vi.fn()}
        onChapterDraftWordCountChange={vi.fn()}
        onSaveChapter={vi.fn(async () => undefined)}
        onApproveReview={vi.fn(async () => undefined)}
        onRejectReview={vi.fn(async () => undefined)}
        onSelectTruthFile={vi.fn()}
        />,
    );

    const layout = container.querySelector(".workspace__layout");
    const manuscriptZone = container.querySelector(".workspace__manuscript");
    const inspectorZone = container.querySelector(".workspace__inspector");
    const inspectorStack = screen.getByRole("group", { name: "Inspector support sections" });
    const workspaceModes = screen.queryByRole("tablist", { name: "Desk views" });

    expect(screen.getByText("Navigator")).toBeTruthy();
    expect(screen.getByText("Manuscript")).toBeTruthy();
    expect(screen.getByText("Inspector")).toBeTruthy();
    expect(workspaceModes).toBeNull();
    expect(layout?.classList.contains("workspace__layout--manuscript-priority")).toBe(true);
    expect(manuscriptZone?.classList.contains("workspace__zone--primary")).toBe(true);
    expect(inspectorZone?.classList.contains("workspace__zone--secondary")).toBe(true);
    expect(inspectorStack.querySelectorAll(":scope > .workspace__inspector-section").length).toBe(4);
    expect(screen.getByRole("heading", { name: "Center draft" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save chapter" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Review" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Context" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Notes" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Runs" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Focus review" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Focus context" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Focus notes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Focus runs" })).toBeTruthy();
    expect(screen.getByText("Continuity drift")).toBeTruthy();
    expect(screen.getByText("POV slip")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve chapter" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject chapter" })).toBeTruthy();
    expect(screen.getByText("Read-only context")).toBeTruthy();
    expect(screen.getByText("Chapter notes are coming soon.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Draft" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Audit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revise" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Write next" })).toBeTruthy();
  });

  it("keeps the manuscript editor present while showing review details in the inspector", () => {
    render(
      <BookWorkspace
        book={book}
        activeTab="review"
        chapters={[selectedChapter]}
        selectedChapterNumber={selectedChapter.number}
        selectedChapter={selectedChapter}
        chapterDetail={chapterDetail}
        truthFiles={[truthFileSummary]}
        selectedTruthFile={null}
        truthFile={null}
        chapterDirty={false}
        chapterSaving={false}
        reviewSubmitting={false}
        onSelectTab={vi.fn()}
        onSelectChapter={vi.fn()}
        onChapterDirtyChange={vi.fn()}
        onChapterDraftWordCountChange={vi.fn()}
        onSaveChapter={vi.fn(async () => undefined)}
        onApproveReview={vi.fn(async () => undefined)}
        onRejectReview={vi.fn(async () => undefined)}
        onSelectTruthFile={vi.fn()}
        />,
    );

    expect(screen.getByText("Manuscript")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save chapter" })).toBeTruthy();
    expect(screen.getByText("Audit issues")).toBeTruthy();
    expect(screen.getByText("Continuity drift")).toBeTruthy();
    expect(screen.getByText("POV slip")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve chapter" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject chapter" })).toBeTruthy();
  });

  it("shows character counts in the review inspector for Chinese-language books", () => {
    render(
      <BookWorkspace
        book={{ ...book, language: "zh" }}
        activeTab="review"
        chapters={[selectedChapter]}
        selectedChapterNumber={selectedChapter.number}
        selectedChapter={selectedChapter}
        chapterDetail={chapterDetail}
        truthFiles={[truthFileSummary]}
        selectedTruthFile={null}
        truthFile={null}
        chapterDirty={false}
        chapterSaving={false}
        reviewSubmitting={false}
        onSelectTab={vi.fn()}
        onSelectChapter={vi.fn()}
        onChapterDirtyChange={vi.fn()}
        onChapterDraftWordCountChange={vi.fn()}
        onSaveChapter={vi.fn(async () => undefined)}
        onApproveReview={vi.fn(async () => undefined)}
        onRejectReview={vi.fn(async () => undefined)}
        onSelectTruthFile={vi.fn()}
      />,
    );

    const reviewPanel = screen.getByRole("heading", { name: "Review" }).closest("section");

    expect(reviewPanel).toBeTruthy();
    expect(within(reviewPanel as HTMLElement).getByText("1,200 characters")).toBeTruthy();
    expect(within(reviewPanel as HTMLElement).queryByText("1,200 words")).toBeNull();
  });

  it("keeps unavailable truth files visibly secondary and unavailable", () => {
    const { container } = render(
      <BookWorkspace
        book={book}
        activeTab="truth-files"
        chapters={[selectedChapter]}
        selectedChapterNumber={selectedChapter.number}
        selectedChapter={selectedChapter}
        chapterDetail={chapterDetail}
        truthFiles={[truthFileSummary, unavailableTruthFileSummary]}
        selectedTruthFile={unavailableTruthFileSummary}
        truthFile={null}
        chapterDirty={true}
        chapterSaving={false}
        reviewSubmitting={false}
        onSelectTab={vi.fn()}
        onSelectChapter={vi.fn()}
        onChapterDirtyChange={vi.fn()}
        onChapterDraftWordCountChange={vi.fn()}
        onSaveChapter={vi.fn(async () => undefined)}
        onApproveReview={vi.fn(async () => undefined)}
        onRejectReview={vi.fn(async () => undefined)}
        onSelectTruthFile={vi.fn()}
      />,
    );

    const contextPanel = container.querySelector(".truth-viewer");
    const contextLayout = container.querySelector(".truth-viewer__layout");

    expect(screen.getByText("Manuscript")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save chapter" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Context" })).toBeTruthy();
    expect(screen.getByText("Read-only context")).toBeTruthy();
    expect(contextPanel?.classList.contains("truth-viewer--compact")).toBe(true);
    expect(contextLayout?.classList.contains("truth-viewer__layout--compact")).toBe(true);
    expect(screen.getAllByText("unavailable").length).toBeGreaterThan(0);
    expect(screen.getByText("This required truth file is currently unavailable in the workspace.")).toBeTruthy();
  });

  it("lets users switch inspector focus locally so context can load through the existing tab path", () => {
    const onSelectTab = vi.fn();

    const { container } = render(
      <BookWorkspace
        book={book}
        activeTab="chapters"
        chapters={[selectedChapter]}
        selectedChapterNumber={selectedChapter.number}
        selectedChapter={selectedChapter}
        chapterDetail={chapterDetail}
        truthFiles={[truthFileSummary]}
        selectedTruthFile={truthFileSummary}
        truthFile={truthFileDetail}
        chapterDirty={false}
        chapterSaving={false}
        reviewSubmitting={false}
        onSelectTab={onSelectTab}
        onSelectChapter={vi.fn()}
        onChapterDirtyChange={vi.fn()}
        onChapterDraftWordCountChange={vi.fn()}
        onSaveChapter={vi.fn(async () => undefined)}
        onApproveReview={vi.fn(async () => undefined)}
        onRejectReview={vi.fn(async () => undefined)}
        onSelectTruthFile={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Focus context" }));
    expect(screen.getByRole("button", { name: "Focus context" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Focus notes" }));
    expect(screen.getByRole("button", { name: "Focus notes" }).getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelectorAll(".workspace__inspector-section--active .notes-panel").length).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Focus runs" }));
    expect(screen.getByRole("button", { name: "Focus runs" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Focus review" }));
    expect(screen.getByRole("button", { name: "Focus review" }).getAttribute("aria-pressed")).toBe("true");

    expect(onSelectTab).toHaveBeenNthCalledWith(1, "truth-files");
    expect(onSelectTab).toHaveBeenNthCalledWith(2, "runs");
    expect(onSelectTab).toHaveBeenNthCalledWith(3, "review");
    expect(onSelectTab).toHaveBeenCalledTimes(3);
  });

  it("keeps run controls visible in the inspector while dirty drafts still block actions", () => {
    render(
      <BookWorkspace
        book={book}
        activeTab="runs"
        chapters={[selectedChapter]}
        selectedChapterNumber={selectedChapter.number}
        selectedChapter={selectedChapter}
        chapterDetail={chapterDetail}
        truthFiles={[truthFileSummary]}
        selectedTruthFile={null}
        truthFile={null}
        chapterDirty={true}
        chapterSaving={false}
        reviewSubmitting={false}
        onSelectTab={vi.fn()}
        onSelectChapter={vi.fn()}
        onChapterDirtyChange={vi.fn()}
        onChapterDraftWordCountChange={vi.fn()}
        onSaveChapter={vi.fn(async () => undefined)}
        onApproveReview={vi.fn(async () => undefined)}
        onRejectReview={vi.fn(async () => undefined)}
        onSelectTruthFile={vi.fn()}
      />,
    );

    expect(screen.getByText("Manuscript")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save chapter" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Runs" })).toBeTruthy();
    expect(screen.getByText("Save or discard manuscript changes before running desk actions.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Draft" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Audit" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Revise" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Write next" }).hasAttribute("disabled")).toBe(true);
  });

  it("keeps write-next reachable for empty books by using the runs inspector", () => {
    render(
      <BookWorkspace
        book={{ ...book, chapters: 0, chapterCount: 0, lastChapterNumber: 0, totalWords: 0, chapterWordCount: 0 }}
        activeTab="runs"
        chapters={[]}
        selectedChapterNumber={null}
        selectedChapter={null}
        chapterDetail={null}
        truthFiles={[]}
        selectedTruthFile={null}
        truthFile={null}
        chapterDirty={false}
        chapterSaving={false}
        reviewSubmitting={false}
        onSelectTab={vi.fn()}
        onSelectChapter={vi.fn()}
        onChapterDirtyChange={vi.fn()}
        onChapterDraftWordCountChange={vi.fn()}
        onSaveChapter={vi.fn(async () => undefined)}
        onApproveReview={vi.fn(async () => undefined)}
        onRejectReview={vi.fn(async () => undefined)}
        onSelectTruthFile={vi.fn()}
      />,
    );

    expect(screen.getByText("Execution console")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Write next" }).hasAttribute("disabled")).toBe(false);
  });

  it("keeps empty review and reference states pointed back to runs", () => {
    const onSelectTab = vi.fn();

    const { rerender } = render(
      <BookWorkspace
        book={{ ...book, chapters: 0, chapterCount: 0, lastChapterNumber: 0, totalWords: 0, chapterWordCount: 0 }}
        activeTab="review"
        chapters={[]}
        selectedChapterNumber={null}
        selectedChapter={null}
        chapterDetail={null}
        truthFiles={[]}
        selectedTruthFile={null}
        truthFile={null}
        chapterDirty={false}
        chapterSaving={false}
        reviewSubmitting={false}
        onSelectTab={onSelectTab}
        onSelectChapter={vi.fn()}
        onChapterDirtyChange={vi.fn()}
        onChapterDraftWordCountChange={vi.fn()}
        onSaveChapter={vi.fn(async () => undefined)}
        onApproveReview={vi.fn(async () => undefined)}
        onRejectReview={vi.fn(async () => undefined)}
        onSelectTruthFile={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Open runs" })[0]);
    expect(onSelectTab).toHaveBeenCalledWith("runs");

    rerender(
      <BookWorkspace
        book={{ ...book, chapters: 0, chapterCount: 0, lastChapterNumber: 0, totalWords: 0, chapterWordCount: 0 }}
        activeTab="truth-files"
        chapters={[]}
        selectedChapterNumber={null}
        selectedChapter={null}
        chapterDetail={null}
        truthFiles={[]}
        selectedTruthFile={null}
        truthFile={null}
        chapterDirty={false}
        chapterSaving={false}
        reviewSubmitting={false}
        onSelectTab={onSelectTab}
        onSelectChapter={vi.fn()}
        onChapterDirtyChange={vi.fn()}
        onChapterDraftWordCountChange={vi.fn()}
        onSaveChapter={vi.fn(async () => undefined)}
        onApproveReview={vi.fn(async () => undefined)}
        onRejectReview={vi.fn(async () => undefined)}
        onSelectTruthFile={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Open runs" })[0]);
    expect(onSelectTab).toHaveBeenLastCalledWith("runs");
  });
});

describe("StudioShell", () => {
  it("uses a lean writing top bar with book and chapter metadata", () => {
    render(
      <StudioShell
        subtitle="Writing-desk access to the live InkOS workspace."
        loading={false}
        error={null}
        onOpenDashboard={vi.fn()}
        onOpenHealth={vi.fn()}
        viewLabel="Northbound"
        metadata={[
          { label: "Book", value: "Northbound" },
          { label: "Chapter", value: "Chapter 1: Chapter 1" },
          { label: "Save", value: "All changes saved" },
          { label: "Words", value: "1,200 words" },
        ]}
      >
        <div>workspace</div>
      </StudioShell>,
    );

    expect(screen.getByRole("heading", { name: "Writing studio" })).toBeTruthy();
    expect(screen.getByText("Shelf is close by, but the draft stays front and center.")).toBeTruthy();
    expect(screen.getByText("Book")).toBeTruthy();
    expect(screen.getAllByText("Chapter 1: Chapter 1").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Shelf" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "System" })).toBeTruthy();
  });

  it("shows dirty save state in top-bar metadata", () => {
    render(
      <StudioShell
        subtitle="Writing-desk access to the live InkOS workspace."
        loading={false}
        error={null}
        onOpenDashboard={vi.fn()}
        onOpenHealth={vi.fn()}
        viewLabel="Northbound"
        metadata={[
          { label: "Book", value: "Northbound" },
          { label: "Chapter", value: "Chapter 1: Chapter 1" },
          { label: "Save", value: "Unsaved changes" },
          { label: "Words", value: "1,200 words" },
        ]}
      >
        <div>workspace</div>
      </StudioShell>,
    );

    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });
});

describe("App", () => {
  it("derives top-bar metadata from live dirty workspace state", () => {
    vi.mocked(useStudioState).mockReturnValue({
      activeView: "workspace",
      creationLauncherMode: null,
      creationDraft: null,
      creationProject: null,
      activeTab: "review",
      books: [],
      selectedBook: book,
      chapters: [selectedChapter],
      selectedChapter,
      chapter: chapterDetail,
      truthFiles: [truthFileSummary],
      selectedTruthFile: truthFileSummary,
      truthFile: truthFileDetail,
      health: null,
      bootstrapStatus: null,
      creationBootstrap: null,
      chapterDirty: true,
      chapterDraftWordCount: 1200,
      chapterSaving: false,
      reviewSubmitting: false,
      loading: false,
      error: null,
      refresh: vi.fn(async () => undefined),
      showDashboard: vi.fn(),
      showHealth: vi.fn(async () => undefined),
      startCreationLauncher: vi.fn(),
      exitCreationLauncher: vi.fn(),
      updateCreationDraft: vi.fn(),
      normalizeIdeaDraft: vi.fn(async () => undefined),
      summarizeUploadDraft: vi.fn(async () => undefined),
      startCreationBootstrap: vi.fn(async () => undefined),
      completeCreationLauncher: vi.fn(),
      openBook: vi.fn(async () => undefined),
      selectChapter: vi.fn(async () => undefined),
      setChapterDirty: vi.fn(),
      setChapterDraftWordCount: vi.fn(),
      saveChapter: vi.fn(async () => undefined),
      approveReview: vi.fn(async () => undefined),
      rejectReview: vi.fn(async () => undefined),
      selectTab: vi.fn(async () => undefined),
      selectTruthFile: vi.fn(async () => undefined),
    });

    render(<App />);

    const workspaceContext = screen.getByLabelText("Workspace context");

    expect(screen.getByText("Book")).toBeTruthy();
    expect(screen.getByText("Northbound")).toBeTruthy();
    expect(screen.getAllByText("Chapter 1: Chapter 1").length).toBeGreaterThan(0);
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(within(workspaceContext).getByText("Words")).toBeTruthy();
    expect(within(workspaceContext).getByText("1,200 words")).toBeTruthy();
  });

  it("labels Chinese top-bar draft counts as characters", () => {
    vi.mocked(useStudioState).mockReturnValue({
      activeView: "workspace",
      creationLauncherMode: null,
      creationDraft: null,
      creationProject: null,
      activeTab: "review",
      books: [],
      selectedBook: { ...book, language: "zh" },
      chapters: [selectedChapter],
      selectedChapter,
      chapter: chapterDetail,
      truthFiles: [truthFileSummary],
      selectedTruthFile: truthFileSummary,
      truthFile: truthFileDetail,
      health: null,
      bootstrapStatus: null,
      creationBootstrap: null,
      chapterDirty: true,
      chapterDraftWordCount: 1200,
      chapterSaving: false,
      reviewSubmitting: false,
      loading: false,
      error: null,
      refresh: vi.fn(async () => undefined),
      showDashboard: vi.fn(),
      showHealth: vi.fn(async () => undefined),
      startCreationLauncher: vi.fn(),
      exitCreationLauncher: vi.fn(),
      updateCreationDraft: vi.fn(),
      normalizeIdeaDraft: vi.fn(async () => undefined),
      summarizeUploadDraft: vi.fn(async () => undefined),
      startCreationBootstrap: vi.fn(async () => undefined),
      completeCreationLauncher: vi.fn(),
      openBook: vi.fn(async () => undefined),
      selectChapter: vi.fn(async () => undefined),
      setChapterDirty: vi.fn(),
      setChapterDraftWordCount: vi.fn(),
      saveChapter: vi.fn(async () => undefined),
      approveReview: vi.fn(async () => undefined),
      rejectReview: vi.fn(async () => undefined),
      selectTab: vi.fn(async () => undefined),
      selectTruthFile: vi.fn(async () => undefined),
    });

    render(<App />);

    const workspaceContext = screen.getByLabelText("Workspace context");

    expect(within(workspaceContext).getByText("Characters")).toBeTruthy();
    expect(within(workspaceContext).getByText("1,200 characters")).toBeTruthy();
  });

  it("disables shell refresh while save or review work is in flight", () => {
    vi.mocked(useStudioState).mockReturnValue({
      activeView: "workspace",
      creationLauncherMode: null,
      creationDraft: null,
      creationProject: null,
      activeTab: "review",
      books: [],
      selectedBook: book,
      chapters: [selectedChapter],
      selectedChapter,
      chapter: chapterDetail,
      truthFiles: [truthFileSummary],
      selectedTruthFile: truthFileSummary,
      truthFile: truthFileDetail,
      health: null,
      bootstrapStatus: null,
      creationBootstrap: null,
      chapterDirty: false,
      chapterDraftWordCount: 1200,
      chapterSaving: true,
      reviewSubmitting: false,
      loading: false,
      error: null,
      refresh: vi.fn(async () => undefined),
      showDashboard: vi.fn(),
      showHealth: vi.fn(async () => undefined),
      startCreationLauncher: vi.fn(),
      exitCreationLauncher: vi.fn(),
      updateCreationDraft: vi.fn(),
      normalizeIdeaDraft: vi.fn(async () => undefined),
      summarizeUploadDraft: vi.fn(async () => undefined),
      startCreationBootstrap: vi.fn(async () => undefined),
      completeCreationLauncher: vi.fn(),
      openBook: vi.fn(async () => undefined),
      selectChapter: vi.fn(async () => undefined),
      setChapterDirty: vi.fn(),
      setChapterDraftWordCount: vi.fn(),
      saveChapter: vi.fn(async () => undefined),
      approveReview: vi.fn(async () => undefined),
      rejectReview: vi.fn(async () => undefined),
      selectTab: vi.fn(async () => undefined),
      selectTruthFile: vi.fn(async () => undefined),
    });

    render(<App />);

    expect(screen.getByRole("button", { name: "Refresh desk" }).hasAttribute("disabled")).toBe(true);
  });

  it("updates shell word metadata after a real editor edit", async () => {
    const chapter = createChapterSummary({ title: "Signals", wordCount: 4, status: "draft" });
    const detail = createChapterDetail(chapter);
    const liveBook = { ...book, chapters: 1, chapterCount: 1, lastChapterNumber: 1, totalWords: 4, chapterWordCount: 4 };
    const client: StudioApiClient = {
      listBooks: async () => [liveBook],
      getBook: async () => liveBook,
      listChapters: async () => [chapter],
      getChapter: async () => detail,
      listTruthFiles: async () => [],
      getTruthFile: async () => truthFileDetail,
      getHealth: async () => ({
        status: "ok",
        projectRoot: "/project",
        projectConfigFound: true,
        envFound: true,
        projectEnvFound: true,
        globalConfigFound: false,
        configReady: true,
        bookCount: 1,
        provider: "openai",
        model: "gpt-4.1",
      }),
      getBootstrapStatus: async () => createReadyBootstrapStatus({
        status: "ok",
        projectRoot: "/project",
        projectConfigFound: true,
        envFound: true,
        projectEnvFound: true,
        globalConfigFound: false,
        configReady: true,
        bookCount: 1,
        provider: "openai",
        model: "gpt-4.1",
      }, liveBook.id),
      createBootstrapProject: async () => { throw new Error("not used"); },
      createBootstrapBook: async () => { throw new Error("not used"); },
      setupStory: async () => { throw new Error("not used"); },
      generateOutline: async () => { throw new Error("not used"); },
      generateFirstChapter: async () => { throw new Error("not used"); },
      normalizeIdea: normalizeIdeaPayload,
      summarizeUpload: summarizeUploadPayload,
      saveChapter: async () => detail,
      approveReview: async () => detail,
      rejectReview: async () => detail,
      createRun: vi.fn<StudioApiClient["createRun"]>(async (_bookId, action) => ({
        id: "run-1",
        bookId: liveBook.id,
        chapter: 1,
        chapterNumber: 1,
        action: "draft",
        status: "running",
        stage: "Queued",
        createdAt: "2026-03-26T00:00:00.000Z",
        updatedAt: "2026-03-26T00:00:00.000Z",
        startedAt: "2026-03-26T00:00:01.000Z",
        finishedAt: null,
        logs: [],
      })),
      listRuns: async () => [],
    };

    const { useStudioState: realUseStudioState } = await vi.importActual<typeof import("../hooks/useStudioState")>("../hooks/useStudioState");

    function LiveHarness() {
      const state = realUseStudioState({ client });
      const liveState = state as typeof state & { chapterDraftWordCount?: number | null };
      const wordCount = liveState.chapterDraftWordCount ?? state.chapter?.wordCount ?? state.selectedChapter?.wordCount ?? null;
      const saveState = state.chapterSaving ? "Saving draft..." : state.chapterDirty ? "Unsaved changes" : "All changes saved";

      useEffect(() => {
        if (state.activeView === "dashboard" && state.selectedBook) {
          void state.openBook(state.selectedBook.id);
        }
      }, [state.activeView, state.openBook, state.selectedBook]);

      return state.activeView === "workspace" && state.selectedBook ? (
        <StudioShell
          subtitle="Open to the live manuscript, with review and reference close at hand."
          loading={state.loading}
          error={state.error}
          onOpenDashboard={state.showDashboard}
          onOpenHealth={state.showHealth}
          viewLabel={`${state.selectedBook.title} manuscript`}
          metadata={[
            { label: "Book", value: state.selectedBook.title },
            { label: "Chapter", value: state.selectedChapter ? `Chapter ${state.selectedChapter.number}: ${state.selectedChapter.title}` : "No chapter selected" },
            { label: "Save", value: saveState },
            { label: "Words", value: wordCount === null ? "No chapter words yet" : `${wordCount.toLocaleString()} words` },
          ]}
        >
          <BookWorkspace
            book={state.selectedBook}
            activeTab={state.activeTab}
            chapters={state.chapters}
            selectedChapterNumber={state.selectedChapter?.number ?? null}
            selectedChapter={state.selectedChapter}
            chapterDetail={state.chapter}
            truthFiles={state.truthFiles}
            selectedTruthFile={state.selectedTruthFile}
            truthFile={state.truthFile}
            chapterDirty={state.chapterDirty}
            chapterSaving={state.chapterSaving}
            reviewSubmitting={state.reviewSubmitting}
            onSelectTab={(tab) => void state.selectTab(tab)}
            onSelectChapter={(chapterNumber) => void state.selectChapter(chapterNumber)}
            onChapterDirtyChange={state.setChapterDirty}
            onChapterDraftWordCountChange={state.setChapterDraftWordCount}
            onSaveChapter={state.saveChapter}
            onApproveReview={state.approveReview}
            onRejectReview={state.rejectReview}
            onSelectTruthFile={(name) => void state.selectTruthFile(name)}
          />
        </StudioShell>
      ) : null;
    }

    render(<LiveHarness />);

    await waitFor(() => {
      expect(screen.getAllByText("4 words").length).toBeGreaterThan(0);
    });

    fireEvent.change(screen.getByRole("textbox", { name: "Chapter markdown" }), {
      target: { value: "# Signals\n\nRevised body grows now." },
    });

    await waitFor(() => {
      expect(screen.getAllByText("4 words").length).toBeGreaterThan(0);
    });
  });
});

describe("RunConsole", () => {
  it("keeps whole-book runs visible alongside chapter runs and only scopes chapter actions", async () => {
    const health: HealthStatus = {
      status: "ok",
      projectRoot: "/project",
      projectConfigFound: true,
      envFound: true,
      projectEnvFound: true,
      globalConfigFound: false,
      configReady: true,
      bookCount: 1,
      provider: "openai",
      model: "gpt-4.1",
    };
    const wholeBookRun: StudioRun = {
      id: "run-book",
      bookId: "book-1",
      chapter: null,
      chapterNumber: null,
      action: "draft",
      status: "running",
      stage: "Queued",
      createdAt: "2026-03-26T00:00:00.000Z",
      updatedAt: "2026-03-26T00:00:00.000Z",
      startedAt: "2026-03-26T00:00:01.000Z",
      finishedAt: null,
      logs: [],
    };
    const chapterRun: StudioRun = {
      id: "run-chapter",
      bookId: "book-1",
      chapter: 1,
      chapterNumber: 1,
      action: "audit",
      status: "succeeded",
      stage: "Completed",
      createdAt: "2026-03-26T00:00:00.000Z",
      updatedAt: "2026-03-26T00:00:00.000Z",
      startedAt: "2026-03-26T00:00:01.000Z",
      finishedAt: "2026-03-26T00:00:02.000Z",
      logs: [],
    };
    const createRun = vi
      .fn<StudioApiClient["createRun"]>()
      .mockResolvedValueOnce(wholeBookRun)
      .mockResolvedValueOnce(chapterRun)
      .mockResolvedValueOnce({
        ...wholeBookRun,
        id: "run-write-next",
        action: "write-next",
      });
    const client: StudioApiClient = {
      listBooks: vi.fn(async () => []),
      getBook: vi.fn(async () => book),
      listChapters: vi.fn(async () => [selectedChapter]),
      getChapter: vi.fn(async () => chapterDetail),
      listTruthFiles: vi.fn(async () => []),
      getTruthFile: vi.fn(async () => truthFileDetail),
      getHealth: vi.fn(async () => health),
      getBootstrapStatus: vi.fn(async () => createReadyBootstrapStatus(health)),
      createBootstrapProject: vi.fn(async () => { throw new Error("not used"); }),
      createBootstrapBook: vi.fn(async () => { throw new Error("not used"); }),
      setupStory: vi.fn(async () => { throw new Error("not used"); }),
      generateOutline: vi.fn(async () => { throw new Error("not used"); }),
      generateFirstChapter: vi.fn(async () => { throw new Error("not used"); }),
      normalizeIdea: vi.fn(normalizeIdeaPayload),
      summarizeUpload: vi.fn(summarizeUploadPayload),
      saveChapter: vi.fn(async () => chapterDetail),
      approveReview: vi.fn(async () => chapterDetail),
      rejectReview: vi.fn(async () => chapterDetail),
      listRuns: vi.fn(async () => [wholeBookRun, chapterRun]),
      createRun,
    };

    render(<RunConsole bookId="book-1" chapterNumber={1} client={client} />);

    await waitFor(() => {
      expect(screen.getByText("Whole book")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Draft" }));
    await waitFor(() => {
      expect(createRun).toHaveBeenNthCalledWith(1, "book-1", "draft", {});
    });

    fireEvent.click(screen.getByRole("button", { name: "Audit" }));
    await waitFor(() => {
      expect(createRun).toHaveBeenNthCalledWith(2, "book-1", "audit", { chapterNumber: 1 });
    });

    fireEvent.click(screen.getByRole("button", { name: "Write next" }));
    await waitFor(() => {
      expect(createRun).toHaveBeenNthCalledWith(3, "book-1", "write-next", {});
    });
  });

  it("ignores stale run responses after the user switches books", async () => {
    let resolveListBookOne: ((runs: ReadonlyArray<StudioRun>) => void) | undefined;
    let resolveCreateBookOne: ((run: StudioRun) => void) | undefined;
    const health: HealthStatus = {
      status: "ok",
      projectRoot: "/project",
      projectConfigFound: true,
      envFound: true,
      projectEnvFound: true,
      globalConfigFound: false,
      configReady: true,
      bookCount: 1,
      provider: "openai",
      model: "gpt-4.1",
    };

    const client: StudioApiClient = {
      listBooks: vi.fn(async () => []),
      getBook: vi.fn(async () => book),
      listChapters: vi.fn(async () => [selectedChapter]),
      getChapter: vi.fn(async () => chapterDetail),
      listTruthFiles: vi.fn(async () => []),
      getTruthFile: vi.fn(async () => truthFileDetail),
      getHealth: vi.fn(async () => health),
      getBootstrapStatus: vi.fn(async () => createReadyBootstrapStatus(health)),
      createBootstrapProject: vi.fn(async () => { throw new Error("not used"); }),
      createBootstrapBook: vi.fn(async () => { throw new Error("not used"); }),
      setupStory: vi.fn(async () => { throw new Error("not used"); }),
      generateOutline: vi.fn(async () => { throw new Error("not used"); }),
      generateFirstChapter: vi.fn(async () => { throw new Error("not used"); }),
      normalizeIdea: vi.fn(normalizeIdeaPayload),
      summarizeUpload: vi.fn(summarizeUploadPayload),
      saveChapter: vi.fn(async () => chapterDetail),
      approveReview: vi.fn(async () => chapterDetail),
      rejectReview: vi.fn(async () => chapterDetail),
      listRuns: vi
        .fn<StudioApiClient["listRuns"]>()
        .mockImplementationOnce(
          async () =>
            await new Promise((resolve) => {
              resolveListBookOne = resolve as unknown as typeof resolveListBookOne;
            }),
        )
        .mockResolvedValue([]),
      createRun: vi.fn<StudioApiClient["createRun"]>(async (bookId, action) => {
        if (bookId === "book-1") {
          return await new Promise((resolve) => {
            resolveCreateBookOne = resolve as unknown as typeof resolveCreateBookOne;
          });
        }

        return {
          id: "run-book-2",
          bookId,
          chapter: 2,
          chapterNumber: 2,
          action,
          status: "running",
          stage: "Queued",
          createdAt: "2026-03-26T00:00:00.000Z",
          updatedAt: "2026-03-26T00:00:00.000Z",
          startedAt: "2026-03-26T00:00:01.000Z",
          finishedAt: null,
          logs: [],
        };
      }),
    };

    const { rerender } = render(<RunConsole bookId="book-1" chapterNumber={1} client={client} />);

    fireEvent.click(screen.getByRole("button", { name: "Draft" }));

    rerender(<RunConsole bookId="book-2" chapterNumber={2} client={client} />);

    await waitFor(() => {
      expect(screen.getByText("Start a run to inspect progress, logs, and the final result.")).toBeTruthy();
    });

    resolveListBookOne?.([
      {
        id: "stale-list-run",
        bookId: "book-1",
        chapter: 1,
        chapterNumber: 1,
        action: "audit",
        status: "succeeded",
        stage: "Completed",
        createdAt: "2026-03-26T00:00:00.000Z",
        updatedAt: "2026-03-26T00:00:00.000Z",
        startedAt: "2026-03-26T00:00:01.000Z",
        finishedAt: "2026-03-26T00:00:02.000Z",
        logs: [],
      },
    ]);
    resolveCreateBookOne?.({
      id: "stale-create-run",
      bookId: "book-1",
      chapter: 1,
      chapterNumber: 1,
      action: "draft",
      status: "running",
      stage: "Queued",
      createdAt: "2026-03-26T00:00:00.000Z",
      updatedAt: "2026-03-26T00:00:00.000Z",
      startedAt: "2026-03-26T00:00:01.000Z",
      finishedAt: null,
      logs: [],
    });

    await waitFor(() => {
      expect(screen.queryByText("Queued")).toBeNull();
    });
    expect(screen.queryByText("Chapter 1")).toBeNull();
    expect(screen.getByText("Start a run to inspect progress, logs, and the final result.")).toBeTruthy();
  });

  it("ignores stale run responses after the user switches chapters in the same book", async () => {
    let resolveListChapterOne: ((runs: ReadonlyArray<StudioRun>) => void) | undefined;
    let resolveCreateChapterOne: ((run: StudioRun) => void) | undefined;
    const health: HealthStatus = {
      status: "ok",
      projectRoot: "/project",
      projectConfigFound: true,
      envFound: true,
      projectEnvFound: true,
      globalConfigFound: false,
      configReady: true,
      bookCount: 1,
      provider: "openai",
      model: "gpt-4.1",
    };

    const client: StudioApiClient = {
      listBooks: vi.fn(async () => []),
      getBook: vi.fn(async () => book),
      listChapters: vi.fn(async () => [selectedChapter]),
      getChapter: vi.fn(async () => chapterDetail),
      listTruthFiles: vi.fn(async () => []),
      getTruthFile: vi.fn(async () => truthFileDetail),
      getHealth: vi.fn(async () => health),
      getBootstrapStatus: vi.fn(async () => createReadyBootstrapStatus(health)),
      createBootstrapProject: vi.fn(async () => { throw new Error("not used"); }),
      createBootstrapBook: vi.fn(async () => { throw new Error("not used"); }),
      setupStory: vi.fn(async () => { throw new Error("not used"); }),
      generateOutline: vi.fn(async () => { throw new Error("not used"); }),
      generateFirstChapter: vi.fn(async () => { throw new Error("not used"); }),
      normalizeIdea: vi.fn(normalizeIdeaPayload),
      summarizeUpload: vi.fn(summarizeUploadPayload),
      saveChapter: vi.fn(async () => chapterDetail),
      approveReview: vi.fn(async () => chapterDetail),
      rejectReview: vi.fn(async () => chapterDetail),
      listRuns: vi
        .fn<StudioApiClient["listRuns"]>()
        .mockImplementationOnce(
          async () =>
            await new Promise((resolve) => {
              resolveListChapterOne = resolve as unknown as typeof resolveListChapterOne;
            }),
        )
        .mockResolvedValue([]),
      createRun: vi.fn<StudioApiClient["createRun"]>(async (bookId, action, options) => {
        if (bookId === "book-1" && options?.chapterNumber === 1) {
          return await new Promise((resolve) => {
            resolveCreateChapterOne = resolve as unknown as typeof resolveCreateChapterOne;
          });
        }

        return {
          id: "run-chapter-2",
          bookId,
          chapter: 2,
          chapterNumber: 2,
          action,
          status: "running",
          stage: "Queued",
          createdAt: "2026-03-26T00:00:00.000Z",
          updatedAt: "2026-03-26T00:00:00.000Z",
          startedAt: "2026-03-26T00:00:01.000Z",
          finishedAt: null,
          logs: [],
        };
      }),
    };

    const { rerender } = render(<RunConsole bookId="book-1" chapterNumber={1} client={client} />);

    fireEvent.click(screen.getByRole("button", { name: "Draft" }));

    rerender(<RunConsole bookId="book-1" chapterNumber={2} client={client} />);

    await waitFor(() => {
      expect(screen.getByText("Start a run to inspect progress, logs, and the final result.")).toBeTruthy();
    });

    resolveListChapterOne?.([
      {
        id: "stale-list-run-ch1",
        bookId: "book-1",
        chapter: 1,
        chapterNumber: 1,
        action: "audit",
        status: "succeeded",
        stage: "Completed",
        createdAt: "2026-03-26T00:00:00.000Z",
        updatedAt: "2026-03-26T00:00:00.000Z",
        startedAt: "2026-03-26T00:00:01.000Z",
        finishedAt: "2026-03-26T00:00:02.000Z",
        logs: [],
      },
    ]);
    resolveCreateChapterOne?.({
      id: "stale-create-run-ch1",
      bookId: "book-1",
      chapter: 1,
      chapterNumber: 1,
      action: "draft",
      status: "running",
      stage: "Queued",
      createdAt: "2026-03-26T00:00:00.000Z",
      updatedAt: "2026-03-26T00:00:00.000Z",
      startedAt: "2026-03-26T00:00:01.000Z",
      finishedAt: null,
      logs: [],
    });

    await waitFor(() => {
      expect(screen.queryByText("stale-create-run-ch1")).toBeNull();
    });
    expect(screen.queryByText("Chapter 1")).toBeNull();
    expect(screen.getByText("Start a run to inspect progress, logs, and the final result.")).toBeTruthy();
  });

  it("ignores stale streamed run updates after the user switches chapters", async () => {
    const staleChapterOneRun: StudioRun = {
      id: "stream-run-ch1",
      bookId: "book-1",
      chapter: 1,
      chapterNumber: 1,
      action: "revise",
      status: "running",
      stage: "Revising",
      createdAt: "2026-03-26T00:00:00.000Z",
      updatedAt: "2026-03-26T00:00:00.000Z",
      startedAt: "2026-03-26T00:00:01.000Z",
      finishedAt: null,
      logs: [],
    };
    const health: HealthStatus = {
      status: "ok",
      projectRoot: "/project",
      projectConfigFound: true,
      envFound: true,
      projectEnvFound: true,
      globalConfigFound: false,
      configReady: true,
      bookCount: 1,
      provider: "openai",
      model: "gpt-4.1",
    };

    let streamedRun: StudioRun | null = null;
    vi.mocked(useRunStream).mockImplementation(() => ({ run: streamedRun, streamError: null }));

    const client: StudioApiClient = {
      listBooks: vi.fn(async () => []),
      getBook: vi.fn(async () => book),
      listChapters: vi.fn(async () => [selectedChapter]),
      getChapter: vi.fn(async () => chapterDetail),
      listTruthFiles: vi.fn(async () => []),
      getTruthFile: vi.fn(async () => truthFileDetail),
      getHealth: vi.fn(async () => health),
      getBootstrapStatus: vi.fn(async () => createReadyBootstrapStatus(health)),
      createBootstrapProject: vi.fn(async () => { throw new Error("not used"); }),
      createBootstrapBook: vi.fn(async () => { throw new Error("not used"); }),
      setupStory: vi.fn(async () => { throw new Error("not used"); }),
      generateOutline: vi.fn(async () => { throw new Error("not used"); }),
      generateFirstChapter: vi.fn(async () => { throw new Error("not used"); }),
      normalizeIdea: vi.fn(normalizeIdeaPayload),
      summarizeUpload: vi.fn(summarizeUploadPayload),
      saveChapter: vi.fn(async () => chapterDetail),
      approveReview: vi.fn(async () => chapterDetail),
      rejectReview: vi.fn(async () => chapterDetail),
      listRuns: vi.fn(async () => []),
      createRun: vi.fn(async () => staleChapterOneRun),
    };

    const { rerender } = render(<RunConsole bookId="book-1" chapterNumber={1} client={client} />);

    streamedRun = staleChapterOneRun;
    rerender(<RunConsole bookId="book-1" chapterNumber={2} client={client} />);

    expect(screen.queryByText("Revising")).toBeNull();
    expect(screen.queryByText("Chapter 1")).toBeNull();
    expect(screen.getByText("Start a run to inspect progress, logs, and the final result.")).toBeTruthy();
  });
});
