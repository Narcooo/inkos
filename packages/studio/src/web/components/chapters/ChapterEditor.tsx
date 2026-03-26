import { useEffect, useState } from "react";
import type { ChapterDetail, ChapterSummary } from "../../../shared/contracts";

interface ChapterEditorProps {
  readonly selectedChapter: ChapterSummary | null;
  readonly chapter: ChapterDetail | null;
  readonly saving: boolean;
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly onSave: (content: string) => Promise<void>;
}

export function ChapterEditor({ selectedChapter, chapter, saving, onDirtyChange, onSave }: ChapterEditorProps) {
  const [draft, setDraft] = useState(chapter?.content ?? "");

  useEffect(() => {
    setDraft(chapter?.content ?? "");
    onDirtyChange(false);
  }, [chapter?.number, chapter?.content, onDirtyChange]);

  const isDirty = chapter ? draft !== chapter.content : false;

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  return (
    <section className="panel chapter-reader">
      <div className="panel__header">
        <div>
          <p className="panel__kicker">Chapter editor</p>
          <h3>{selectedChapter ? `Chapter ${selectedChapter.number}: ${selectedChapter.title}` : "No chapter selected"}</h3>
          <p className="panel__copy">Editable manuscript view with explicit save and local draft tracking.</p>
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
            <span>{isDirty ? "Unsaved changes" : "All changes saved"}</span>
            <button type="button" disabled={!isDirty || saving} onClick={() => void onSave(draft)}>
              {saving ? "Saving..." : "Save chapter"}
            </button>
          </div>
        </>
      ) : (
        <div className="empty-state">Open a chapter to edit the current manuscript snapshot.</div>
      )}
    </section>
  );
}
