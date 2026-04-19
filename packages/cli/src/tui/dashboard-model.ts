import type {
  ExecutionStatus,
  InteractionEvent,
  InteractionMessage,
  InteractionSession,
} from "@actalk/inkos-core";
import { formatModeLabel, normalizeStageLabel, type TuiCopy } from "./i18n.js";

export interface DashboardMessageRow {
  readonly key: string;
  readonly label: string;
  readonly role: InteractionMessage["role"];
  readonly content: string;
}

export interface DashboardEventRow {
  readonly key: string;
  readonly status: ExecutionStatus;
  readonly summary: string;
}

export interface DashboardViewModel {
  readonly projectName: string;
  readonly activeBookTitle?: string;
  readonly modelLabel: string;
  readonly modeLabel: string;
  readonly executionStatus: ExecutionStatus;
  readonly executionLabel: string;
  readonly headerLine: string;
  readonly statusPrimaryLine: string;
  readonly statusSecondaryLine: string;
  readonly messageRows: ReadonlyArray<DashboardMessageRow>;
  readonly eventRows: ReadonlyArray<DashboardEventRow>;
  readonly pendingDecisionSummary?: string;
  readonly composerPlaceholder: string;
  readonly composerHelper: string;
  readonly composerStatus: string;
  readonly errorText?: string;
}

export interface BuildDashboardViewModelParams {
  readonly projectName: string;
  readonly activeBookTitle?: string;
  readonly modelLabel: string;
  readonly depthLabel?: string;
  readonly copy: TuiCopy;
  readonly session: InteractionSession;
  readonly isSubmitting: boolean;
  readonly lastError?: string;
  readonly sinceTimestamp?: number;
  readonly terminalRows?: number;
  readonly scrollOffset?: number;
}

export function buildDashboardViewModel(params: BuildDashboardViewModelParams): DashboardViewModel {
  const status = params.session.currentExecution?.status ?? "idle";
  const executionLabel = normalizeStageLabel(params.session.currentExecution?.stageLabel ?? status, params.copy);
  const modeLabel = formatModeLabel(params.session.automationMode, params.copy);
  const bookLabel = params.activeBookTitle ?? params.session.activeBookId ?? params.copy.labels.none;
  const draftTitle = params.session.creationDraft?.title;
  const draftQuestion = params.session.creationDraft?.nextQuestion;
  const sinceTimestamp = params.sinceTimestamp ?? 0;
  const terminalRows = params.terminalRows ?? process.stdout.rows ?? 24;
  const conversationLimit = Math.max(4, terminalRows - 10);

  const filteredMessages = params.session.messages
    .filter((message) => message.timestamp >= sinceTimestamp);
  const scrollOffset = params.scrollOffset ?? 0;
  const endIndex = filteredMessages.length - scrollOffset;
  const startIndex = Math.max(0, endIndex - conversationLimit);
  const messageRows = filteredMessages
    .slice(startIndex, endIndex > 0 ? endIndex : undefined)
    .map((message, index) => ({
      key: `${message.timestamp}-${index}`,
      label: roleLabel(message.role, params.copy),
      role: message.role,
      content: message.content,
    }));

  const eventRows = params.session.events
    .filter((event) => event.timestamp >= sinceTimestamp)
    .slice(-3)
    .map((event, index) => ({
      key: `${event.timestamp}-${index}`,
      status: event.status,
      summary: summarizeEvent(event, params.copy),
    }));

  const latestEventSummary = eventRows[eventRows.length - 1]?.summary;

  return {
    projectName: params.projectName,
    activeBookTitle: params.activeBookTitle ?? params.session.activeBookId,
    modelLabel: params.modelLabel,
    modeLabel,
    executionStatus: status,
    executionLabel,
    headerLine: [
      `${params.copy.labels.project} ${params.projectName}`,
      `${params.copy.labels.book} ${bookLabel}`,
      draftTitle ? `${params.copy.labels.draft} ${draftTitle}` : undefined,
      `${params.copy.labels.depth} ${params.depthLabel ?? params.copy.depthLabels.normal}`,
      `${params.copy.labels.session} ${params.session.sessionId.slice(-4)}`,
      params.copy.labels.messageCount(params.session.messages.length),
    ].filter(Boolean).join(" · "),
    statusPrimaryLine: `${params.copy.labels.stage} ${executionLabel} · ${params.copy.labels.model} ${params.modelLabel}`,
    statusSecondaryLine: params.lastError
      ? `${params.copy.labels.error} · ${compactInline(params.lastError)}`
      : params.isSubmitting && latestEventSummary
        ? `${params.copy.labels.recent} · ${latestEventSummary}`
      : params.session.pendingDecision?.summary
          ? `${params.copy.labels.pending} · ${compactInline(params.session.pendingDecision.summary)}`
        : draftQuestion
          ? `${params.copy.labels.draft} · ${compactInline(draftQuestion)}`
        : draftTitle
          ? `${params.copy.labels.draft} · ${draftTitle}`
        : latestEventSummary
            ? `${params.copy.labels.recent} · ${latestEventSummary}`
            : `${params.copy.labels.ready} · ${bookLabel}`,
    messageRows,
    eventRows,
    pendingDecisionSummary: params.session.pendingDecision?.summary,
    composerPlaceholder: params.copy.composer.placeholder,
    composerHelper: params.copy.composer.helper,
    composerStatus: params.isSubmitting
      ? params.copy.composer.submitting
      : params.lastError
        ? params.copy.composer.failed
        : params.copy.composer.ready,
    errorText: params.lastError,
  };
}

function roleLabel(role: InteractionMessage["role"], copy: TuiCopy): string {
  switch (role) {
    case "user":
      return copy.roles.user;
    case "assistant":
      return copy.roles.assistant;
    case "system":
      return copy.roles.system;
    default:
      return role;
  }
}

function summarizeEvent(event: InteractionEvent, copy: TuiCopy): string {
  const base = compactInline(event.detail?.trim() || event.kind);
  if (event.bookId && event.chapterNumber !== undefined) {
    const chapterLabel = copy.locale === "zh-CN"
      ? `第 ${event.chapterNumber} 章`
      : `ch.${event.chapterNumber}`;
    return `${base} (${event.bookId} ${chapterLabel})`;
  }
  if (event.bookId) {
    return `${base} (${event.bookId})`;
  }
  return base;
}

function compactInline(value: string): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > 72 ? singleLine.slice(0, 69) + "..." : singleLine;
}
