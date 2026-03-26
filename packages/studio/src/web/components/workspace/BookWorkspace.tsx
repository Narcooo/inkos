import type {
  BookDetail,
  ChapterDetail,
  ChapterSummary,
  TruthFileDetail,
  TruthFileSummary,
} from "../../../shared/contracts";
import type { WorkspaceTab } from "../../hooks/useStudioState";
import { ChapterEditor } from "../chapters/ChapterEditor";
import { ChapterList } from "../chapters/ChapterList";
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
  readonly chapterSaving: boolean;
  readonly reviewSubmitting: boolean;
  readonly onSelectTab: (tab: WorkspaceTab) => void;
  readonly onSelectChapter: (chapterNumber: number) => void;
  readonly onChapterDirtyChange: (dirty: boolean) => void;
  readonly onSaveChapter: (content: string) => Promise<void>;
  readonly onApproveReview: () => Promise<void>;
  readonly onRejectReview: (reason?: string) => Promise<void>;
  readonly onSelectTruthFile: (name: string) => void;
}

const TABS: ReadonlyArray<{ value: WorkspaceTab; label: string }> = [
  { value: "review", label: "Review" },
  { value: "chapters", label: "Chapters" },
  { value: "truth-files", label: "Truth Files" },
  { value: "runs", label: "Runs" },
];

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
  chapterSaving,
  reviewSubmitting,
  onSelectTab,
  onSelectChapter,
  onChapterDirtyChange,
  onSaveChapter,
  onApproveReview,
  onRejectReview,
  onSelectTruthFile,
}: BookWorkspaceProps) {
  return (
    <section className="workspace">
      <header className="panel workspace__hero">
        <div>
          <p className="panel__kicker">Workspace</p>
          <h2>{book.title}</h2>
          <p className="panel__copy">Review cockpit with chapter saves and review decisions; everything else stays read-only.</p>
        </div>
        <dl className="workspace__stats">
          <div>
            <dt>Pending review</dt>
            <dd>{book.pendingReviewChapters}</dd>
          </div>
          <div>
            <dt>Approved</dt>
            <dd>{book.approvedChapters}</dd>
          </div>
          <div>
            <dt>Latest</dt>
            <dd>{book.lastChapterNumber || "-"}</dd>
          </div>
        </dl>
      </header>
      <div className="workspace__tabs" role="tablist" aria-label="Workspace tabs">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={tab.value === activeTab}
            className={tab.value === activeTab ? "workspace__tab workspace__tab--active" : "workspace__tab"}
            onClick={() => void onSelectTab(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="workspace__layout">
        <ChapterList
          chapters={chapters}
          selectedChapterNumber={selectedChapterNumber}
          onSelectChapter={onSelectChapter}
        />
        {activeTab === "review" ? (
          <ReviewPanel
            selectedChapter={selectedChapter}
            chapter={chapterDetail}
            submitting={reviewSubmitting}
            onApprove={onApproveReview}
            onReject={onRejectReview}
          />
        ) : null}
        {activeTab === "chapters" ? (
          <ChapterEditor
            selectedChapter={selectedChapter}
            chapter={chapterDetail}
            saving={chapterSaving}
            onDirtyChange={onChapterDirtyChange}
            onSave={onSaveChapter}
          />
        ) : null}
        {activeTab === "truth-files" ? (
          <TruthFilesViewer
            truthFiles={truthFiles}
            selectedTruthFile={selectedTruthFile}
            truthFile={truthFile}
            onSelectTruthFile={onSelectTruthFile}
          />
        ) : null}
        {activeTab === "runs" ? (
          <RunConsole bookId={book.id} chapterNumber={selectedChapterNumber} />
        ) : null}
      </div>
    </section>
  );
}
