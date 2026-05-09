import { useMemo, useState, useEffect } from "react";
import type { ToolExecution, PipelineStage } from "../../store/chat/types";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "../ui/collapsible";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  Wrench,
} from "lucide-react";

// -- Status rendering helpers --

type ToolDisplayLanguage = "zh" | "en" | "ko";

const EXEC_STATUS_LABELS: Record<ToolExecution["status"], Record<ToolDisplayLanguage, string>> = {
  running: { zh: "执行中", en: "Running", ko: "실행 중" },
  processing: { zh: "处理结果", en: "Processing", ko: "결과 처리 중" },
  completed: { zh: "已完成", en: "Completed", ko: "완료" },
  error: { zh: "失败", en: "Failed", ko: "실패" },
};

const TOOL_LABEL_KO: Record<string, string> = {
  "建书": "작품 만들기",
  "写作": "집필",
  "审计": "검토",
  "修订": "수정",
  "导出": "내보내기",
  "读取文件": "파일 읽기",
  "编辑文件": "파일 편집",
  "搜索": "검색",
  "列目录": "목록 보기",
};

const LOG_STAGE_LABEL_KO: Record<string, string> = {
  "生成基础设定": "기초 설정 생성",
  "保存书籍配置": "작품 설정 저장",
  "写入基础设定文件": "기초 설정 파일 작성",
  "初始化控制文档": "제어 문서 초기화",
  "创建初始快照": "초기 스냅샷 생성",
  "导入同人正典": "팬픽 원본 설정 가져오기",
  "生成同人基础设定": "팬픽 기초 설정 생성",
  "提取原作风格指纹": "원작 문체 지문 추출",
  "准备章节输入": "챕터 입력 준비",
  "撰写章节草稿": "챕터 초안 작성",
  "审计草稿": "초안 검토",
  "文字层润色": "문장 다듬기",
  "落盘草稿与真相文件": "초안 및 기준 문서 저장",
  "落盘最终章节": "최종 챕터 저장",
  "生成最终真相文件": "최종 기준 문서 생성",
  "校验真相文件变更": "기준 문서 변경 검증",
  "同步记忆索引": "기억 색인 동기화",
  "更新章节索引与快照": "챕터 색인 및 스냅샷 갱신",
  "规划下一章意图": "다음 장 의도 계획",
  "组装章节运行时上下文": "챕터 런타임 컨텍스트 구성",
  "修复章节状态结算": "챕터 상태 정산 복구",
  "根据已编辑正文同步真相文件与索引": "편집된 본문에서 기준 문서와 색인 동기화",
  "generating foundation": "기초 설정 생성",
  "saving book config": "작품 설정 저장",
  "writing foundation files": "기초 설정 파일 작성",
  "initializing control documents": "제어 문서 초기화",
  "creating initial snapshot": "초기 스냅샷 생성",
  "preparing chapter inputs": "챕터 입력 준비",
  "writing chapter draft": "챕터 초안 작성",
  "auditing draft": "초안 검토",
  "polishing prose": "문장 다듬기",
  "persisting final chapter": "최종 챕터 저장",
  "rebuilding final truth files": "최종 기준 문서 생성",
  "validating truth file updates": "기준 문서 변경 검증",
  "syncing memory indexes": "기억 색인 동기화",
  "updating chapter index and snapshots": "챕터 색인 및 스냅샷 갱신",
  "planning next chapter intent": "다음 장 의도 계획",
  "composing chapter runtime context": "챕터 런타임 컨텍스트 구성",
};

function localizeToolLabel(label: string, language: ToolDisplayLanguage): string {
  if (language === "ko") return TOOL_LABEL_KO[label] ?? label;
  return label;
}

