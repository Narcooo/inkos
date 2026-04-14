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

function ExecStatusBadge({ status }: { status: ToolExecution["status"] }) {
  switch (status) {
    case "running":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-primary">
          <Loader2 size={12} className="animate-spin" />
          <span>执行中</span>
        </span>
      );
    case "processing":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 size={12} className="animate-spin" style={{ animationDuration: "2s" }} />
          <span>处理结果</span>
        </span>
      );
    case "completed":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
          <CheckCircle2 size={12} />
          <span>已完成</span>
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-destructive">
          <XCircle size={12} />
          <span>失败</span>
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

function formatProgress(progress: NonNullable<PipelineStage["progress"]>): string {
  const secs = Math.round(progress.elapsedMs / 1000);
  const chars = progress.chineseChars > 0
    ? `${progress.totalChars}字`
    : `${progress.totalChars} chars`;
  return `${secs}s · ${chars}`;
}

function formatDuration(startedAt: number, completedAt?: number): string {
  const ms = (completedAt ?? Date.now()) - startedAt;
  const secs = Math.round(ms / 1000);
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

// -- Pipeline operation (sub_agent) --

function PipelineExecution({ exec }: { exec: ToolExecution }) {
  const isActive = exec.status === "running" || exec.status === "processing";
  const [open, setOpen] = useState(isActive);

  useEffect(() => {
    if (exec.status === "running") setOpen(true);
    if (exec.status === "completed") {
      const timer = setTimeout(() => setOpen(false), 500);
      return () => clearTimeout(timer);
    }
  }, [exec.status]);

  const bookId = exec.args?.bookId as string | undefined;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-card/60 hover:bg-card/80 transition-colors cursor-pointer">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-foreground truncate">
            {exec.label}
            {bookId && <span className="text-muted-foreground font-normal"> · {bookId}</span>}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {exec.completedAt && (
            <span className="text-[10px] text-muted-foreground/60">
              {formatDuration(exec.startedAt, exec.completedAt)}
            </span>
          )}
          <ExecStatusBadge status={exec.status} />
          <ChevronDown size={14} className={`text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pb-3 pt-1">
          {exec.stages && exec.stages.length > 0 && (
            <ul className="space-y-1.5">
              {exec.stages.map((stage, i) => (
                <li key={i} className="flex items-center gap-2.5">
                  <StageIcon status={stage.status} />
                  <span className={`text-xs ${stage.status === "pending" ? "text-muted-foreground/40" : "text-muted-foreground"}`}>
                    {stage.label}
                  </span>
                  {stage.status === "active" && stage.progress && (
                    <span className="text-[10px] text-primary/70 ml-auto">
                      {formatProgress(stage.progress)}
                    </span>
                  )}
                </li>
              ))}
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

function UtilityToolsGroup({ execs }: { execs: ToolExecution[] }) {
  const [open, setOpen] = useState(false);
  const allDone = execs.every(e => e.status === "completed" || e.status === "error");
  const hasError = execs.some(e => e.status === "error");

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer text-xs text-muted-foreground">
        <Wrench size={12} />
        <span>{execs.length} 个文件操作</span>
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

export function ToolExecutionSteps({ executions }: ToolExecutionStepsProps) {
  const groups = useMemo(() => groupChronologically(executions), [executions]);

  return (
    <div className="space-y-2 mt-2">
      {groups.map((g, i) =>
        g.type === "pipeline"
          ? <PipelineExecution key={g.exec.id} exec={g.exec} />
          : <UtilityToolsGroup key={`utils-${i}`} execs={g.execs} />
      )}
    </div>
  );
}
