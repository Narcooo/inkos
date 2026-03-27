import { FactoryHome } from "./components/home/FactoryHome";
import { HealthView } from "./components/health/HealthView";
import { CreationLauncher } from "./components/launcher/CreationLauncher";
import { StudioShell } from "./components/layout/StudioShell";
import { BookWorkspace } from "./components/workspace/BookWorkspace";
import { useStudioState } from "./hooks/useStudioState";
import { formatLengthMetric, getLengthMetricLabel } from "./utils/length-metrics";

export function App() {
  const state = useStudioState();
  const shellSubtitle =
    state.activeView === "workspace"
      ? "Open to the live manuscript, with review and reference close at hand."
      : state.activeView === "launcher"
        ? "Shape the intake, confirm setup, and hand the project toward the desk."
      : state.activeView === "dashboard"
        ? "Start from the factory home, then step into the writing desk when a project needs focused work."
        : "Writing-desk access to the live InkOS workspace.";
  const viewLabel =
    state.activeView === "workspace" && state.selectedBook
      ? `${state.selectedBook.title} manuscript`
      : state.activeView === "launcher"
        ? "Launcher"
      : state.activeView === "dashboard"
        ? "Home"
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
  const refreshBlocked = state.chapterSaving || state.reviewSubmitting || Boolean(state.creationProject);

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
        <FactoryHome
          books={state.books}
          selectedBook={state.selectedBook}
          bootstrapStatus={state.bootstrapStatus}
          onOpenBook={(bookId) => void state.openBook(bookId)}
          onStartCreation={state.startCreationLauncher}
        />
      ) : null}
      {state.activeView === "launcher" && state.creationLauncherMode ? (
        <CreationLauncher
          draft={state.creationDraft!}
          health={state.health}
          bootstrapStatus={state.bootstrapStatus}
          creationBootstrap={state.creationBootstrap}
          creationProject={state.creationProject}
          onBackHome={state.exitCreationLauncher}
          onDraftChange={state.updateCreationDraft}
          onNormalizeIdea={() => state.normalizeIdeaDraft()}
          onSummarizeUpload={() => state.summarizeUploadDraft()}
          onStartBootstrap={() => state.startCreationBootstrap()}
          onComplete={state.completeCreationLauncher}
        />
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
