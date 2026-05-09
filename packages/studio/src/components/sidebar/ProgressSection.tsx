import { useEffect, useState } from "react";
import type { SSEMessage } from "../../hooks/use-sse";
import { Loader2, Check } from "lucide-react";
import { cn } from "../../lib/utils";
import { SidebarCard } from "./SidebarCard";
import type { SidebarLanguage } from "../chat/BookSidebar";

const INIT_BOOK_STEPS = [
  "生成基础设定",
  "保存书籍配置",
  "写入基础设定文件",
  "初始化控制文档",
  "创建初始快照",
] as const;

const WRITE_CHAPTER_STEPS = [
  "准备章节输入",
  "撰写章节草稿",
  "落盘最终章节",
  "生成最终真相文件",
  "校验真相文件变更",
  "同步记忆索引",
  "更新章节索引与快照",
] as const;

type StepStatus = "pending" | "active" | "done";

interface ProgressSectionProps {
  readonly sse: { messages: ReadonlyArray<SSEMessage>; connected: boolean };
  readonly language: SidebarLanguage;
}

const STEP_LABELS: Record<string, Record<SidebarLanguage, string>> = {
  "生成基础设定": { zh: "生成基础设定", en: "Generating foundation", ko: "기초 설정 생성" },
  "保存书籍配置": { zh: "保存书籍配置", en: "Saving book config", ko: "작품 설정 저장" },
  "写入基础设定文件": { zh: "写入基础设定文件", en: "Writing foundation files", ko: "기초 설정 파일 작성" },
  "初始化控制文档": { zh: "初始化控制文档", en: "Initializing control documents", ko: "제어 문서 초기화" },
  "创建初始快照": { zh: "创建初始快照", en: "Creating initial snapshot", ko: "초기 스냅샷 생성" },
  "准备章节输入": { zh: "准备章节输入", en: "Preparing chapter input", ko: "챕터 입력 준비" },
  "撰写章节草稿": { zh: "撰写章节草稿", en: "Writing chapter draft", ko: "챕터 초안 작성" },
  "落盘最终章节": { zh: "落盘最终章节", en: "Persisting final chapter", ko: "최종 챕터 저장" },
  "生成最终真相文件": { zh: "生成最终真相文件", en: "Rebuilding truth files", ko: "최종 기준 문서 생성" },
  "校验真相文件变更": { zh: "校验真相文件变更", en: "Validating truth changes", ko: "기준 문서 변경 검증" },
  "同步记忆索引": { zh: "同步记忆索引", en: "Syncing memory indexes", ko: "기억 색인 동기화" },
  "更新章节索引与快照": { zh: "更新章节索引与快照", en: "Updating chapter index and snapshots", ko: "챕터 색인 및 스냅샷 갱신" },
};

const STAGE_ALIASES: Record<string, string> = {
  "단계: 기초 설정 생성": "生成基础设定",
  "단계: 작품 설정 저장": "保存书籍配置",
  "단계: 기초 설정 파일 작성": "写入基础设定文件",
  "단계: 제어 문서 초기화": "初始化控制文档",
  "단계: 초기 스냅샷 생성": "创建初始快照",
  "단계: 챕터 입력 준비": "准备章节输入",
  "단계: 챕터 초안 작성": "撰写章节草稿",
  "단계: 최종 챕터 저장": "落盘最终章节",
  "단계: 최종 기준 문서 생성": "生成最终真相文件",
  "단계: 기준 문서 변경 검증": "校验真相文件变更",
  "단계: 기억 색인 동기화": "同步记忆索引",
  "단계: 챕터 색인 및 스냅샷 갱신": "更新章节索引与快照",
  "Stage: generating foundation": "生成基础设定",
  "Stage: saving book config": "保存书籍配置",
  "Stage: writing foundation files": "写入基础设定文件",
  "Stage: initializing control documents": "初始化控制文档",
  "Stage: creating initial snapshot": "创建初始快照",
  "Stage: preparing chapter inputs": "准备章节输入",
  "Stage: writing chapter draft": "撰写章节草稿",
  "Stage: persisting final chapter": "落盘最终章节",
  "Stage: rebuilding final truth files": "生成最终真相文件",
  "Stage: validating truth file updates": "校验真相文件变更",
  "Stage: syncing memory indexes": "同步记忆索引",
  "Stage: updating chapter index and snapshots": "更新章节索引与快照",
};

