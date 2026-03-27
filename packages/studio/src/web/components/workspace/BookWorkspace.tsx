import { useEffect, useState } from "react";
import type {
  BookDetail,
  ChapterDetail,
  ChapterSummary,
  TruthFileDetail,
  TruthFileSummary,
} from "../../../shared/contracts";
import type { WorkspaceTab } from "../../hooks/useStudioState";
import type { LengthLanguage } from "../../utils/length-metrics";
import { ChapterEditor } from "../chapters/ChapterEditor";
import { ChapterList } from "../chapters/ChapterList";
import { NotesPanel } from "../notes/NotesPanel";
import { ReviewPanel } from "../review/ReviewPanel";
import { RunConsole } from "../runs/RunConsole";
import { TruthFilesViewer } from "../truth/TruthFilesViewer";

interface BookWorkspaceProps {
  readonly book: BookDetail;
  readonly activeTab: WorkspaceTab;
  readonly chapters: ReadonlyArray<ChapterSummary>;
  readonly selectedChapterNumber: number | null;
  readonly selectedChapter: ChapterSummary | null;
  readonly chapterDetail: ChapterDetail | null;
  readonly truthFiles: ReadonlyArray<TruthFileSummary>;
  readonly selectedTruthFile: TruthFileSummary | null;
  readonly truthFile: TruthFileDetail | null;
  readonly chapterDirty: boolean;
  readonly chapterSaving: boolean;
  readonly reviewSubmitting: boolean;
  readonly onSelectTab: (tab: WorkspaceTab) => void;
  readonly onSelectChapter: (chapterNumber: number) => void;
  readonly onChapterDirtyChange: (dirty: boolean) => void;
  readonly onChapterDraftWordCountChange: (wordCount: number | null) => void;
  readonly onSaveChapter: (content: string) => Promise<void>;
  readonly onApproveReview: () => Promise<void>;
  readonly onRejectReview: (reason?: string) => Promise<void>;
  readonly onSelectTruthFile: (name: string) => void;
}

type InspectorSection = "review" | "context" | "notes" | "runs";

function deriveInspectorSection(activeTab: WorkspaceTab): InspectorSection | null {
  if (activeTab === "review") {
    return "review";
  }

  if (activeTab === "truth-files") {
    return "context";
  }

  if (activeTab === "runs") {
    return "runs";
  }

  return null;
}

