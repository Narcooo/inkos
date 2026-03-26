import { useEffect, useState } from "react";
import type { ChapterDetail, ChapterSummary } from "../../../shared/contracts";

interface ReviewPanelProps {
  readonly selectedChapter: ChapterSummary | null;
  readonly chapter: ChapterDetail | null;
  readonly submitting: boolean;
  readonly onApprove: () => Promise<void>;
  readonly onReject: (reason?: string) => Promise<void>;
}

export function ReviewPanel({ selectedChapter, chapter, submitting, onApprove, onReject }: ReviewPanelProps) {
  const [reason, setReason] = useState(chapter?.reviewNote ?? "");

  useEffect(() => {
    setReason(chapter?.reviewNote ?? "");
  }, [chapter?.number, chapter?.reviewNote]);

  return (
    <section className="panel review-panel">
      <div className="panel__header">
        <div>
          <p className="panel__kicker">Review</p>
          <h3>{selectedChapter ? `Chapter ${selectedChapter.number}` : "No chapter selected"}</h3>
        </div>
        {selectedChapter ? <span className={`status-pill status-pill--${selectedChapter.status}`}>{selectedChapter.status}</span> : null}
      </div>
      {chapter ? (
        <>
          <div className="review-panel__meta">
            <span>{chapter.wordCount} words</span>
            <span>{chapter.auditIssueCount} audit issues</span>
          </div>
          <div className="review-panel__issues">
            <h4>Audit issues</h4>
            {chapter.auditIssues.length > 0 ? (
              <ul>
                {chapter.auditIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            ) : (
              <p className="review-panel__issues-empty">No audit issues recorded for this chapter.</p>
            )}
          </div>
          {chapter.reviewNote ? <blockquote className="review-panel__note">{chapter.reviewNote}</blockquote> : null}
          <div className="review-panel__actions">
            <label>
              <span>Review note</span>
              <textarea
                aria-label="Review note"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={4}
              />
            </label>
            <div>
              <button type="button" disabled={submitting} onClick={() => void onApprove()}>
                {submitting ? "Working..." : "Approve chapter"}
              </button>
              <button type="button" disabled={submitting} onClick={() => void onReject(reason.trim() || undefined)}>
                Reject chapter
              </button>
            </div>
          </div>
          <pre className="review-panel__content">{chapter.content}</pre>
        </>
      ) : (
        <div className="empty-state">Open a chapter to inspect its review copy.</div>
      )}
    </section>
  );
}
