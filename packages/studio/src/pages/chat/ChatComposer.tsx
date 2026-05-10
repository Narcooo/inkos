import { useEffect, useRef } from "react";
import { ArrowUp, ChevronDown, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { QuickActions } from "../../components/chat/QuickActions";
import type { ChatPageModelGroup } from "../chat-page-state";
import { ModelPickerContent } from "./ModelPickerContent";

interface ChatComposerProps {
  readonly activeSessionId: string | null;
  readonly disabled: boolean;
  readonly groupedModels: ReadonlyArray<ChatPageModelGroup>;
  readonly hasBook: boolean;
  readonly input: string;
  readonly isZh: boolean;
  readonly modelPickerStatus: "loading" | "ready" | "no-models";
  readonly onManageModels: () => void;
  readonly onQuickAction: (command: string) => void;
  readonly onSelectModel: (model: string, service: string) => void;
  readonly onSend: (text: string) => void;
  readonly selectedModel: string | null;
  readonly selectedModelLabel: string;
  readonly selectedService: string | null;
  readonly setInput: (text: string) => void;
}

export function ChatComposer({
  activeSessionId,
  disabled,
  groupedModels,
  hasBook,
  input,
  isZh,
  modelPickerStatus,
  onManageModels,
  onQuickAction,
  onSelectModel,
  onSend,
  selectedModel,
  selectedModelLabel,
  selectedService,
  setInput,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  return (
    <>
      {hasBook && (
        <div className="shrink-0 max-w-3xl mx-auto w-full px-4">
          <QuickActions
            onAction={onQuickAction}
            disabled={disabled || !activeSessionId}
            isZh={isZh}
          />
        </div>
      )}

      <div className="shrink-0 border-t border-border/40 px-4 py-3">
        <div className="max-w-3xl mx-auto">
          <div className="rounded-xl bg-secondary/30 transition-all">
            <div className="flex items-center gap-2 px-3 py-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    onSend(input);
                  }
                }}
                placeholder={isZh ? "输入指令..." : "Enter command..."}
                disabled={disabled || !activeSessionId}
                rows={1}
                className="flex-1 bg-transparent text-sm leading-6 placeholder:text-muted-foreground/50 outline-none! border-none! ring-0! shadow-none focus:outline-none! focus:ring-0! focus:border-none! resize-none disabled:opacity-50 max-h-[200px] overflow-y-auto"
              />
              <button
                type="button"
                onClick={() => onSend(input)}
                disabled={!input.trim() || disabled || !activeSessionId}
                className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shrink-0 hover:scale-105 active:scale-95 transition-all disabled:opacity-20 disabled:scale-100 shadow-sm shadow-primary/20"
              >
                {disabled
                  ? <Loader2 size={14} className="animate-spin" />
                  : <ArrowUp size={14} strokeWidth={2.5} />}
              </button>
            </div>
            <div className="flex items-center gap-2 px-3 pb-2 border-t border-border/20 pt-1.5">
              {modelPickerStatus === "loading" ? (
                <span className="text-xs text-muted-foreground/40 animate-pulse">加载模型...</span>
              ) : modelPickerStatus === "ready" ? (
                <DropdownMenu>
                  <DropdownMenuTrigger className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-muted text-sm transition-colors cursor-pointer">
                    <span className="font-medium text-xs truncate max-w-[220px]">
                      {selectedModelLabel}
                    </span>
                    <ChevronDown size={14} className="text-muted-foreground" />
                  </DropdownMenuTrigger>
                  <ModelPickerContent
                    groupedModels={groupedModels}
                    selectedModel={selectedModel}
                    selectedService={selectedService}
                    onSelect={onSelectModel}
                    onManage={onManageModels}
                  />
                </DropdownMenu>
              ) : (
                <button
                  type="button"
                  onClick={onManageModels}
                  className="text-xs text-muted-foreground/50 hover:text-primary transition-colors"
                >
                  配置模型 →
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
