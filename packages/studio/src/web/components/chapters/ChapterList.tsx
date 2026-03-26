import type { ChapterSummary } from "../../../shared/contracts";

interface ChapterListProps {
  readonly chapters: ReadonlyArray<ChapterSummary>;
  readonly selectedChapterNumber: number | null;
  readonly onSelectChapter: (chapterNumber: number) => void;
}

export function ChapterList({ chapters, selectedChapterNumber, onSelectChapter }: ChapterListProps) {
  return (
    <section className="panel chapter-list">
      <div className="panel__header">
        <div>
          <p className="panel__kicker">Chapters</p>
          <h3>Sequence</h3>
        </div>
      </div>
      <div className="chapter-list__items">
        {chapters.map((chapter) => (
          <button
            key={chapter.number}
            type="button"
            className={chapter.number === selectedChapterNumber ? "chapter-list__item chapter-list__item--selected" : "chapter-list__item"}
            onClick={() => void onSelectChapter(chapter.number)}
          >
            <span className="chapter-list__number">{chapter.number.toString().padStart(2, "0")}</span>
            <span className="chapter-list__title">{chapter.title}</span>
            <span className={`status-pill status-pill--${chapter.status}`}>{chapter.status}</span>
          </button>
        ))}
        {chapters.length === 0 ? <div className="empty-state">No indexed chapters yet.</div> : null}
      </div>
    </section>
  );
}