function localizeLogLine(log: string, language: ToolDisplayLanguage): string {
  if (language !== "ko") return log;
  const postWrite = log.match(/^Post-write:\s*(\d+)\s*errors?,\s*(\d+)\s*warnings?\s*in chapter\s*(\d+)/i);
  if (postWrite) return `작성 후 검증: ${postWrite[3]}장 오류 ${postWrite[1]}개, 경고 ${postWrite[2]}개`;
  const aiTell = log.match(/^AI-tell check:\s*(\d+)\s*issues?\s*in chapter\s*(\d+)/i);
  if (aiTell) return `AI 문체 검사: ${aiTell[2]}장 문제 ${aiTell[1]}개`;
  const preAuditNormalize = log.match(/^审计前字数归一化：第(\d+)章\s*(\d+)\s*->\s*(\d+)/u);
  if (preAuditNormalize) return `감사 전 분량 정규화: ${preAuditNormalize[1]}장 ${preAuditNormalize[2]} -> ${preAuditNormalize[3]}`;
  const repairStage = log.match(/^(?:阶段：)?修复轮次\s*(\d+)\/(\d+)（当前\s*(\d+)\s*分）/u);
  if (repairStage) return `${log.startsWith("阶段：") ? "단계: " : ""}수정 라운드 ${repairStage[1]}/${repairStage[2]} (현재 ${repairStage[3]}점)`;
  const noImprovement = log.match(/^(?:阶段：)?修复轮次\s*(\d+)\s*未净提升（(\d+)\s*→\s*(\d+)），退出循环/u);
  if (noImprovement) return `수정 라운드 ${noImprovement[1]}에서 점수가 개선되지 않았습니다 (${noImprovement[2]} -> ${noImprovement[3]}). 반복을 종료합니다`;
  const noContent = log.match(/^(?:阶段：)?修复轮次\s*(\d+)\s*未产出新内容，退出循环/u);
  if (noContent) return `수정 라운드 ${noContent[1]}에서 새 내용이 생성되지 않아 반복을 종료합니다`;
  const lengthWarning = log.match(/^(\d+)장은 한 번의 분량 정규화 후에도 허용 범위\((\d+)-(\d+)\)를 벗어났습니다\. 실제 분량:\s*(\d+)\./u);
  if (lengthWarning) return `${lengthWarning[1]}장은 분량 정규화 후에도 허용 범위(${lengthWarning[2]}-${lengthWarning[3]})를 벗어났습니다. 실제 분량: ${lengthWarning[4]}.`;

  const replacements: ReadonlyArray<[RegExp, string]> = [
    [/^\[warning\]\s*Paragraph fragmentation:\s*(\d+) of (\d+) paragraphs are shorter than (\d+) characters\./i, "[warning] 문단 분절: $2개 문단 중 $1개가 $3자보다 짧습니다."],
    [/^\[warning\]\s*Consecutive short paragraphs:\s*(\d+) short paragraphs appear back to back\./i, "[warning] 연속 짧은 문단: 짧은 문단 $1개가 연달아 나타납니다."],
    [/^\[info\]\s*List-like structure:\s*Detected (\d+) consecutive sentences with the same opening pattern, creating a list-like generated cadence/i, "[info] 목록형 구조: 같은 시작 패턴의 문장 $1개가 연속되어 생성문 같은 목록 리듬이 생깁니다."],
    [/^\[paragraph\]\s*连续出现(\d+)个不足(\d+)字的短段，容易形成短句堆砌。/u, "[paragraph] $2자 미만의 짧은 문단이 $1개 연속되어 짧은 문장 더미처럼 보일 수 있습니다."],
    [/^阶段：/u, "단계: "],
    [/审计草稿/u, "초안 검토"],
    [/准备章节输入/u, "챕터 입력 준비"],
    [/撰写章节草稿/u, "챕터 초안 작성"],
    [/落盘最终章节/u, "최종 챕터 저장"],
    [/生成最终真相文件/u, "최종 기준 문서 생성"],
    [/校验真相文件变更/u, "기준 문서 변경 검증"],
    [/同步记忆索引/u, "기억 색인 동기화"],
    [/更新章节索引与快照/u, "챕터 색인 및 스냅샷 갱신"],
  ];
  let translated = log;
  for (const [pattern, replacement] of replacements) {
    translated = translated.replace(pattern, replacement);
  }
  if (translated !== log) return translated;

  const prefix = log.startsWith("阶段：")
    ? "阶段："
    : log.startsWith("Stage: ")
      ? "Stage: "
      : log.startsWith("단계: ")
        ? "단계: "
        : undefined;
  if (!prefix) return log;
  const stage = log.slice(prefix.length).trim();
  const auditChapter = stage.match(/^审计第(\d+)章$/u) ?? stage.match(/^auditing chapter (\d+)$/i);
  if (auditChapter?.[1]) return `단계: ${auditChapter[1]}장 검토`;
  const reviseContext = stage.match(/^加载第(\d+)章修订上下文$/u) ?? stage.match(/^loading revision context for chapter (\d+)$/i);
  if (reviseContext?.[1]) return `단계: ${reviseContext[1]}장 수정 컨텍스트 불러오기`;
  const reviseChapter = stage.match(/^修订第(\d+)章$/u) ?? stage.match(/^revising chapter (\d+)$/i);
  if (reviseChapter?.[1]) return `단계: ${reviseChapter[1]}장 수정`;
  const persistRevision = stage.match(/^落盘第(\d+)章修订结果$/u) ?? stage.match(/^persisting revision for chapter (\d+)$/i);
  if (persistRevision?.[1]) return `단계: ${persistRevision[1]}장 수정 결과 저장`;
  return `단계: ${LOG_STAGE_LABEL_KO[stage] ?? stage}`;
}

