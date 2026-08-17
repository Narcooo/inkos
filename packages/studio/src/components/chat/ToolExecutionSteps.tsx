import { memo, useMemo, useState, useEffect } from "react";
import type { ChatActionPayload, ChatRequestedIntent, ChatSessionKind, ToolExecution, PipelineStage } from "../../store/chat/types";
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
  Check,
} from "lucide-react";
import { buildApiUrl } from "../../hooks/use-api";
import { tr } from "../../lib/app-language";
import { chatSelectors, useChatStore } from "../../store/chat";
import { usePreferencesStore } from "../../store/preferences";
import {
  NarrativeForecastPreview,
  getNarrativeForecastPreviewDetails,
} from "./NarrativeForecastPreview";

// -- Status rendering helpers --

function ExecStatusBadge({ status }: { status: ToolExecution["status"] }) {
  switch (status) {
    case "running":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-primary">
          <Loader2 size={12} className="animate-spin" />
          <span>{tr("执行中", "Running")}</span>
        </span>
      );
    case "processing":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 size={12} className="animate-spin" style={{ animationDuration: "2s" }} />
          <span>{tr("处理结果", "Processing result")}</span>
        </span>
      );
    case "completed":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
          <CheckCircle2 size={12} />
          <span>{tr("已完成", "Completed")}</span>
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-destructive">
          <XCircle size={12} />
          <span>{tr("失败", "Failed")}</span>
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
  const statusLabel = progress.status === "thinking" ? tr("思考中", "Thinking") : progress.status ?? "";
  const chars = progress.totalChars > 0
    ? progress.chineseChars > 0 ? `${progress.totalChars}字` : `${progress.totalChars} chars`
    : "";
  const parts = [statusLabel, `${secs}s`, chars].filter(Boolean);
  return parts.join(" · ");
}

