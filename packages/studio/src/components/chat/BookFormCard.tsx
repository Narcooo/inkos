import type { Theme } from "../../hooks/use-theme";
import { cn } from "../../lib/utils";
import { Tool, ToolHeader, ToolContent } from "../ai-elements/tool";
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
  disabled,
}: {
  readonly options: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  readonly value: string | undefined;
  readonly onChange: (v: string) => void;
  readonly disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          disabled={disabled}
          className={cn(
            "px-3 py-1 rounded-lg text-xs font-medium border transition-all",
            value === opt.value
              ? "border-primary bg-primary/10 text-primary"
              : "border-border/60 bg-background/60 text-muted-foreground hover:border-primary/30",
            disabled && "opacity-50 cursor-not-allowed",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function BookFormCard({ args, onArgsChange, onConfirm, confirming }: BookFormCardProps) {
  const disabled = confirming;
  const update = <K extends keyof BookFormArgs>(key: K, value: BookFormArgs[K]) => {
    if (disabled) return;
    onArgsChange({ ...args, [key]: value });
  };

  const disabledInput = disabled ? "opacity-60 cursor-not-allowed" : "";
  const toolState = confirming ? "input-available" : "approval-requested";

  return (
    <Tool defaultOpen>
      <ToolHeader
        title="创建新书"
        type="tool-invocation"
        state={toolState}
      />
      <ToolContent>
        <div className={cn("space-y-4", disabled && "pointer-events-none opacity-80")}>
          {/* 书名 */}
          <div className="space-y-1.5">
            <label className={labelClass}>书名</label>
            <input
              type="text"
              value={args.title ?? ""}
              onChange={(e) => update("title", e.target.value)}
              placeholder="输入书名"
              disabled={disabled}
              className={cn(inputClass, disabledInput)}
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
              disabled={disabled}
              className={cn(inputClass, disabledInput)}
            />
          </div>

          {/* 目标平台 */}
          <div className="space-y-1.5">
            <label className={labelClass}>目标平台</label>
            <RadioGroup
              options={PLATFORM_OPTIONS}
              value={args.platform}
              onChange={(v) => update("platform", v)}
              disabled={disabled}
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
                disabled={disabled}
                className={cn(inputClass, disabledInput)}
              />
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>每章字数</label>
              <input
                type="number"
                value={args.chapterWordCount ?? ""}
                onChange={(e) => update("chapterWordCount", e.target.value ? Number(e.target.value) : undefined)}
                placeholder="如 2000"
                disabled={disabled}
                className={cn(inputClass, disabledInput)}
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
              disabled={disabled}
            />
          </div>

          {/* 创意简述 */}
          <div className="space-y-1.5">
            <label className={labelClass}>创意简述</label>
            <div className={cn(
              "rounded-lg border border-border/60 bg-background/80 px-3 py-2 text-sm leading-7 whitespace-pre-wrap",
              disabled ? "opacity-60" : "",
            )}>
              {args.brief || <span className="text-muted-foreground/40">AI 会根据你的描述自动生成</span>}
            </div>
          </div>
        </div>

        {/* 确认按钮 */}
        <div className="flex items-center justify-between pt-4 border-t border-border/40 mt-4">
          <p className="text-xs text-muted-foreground">确认后将由 Architect 生成完整 foundation</p>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirming}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {confirming && <Loader2 size={14} className="animate-spin" />}
            {confirming ? "创建中…" : "开始写这本书"}
          </button>
        </div>
      </ToolContent>
    </Tool>
  );
}
