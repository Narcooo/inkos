import type { BookSummary } from "../../../shared/contracts";

interface BooksDashboardProps {
  readonly books: ReadonlyArray<BookSummary>;
  readonly onOpenBook: (bookId: string) => void;
}

export function BooksDashboard({ books, onOpenBook }: BooksDashboardProps) {
  return (
    <section className="panel books-dashboard">
      <div className="panel__header">
        <div>
          <p className="panel__kicker">Books</p>
          <h2>Library shelf</h2>
        </div>
        <p className="panel__copy">
          Use the shelf to switch books, review progress, and reopen a workspace when you need broader project
          management.
        </p>
      </div>
      <div className="books-dashboard__grid">
        {books.map((book) => (
          <article key={book.id} className="book-card">
            <div className="book-card__header">
              <p className="book-card__meta">{book.platform} · {book.genre}</p>
              <span className={`status-pill status-pill--${book.status}`}>{book.status}</span>
            </div>
            <h3>{book.title}</h3>
            <dl className="book-card__stats">
              <div>
                <dt>Chapter count</dt>
                <dd>{book.chapterCount}</dd>
              </div>
              <div>
                <dt>Pending review</dt>
                <dd>{book.pendingReviewChapters}</dd>
              </div>
              <div>
                <dt>Audit failed</dt>
                <dd>{book.failedChapters}</dd>
              </div>
            </dl>
            {book.recentRunStatus ? (
              <div className="book-card__run-status">
                <span className="book-card__run-label">Recent run</span>
                <span className={`status-pill status-pill--${book.recentRunStatus}`}>{book.recentRunStatus}</span>
              </div>
            ) : null}
            <button type="button" className="book-card__action" onClick={() => onOpenBook(book.id)}>
              Open workspace
            </button>
          </article>
        ))}
        {books.length === 0 ? <div className="empty-state">No books found in this InkOS project yet.</div> : null}
      </div>
    </section>
  );
}
