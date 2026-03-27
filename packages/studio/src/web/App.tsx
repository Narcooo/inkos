import { BooksDashboard } from "./components/books/BooksDashboard";
import { HealthView } from "./components/health/HealthView";
import { StudioShell } from "./components/layout/StudioShell";
import { BookWorkspace } from "./components/workspace/BookWorkspace";
import { useStudioState } from "./hooks/useStudioState";
import { formatLengthMetric, getLengthMetricLabel } from "./utils/length-metrics";

export function App() {
  const state = useStudioState();
  const shellSubtitle =
    state.activeView === "workspace"
      ? "Open to the live manuscript, with review and reference close at hand."
      : "Writing-desk access to the live InkOS workspace.";
  const viewLabel =
    state.activeView === "workspace" && state.selectedBook
      ? `${state.selectedBook.title} manuscript`
      : state.activeView === "dashboard"
        ? "Shelf"
        : "System";
  const wordCount = state.chapterDraftWordCount ?? state.chapter?.wordCount ?? state.selectedChapter?.wordCount ?? null;
  const lengthLanguage = state.selectedBook?.language === "en" ? "en" : "zh";
  const saveState = state.chapterSaving ? "Saving draft..." : state.chapterDirty ? "Unsaved changes" : "All changes saved";
  const metadata =
    state.activeView === "workspace" && state.selectedBook
      ? [
          { label: "Book", value: state.selectedBook.title },
          {
            label: "Chapter",
            value: state.selectedChapter
              ? `Chapter ${state.selectedChapter.number}: ${state.selectedChapter.title}`
              : "No chapter selected",
          },
          { label: "Save", value: saveState },
          {
            label: getLengthMetricLabel(lengthLanguage),
            value: wordCount === null ? `No chapter ${getLengthMetricLabel(lengthLanguage).toLowerCase()} yet` : formatLengthMetric(wordCount, lengthLanguage),
          },
        ]
      : [];
  const refreshBlocked = state.chapterSaving || state.reviewSubmitting;

  return (
    <StudioShell
      subtitle={shellSubtitle}
      loading={state.loading}
      error={state.error}
      onOpenDashboard={state.showDashboard}
      onOpenHealth={state.showHealth}
      viewLabel={viewLabel}
      metadata={metadata}
      actions={
        <button type="button" onClick={() => void state.refresh()} disabled={refreshBlocked}>
          Refresh desk
        </button>
      }
    >
      {state.activeView === "dashboard" ? (
        <BooksDashboard books={state.books} onOpenBook={(bookId) => void state.openBook(bookId)} />
      ) : null}
      {state.activeView === "workspace" && state.selectedBook ? (
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
      ) : null}
      {state.activeView === "health" ? <HealthView health={state.health} /> : null}
    </StudioShell>
  );
}
