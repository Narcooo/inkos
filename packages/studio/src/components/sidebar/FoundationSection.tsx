import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { useChatStore } from "../../store/chat";
import { fetchJson } from "../../hooks/use-api";
import { SidebarCard } from "./SidebarCard";

const FOUNDATION_FILES: ReadonlyArray<{ file: string; label: string }> = [
  { file: "story_bible.md", label: "世界观设定" },
  { file: "volume_outline.md", label: "卷纲规划" },
  { file: "book_rules.md", label: "叙事规则" },
  { file: "current_state.md", label: "状态卡" },
  { file: "pending_hooks.md", label: "伏笔池" },
  { file: "subplot_board.md", label: "支线进度" },
  { file: "emotional_arcs.md", label: "感情线" },
  { file: "character_matrix.md", label: "角色矩阵" },
];

interface TruthFileInfo {
  name: string;
  size: number;
}

interface FoundationSectionProps {
  readonly bookId: string;
}

export function FoundationSection({ bookId }: FoundationSectionProps) {
  const [files, setFiles] = useState<ReadonlyArray<TruthFileInfo>>([]);
  const openArtifact = useChatStore((s) => s.openArtifact);
  const bookDataVersion = useChatStore((s) => s.bookDataVersion);

  useEffect(() => {
    fetchJson<{ files: TruthFileInfo[] }>(`/books/${bookId}/truth`)
      .then((data) => setFiles(data.files))
      .catch(() => setFiles([]));
  }, [bookId, bookDataVersion]);

  const available = FOUNDATION_FILES.filter((f) =>
    files.some((tf) => tf.name === f.file),
  );

  if (available.length === 0) return null;

  return (
    <SidebarCard title="核心文件">
      <ul className="space-y-1">
        {available.map((item) => (
          <li key={item.file}>
            <button
              onClick={() => openArtifact(item.file)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors font-['SimSun','Songti_SC','STSong',serif]"
            >
              <FileText size={14} className="shrink-0 text-muted-foreground/60" />
              <span className="truncate">{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </SidebarCard>
  );
}
