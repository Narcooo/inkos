import type { ChapterSummary } from "../../../shared/contracts";
import { getLengthMetricUnitForLanguage, type LengthLanguage } from "../../utils/length-metrics";

const chapterDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatUpdatedAt(value: string): string {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return chapterDateFormatter.format(parsed);
}

interface ChapterListProps {
  readonly chapters: ReadonlyArray<ChapterSummary>;
  readonly selectedChapterNumber: number | null;
  readonly language?: LengthLanguage;
  readonly onSelectChapter: (chapterNumber: number) => void;
}

export function ChapterList({ chapters, selectedChapterNumber, language = "zh", onSelectChapter }: ChapterListProps) {
  return (
    <section className="panel chapter-list">
      <div className="panel__header">
        <div>
          <p className="panel__kicker">Draft navigator</p>
          <h3>Chapter path</h3>
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
            <span>{`${chapter.wordCount.toLocaleString()} draft ${getLengthMetricUnitForLanguage(chapter.wordCount, language)}`}</span>
            <span>{`Last updated ${formatUpdatedAt(chapter.updatedAt)}`}</span>
            <span className={`status-pill status-pill--${chapter.status}`}>{chapter.status}</span>
          </button>
        ))}
        {chapters.length === 0 ? <div className="empty-state">Use Write next in the inspector to draft chapter one, then pick it up here once it lands.</div> : null}
      </div>
    </section>
  );
}
