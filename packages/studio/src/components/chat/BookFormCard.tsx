import type { Theme } from "../../hooks/use-theme";
import { cn } from "../../lib/utils";
import { Loader2 } from "lucide-react";

export interface BookFormArgs {
  title?: string;
  genre?: string;
  platform?: string;
  targetChapters?: number;
  chapterWordCount?: number;
  language?: string;
  brief?: string;
}

export interface BookFormCardProps {
  readonly args: BookFormArgs;
  readonly onArgsChange: (args: BookFormArgs) => void;
  readonly onConfirm: () => void;
  readonly confirming: boolean;
  readonly theme: Theme;
}

const PLATFORM_OPTIONS = [
  { label: "番茄小说", value: "tomato" },
  { label: "起点中文网", value: "qidian" },
  { label: "飞卢", value: "feilu" },
  { label: "其他", value: "other" },
] as const;

const LANGUAGE_OPTIONS = [
  { label: "中文", value: "zh" },
  { label: "English", value: "en" },
] as const;

const labelClass = "text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold";

const inputClass = cn(
  "w-full rounded-lg border border-border/60 bg-background/80 px-3 py-1.5 text-sm",
  "outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all",
  "placeholder:text-muted-foreground/40",
);

function RadioGroup({
  options,
  value,
  onChange,
}: {
  readonly options: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  readonly value: string | undefined;
  readonly onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "px-3 py-1 rounded-lg text-xs font-medium border transition-all",
            value === opt.value
              ? "border-primary bg-primary/10 text-primary"
              : "border-border/60 bg-background/60 text-muted-foreground hover:border-primary/30",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function BookFormCard({ args, onArgsChange, onConfirm, confirming }: BookFormCardProps) {
  const update = <K extends keyof BookFormArgs>(key: K, value: BookFormArgs[K]) => {
    onArgsChange({ ...args, [key]: value });
  };

  return (
    <div className="rounded-2xl border border-border/60 bg-card/80 p-5 space-y-4 mt-2">
      {/* 书名 */}
      <div className="space-y-1.5">
        <label className={labelClass}>书名</label>
        <input
          type="text"
          value={args.title ?? ""}
          onChange={(e) => update("title", e.target.value)}
          placeholder="输入书名"
          className={inputClass}
        />
      </div>

      {/* 题材 */}
      <div className="space-y-1.5">
        <label className={labelClass}>题材</label>
        <input
          type="text"
          value={args.genre ?? ""}
          onChange={(e) => update("genre", e.target.value)}
          placeholder="如 xuanhuan、urban、romance"
          className={inputClass}
        />
      </div>

      {/* 目标平台 */}
      <div className="space-y-1.5">
        <label className={labelClass}>目标平台</label>
        <RadioGroup
          options={PLATFORM_OPTIONS}
          value={args.platform}
          onChange={(v) => update("platform", v)}
        />
      </div>

      {/* 目标章数 + 每章字数 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className={labelClass}>目标章数</label>
          <input
            type="number"
            value={args.targetChapters ?? ""}
            onChange={(e) => update("targetChapters", e.target.value ? Number(e.target.value) : undefined)}
            placeholder="如 200"
            className={inputClass}
          />
        </div>
        <div className="space-y-1.5">
          <label className={labelClass}>每章字数</label>
          <input
            type="number"
            value={args.chapterWordCount ?? ""}
            onChange={(e) => update("chapterWordCount", e.target.value ? Number(e.target.value) : undefined)}
            placeholder="如 2000"
            className={inputClass}
          />
        </div>
      </div>

      {/* 写作语言 */}
      <div className="space-y-1.5">
        <label className={labelClass}>写作语言</label>
        <RadioGroup
          options={LANGUAGE_OPTIONS}
          value={args.language}
          onChange={(v) => update("language", v)}
        />
      </div>

      {/* 创意简述 */}
      <div className="space-y-1.5">
        <label className={labelClass}>创意简述</label>
        <textarea
          value={args.brief ?? ""}
          onChange={(e) => update("brief", e.target.value)}
          placeholder="描述你的小说创意——世界观、主角、核心冲突"
          rows={5}
          className={cn(inputClass, "resize-none")}
        />
      </div>

      {/* 确认按钮 */}
      <button
        type="button"
        onClick={onConfirm}
        disabled={confirming}
        className={cn(
          "w-full py-2.5 rounded-xl text-sm font-semibold transition-all",
          "bg-primary text-primary-foreground",
          "hover:opacity-90 active:scale-[0.98]",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          "flex items-center justify-center gap-2",
        )}
      >
        {confirming && <Loader2 size={14} className="animate-spin" />}
        {confirming ? "创建中…" : "开始写这本书"}
      </button>
    </div>
  );
}