export function BookWorkspace({
  book,
  activeTab,
  chapters,
  selectedChapterNumber,
  selectedChapter,
  chapterDetail,
  truthFiles,
  selectedTruthFile,
  truthFile,
  chapterDirty,
  chapterSaving,
  reviewSubmitting,
  onSelectTab,
  onSelectChapter,
  onChapterDirtyChange,
  onChapterDraftWordCountChange,
  onSaveChapter,
  onApproveReview,
  onRejectReview,
  onSelectTruthFile,
}: BookWorkspaceProps) {
  const showWriteNextPath = chapters.length === 0 && selectedChapter === null;
  const [focusedInspectorSection, setFocusedInspectorSection] = useState<InspectorSection | null>(deriveInspectorSection(activeTab));

  useEffect(() => {
    const nextSection = deriveInspectorSection(activeTab);
    if (nextSection !== null) {
      setFocusedInspectorSection(nextSection);
    }
  }, [activeTab]);

  const activeInspectorSection = focusedInspectorSection;
  const inspectorFocusLabel =
    activeInspectorSection === "review"
      ? "Review in focus"
      : activeInspectorSection === "context"
        ? "Context in focus"
        : activeInspectorSection === "runs"
          ? "Runs in focus"
          : activeInspectorSection === "notes"
            ? "Notes in focus"
          : "Inspector support sections stay nearby";

  function focusInspectorSection(section: InspectorSection) {
    setFocusedInspectorSection(section);

    if (section === "review") {
      void onSelectTab("review");
    }

    if (section === "context") {
      void onSelectTab("truth-files");
    }

    if (section === "runs") {
      void onSelectTab("runs");
    }
  }

  return (
    <section className="workspace">
      <div className="workspace__topbar">
        <div>
          <p className="panel__kicker">Writing desk</p>
          <p className="workspace__topbar-copy">Keep the manuscript in the center lane and use the inspector for nearby context.</p>
        </div>
        <div className="workspace__topbar-support" aria-label="Inspector summary">
          <span className="workspace__support-pill">Review</span>
          <span className="workspace__support-pill">Context</span>
          <span className="workspace__support-pill">Notes</span>
          <span className="workspace__support-pill">Runs</span>
          <span className="workspace__support-copy">{inspectorFocusLabel}</span>
        </div>
      </div>
      <div className="workspace__layout workspace__layout--manuscript-priority">
        <section className="workspace__zone workspace__navigator">
          <div className="workspace__zone-heading">
            <p className="panel__kicker">Navigator</p>
            <h3>Chapter path</h3>
          </div>
            <ChapterList
              chapters={chapters}
              selectedChapterNumber={selectedChapterNumber}
              language={(book.language as LengthLanguage | undefined) ?? undefined}
              onSelectChapter={onSelectChapter}
            />
        </section>
        <section className="workspace__zone workspace__manuscript workspace__zone--primary">
          <div className="workspace__zone-heading">
            <p className="panel__kicker">Manuscript</p>
            <h3>Center draft</h3>
          </div>
          <ChapterEditor
            selectedChapter={selectedChapter}
            chapter={chapterDetail}
            language={book.language ?? undefined}
            saving={chapterSaving}
            onDirtyChange={onChapterDirtyChange}
            onDraftWordCountChange={onChapterDraftWordCountChange}
            onSave={onSaveChapter}
          />
        </section>
        <aside className="workspace__zone workspace__inspector workspace__zone--secondary">
          <div className="workspace__zone-heading">
            <p className="panel__kicker">Inspector</p>
            <h3>Support stack</h3>
          </div>
          <div className="workspace__inspector-focus" role="toolbar" aria-label="Inspector focus controls">
            <button
              type="button"
              className={activeInspectorSection === "review" ? "workspace__inspector-focus-button workspace__inspector-focus-button--active" : "workspace__inspector-focus-button"}
              aria-pressed={activeInspectorSection === "review"}
              onClick={() => focusInspectorSection("review")}
            >
              Focus review
            </button>
            <button
              type="button"
              className={activeInspectorSection === "context" ? "workspace__inspector-focus-button workspace__inspector-focus-button--active" : "workspace__inspector-focus-button"}
              aria-pressed={activeInspectorSection === "context"}
              onClick={() => focusInspectorSection("context")}
            >
              Focus context
            </button>
            <button
              type="button"
              className={activeInspectorSection === "notes" ? "workspace__inspector-focus-button workspace__inspector-focus-button--active" : "workspace__inspector-focus-button"}
              aria-pressed={activeInspectorSection === "notes"}
              onClick={() => focusInspectorSection("notes")}
            >
              Focus notes
            </button>
            <button
              type="button"
              className={activeInspectorSection === "runs" ? "workspace__inspector-focus-button workspace__inspector-focus-button--active" : "workspace__inspector-focus-button"}
              aria-pressed={activeInspectorSection === "runs"}
              onClick={() => focusInspectorSection("runs")}
            >
              Focus runs
            </button>
          </div>
          <div className="workspace__inspector-stack" role="group" aria-label="Inspector support sections">
            <div className={activeInspectorSection === "review" ? "workspace__inspector-section workspace__inspector-section--active" : "workspace__inspector-section"}>
              <ReviewPanel
                selectedChapter={selectedChapter}
                chapter={chapterDetail}
                submitting={reviewSubmitting}
                language={book.language ?? undefined}
                compact
                showWriteNextPath={showWriteNextPath}
                onOpenRuns={() => void onSelectTab("runs")}
                onApprove={onApproveReview}
                onReject={onRejectReview}
              />
            </div>
            <div className={activeInspectorSection === "context" ? "workspace__inspector-section workspace__inspector-section--active" : "workspace__inspector-section"}>
              <TruthFilesViewer
                truthFiles={truthFiles}
                selectedTruthFile={selectedTruthFile}
                truthFile={truthFile}
                compact
                showWriteNextPath={showWriteNextPath}
                onOpenRuns={() => void onSelectTab("runs")}
                onSelectTruthFile={onSelectTruthFile}
              />
            </div>
            <div className={activeInspectorSection === "notes" ? "workspace__inspector-section workspace__inspector-section--active" : "workspace__inspector-section"}>
              <NotesPanel />
            </div>
            <div className={activeInspectorSection === "runs" ? "workspace__inspector-section workspace__inspector-section--active" : "workspace__inspector-section"}>
              <RunConsole
                bookId={book.id}
                chapterNumber={selectedChapterNumber}
                actionsBlockedReason={chapterDirty ? "Save or discard manuscript changes before running desk actions." : null}
              />
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