function normalizeStageMessage(message: string): string {
  if (STAGE_ALIASES[message]) return STAGE_ALIASES[message];
  if (message.startsWith("阶段：")) return message.slice("阶段：".length).trim();
  if (message.startsWith("Stage: ")) {
    const stage = message.slice("Stage: ".length).trim();
    return STAGE_ALIASES[`Stage: ${stage}`] ?? stage;
  }
  if (message.startsWith("단계: ")) {
    const stage = message.slice("단계: ".length).trim();
    return STAGE_ALIASES[`단계: ${stage}`] ?? stage;
  }
  return message;
}

function localizeStep(step: string, language: SidebarLanguage): string {
  return STEP_LABELS[step]?.[language] ?? step;
}

export function ProgressSection({ sse, language }: ProgressSectionProps) {
  const [operation, setOperation] = useState<"idle" | "init" | "write">("idle");
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const [activeStep, setActiveStep] = useState<string | null>(null);

  useEffect(() => {
    const latest = sse.messages;
    if (latest.length === 0) return;
    const last = latest[latest.length - 1];

    if (last.event === "book:creating") {
      setOperation("init");
      setCompletedSteps(new Set());
      setActiveStep(null);
    } else if (last.event === "write:start") {
      setOperation("write");
      setCompletedSteps(new Set());
      setActiveStep(null);
    } else if (last.event === "book:created" || last.event === "write:complete") {
      // Mark all steps done
      const steps = operation === "init" ? INIT_BOOK_STEPS : WRITE_CHAPTER_STEPS;
      setCompletedSteps(new Set(steps));
      setActiveStep(null);
    } else if (last.event === "log") {
      const data = last.data as { message?: string } | null;
      const message = data?.message;
      if (message && operation !== "idle") {
        const nextActiveStep = normalizeStageMessage(message);
        // Mark previous active step as done, set new active
        setCompletedSteps((prev) => {
          if (activeStep) {
            const next = new Set(prev);
            next.add(activeStep);
            return next;
          }
          return prev;
        });
        setActiveStep(nextActiveStep);
      }
    }
  }, [sse.messages]);

  const steps = operation === "init" ? INIT_BOOK_STEPS
    : operation === "write" ? WRITE_CHAPTER_STEPS
    : null;

  if (!steps) return null;

  return (
    <SidebarCard title={language === "ko" ? "실행" : language === "en" ? "Execution" : "执行"}>
      <ul className="space-y-2">
        {steps.map((step, i) => {
          const status: StepStatus = completedSteps.has(step) ? "done"
            : activeStep === step ? "active"
            : "pending";
          return (
            <li key={step} className="flex items-center gap-2.5">
              <StepIndicator index={i + 1} status={status} />
              <span className={cn(
                "text-xs",
                status === "done" && "text-muted-foreground",
                status === "active" && "text-foreground font-medium",
                status === "pending" && "text-muted-foreground/50",
              )}>
                {localizeStep(step, language)}
              </span>
            </li>
          );
        })}
      </ul>
    </SidebarCard>
  );
}

function StepIndicator({ index, status }: { readonly index: number; readonly status: StepStatus }) {
  if (status === "done") {
    return (
      <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center shrink-0">
        <Check size={12} className="text-primary-foreground" strokeWidth={2.5} />
      </div>
    );
  }
  if (status === "active") {
    return (
      <div className="w-5 h-5 rounded-full border-2 border-primary flex items-center justify-center shrink-0">
        <Loader2 size={10} className="text-primary animate-spin" />
      </div>
    );
  }
  return (
    <div className="w-5 h-5 rounded-full border border-border/60 flex items-center justify-center shrink-0">
      <span className="text-[10px] text-muted-foreground/50">{index}</span>
    </div>
  );
}
