import {
  ChevronRight,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import type { TFunction } from "../../hooks/use-i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { formatRelativeTime, getSessionLabel } from "./session-helpers";
import type {
  DeleteTarget,
  RenameTarget,
  SidebarBookSummary,
  SidebarSession,
} from "./types";

interface SidebarBooksSectionProps {
  readonly activePage: string;
  readonly activeSessionId: string | null;
  readonly books: ReadonlyArray<SidebarBookSummary>;
  readonly expandedBooks: ReadonlySet<string>;
  readonly onCreateSession: (bookId: string) => void;
  readonly onNewBook: () => void;
  readonly onOpenSession: (bookId: string, sessionId: string) => void;
  readonly onRenameSession: (target: RenameTarget) => void;
  readonly onDeleteSession: (target: DeleteTarget) => void;
  readonly onToggleBook: (bookId: string) => void;
  readonly sessionsByBook: Record<string, ReadonlyArray<SidebarSession>>;
  readonly t: TFunction;
}

export function SidebarBooksSection({
  activePage,
  activeSessionId,
  books,
  expandedBooks,
  onCreateSession,
  onNewBook,
  onOpenSession,
  onRenameSession,
  onDeleteSession,
  onToggleBook,
  sessionsByBook,
  t,
}: SidebarBooksSectionProps) {
  return (
    <div>
      <div className="px-3 mb-3 flex items-center justify-center lg:justify-between">
        <span className="hidden text-[11px] uppercase tracking-widest text-muted-foreground font-semibold lg:inline">
          {t("nav.books")}
        </span>
        <button
          onClick={onNewBook}
          className="ios-pill flex items-center gap-1 px-2 py-1 text-[10px] text-muted-foreground hover:text-primary transition-all"
        >
          <Plus size={12} />
          <span className="hidden lg:inline">{t("nav.newBook")}</span>
        </button>
      </div>

      <div className="space-y-0.5">
        {books.map((book) => (
          <SidebarBookItem
            key={book.id}
            activePage={activePage}
            activeSessionId={activeSessionId}
            book={book}
            expanded={expandedBooks.has(book.id)}
            onCreateSession={onCreateSession}
            onDeleteSession={onDeleteSession}
            onOpenSession={onOpenSession}
            onRenameSession={onRenameSession}
            onToggleBook={onToggleBook}
            sessions={sessionsByBook[book.id] ?? []}
          />
        ))}

        {books.length === 0 && (
          <div className="hidden px-3 py-6 text-xs text-muted-foreground/50 italic text-center lg:block">
            {t("dash.noBooks")}
          </div>
        )}
      </div>
    </div>
  );
}

function SidebarBookItem({
  activePage,
  activeSessionId,
  book,
  expanded,
  onCreateSession,
  onDeleteSession,
  onOpenSession,
  onRenameSession,
  onToggleBook,
  sessions,
}: {
  readonly activePage: string;
  readonly activeSessionId: string | null;
  readonly book: SidebarBookSummary;
  readonly expanded: boolean;
  readonly onCreateSession: (bookId: string) => void;
  readonly onDeleteSession: (target: DeleteTarget) => void;
  readonly onOpenSession: (bookId: string, sessionId: string) => void;
  readonly onRenameSession: (target: RenameTarget) => void;
  readonly onToggleBook: (bookId: string) => void;
  readonly sessions: ReadonlyArray<SidebarSession>;
}) {
  const isActiveBook = activePage === `book:${book.id}`;

  return (
    <div>
      <div className="group/book flex items-center">
        <button
          type="button"
          onClick={() => onToggleBook(book.id)}
          className={`ios-nav-item flex min-w-0 flex-1 items-center justify-center gap-1.5 px-2.5 py-2 rounded-2xl text-sm transition-colors lg:justify-start ${
            isActiveBook ? "ios-nav-item-active text-foreground font-semibold" : "text-muted-foreground hover:text-foreground hover:bg-card/45"
          }`}
        >
          <ChevronRight
            size={12}
            className={`shrink-0 text-muted-foreground/60 transition-transform ${expanded ? "rotate-90" : ""}`}
          />
          <FolderOpen size={14} className="shrink-0 text-muted-foreground/60" />
          <span className="truncate flex-1 text-left">{book.title}</span>
        </button>
      </div>

      {expanded && (
        <div className="mt-0.5">
          {sessions.map((session) => (
            <SidebarSessionRow
              key={session.sessionId}
              active={isActiveBook && activeSessionId === session.sessionId}
              bookId={book.id}
              onDeleteSession={onDeleteSession}
              onOpenSession={onOpenSession}
              onRenameSession={onRenameSession}
              session={session}
            />
          ))}
          <button
            type="button"
            onClick={() => onCreateSession(book.id)}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground/60 hover:text-foreground transition-colors lg:pl-9 lg:pr-2"
          >
            <Plus size={12} />
            <span className="hidden lg:inline">新建会话</span>
          </button>
        </div>
      )}
    </div>
  );
}

function SidebarSessionRow({
  active,
  bookId,
  onDeleteSession,
  onOpenSession,
  onRenameSession,
  session,
}: {
  readonly active: boolean;
  readonly bookId: string;
  readonly onDeleteSession: (target: DeleteTarget) => void;
  readonly onOpenSession: (bookId: string, sessionId: string) => void;
  readonly onRenameSession: (target: RenameTarget) => void;
  readonly session: SidebarSession;
}) {
  const label = getSessionLabel(session);

  return (
    <div
      className={`group/session flex items-center rounded-xl ${active ? "bg-card/55 shadow-sm" : "hover:bg-card/35"}`}
    >
      <button
        type="button"
        onClick={() => onOpenSession(bookId, session.sessionId)}
        className="flex min-w-0 flex-1 items-center gap-2 pl-9 pr-2 py-1.5 text-left text-[13px] transition-colors"
      >
        <span className={`truncate flex-1 ${active ? "text-foreground" : "text-muted-foreground group-hover/session:text-foreground"}`}>
          {label}
        </span>
        {session.isStreaming ? (
          <Loader2 size={12} className="shrink-0 animate-spin text-primary" />
        ) : (
          <span className="shrink-0 text-[11px] text-muted-foreground/40">
            {formatRelativeTime(session.sessionId)}
          </span>
        )}
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger className="flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 group-hover/session:opacity-100 text-muted-foreground hover:text-foreground transition-opacity">
          <MoreHorizontal size={14} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-36">
          <DropdownMenuItem
            onClick={() => {
              onRenameSession({ sessionId: session.sessionId, currentTitle: label });
            }}
          >
            <Pencil size={14} />
            <span>改名</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onDeleteSession({ sessionId: session.sessionId, title: label })}
          >
            <Trash2 size={14} />
            <span>删除</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
