import { useState, useEffect } from "react";
import type { Theme } from "../../hooks/use-theme";
import type { TFunction } from "../../hooks/use-i18n";
import type { SSEMessage } from "../../hooks/use-sse";
import { useChatStore } from "../../store/chat";
import { fetchJson } from "../../hooks/use-api";
import { PanelRightClose, PanelRightOpen, ArrowLeft, Loader2 } from "lucide-react";
import { ProgressSection } from "../sidebar/ProgressSection";
import { FoundationSection } from "../sidebar/FoundationSection";
import { SummarySection } from "../sidebar/SummarySection";
import { ChaptersSection } from "../sidebar/ChaptersSection";

export interface BookSidebarProps {
  readonly bookId: string;
  readonly theme: Theme;
  readonly t: TFunction;
  readonly sse: { messages: ReadonlyArray<SSEMessage>; connected: boolean };
}

const FOUNDATION_LABELS: Record<string, string> = {
  "story_bible.md": "世界观设定",
  "volume_outline.md": "卷纲规划",
  "book_rules.md": "叙事规则",
  "current_state.md": "状态卡",
  "pending_hooks.md": "伏笔池",
  "subplot_board.md": "支线进度",
  "emotional_arcs.md": "情感弧线",
  "character_matrix.md": "角色矩阵",
};

function ArtifactView({ bookId }: { readonly bookId: string }) {
  const artifactFile = useChatStore((s) => s.artifactFile);
  const closeArtifact = useChatStore((s) => s.closeArtifact);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!artifactFile) return;
    setLoading(true);
    fetchJson<{ content: string | null }>(`/books/${bookId}/truth/${artifactFile}`)
      .then((data) => setContent(data.content ?? ""))
      .catch(() => setContent(null))
      .finally(() => setLoading(false));
  }, [bookId, artifactFile]);

  const label = artifactFile ? FOUNDATION_LABELS[artifactFile] ?? artifactFile : "";

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/20 shrink-0">
        <button
          onClick={closeArtifact}
          className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
        >
          <ArrowLeft size={14} />
        </button>
        <span className="text-sm font-medium truncate">{label}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={16} className="text-muted-foreground animate-spin" />
          </div>
        ) : content === null ? (
          <p className="text-xs text-muted-foreground/50 italic">文件不存在</p>
        ) : (
          <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-sm leading-7 [&_table]:text-xs [&_h2]:text-sm [&_h3]:text-xs">
            {content}
          </div>
        )}
      </div>
    </div>
  );
}

function PanelView({ bookId, theme: _theme, t, sse }: BookSidebarProps) {
  const isZh = t("nav.connected") === "\u5DF2\u8FDE\u63A5";

  return (
    <div className="flex flex-col gap-2 p-3">
      <ProgressSection sse={sse} />
      <FoundationSection bookId={bookId} />
      <SummarySection bookId={bookId} />
      <ChaptersSection bookId={bookId} isZh={isZh} />
    </div>
  );
}

export function BookSidebar({ bookId, theme, t, sse }: BookSidebarProps) {
  const sidebarView = useChatStore((s) => s.sidebarView);

  return (
    <aside className="hidden lg:flex w-[300px] shrink-0 flex-col bg-background/30 backdrop-blur-sm overflow-y-auto">
      {sidebarView === "artifact" ? (
        <ArtifactView bookId={bookId} />
      ) : (
        <PanelView bookId={bookId} theme={theme} t={t} sse={sse} />
      )}
    </aside>
  );
}

export function BookSidebarToggle({ bookId, theme, t, sse }: BookSidebarProps) {
  const [open, setOpen] = useState(false);
  const sidebarView = useChatStore((s) => s.sidebarView);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed right-3 top-[72px] z-20 lg:hidden w-8 h-8 rounded-lg bg-card border border-border/40 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
      >
        <PanelRightOpen size={14} />
      </button>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
          <aside
            className="absolute right-0 top-0 h-full w-[300px] bg-background border-l border-border/20 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/20">
              <span className="text-xs font-medium text-muted-foreground">书籍信息</span>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <PanelRightClose size={14} />
              </button>
            </div>
            {sidebarView === "artifact" ? (
              <ArtifactView bookId={bookId} />
            ) : (
              <PanelView bookId={bookId} theme={theme} t={t} sse={sse} />
            )}
          </aside>
        </div>
      )}
    </>
  );
}
