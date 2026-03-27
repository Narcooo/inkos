import { useEffect, useState } from "react";
import type { ChapterDetail, ChapterSummary } from "../../../shared/contracts";
import { formatLengthMetric, type LengthLanguage } from "../../utils/length-metrics";

interface ReviewPanelProps {
  readonly selectedChapter: ChapterSummary | null;
  readonly chapter: ChapterDetail | null;
  readonly submitting: boolean;
  readonly language?: LengthLanguage;
  readonly compact?: boolean;
  readonly showWriteNextPath?: boolean;
  readonly onOpenRuns?: () => void;
  readonly onApprove: () => Promise<void>;
  readonly onReject: (reason?: string) => Promise<void>;
}

export function ReviewPanel({
  selectedChapter,
  chapter,
  submitting,
  language = "zh",
  compact = false,
  showWriteNextPath = false,
  onOpenRuns,
  onApprove,
  onReject,
}: ReviewPanelProps) {
  const [reason, setReason] = useState(chapter?.reviewNote ?? "");

  useEffect(() => {
    setReason(chapter?.reviewNote ?? "");
  }, [chapter?.number, chapter?.reviewNote]);

  return (
    <section className="panel review-panel">
      <div className="panel__header">
        <div>
          <p className="panel__kicker">Support section</p>
          <h3>Review</h3>
          <p className="panel__copy">{selectedChapter ? `Chapter ${selectedChapter.number} audit and approval.` : "No chapter selected for review."}</p>
        </div>
        {selectedChapter ? <span className={`status-pill status-pill--${selectedChapter.status}`}>{selectedChapter.status}</span> : null}
      </div>
      {chapter ? (
        <>
          <div className="review-panel__meta">
            <span>{formatLengthMetric(chapter.wordCount, language)}</span>
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
                rows={compact ? 3 : 4}
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
          {compact ? null : <pre className="review-panel__content">{chapter.content}</pre>}
        </>
      ) : (
        <div className="empty-state">
          <p>{showWriteNextPath ? "No chapter yet. Open Runs to use Write next, then come back here for review." : "Open a chapter to inspect its review copy."}</p>
          {showWriteNextPath && onOpenRuns ? (
            <button type="button" onClick={onOpenRuns}>
              Open runs
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