function formatDuration(startedAt: number, completedAt?: number): string {
  const ms = (completedAt ?? Date.now()) - startedAt;
  const secs = Math.round(ms / 1000);
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function encodeProjectPath(path: string): string {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function extractResultPath(result: string | undefined, label: string): string | null {
  if (!result) return null;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = result.match(new RegExp(`^${escaped}:\\s*(.+)$`, "im"));
  const path = match?.[1]?.trim();
  return path || null;
}

export interface GeneratedArtifactDetails {
  readonly kind: "short_fiction_created" | "cover_generated" | "script_created" | "storyboard_created" | "interactive_film_created";
  readonly title?: string;
  readonly storyId?: string;
  readonly projectId?: string;
  readonly finalMarkdownPath?: string;
  readonly salesPackagePath?: string;
  readonly coverPromptPath?: string;
  readonly coverImagePath?: string;
  readonly coverError?: string;
  readonly specPath?: string;
  readonly scriptPath?: string;
  readonly storyboardPath?: string;
  readonly storyGraphPath?: string;
  readonly storyTreePath?: string;
  readonly flagsPath?: string;
  readonly imagePromptsPath?: string;
  readonly assetsManifestPath?: string;
  readonly skillIds?: ReadonlyArray<string>;
}

export interface PlayToolDetails {
  readonly kind: "play_world_started" | "play_turn_advanced" | "play_turn_revised" | "play_variant_restored";
  readonly title?: string;
  readonly worldId?: string;
  readonly runId?: string;
  readonly turn?: number;
  readonly sceneImageUrl?: string;
  readonly sceneText?: string;
  readonly suggestedActions?: readonly string[];
  readonly variantId?: string;
  readonly skillIds?: ReadonlyArray<string>;
}

export interface PlayEditDetails {
  readonly kind: "play_world_updated";
  readonly worldId?: string;
  readonly runId?: string;
  readonly updatedWorldContract?: boolean;
  readonly updatedVisualContract?: boolean;
  readonly updatedPremise?: boolean;
  readonly updatedEntities?: number;
}

export interface ProposedActionDetails {
  readonly kind: "proposed_action";
  readonly execId: string;
  readonly action: ChatRequestedIntent;
  readonly targetSessionKind: ChatSessionKind;
  readonly sameSession?: boolean;
  readonly title?: string;
  readonly summary?: string;
  readonly instruction?: string;
  readonly requestedSkills?: ReadonlyArray<string>;
  readonly actionPayload?: ChatActionPayload;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function booleanField(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nestedNumberField(record: Record<string, unknown>, objectKey: string, key: string): number | undefined {
  const value = record[objectKey];
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return numberField(value as Record<string, unknown>, key);
}

function actionPayloadField(record: Record<string, unknown>): ChatActionPayload | undefined {
  const value = record.actionPayload;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as ChatActionPayload;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const out = Array.from(new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  ));
  return out.length > 0 ? out : undefined;
}

function rawStringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getExecutionSkillIds(exec: ToolExecution): ReadonlyArray<string> {
  if (!exec.details || typeof exec.details !== "object" || Array.isArray(exec.details)) return [];
  return rawStringArrayField(exec.details as Record<string, unknown>, "skillIds");
}

function SkillUsagePreview({ exec }: { exec: ToolExecution }) {
  const skills = getExecutionSkillIds(exec);
  if (skills.length === 0) return null;
  return (
    <div className="mx-3 mb-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span className="font-semibold text-foreground/80">{tr("专业 Skill", "Professional skills")}</span>
      {skills.map((skill) => (
        <span key={skill} className="rounded-full border border-border/50 bg-background/60 px-2 py-0.5 font-mono text-[11px]">
          {skill}
        </span>
      ))}
    </div>
  );
}

interface ChapterContextTraceDetails {
  readonly chapterNumber?: number;
  readonly tracePath: string;
  readonly selectedSources: ReadonlyArray<string>;
  readonly protectedSources: ReadonlyArray<string>;
  readonly compressibleSources: ReadonlyArray<string>;
  readonly protectedTokens?: number;
  readonly compressibleTokens?: number;
  readonly totalSelectedTokens?: number;
  readonly retrievalEngine?: string;
  readonly retrievalCandidateCount: number;
  readonly semanticSelectedCount: number;
  readonly compressedSources: ReadonlyArray<string>;
}

function parseChapterContextTrace(value: unknown, chapterNumber?: number): ChapterContextTraceDetails | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const tracePath = stringField(record, "tracePath");
  if (!tracePath) return null;
  const tokenBudget = record.tokenBudget && typeof record.tokenBudget === "object" && !Array.isArray(record.tokenBudget)
    ? record.tokenBudget as Record<string, unknown>
    : {};
  const retrieval = record.retrieval && typeof record.retrieval === "object" && !Array.isArray(record.retrieval)
    ? record.retrieval as Record<string, unknown>
    : {};
  const compression = record.compression && typeof record.compression === "object" && !Array.isArray(record.compression)
    ? record.compression as Record<string, unknown>
    : {};
  return {
    chapterNumber,
    tracePath,
    selectedSources: rawStringArrayField(record, "selectedSources"),
    protectedSources: rawStringArrayField(record, "protectedSources"),
    compressibleSources: rawStringArrayField(record, "compressibleSources"),
    protectedTokens: numberField(tokenBudget, "protectedTokens"),
    compressibleTokens: numberField(tokenBudget, "compressibleTokens"),
    totalSelectedTokens: numberField(tokenBudget, "totalSelectedTokens"),
    retrievalEngine: stringField(retrieval, "engine"),
    retrievalCandidateCount: Array.isArray(retrieval.candidates) ? retrieval.candidates.length : 0,
    semanticSelectedCount: rawStringArrayField(retrieval, "semanticSelectedIds").length,
    compressedSources: rawStringArrayField(compression, "compressedSources"),
  };
}

export function getChapterContextTraceDetails(exec: ToolExecution): ReadonlyArray<ChapterContextTraceDetails> {
  if (exec.tool !== "sub_agent" || !exec.details || typeof exec.details !== "object" || Array.isArray(exec.details)) return [];
  const details = exec.details as Record<string, unknown>;
  if (details.kind === "chapter_written") {
    const trace = parseChapterContextTrace(details.contextTrace, numberField(details, "chapterNumber"));
    return trace ? [trace] : [];
  }
  if (details.kind !== "chapters_written" || !Array.isArray(details.chapters)) return [];
  return details.chapters.flatMap((chapter) => {
    if (!chapter || typeof chapter !== "object" || Array.isArray(chapter)) return [];
    const record = chapter as Record<string, unknown>;
    const trace = parseChapterContextTrace(record.contextTrace, numberField(record, "chapterNumber"));
    return trace ? [trace] : [];
  });
}

function ChapterContextTracePreview({ exec }: { exec: ToolExecution }) {
  const traces = getChapterContextTraceDetails(exec);
  if (traces.length === 0) return null;
  return (
    <div className="mx-3 mb-3 mt-1 rounded-xl border border-border/50 bg-background/55 px-3 py-2.5 text-xs">
      <div className="font-semibold text-foreground">{tr("本轮参考依据", "Context used this turn")}</div>
      <div className="mt-2 space-y-2">
        {traces.map((trace) => (
          <details key={`${trace.chapterNumber ?? 0}:${trace.tracePath}`} className="rounded-lg border border-border/40 px-2.5 py-2">
            <summary className="cursor-pointer select-none font-medium text-foreground">
              {trace.chapterNumber ? tr(`第 ${trace.chapterNumber} 章`, `Chapter ${trace.chapterNumber}`) : tr("章节", "Chapter")}
              {trace.retrievalEngine ? ` · ${trace.retrievalEngine}` : ""}
            </summary>
            <div className="mt-2 space-y-1.5 text-muted-foreground">
              <div>
                {tr("预算", "Budget")}: {trace.totalSelectedTokens ?? 0}
                {` · ${tr("保护", "protected")} ${trace.protectedTokens ?? 0}`}
                {` · ${tr("可压缩", "compressible")} ${trace.compressibleTokens ?? 0}`}
              </div>
              <div>
                {tr("检索", "Retrieval")}: {trace.retrievalCandidateCount} {tr("个 BM25 候选", "BM25 candidates")}
                {trace.semanticSelectedCount > 0 ? ` · ${trace.semanticSelectedCount} ${tr("个语义选择", "semantic selections")}` : ""}
              </div>
              {trace.compressedSources.length > 0 && (
                <div>{tr("语义压缩", "Semantic compaction")}: {trace.compressedSources.join(" · ")}</div>
              )}
              <div>{tr("完整来源", "All sources")}:</div>
              <ul className="space-y-0.5 font-mono text-[11px]">
                {trace.selectedSources.map((source) => <li key={source}>{source}</li>)}
              </ul>
              <div className="font-mono text-[11px]">{trace.tracePath}</div>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

interface ChapterRevisionIssueDetails {
  readonly severity: string;
  readonly category: string;
  readonly description: string;
  readonly suggestion?: string;
}

interface ChapterRevisionDetails {
  readonly chapterNumber?: number;
  readonly applied: boolean;
  readonly status?: string;
  readonly auditPassed?: boolean;
  readonly fixedIssues: ReadonlyArray<string>;
  readonly auditIssues: ReadonlyArray<ChapterRevisionIssueDetails>;
  readonly skippedReason?: string;
}

interface ChapterStateResyncDetails {
  readonly chapterNumber?: number;
  readonly status?: string;
  readonly auditPassed?: boolean;
  readonly auditIssues: ReadonlyArray<ChapterRevisionIssueDetails>;
  readonly summary?: string;
}

function parseChapterAuditIssues(value: unknown): ReadonlyArray<ChapterRevisionIssueDetails> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((issue) => {
    if (!issue || typeof issue !== "object" || Array.isArray(issue)) return [];
    const record = issue as Record<string, unknown>;
    const description = stringField(record, "description");
    if (!description) return [];
    return [{
      severity: stringField(record, "severity") ?? "warning",
      category: stringField(record, "category") ?? "review",
      description,
      suggestion: stringField(record, "suggestion"),
    }];
  });
}

export function getChapterRevisionDetails(exec: ToolExecution): ChapterRevisionDetails | null {
  if (exec.tool !== "sub_agent" || !exec.details || typeof exec.details !== "object" || Array.isArray(exec.details)) return null;
  const details = exec.details as Record<string, unknown>;
  if (details.kind !== "chapter_revision") return null;
  return {
    chapterNumber: numberField(details, "chapterNumber"),
    applied: details.applied === true,
    status: stringField(details, "status"),
    auditPassed: typeof details.auditPassed === "boolean" ? details.auditPassed : undefined,
    fixedIssues: rawStringArrayField(details, "fixedIssues"),
    auditIssues: parseChapterAuditIssues(details.auditIssues),
    skippedReason: stringField(details, "skippedReason"),
  };
}

export function getChapterStateResyncDetails(exec: ToolExecution): ChapterStateResyncDetails | null {
  if (exec.tool !== "resync_chapter_state" || !exec.details || typeof exec.details !== "object" || Array.isArray(exec.details)) return null;
  const details = exec.details as Record<string, unknown>;
  if (details.kind !== "chapter_state_resynced") return null;
  return {
    chapterNumber: numberField(details, "chapterNumber"),
    status: stringField(details, "status"),
    auditPassed: typeof details.auditPassed === "boolean" ? details.auditPassed : undefined,
    auditIssues: parseChapterAuditIssues(details.auditIssues),
    summary: stringField(details, "summary"),
  };
}

function ChapterAuditIssues({
  issues,
  title,
}: {
  readonly issues: ReadonlyArray<ChapterRevisionIssueDetails>;
  readonly title: string;
}) {
  if (issues.length === 0) return null;
  return (
    <div className="mt-2 space-y-1.5">
      <div className="text-[13px] font-medium text-foreground">{title}</div>
      {issues.map((issue, index) => (
        <div key={`${issue.category}:${index}`} className="rounded-lg border border-border/40 bg-background/55 px-2.5 py-2 text-[12px] leading-5 text-muted-foreground">
          <div className="font-medium text-foreground">[{issue.severity}] {issue.category}</div>
          <div>{issue.description}</div>
          {issue.suggestion && <div className="mt-0.5">{tr("建议", "Suggestion")}{tr("：", ": ")}{issue.suggestion}</div>}
        </div>
      ))}
    </div>
  );
}

function ChapterRevisionPreview({ exec }: { exec: ToolExecution }) {
  const details = getChapterRevisionDetails(exec);
  if (!details) return null;
  const passed = details.applied && details.auditPassed === true;
  return (
    <div
      data-testid="chapter-revision-preview"
      className={`mx-3 mb-3 mt-1 rounded-xl border px-3 py-2.5 ${passed ? "border-emerald-500/25 bg-emerald-500/5" : "border-amber-500/25 bg-amber-500/5"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[15px] font-semibold text-foreground">
          {details.chapterNumber ? tr(`第 ${details.chapterNumber} 章修订`, `Chapter ${details.chapterNumber} revision`) : tr("章节修订", "Chapter revision")}
        </div>
        <div className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${passed ? "bg-emerald-500/15 text-emerald-600" : "bg-amber-500/15 text-amber-600"}`}>
          {!details.applied
            ? tr("保留原稿", "Original kept")
            : details.auditPassed
              ? tr("审稿通过", "Audit passed")
              : tr("仍需复核", "Review required")}
        </div>
      </div>
      {details.skippedReason && (
        <div className="mt-2 text-[13px] leading-5 text-muted-foreground">{details.skippedReason}</div>
      )}
      {details.fixedIssues.length > 0 && (
        <div className="mt-2 text-[13px] leading-5 text-muted-foreground">
          <span className="font-medium text-foreground">{tr("已处理", "Fixed")}{tr("：", ": ")}</span>
          {details.fixedIssues.join("；")}
        </div>
      )}
      <ChapterAuditIssues issues={details.auditIssues} title={tr("剩余审稿问题", "Remaining audit issues")} />
    </div>
  );
}

function ChapterStateResyncPreview({ exec }: { exec: ToolExecution }) {
  const details = getChapterStateResyncDetails(exec);
  if (!details) return null;
  const passed = details.auditPassed === true;
  return (
    <div
      data-testid="chapter-state-resync-preview"
      className={`mx-3 mb-3 mt-1 rounded-xl border px-3 py-2.5 ${passed ? "border-emerald-500/25 bg-emerald-500/5" : "border-amber-500/25 bg-amber-500/5"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[15px] font-semibold text-foreground">
          {details.chapterNumber ? tr(`第 ${details.chapterNumber} 章状态已同步`, `Chapter ${details.chapterNumber} state resynced`) : tr("章节状态已同步", "Chapter state resynced")}
        </div>
        <div className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${passed ? "bg-emerald-500/15 text-emerald-600" : "bg-amber-500/15 text-amber-600"}`}>
          {passed ? tr("审稿通过", "Audit passed") : tr("仍需修订", "Revision required")}
        </div>
      </div>
      {details.summary && <div className="mt-2 text-[13px] leading-5 text-muted-foreground">{details.summary}</div>}
      <ChapterAuditIssues issues={details.auditIssues} title={tr("审稿问题", "Audit issues")} />
    </div>
  );
}

export function getGeneratedArtifactDetails(exec: ToolExecution): GeneratedArtifactDetails | null {
  if (!["short_fiction_run", "generate_cover", "script_create", "storyboard_create", "interactive_film_create"].includes(exec.tool)) return null;
  if (!exec.details || typeof exec.details !== "object") return null;
  const record = exec.details as Record<string, unknown>;
  if (
    record.kind !== "short_fiction_created"
    && record.kind !== "cover_generated"
    && record.kind !== "script_created"
    && record.kind !== "storyboard_created"
    && record.kind !== "interactive_film_created"
  ) return null;
  return {
    kind: record.kind,
    title: stringField(record, "title"),
    storyId: stringField(record, "storyId"),
    projectId: stringField(record, "projectId"),
    finalMarkdownPath: stringField(record, "finalMarkdownPath"),
    salesPackagePath: stringField(record, "salesPackagePath"),
    coverPromptPath: stringField(record, "coverPromptPath"),
    coverImagePath: stringField(record, "coverImagePath"),
    coverError: stringField(record, "coverError"),
    specPath: stringField(record, "specPath"),
    scriptPath: stringField(record, "scriptPath"),
    storyboardPath: stringField(record, "storyboardPath"),
    storyGraphPath: stringField(record, "storyGraphPath"),
    storyTreePath: stringField(record, "storyTreePath"),
    flagsPath: stringField(record, "flagsPath"),
    imagePromptsPath: stringField(record, "imagePromptsPath"),
    assetsManifestPath: stringField(record, "assetsManifestPath"),
    skillIds: stringArrayField(record, "skillIds"),
  };
}

function ScriptStoryboardResultPreview({ exec, onOpenFilmStudio }: { exec: ToolExecution; onOpenFilmStudio?: (projectId: string) => void }) {
  const openProjectArtifact = useChatStore((s) => s.openProjectArtifact);
  if (!["script_create", "storyboard_create", "interactive_film_create"].includes(exec.tool) || exec.status !== "completed") return null;
  const details = getGeneratedArtifactDetails(exec);
  if (!details || (
    details.kind !== "script_created"
    && details.kind !== "storyboard_created"
    && details.kind !== "interactive_film_created"
  )) return null;
  const maybeRows: Array<readonly [string, string] | null> = [
    details.specPath ? [tr("规格", "Spec"), details.specPath] : null,
    details.storyGraphPath ? [tr("剧情图谱", "Story graph"), details.storyGraphPath] : null,
    details.storyTreePath ? [tr("剧情树", "Story tree"), details.storyTreePath] : null,
    details.flagsPath ? [tr("变量旗标", "Flags"), details.flagsPath] : null,
    details.scriptPath ? [tr("剧本", "Script"), details.scriptPath] : null,
    details.storyboardPath ? [tr("分镜", "Storyboard"), details.storyboardPath] : null,
    details.imagePromptsPath ? [tr("图像提示词", "Image prompts"), details.imagePromptsPath] : null,
    details.assetsManifestPath ? [tr("图片资产", "Image assets"), details.assetsManifestPath] : null,
  ];
  const rows = maybeRows.filter((row): row is readonly [string, string] => Boolean(row));
  if (rows.length === 0 && !(details.kind === "interactive_film_created" && details.projectId)) return null;
  return (
    <div className="mx-3 mb-3 mt-1 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[16px] leading-6 font-semibold text-primary">
          {details.kind === "script_created"
            ? tr("剧本已生成", "Script generated")
            : details.kind === "storyboard_created"
              ? tr("分镜已生成", "Storyboard generated")
              : tr("互动影游已生成", "Interactive film generated")}
        </div>
        {details.kind === "interactive_film_created" && details.projectId && onOpenFilmStudio && (
          <button
            type="button"
            data-testid="open-film-studio"
            onClick={() => onOpenFilmStudio(details.projectId!)}
            className="shrink-0 rounded-lg bg-primary px-3 py-1 text-[13px] font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
          >
            {tr("打开创作向导 →", "Open creation wizard →")}
          </button>
        )}
      </div>
      {rows.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {rows.map(([label, path]) => (
            <button
              key={label}
              type="button"
              onClick={() => openProjectArtifact(path)}
              className="group flex w-full items-start justify-between gap-3 rounded-lg border border-transparent px-2 py-1.5 text-left transition hover:border-primary/25 hover:bg-background/65"
            >
              <span className="min-w-0 text-[13px] leading-5 text-muted-foreground break-all">
                <span className="font-medium text-foreground">{label}{tr("：", ": ")}</span>{path}
              </span>
              <span className="mt-0.5 shrink-0 rounded-md border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary opacity-80 transition group-hover:opacity-100">
                {tr("查看", "View")}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ShortFictionResultPreview({ exec }: { exec: ToolExecution }) {
  if (!["short_fiction_run", "generate_cover"].includes(exec.tool) || exec.status !== "completed") return null;
  const details = getGeneratedArtifactDetails(exec);
  const coverPath = details?.coverImagePath ?? extractResultPath(exec.result, "Cover image");
  const coverError = details?.coverError ?? extractResultPath(exec.result, "Cover image reason");
  if (!coverPath || !/\.(png|jpe?g|webp)$/iu.test(coverPath)) {
    if (!coverError) return null;
    return (
      <div className="mx-3 mb-3 mt-1 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        {tr("封面未生成：", "Cover not generated: ")}{coverError}
      </div>
    );
  }

  const coverUrl = buildApiUrl(`/project/files/${encodeProjectPath(coverPath)}`);
  if (!coverUrl) return null;
  const title = details?.title ?? details?.storyId ?? tr("短篇封面", "Short fiction cover");

  return (
    <div className="mx-3 mb-3 mt-1 overflow-hidden rounded-xl border border-border/40 bg-background/70">
      <img
        src={coverUrl}
        alt={title}
        className="block max-h-[360px] w-full object-contain bg-muted/20"
        loading="lazy"
      />
      <div className="border-t border-border/40 px-3 py-2 text-[11px] text-muted-foreground break-all">
        {coverPath}
      </div>
    </div>
  );
}

export function getPlayToolDetails(exec: ToolExecution): PlayToolDetails | null {
  if (!["play_start", "play_step", "play_revise"].includes(exec.tool)) return null;
  if (!exec.details || typeof exec.details !== "object") return null;
  const record = exec.details as Record<string, unknown>;
  if (
    record.kind !== "play_world_started"
    && record.kind !== "play_turn_advanced"
    && record.kind !== "play_turn_revised"
    && record.kind !== "play_variant_restored"
  ) return null;
  const suggested = Array.isArray(record.suggestedActions)
    ? record.suggestedActions.filter((item): item is string => typeof item === "string")
    : [];
  return {
    kind: record.kind,
    title: stringField(record, "title"),
    worldId: stringField(record, "worldId"),
    runId: stringField(record, "runId"),
    turn: numberField(record, "turn")
      ?? nestedNumberField(record, "currentState", "turn")
      ?? (record.kind === "play_world_started" ? 0 : undefined),
    sceneImageUrl: stringField(record, "sceneImageUrl"),
    sceneText: stringField(record, "sceneText"),
    suggestedActions: suggested,
    variantId: stringField(record, "variantId"),
    skillIds: stringArrayField(record, "skillIds"),
  };
}

type PlayRunImageIndex = {
  readonly sceneImageUrls?: Record<string, string>;
  readonly sceneImageUrl?: string;
};

function sceneImageKey(details: PlayToolDetails): string | null {
  return details.turn == null ? null : `scene-turn-${Math.trunc(details.turn)}`;
}

export function buildPlaySceneImageUrl(details: PlayToolDetails, run?: PlayRunImageIndex | null): string | null {
  if (details.sceneImageUrl) {
    return buildApiUrl(details.sceneImageUrl);
  }
  const key = sceneImageKey(details);
  const fromIndex = key ? run?.sceneImageUrls?.[key] : undefined;
  if (fromIndex) return buildApiUrl(fromIndex);
  if (key === "scene-turn-0" && run?.sceneImageUrl) return buildApiUrl(run.sceneImageUrl);
  return null;
}

export function buildPlayRunStatusUrl(details: PlayToolDetails): string | null {
  if (!details.worldId || !details.runId || details.turn == null) return null;
  return buildApiUrl(
    `/play/runs/${encodeURIComponent(details.worldId)}/${encodeURIComponent(details.runId)}`,
  );
}

function PlaySceneImagePreview({ details }: { details: PlayToolDetails }) {
  const runUrl = useMemo(() => buildPlayRunStatusUrl(details), [details]);
  const directUrl = useMemo(() => buildPlaySceneImageUrl(details), [details]);
  const [readyUrl, setReadyUrl] = useState<string | null>(null);

  useEffect(() => {
    setReadyUrl(null);
    if (directUrl) {
      setReadyUrl(directUrl);
      return;
    }
    if (!runUrl) return;
    let cancelled = false;
    let timer: number | undefined;
    let attempt = 0;
    const maxAttempts = 40;

    const probe = async () => {
      try {
        const response = await fetch(runUrl);
        if (response.ok) {
          const data = await response.json() as PlayRunImageIndex;
          const url = buildPlaySceneImageUrl(details, data);
          if (url && !cancelled) {
            setReadyUrl(url);
            return;
          }
        }
      } catch {
        // The run may not exist yet, or the image may still be generating.
      }
      if (cancelled) return;
      attempt += 1;
      if (attempt < maxAttempts) {
        timer = window.setTimeout(() => void probe(), 2000);
      }
    };

    void probe();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [details, directUrl, runUrl]);

  if (!readyUrl) return null;

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border/40 bg-background/80">
      <img
        src={readyUrl}
        alt={tr("本幕配图", "Scene illustration")}
        className="block max-h-[420px] w-full object-contain bg-muted/20"
        loading="lazy"
      />
      {details.turn != null && (
        <div className="border-t border-border/40 px-3 py-2.5 text-[14px] leading-6 text-muted-foreground">
          {tr(`第 ${Math.trunc(details.turn)} 幕配图`, `Scene ${Math.trunc(details.turn)} illustration`)}
        </div>
      )}
    </div>
  );
}

export function getPlayEditDetails(exec: ToolExecution): PlayEditDetails | null {
  if (exec.tool !== "play_edit") return null;
  if (!exec.details || typeof exec.details !== "object") return null;
  const record = exec.details as Record<string, unknown>;
  if (record.kind !== "play_world_updated") return null;
  return {
    kind: "play_world_updated",
    worldId: stringField(record, "worldId"),
    runId: stringField(record, "runId"),
    updatedWorldContract: booleanField(record, "updatedWorldContract"),
    updatedVisualContract: booleanField(record, "updatedVisualContract"),
    updatedPremise: booleanField(record, "updatedPremise"),
    updatedEntities: numberField(record, "updatedEntities"),
  };
}

export function getProposedActionDetails(exec: ToolExecution): ProposedActionDetails | null {
  if (exec.tool !== "propose_action") return null;
  if (!exec.details || typeof exec.details !== "object") return null;
  const record = exec.details as Record<string, unknown>;
  if (record.kind !== "proposed_action") return null;
  const action = stringField(record, "action") as ChatRequestedIntent | undefined;
  const targetSessionKind = stringField(record, "targetSessionKind") as ChatSessionKind | undefined;
  const instruction = stringField(record, "instruction");
  if (!action || !targetSessionKind || !instruction) return null;
  return {
    kind: "proposed_action",
    execId: exec.id,
    action,
    targetSessionKind,
    sameSession: booleanField(record, "sameSession"),
    title: stringField(record, "title"),
    summary: stringField(record, "summary"),
    instruction,
    requestedSkills: stringArrayField(record, "requestedSkills"),
    actionPayload: actionPayloadField(record),
  };
}

export function getProposedActionContractRows(details: ProposedActionDetails): ReadonlyArray<{ label: string; value: string }> {
  const playStart = details.actionPayload?.playStart;
  if (details.action !== "play_start" || !playStart) return [];
  const rows: Array<{ label: string; value: string }> = [];
  const worldContract = playStart.worldContract?.trim();
  if (worldContract) rows.push({ label: tr("世界契约", "World contract"), value: worldContract });
  const visualContract = playStart.visualContract?.trim();
  if (visualContract) rows.push({ label: tr("视觉契约", "Visual contract"), value: visualContract });
  return rows;
}

function ProposedActionPreview({
  exec,
  onProposedAction,
  onRejectProposedAction,
}: {
  exec: ToolExecution;
  onProposedAction?: (details: ProposedActionDetails) => void;
  onRejectProposedAction?: (details: ProposedActionDetails) => void;
}) {
  const resolvedProposals = useChatStore((s) => s.resolvedProposals);
  const isActiveSessionStreaming = useChatStore(chatSelectors.isActiveSessionStreaming);
  if (exec.tool !== "propose_action" || exec.status !== "completed") return null;
  const details = getProposedActionDetails(exec);
  if (!details) return null;
  // A proposed action is one-shot: once confirmed or rejected the card locks so
  // the production action can't be re-fired. While a run is in flight the
  // confirm button reflects "执行中…" instead of silently swallowing the click.
  const resolution = resolvedProposals[details.execId];
  const streaming = isActiveSessionStreaming;
  const locked = resolution !== undefined;
  const contractRows = getProposedActionContractRows(details);
  return (
    <div className="mx-3 mb-3 mt-1 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3.5">
      <div className="text-[17px] leading-6 font-semibold text-foreground">{details.title ?? tr("确认执行", "Confirm action")}</div>
      {details.summary && (
        <div className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-7 text-muted-foreground">{details.summary}</div>
      )}
      <div className="mt-2.5 whitespace-pre-wrap break-words rounded-lg bg-background/70 px-3 py-2.5 text-[15px] leading-7 text-muted-foreground">
        {details.instruction}
      </div>
      {contractRows.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {contractRows.map((row) => (
            <div key={row.label} className="rounded-lg border border-border/50 bg-background/60 px-3 py-2.5">
              <div className="text-[13px] leading-5 font-semibold text-foreground">{row.label}</div>
              <div className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-7 text-muted-foreground">{row.value}</div>
            </div>
          ))}
        </div>
      )}
      {resolution === "confirmed" ? (
        <div className="mt-3 flex items-center gap-1.5 text-[15px] leading-6 font-medium text-primary">
          <Check size={15} className="shrink-0" />
          {tr("已执行", "Executed")}
        </div>
      ) : resolution === "rejected" ? (
        <div className="mt-3 text-[15px] leading-6 font-medium text-muted-foreground">{tr("已取消", "Cancelled")}</div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="confirm-action"
            onClick={() => onProposedAction?.(details)}
            disabled={!onProposedAction || streaming || locked}
            className="rounded-lg bg-primary px-3.5 py-2 text-[15px] leading-6 font-medium text-primary-foreground disabled:opacity-50"
          >
            {streaming ? tr("执行中…", "Running…") : tr("继续执行", "Continue")}
          </button>
          <button
            type="button"
            onClick={() => onRejectProposedAction?.(details)}
            disabled={!onRejectProposedAction || streaming || locked}
            className="rounded-lg border border-border/60 bg-background/80 px-3.5 py-2 text-[15px] leading-6 font-medium text-muted-foreground disabled:opacity-50"
          >
            {tr("取消", "Cancel")}
          </button>
        </div>
      )}
    </div>
  );
}

function PlayResultPreview({ exec }: { exec: ToolExecution }) {
  if (!["play_start", "play_step", "play_revise"].includes(exec.tool) || exec.status !== "completed") return null;
  const details = getPlayToolDetails(exec);
  if (!details?.sceneText) return null;
  const label = details.kind === "play_world_started"
    ? tr("互动世界已启动", "Interactive world started")
    : details.kind === "play_turn_revised"
      ? tr("互动回合已重做", "Play turn redone")
      : details.kind === "play_variant_restored"
        ? tr("已切换互动回合版本", "Switched play turn variant")
        : tr("互动世界已推进", "Interactive world advanced");
  return (
    <div className="mx-3 mb-3 mt-1 rounded-xl border border-primary/20 bg-primary/5 px-3 py-3">
      <div className="mb-2 text-[16px] leading-6 font-semibold text-primary">
        {label}
      </div>
      <div className="whitespace-pre-wrap text-base leading-7 text-foreground">{details.sceneText}</div>
      <PlaySceneImagePreview details={details} />
    </div>
  );
}

function PlayEditPreview({ exec }: { exec: ToolExecution }) {
  if (exec.tool !== "play_edit" || exec.status !== "completed") return null;
  const details = getPlayEditDetails(exec);
  if (!details) return null;
  const changes = [
    details.updatedWorldContract ? tr("世界契约", "World contract") : "",
    details.updatedVisualContract ? tr("视觉契约", "Visual contract") : "",
    details.updatedPremise ? tr("世界前提", "World premise") : "",
    details.updatedEntities && details.updatedEntities > 0
      ? tr(`${details.updatedEntities} 张卡片`, `${details.updatedEntities} cards`)
      : "",
  ].filter(Boolean);
  return (
    <div className="mx-3 mb-3 mt-1 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5">
      <div className="text-[16px] leading-6 font-semibold text-primary">{tr("互动世界设定已更新", "Interactive world settings updated")}</div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">
        {changes.length > 0 ? changes.join(" · ") : tr("已写入当前世界。", "Written to the current world.")}
      </div>
    </div>
  );
}

function hasStructuredResultPreview(exec: ToolExecution): boolean {
  if (getProposedActionDetails(exec)) return true;
  if (getPlayToolDetails(exec)?.sceneText) return true;
  if (getChapterRevisionDetails(exec)) return true;
  if (getChapterStateResyncDetails(exec)) return true;
  return Boolean(getPlayEditDetails(exec));
}

function isPipelineTool(tool: string): boolean {
  return tool === "sub_agent"
    || tool === "resync_chapter_state"
    || tool === "context_compression"
    || tool === "propose_action"
    || tool === "short_fiction_run"
    || tool === "script_create"
    || tool === "storyboard_create"
    || tool === "interactive_film_create"
    || tool === "generate_cover"
    || tool === "play_edit"
    || tool === "play_start"
    || tool === "play_revise"
    || tool === "play_step"
    || tool === "create_narrative_forecast"
    || tool === "get_narrative_forecast"
    || tool === "select_narrative_branch";
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

/**
 * Uncontrolled <details>: `open` only sets the initial state, so manual
 * toggling keeps working (React leaves the DOM alone while the prop value is
 * unchanged). The key remounts the element when the global preference flips,
 * re-applying the new default.
 */
export function PipelineResultDetails({ result, defaultOpen }: { result: string; defaultOpen: boolean }) {
  return (
    <details
      key={defaultOpen ? "result-default-open" : "result-default-collapsed"}
      open={defaultOpen}
      className="mx-3 mb-3 mt-1 rounded-lg border border-border/40 bg-background/60 px-2.5 py-2 text-xs"
    >
      <summary className="cursor-pointer select-none font-medium text-muted-foreground hover:text-foreground">
        {tr("查看操作结果", "View result")}
      </summary>
      <div className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words leading-5 text-foreground">
        {result}
      </div>
    </details>
  );
}

function PipelineExecution({
  exec,
  onProposedAction,
  onRejectProposedAction,
  onOpenFilmStudio,
  onSelectNarrativeBranch,
  onRecheckNarrativeForecast,
}: {
  exec: ToolExecution;
  onProposedAction?: (details: ProposedActionDetails) => void;
  onRejectProposedAction?: (details: ProposedActionDetails) => void;
  onOpenFilmStudio?: (projectId: string) => void;
  onSelectNarrativeBranch?: (forecastId: string, branchId: string) => void | Promise<void>;
  onRecheckNarrativeForecast?: (forecastId: string) => void | Promise<void>;
}) {
  const isActive = exec.status === "running" || exec.status === "processing";
  const [open, setOpen] = useState(isActive);
  const elapsedMs = useElapsedTimer(exec.startedAt, isActive);
  const toolDetailsDefaultOpen = usePreferencesStore((s) => s.toolDetailsDefaultOpen);

  useEffect(() => {
    if (exec.status === "running") setOpen(true);
    if (exec.status === "completed") {
      const timer = setTimeout(() => setOpen(false), 500);
      return () => clearTimeout(timer);
    }
  }, [exec.status]);

  const bookId = exec.args?.bookId as string | undefined;
  const forecastDetails = getNarrativeForecastPreviewDetails(exec);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border border-border/40 bg-card/60">
      <CollapsibleTrigger className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl hover:bg-card/80 transition-colors cursor-pointer">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[16px] leading-6 font-medium text-foreground truncate">
            {exec.label}
            {bookId && <span className="text-muted-foreground font-normal"> · {bookId}</span>}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[12px] text-muted-foreground/60">
            {isActive
              ? formatDuration(exec.startedAt, exec.startedAt + elapsedMs)
              : exec.completedAt ? formatDuration(exec.startedAt, exec.completedAt) : ""}
          </span>
          <ExecStatusBadge status={exec.status} />
          <ChevronDown size={16} className={`text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </CollapsibleTrigger>
      <ProposedActionPreview
        exec={exec}
        onProposedAction={onProposedAction}
        onRejectProposedAction={onRejectProposedAction}
      />
      <SkillUsagePreview exec={exec} />
      <ShortFictionResultPreview exec={exec} />
      <ScriptStoryboardResultPreview exec={exec} onOpenFilmStudio={onOpenFilmStudio} />
      <PlayResultPreview exec={exec} />
      <PlayEditPreview exec={exec} />
      <ChapterContextTracePreview exec={exec} />
      <ChapterRevisionPreview exec={exec} />
      <ChapterStateResyncPreview exec={exec} />
      <NarrativeForecastPreview
        exec={exec}
        onSelectBranch={onSelectNarrativeBranch}
        onRecheck={onRecheckNarrativeForecast}
      />
      {!forecastDetails && !hasStructuredResultPreview(exec) && typeof exec.result === "string" && exec.result.trim() && (
        <PipelineResultDetails result={exec.result} defaultOpen={toolDetailsDefaultOpen} />
      )}
      <CollapsibleContent>
        <div className="px-3 pb-3 pt-1">
          {exec.stages && exec.stages.length > 0 && (
            <ol className="mb-2 space-y-1.5">
              {exec.stages.map((stage) => (
                <li
                  key={stage.label}
                  className={[
                    "flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs",
                    stage.status === "active" ? "bg-primary/5 text-foreground" : "text-muted-foreground",
                  ].join(" ")}
                >
                  <StageIcon status={stage.status} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{stage.label}</div>
                    {stage.progress && (
                      <div className="mt-0.5 text-[10px] text-muted-foreground/70">
                        {formatProgress(stage.progress)}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
          {/* Real-time execution logs */}
          {exec.logs && exec.logs.length > 0 && (
            <ul className="space-y-0.5">
              {exec.logs.map((log, i) => {
                const isError = log.startsWith("[error]") || /error/i.test(log);
                const isWarn = log.startsWith("[warning]") || /warning|警告/i.test(log);
                return (
                  <li key={i} className={`text-xs font-mono break-words ${isError ? "text-destructive" : isWarn ? "text-yellow-600 dark:text-yellow-400" : "text-muted-foreground"}`}>
                    {log}
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

function UtilityExecStatusIcon({ status }: { status: ToolExecution["status"] }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 size={10} className="text-green-600 dark:text-green-400 shrink-0" />;
    case "error":
      return <XCircle size={10} className="text-destructive shrink-0" />;
    case "running":
    case "processing":
      return <Loader2 size={10} className="animate-spin text-primary shrink-0" />;
  }
}

export function UtilityExecutionRow({ exec }: { exec: ToolExecution }) {
  const title = `${exec.tool} ${String(exec.args?.path ?? exec.args?.pattern ?? "")}`;
  const hasResult = typeof exec.result === "string" && exec.result.trim().length > 0;

  if (!hasResult) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono truncate">{title}</span>
        <UtilityExecStatusIcon status={exec.status} />
      </div>
    );
  }

  // Uncontrolled <details>, always collapsed by default: utility results are
  // reference material, expanding them all would flood the transcript.
  return (
    <details className="group">
      <summary className="flex cursor-pointer select-none items-center gap-2 list-none [&::-webkit-details-marker]:hidden hover:text-foreground transition-colors">
        <span className="font-mono truncate">{title}</span>
        <UtilityExecStatusIcon status={exec.status} />
        <ChevronDown size={10} className="shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-1 mb-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/40 bg-background/60 px-2 py-1.5 leading-5">
        {exec.result}
      </div>
    </details>
  );
}

function UtilityToolsGroup({ execs }: { execs: ToolExecution[] }) {
  const [open, setOpen] = useState(false);
  const allDone = execs.every(e => e.status === "completed" || e.status === "error");
  const hasError = execs.some(e => e.status === "error");

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer text-xs text-muted-foreground">
        <Wrench size={12} />
        <span>{tr(`${execs.length} 个文件操作`, `${execs.length} file operation${execs.length === 1 ? "" : "s"}`)}</span>
        {allDone && !hasError && <CheckCircle2 size={10} className="text-green-600 dark:text-green-400" />}
        {hasError && <XCircle size={10} className="text-destructive" />}
        {!allDone && <Loader2 size={10} className="animate-spin text-primary" />}
        <ChevronDown size={10} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="pl-6 space-y-0.5 py-1">
          {execs.map((exec) => (
            <li key={exec.id} className="text-xs text-muted-foreground">
              <UtilityExecutionRow exec={exec} />
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
  onProposedAction?: (details: ProposedActionDetails) => void;
  onRejectProposedAction?: (details: ProposedActionDetails) => void;
  onOpenFilmStudio?: (projectId: string) => void;
  onSelectNarrativeBranch?: (forecastId: string, branchId: string) => void | Promise<void>;
  onRecheckNarrativeForecast?: (forecastId: string) => void | Promise<void>;
}

/**
 * Group executions chronologically: pipeline ops render individually,
 * consecutive utility tools are merged into a single collapsed group.
 */
type RenderGroup =
  | { type: "pipeline"; exec: ToolExecution }
  | { type: "utilities"; execs: ToolExecution[] };

export function groupToolExecutionsChronologically(executions: ToolExecution[]): RenderGroup[] {
  const groups: RenderGroup[] = [];
  let utilBuf: ToolExecution[] = [];

  const flushUtils = () => {
    if (utilBuf.length > 0) {
      groups.push({ type: "utilities", execs: utilBuf });
      utilBuf = [];
    }
  };

  for (const exec of executions) {
    if (isPipelineTool(exec.tool)) {
      flushUtils();
      groups.push({ type: "pipeline", exec });
    } else {
      utilBuf.push(exec);
    }
  }
  flushUtils();
  return groups;
}

export const ToolExecutionSteps = memo(function ToolExecutionSteps({
  executions,
  onProposedAction,
  onRejectProposedAction,
  onOpenFilmStudio,
  onSelectNarrativeBranch,
  onRecheckNarrativeForecast,
}: ToolExecutionStepsProps) {
  const groups = useMemo(() => groupToolExecutionsChronologically(executions), [executions]);

  return (
    <div className="space-y-2 mt-2">
      {groups.map((g, i) =>
        g.type === "pipeline"
          ? (
              <PipelineExecution
                key={g.exec.id}
                exec={g.exec}
                onProposedAction={onProposedAction}
                onRejectProposedAction={onRejectProposedAction}
                onOpenFilmStudio={onOpenFilmStudio}
                onSelectNarrativeBranch={onSelectNarrativeBranch}
                onRecheckNarrativeForecast={onRecheckNarrativeForecast}
              />
            )
          : <UtilityToolsGroup key={`utils-${i}`} execs={g.execs} />
      )}
    </div>
  );
});

ToolExecutionSteps.displayName = "ToolExecutionSteps";
