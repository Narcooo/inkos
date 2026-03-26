import { BooksDashboard } from "./components/books/BooksDashboard";
import { HealthView } from "./components/health/HealthView";
import { StudioShell } from "./components/layout/StudioShell";
import { BookWorkspace } from "./components/workspace/BookWorkspace";
import { useStudioState } from "./hooks/useStudioState";

export function App() {
  const state = useStudioState();

  return (
    <StudioShell
      subtitle="Review-first access to the live InkOS workspace."
      loading={state.loading}
      error={state.error}
      onOpenDashboard={state.showDashboard}
      onOpenHealth={state.showHealth}
      viewLabel={state.activeView === "workspace" && state.selectedBook ? state.selectedBook.title : state.activeView}
      actions={
        <button type="button" onClick={() => void state.refresh()}>
          Refresh
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
          chapterSaving={state.chapterSaving}
          reviewSubmitting={state.reviewSubmitting}
          onSelectTab={(tab) => void state.selectTab(tab)}
          onSelectChapter={(chapterNumber) => void state.selectChapter(chapterNumber)}
          onChapterDirtyChange={state.setChapterDirty}
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
