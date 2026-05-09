import {
  Zap,
  Search,
  FileOutput,
  TrendingUp,
} from "lucide-react";

export interface QuickActionsProps {
  readonly onAction: (command: string) => void;
  readonly disabled: boolean;
  readonly language: "zh" | "en" | "ko";
}

interface ChipDef {
  readonly icon: React.ReactNode;
  readonly labelZh: string;
  readonly labelEn: string;
  readonly labelKo: string;
  readonly commandZh: string;
  readonly commandEn: string;
  readonly commandKo: string;
}

const CHIPS: ReadonlyArray<ChipDef> = [
  {
    icon: <Zap size={12} />,
    labelZh: "写下一章",
    labelEn: "Write next",
    labelKo: "다음 장 쓰기",
    commandZh: "写下一章",
    commandEn: "write next",
    commandKo: "다음 장 쓰기",
  },
  {
    icon: <Search size={12} />,
    labelZh: "审计",
    labelEn: "Audit",
    labelKo: "검토",
    commandZh: "审计",
    commandEn: "audit",
    commandKo: "검토",
  },
  {
    icon: <FileOutput size={12} />,
    labelZh: "导出",
    labelEn: "Export",
    labelKo: "내보내기",
    commandZh: "导出全书",
    commandEn: "export book",
    commandKo: "전체 작품 내보내기",
  },
  {
    icon: <TrendingUp size={12} />,
    labelZh: "市场雷达",
    labelEn: "Market radar",
    labelKo: "시장 레이더",
    commandZh: "扫描市场趋势",
    commandEn: "scan market trends",
    commandKo: "시장 트렌드 스캔",
  },
];

export function QuickActions({ onAction, disabled, language }: QuickActionsProps) {
  return (
    <div className="flex gap-2 overflow-x-auto px-1 py-1">
      {CHIPS.map((chip) => {
        const label = language === "ko" ? chip.labelKo : language === "zh" ? chip.labelZh : chip.labelEn;
        const command = language === "ko" ? chip.commandKo : language === "zh" ? chip.commandZh : chip.commandEn;
        return (
          <button
            key={label}
            onClick={() => onAction(command)}
            disabled={disabled}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary/50 border border-border/30 text-xs font-medium text-muted-foreground hover:text-primary hover:border-primary/30 hover:bg-primary/5 transition-all disabled:opacity-40 disabled:pointer-events-none group"
          >
            <span className="group-hover:scale-110 transition-transform">{chip.icon}</span>
            {label}
          </button>
        );
      })}
    </div>
  );
}
