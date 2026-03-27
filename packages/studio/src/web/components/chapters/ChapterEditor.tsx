import { useEffect, useState } from "react";
import type { ChapterDetail, ChapterSummary } from "../../../shared/contracts";
import { countChapterLength, formatLengthMetric, resolveLengthCountingMode, type LengthLanguage } from "../../utils/length-metrics";

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

function countDraftWords(content: string, language: LengthLanguage): number {
  return countChapterLength(content, resolveLengthCountingMode(language));
}

interface ChapterEditorProps {
  readonly selectedChapter: ChapterSummary | null;
  readonly chapter: ChapterDetail | null;
  readonly language?: LengthLanguage;
  readonly saving: boolean;
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly onDraftWordCountChange: (wordCount: number | null) => void;
  readonly onSave: (content: string) => Promise<void>;
}

export function ChapterEditor({ selectedChapter, chapter, language = "zh", saving, onDirtyChange, onDraftWordCountChange, onSave }: ChapterEditorProps) {
  const [draft, setDraft] = useState(chapter?.content ?? "");

  useEffect(() => {
    setDraft(chapter?.content ?? "");
    onDirtyChange(false);
  }, [chapter?.number, chapter?.content, onDirtyChange]);

  const isDirty = chapter ? draft !== chapter.content : false;
  const saveMessage = saving ? "Saving the draft..." : isDirty ? "Draft in progress" : "Draft saved to manuscript";
  const regionLabel = selectedChapter ? `Chapter ${selectedChapter.number} manuscript` : "Empty manuscript desk";
  const draftWordCount = countDraftWords(draft, language);

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    onDraftWordCountChange(chapter ? draftWordCount : null);
  }, [chapter, draftWordCount, onDraftWordCountChange]);

  return (
    <section className="panel chapter-reader" aria-label={regionLabel}>
      <div className="panel__header">
        <div>
          <p className="panel__kicker">Drafting desk</p>
          <h3>{selectedChapter ? `Chapter ${selectedChapter.number}: ${selectedChapter.title}` : "Ready for chapter one"}</h3>
          <p className="panel__copy">Shape the live manuscript here, with the chapter title, draft state, and word count kept in view.</p>
        </div>
        {selectedChapter ? <span className={`status-pill status-pill--${selectedChapter.status}`}>{selectedChapter.status}</span> : null}
      </div>
      {chapter ? (
        <>
          <dl className="chapter-reader__meta" aria-label="Manuscript context">
            <div>
              <dt>Manuscript status</dt>
              <dd>{saveMessage}</dd>
            </div>
            <div>
              <dt>Draft length</dt>
              <dd>{formatLengthMetric(draftWordCount, language, { context: "draft" })}</dd>
            </div>
            <div>
              <dt>Source file</dt>
              <dd>{chapter.fileName ?? "No source file"}</dd>
            </div>
            <div>
              <dt>Last updated</dt>
              <dd>{formatUpdatedAt(chapter.updatedAt)}</dd>
            </div>
          </dl>
          <label>
            <span className="sr-only">Chapter markdown</span>
            <textarea
              aria-label="Chapter markdown"
              className="chapter-editor__input"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
              }}
              spellCheck={false}
              rows={20}
            />
          </label>
          <div className="chapter-editor__actions">
            <span>{saveMessage}</span>
            <button type="button" disabled={!isDirty || saving} onClick={() => void onSave(draft)}>
              {saving ? "Saving..." : "Save chapter"}
            </button>
          </div>
        </>
      ) : (
        <div className="empty-state">Start writing chapter one from the inspector with Write next, then return here to keep drafting.</div>
      )}
    </section>
  );
}