function ExecStatusBadge({ status, language }: { status: ToolExecution["status"]; language: ToolDisplayLanguage }) {
  switch (status) {
    case "running":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-primary">
          <Loader2 size={12} className="animate-spin" />
          <span>{EXEC_STATUS_LABELS.running[language]}</span>
        </span>
      );
    case "processing":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 size={12} className="animate-spin" style={{ animationDuration: "2s" }} />
          <span>{EXEC_STATUS_LABELS.processing[language]}</span>
        </span>
      );
    case "completed":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
          <CheckCircle2 size={12} />
          <span>{EXEC_STATUS_LABELS.completed[language]}</span>
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-destructive">
          <XCircle size={12} />
          <span>{EXEC_STATUS_LABELS.error[language]}</span>
        </span>
      );
  }
}

function StageIcon({ status }: { status: PipelineStage["status"] }) {
  switch (status) {
    case "pending":
      return <span className="w-4 h-4 rounded-full border border-border/60 flex items-center justify-center shrink-0 text-[8px] text-muted-foreground/40">○</span>;
    case "active":
      return <Loader2 size={14} className="text-primary animate-spin shrink-0" />;
    case "completed":
      return <CheckCircle2 size={14} className="text-green-600 dark:text-green-400 shrink-0" />;
  }
}

function formatProgress(progress: NonNullable<PipelineStage["progress"]>, language: ToolDisplayLanguage): string {
  const secs = Math.round(progress.elapsedMs / 1000);
  const statusLabel = progress.status === "thinking"
    ? language === "ko" ? "생각 중" : language === "en" ? "Thinking" : "思考中"
    : "";
  const chars = progress.totalChars > 0
    ? language === "ko" ? `${progress.totalChars}자` : progress.chineseChars > 0 ? `${progress.totalChars}字` : `${progress.totalChars} chars`
    : "";
  const parts = [statusLabel, `${secs}s`, chars].filter(Boolean);
  return parts.join(" · ");
}

