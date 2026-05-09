import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { useChatStore } from "../../store/chat";
import { fetchJson } from "../../hooks/use-api";
import { SidebarCard } from "./SidebarCard";
import type { SidebarLanguage } from "../chat/BookSidebar";

const FOUNDATION_FILES: ReadonlyArray<{ file: string; label: Record<SidebarLanguage, string> }> = [
  { file: "story_bible.md", label: { zh: "世界观设定", en: "Worldbuilding", ko: "세계관 설정" } },
  { file: "volume_outline.md", label: { zh: "卷纲规划", en: "Volume Outline", ko: "권별 개요" } },
  { file: "book_rules.md", label: { zh: "叙事规则", en: "Narrative Rules", ko: "서사 규칙" } },
  { file: "current_state.md", label: { zh: "状态卡", en: "State Card", ko: "상태 카드" } },
  { file: "pending_hooks.md", label: { zh: "伏笔池", en: "Hook Pool", ko: "복선 풀" } },
  { file: "subplot_board.md", label: { zh: "支线进度", en: "Subplots", ko: "서브플롯 진행" } },
  { file: "emotional_arcs.md", label: { zh: "感情线", en: "Emotional Arcs", ko: "감정선" } },
  { file: "character_matrix.md", label: { zh: "角色矩阵", en: "Character Matrix", ko: "인물 매트릭스" } },
];

interface TruthFileInfo {
  name: string;
  size: number;
}

interface FoundationSectionProps {
  readonly bookId: string;
  readonly language: SidebarLanguage;
}

export function FoundationSection({ bookId, language }: FoundationSectionProps) {
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
    <SidebarCard title={language === "ko" ? "핵심 파일" : language === "en" ? "Core Files" : "核心文件"}>
      <ul className="space-y-1">
        {available.map((item) => (
          <li key={item.file}>
            <button
              onClick={() => openArtifact(item.file)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors font-['SimSun','Songti_SC','STSong',serif]"
            >
              <FileText size={14} className="shrink-0 text-muted-foreground/60" />
              <span className="truncate">{item.label[language]}</span>
            </button>
          </li>
        ))}
      </ul>
    </SidebarCard>
  );
}
