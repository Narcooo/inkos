import type { ChapterDetail, ChapterSummary } from "../../../shared/contracts";

interface ChapterReaderProps {
  readonly selectedChapter: ChapterSummary | null;
  readonly chapter: ChapterDetail | null;
}

export function ChapterReader({ selectedChapter, chapter }: ChapterReaderProps) {
  return (
    <section className="panel chapter-reader">
      <div className="panel__header">
        <div>
          <p className="panel__kicker">Chapter text</p>
          <h3>{selectedChapter ? `Chapter ${selectedChapter.number}: ${selectedChapter.title}` : "No chapter selected"}</h3>
          <p className="panel__copy">Manuscript reading view with chapter metadata and full copy.</p>
        </div>
        {selectedChapter ? <span className={`status-pill status-pill--${selectedChapter.status}`}>{selectedChapter.status}</span> : null}
      </div>
      {chapter ? (
        <>
          <div className="chapter-reader__meta">
            <span>{chapter.wordCount} words</span>
            <span>{chapter.fileName ?? "No source file"}</span>
            <span>{chapter.updatedAt}</span>
          </div>
          <pre className="chapter-reader__content">{chapter.content}</pre>
        </>
      ) : (
        <div className="empty-state">Open a chapter to read the current manuscript snapshot.</div>
      )}
    </section>
  );
}
