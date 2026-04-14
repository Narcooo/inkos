import type { Theme } from "../../hooks/use-theme";
import { cn } from "../../lib/utils";
import { Tool, ToolHeader, ToolContent } from "../ai-elements/tool";
import {
  Confirmation,
  ConfirmationTitle,
  ConfirmationRequest,
  ConfirmationActions,
  ConfirmationAction,
} from "../ai-elements/confirmation";
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
  { label: "\u756A\u8304\u5C0F\u8BF4", value: "tomato" },
  { label: "\u8D77\u70B9\u4E2D\u6587\u7F51", value: "qidian" },
  { label: "\u98DE\u5362", value: "feilu" },
  { label: "\u5176\u4ED6", value: "other" },
] as const;

const LANGUAGE_OPTIONS = [
  { label: "\u4E2D\u6587", value: "zh" },
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
        title="\u521B\u5EFA\u65B0\u4E66"
        type="tool-invocation"
        state={toolState}
      />
      <ToolContent>
        <div className={cn("space-y-4", disabled && "pointer-events-none opacity-80")}>
          {/* \u4E66\u540D */}
          <div className="space-y-1.5">
            <label className={labelClass}>\u4E66\u540D</label>
            <input
              type="text"
              value={args.title ?? ""}
              onChange={(e) => update("title", e.target.value)}
              placeholder="\u8F93\u5165\u4E66\u540D"
              disabled={disabled}
              className={cn(inputClass, disabledInput)}
            />
          </div>

          {/* \u9898\u6750 */}
          <div className="space-y-1.5">
            <label className={labelClass}>\u9898\u6750</label>
            <input
              type="text"
              value={args.genre ?? ""}
              onChange={(e) => update("genre", e.target.value)}
              placeholder="\u5982 xuanhuan\u3001urban\u3001romance"
              disabled={disabled}
              className={cn(inputClass, disabledInput)}
            />
          </div>

          {/* \u76EE\u6807\u5E73\u53F0 */}
          <div className="space-y-1.5">
            <label className={labelClass}>\u76EE\u6807\u5E73\u53F0</label>
            <RadioGroup
              options={PLATFORM_OPTIONS}
              value={args.platform}
              onChange={(v) => update("platform", v)}
              disabled={disabled}
            />
          </div>

          {/* \u76EE\u6807\u7AE0\u6570 + \u6BCF\u7AE0\u5B57\u6570 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className={labelClass}>\u76EE\u6807\u7AE0\u6570</label>
              <input
                type="number"
                value={args.targetChapters ?? ""}
                onChange={(e) => update("targetChapters", e.target.value ? Number(e.target.value) : undefined)}
                placeholder="\u5982 200"
                disabled={disabled}
                className={cn(inputClass, disabledInput)}
              />
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>\u6BCF\u7AE0\u5B57\u6570</label>
              <input
                type="number"
                value={args.chapterWordCount ?? ""}
                onChange={(e) => update("chapterWordCount", e.target.value ? Number(e.target.value) : undefined)}
                placeholder="\u5982 2000"
                disabled={disabled}
                className={cn(inputClass, disabledInput)}
              />
            </div>
          </div>

          {/* \u5199\u4F5C\u8BED\u8A00 */}
          <div className="space-y-1.5">
            <label className={labelClass}>\u5199\u4F5C\u8BED\u8A00</label>
            <RadioGroup
              options={LANGUAGE_OPTIONS}
              value={args.language}
              onChange={(v) => update("language", v)}
              disabled={disabled}
            />
          </div>

          {/* \u521B\u610F\u7B80\u8FF0 */}
          <div className="space-y-1.5">
            <label className={labelClass}>\u521B\u610F\u7B80\u8FF0</label>
            <div className={cn(
              "rounded-lg border border-border/60 bg-background/80 px-3 py-2 text-sm leading-7 whitespace-pre-wrap",
              disabled ? "opacity-60" : "",
            )}>
              {args.brief || <span className="text-muted-foreground/40">AI \u4F1A\u6839\u636E\u4F60\u7684\u63CF\u8FF0\u81EA\u52A8\u751F\u6210</span>}
            </div>
          </div>
        </div>

        {/* Confirmation area */}
        <Confirmation
          state={toolState}
          approval={confirming ? undefined : { id: "create_book" }}
        >
          <ConfirmationTitle>\u786E\u8BA4\u521B\u5EFA\u8FD9\u672C\u4E66\uFF1F</ConfirmationTitle>
          <ConfirmationRequest>
            <ConfirmationActions>
              <ConfirmationAction onClick={onConfirm}>
                {confirming && <Loader2 size={14} className="animate-spin mr-1" />}
                {confirming ? "\u521B\u5EFA\u4E2D\u2026" : "\u5F00\u59CB\u5199\u8FD9\u672C\u4E66"}
              </ConfirmationAction>
            </ConfirmationActions>
          </ConfirmationRequest>
        </Confirmation>
      </ToolContent>
    </Tool>
  );
}
