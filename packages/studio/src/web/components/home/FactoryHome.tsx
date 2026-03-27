import type { BookDetail, BookSummary, BootstrapStatus } from "../../../shared/contracts";
import { isStageALauncherReady } from "../../utils/stage-a-readiness";
import { QuickStartPrompt } from "./QuickStartPrompt";
import { UploadIntake } from "./UploadIntake";

interface FactoryHomeProps {
  readonly books: ReadonlyArray<BookSummary>;
  readonly selectedBook: BookDetail | null;
  readonly bootstrapStatus: BootstrapStatus | null;
  readonly onOpenBook: (bookId: string) => void;
  readonly onStartCreation: (mode: "idea" | "upload") => void;
}

function formatProvider(provider: string | null | undefined): string {
  if (!provider) {
    return "AI provider";
  }

  return provider === "openai" ? "OpenAI" : provider;
}

function getReadinessHint(bootstrapStatus: BootstrapStatus | null): string {
  if (isStageALauncherReady(bootstrapStatus)) {
    return `Studio is ready. ${formatProvider(bootstrapStatus?.health.provider)} · ${bootstrapStatus?.health.model} is connected for this workspace.`;
  }

  return bootstrapStatus?.readiness.message ?? "Readiness hint: finish project config and environment setup before launching a new run.";
}

function getRecentProjects(books: ReadonlyArray<BookSummary>, selectedBook: BookDetail | null): Array<BookSummary> {
  const recent = [...books];
  if (!selectedBook) {
    return recent.slice(0, 3);
  }

  const selectedBookSummary = recent.find((book) => book.id === selectedBook.id);
  if (!selectedBookSummary) {
    return recent.slice(0, 3);
  }

  const withoutSelected = recent.filter((book) => book.id !== selectedBook.id);
  return [selectedBookSummary, ...withoutSelected].slice(0, 3);
}

export function FactoryHome({ books, selectedBook, bootstrapStatus, onOpenBook, onStartCreation }: FactoryHomeProps) {
  const recentProjects = getRecentProjects(books, selectedBook);

  return (
    <section className="factory-home panel">
      <div className="factory-home__hero">
        <div>
          <p className="panel__kicker">Factory home</p>
          <h2>AI Novel Factory</h2>
          <p className="panel__copy">
            Start from an idea, feed the factory your source material, and move into the writer desk only when a
            project needs focused drafting.
          </p>
        </div>
        <p className="factory-home__hint">{getReadinessHint(bootstrapStatus)}</p>
      </div>

      <div className="factory-home__actions">
        <QuickStartPrompt
          title="一句话开始创作"
          copy="Turn a one-line premise into a guided novel setup without leaving the studio home."
          actionLabel="一句话开始创作"
          onAction={() => onStartCreation("idea")}
        />
        <UploadIntake
          title="上传资料开始创作"
          copy="Start from outlines, briefs, or reference packets once the launcher intake lands."
          actionLabel="上传资料开始创作"
          onAction={() => onStartCreation("upload")}
        />
      </div>

      <aside className="factory-home__recent" aria-label="Recent projects">
        <div className="factory-home__recent-header">
          <div>
            <p className="factory-home__secondary-label">Secondary</p>
            <h3>继续上次创作</h3>
          </div>
          <p className="factory-home__recent-copy">Recent projects stay close, but the factory launch comes first.</p>
        </div>

        {recentProjects.length > 0 ? (
          <div className="factory-home__recent-list">
            {recentProjects.map((book) => (
              <button
                key={book.id}
                type="button"
                className="factory-home__recent-card"
                onClick={() => onOpenBook(book.id)}
              >
                <span className="factory-home__recent-title">{book.title}</span>
                <span className="factory-home__recent-meta">
                  {book.chapterCount} chapters · {book.pendingReviewChapters} pending review
                </span>
                <span className="factory-home__recent-action">Continue {book.title}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-state">No recent projects yet. Use the factory prompts above to start the first one.</div>
        )}
      </aside>
    </section>
  );
}