function formatDuration(startedAt: number, completedAt?: number): string {
  const ms = (completedAt ?? Date.now()) - startedAt;
  const secs = Math.round(ms / 1000);
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

// -- Live elapsed timer hook --

function useElapsedTimer(startedAt: number, active: boolean): number {
  const [elapsed, setElapsed] = useState(() => active ? Date.now() - startedAt : 0);
  useEffect(() => {
    if (!active) return;
    setElapsed(Date.now() - startedAt);
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [startedAt, active]);
  return elapsed;
}

// -- Pipeline operation (sub_agent) --

function PipelineExecution({ exec, language }: { exec: ToolExecution; language: ToolDisplayLanguage }) {
  const isActive = exec.status === "running" || exec.status === "processing";
  const [open, setOpen] = useState(isActive);
  const elapsedMs = useElapsedTimer(exec.startedAt, isActive);

  useEffect(() => {
    if (exec.status === "running") setOpen(true);
    if (exec.status === "completed") {
      const timer = setTimeout(() => setOpen(false), 500);
      return () => clearTimeout(timer);
    }
  }, [exec.status]);

  const bookId = exec.args?.bookId as string | undefined;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border border-border/40 bg-card/60">
      <CollapsibleTrigger className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl hover:bg-card/80 transition-colors cursor-pointer">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-foreground truncate">
            {localizeToolLabel(exec.label, language)}
            {bookId && <span className="text-muted-foreground font-normal"> · {bookId}</span>}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-muted-foreground/60">
            {isActive
              ? formatDuration(exec.startedAt, exec.startedAt + elapsedMs)
              : exec.completedAt ? formatDuration(exec.startedAt, exec.completedAt) : ""}
          </span>
          <ExecStatusBadge status={exec.status} language={language} />
          <ChevronDown size={14} className={`text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pb-3 pt-1">
          {/* Real-time execution logs */}
          {exec.logs && exec.logs.length > 0 && (
            <ul className="space-y-0.5">
              {exec.logs.map((log, i) => {
                const isError = log.startsWith("[error]") || /error/i.test(log);
                const isWarn = log.startsWith("[warning]") || /warning|警告/i.test(log);
                const displayLog = localizeLogLine(log, language);
                return (
                  <li key={i} className={`text-xs font-mono break-words ${isError ? "text-destructive" : isWarn ? "text-yellow-600 dark:text-yellow-400" : "text-muted-foreground"}`}>
                    {displayLog}
                  </li>
                );
              })}
            </ul>
          )}
          {exec.status === "error" && exec.error && (
            <div className="mt-2 text-xs text-destructive bg-destructive/5 rounded-lg px-2.5 py-2">
              {exec.error}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// -- Utility tools (read/edit/grep/ls) grouped --

function UtilityToolsGroup({ execs, language }: { execs: ToolExecution[]; language: ToolDisplayLanguage }) {
  const [open, setOpen] = useState(false);
  const allDone = execs.every(e => e.status === "completed" || e.status === "error");
  const hasError = execs.some(e => e.status === "error");

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer text-xs text-muted-foreground">
        <Wrench size={12} />
        <span>{language === "ko" ? `파일 작업 ${execs.length}개` : language === "en" ? `${execs.length} file operations` : `${execs.length} 个文件操作`}</span>
        {allDone && !hasError && <CheckCircle2 size={10} className="text-green-600 dark:text-green-400" />}
        {hasError && <XCircle size={10} className="text-destructive" />}
        {!allDone && <Loader2 size={10} className="animate-spin text-primary" />}
        <ChevronDown size={10} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="pl-6 space-y-0.5 py-1">
          {execs.map((exec) => (
            <li key={exec.id} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono truncate">{exec.tool} {String(exec.args?.path ?? exec.args?.pattern ?? "")}</span>
              {exec.status === "completed" && <CheckCircle2 size={10} className="text-green-600 dark:text-green-400 shrink-0" />}
              {exec.status === "error" && <XCircle size={10} className="text-destructive shrink-0" />}
              {(exec.status === "running" || exec.status === "processing") && <Loader2 size={10} className="animate-spin text-primary shrink-0" />}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

// -- Main component --

export interface ToolExecutionStepsProps {
  executions: ToolExecution[];
  language?: ToolDisplayLanguage;
}

/**
 * Group executions chronologically: pipeline ops render individually,
 * consecutive utility tools are merged into a single collapsed group.
 */
type RenderGroup =
  | { type: "pipeline"; exec: ToolExecution }
  | { type: "utilities"; execs: ToolExecution[] };

function groupChronologically(executions: ToolExecution[]): RenderGroup[] {
  const groups: RenderGroup[] = [];
  let utilBuf: ToolExecution[] = [];

  const flushUtils = () => {
    if (utilBuf.length > 0) {
      groups.push({ type: "utilities", execs: utilBuf });
      utilBuf = [];
    }
  };

  for (const exec of executions) {
    if (exec.tool === "sub_agent") {
      flushUtils();
      groups.push({ type: "pipeline", exec });
    } else {
      utilBuf.push(exec);
    }
  }
  flushUtils();
  return groups;
}

export function ToolExecutionSteps({ executions, language = "zh" }: ToolExecutionStepsProps) {
  const groups = useMemo(() => groupChronologically(executions), [executions]);

  return (
    <div className="space-y-2 mt-2">
      {groups.map((g, i) =>
        g.type === "pipeline"
          ? <PipelineExecution key={g.exec.id} exec={g.exec} language={language} />
          : <UtilityToolsGroup key={`utils-${i}`} execs={g.execs} language={language} />
      )}
    </div>
  );
}
