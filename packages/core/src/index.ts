// Models
export { type BookConfig, type Platform, type Genre, type BookStatus, type FanficMode, BookConfigSchema, PlatformSchema, GenreSchema, BookStatusSchema, FanficModeSchema, normalizePlatformId, normalizePlatformOrOther } from "./models/book.js";
export { type ChapterMeta, type ChapterStatus, ChapterMetaSchema, ChapterStatusSchema } from "./models/chapter.js";
export { type ProjectConfig, type LLMConfig, type NotifyChannel, type DetectionConfig, type QualityGates, type FoundationConfig, type WritingConfig, type AgentLLMOverride, type InputGovernanceMode, ProjectConfigSchema, LLMConfigSchema, AgentLLMOverrideSchema, DetectionConfigSchema, QualityGatesSchema, FoundationConfigSchema, WritingConfigSchema, InputGovernanceModeSchema } from "./models/project.js";
export { type CurrentState, type ParticleLedger, type PendingHooks, type PendingHook, type LedgerEntry } from "./models/state.js";
export { type GenreProfile, type ParsedGenreProfile, GenreProfileSchema, parseGenreProfile } from "./models/genre-profile.js";
export { type BookRules, type ParsedBookRules, BookRulesSchema, parseBookRules, tryParseBookRulesFrontmatter } from "./models/book-rules.js";
export { type DetectionHistoryEntry, type DetectionStats } from "./models/detection.js";
export { type StyleProfile } from "./models/style-profile.js";
export { type LengthCountingMode, type LengthNormalizeMode, type LengthSpec, type LengthTelemetry, type LengthWarning, LengthCountingModeSchema, LengthNormalizeModeSchema, LengthSpecSchema, LengthTelemetrySchema, LengthWarningSchema } from "./models/length-governance.js";
export {
  type RuntimeStateLanguage,
  type StateManifest,
  type HookStatus,
  type HookRecord,
  type HooksState,
  type ChapterSummaryRow,
  type ChapterSummariesState,
  type CurrentStateFact,
  type CurrentStateState,
  type CurrentStatePatch,
  type HookOps,
  type NewHookCandidate,
  type RuntimeStateDelta,
  RuntimeStateLanguageSchema,
  StateManifestSchema,
  HookStatusSchema,
  HookRecordSchema,
  HooksStateSchema,
  ChapterSummaryRowSchema,
  ChapterSummariesStateSchema,
  CurrentStateFactSchema,
  CurrentStateStateSchema,
  CurrentStatePatchSchema,
  HookOpsSchema,
  NewHookCandidateSchema,
  RuntimeStateDeltaSchema,
} from "./models/runtime-state.js";
export {
  type ChapterMemo,
  type ChapterIntent,
  type ContextSource,
  type ContextPackage,
  type RuleLayerScope,
  type RuleLayer,
  type OverrideEdge,
  type ActiveOverride,
  type RuleStackSections,
  type RuleStack,
  type ChapterTrace,
  ChapterMemoSchema,
  ChapterIntentSchema,
  ContextSourceSchema,
  ContextPackageSchema,
  RuleLayerScopeSchema,
  RuleLayerSchema,
  OverrideEdgeSchema,
  ActiveOverrideSchema,
  RuleStackSectionsSchema,
  RuleStackSchema,
  ChapterTraceSchema,
  type StoryDirection,
} from "./models/input-governance.js";
export { PlannerAgent, type PlanChapterInput, type PlanChapterOutput } from "./agents/planner.js";
export {
  ComposerAgent,
  composeGovernedChapter,
  type ComposeChapterInput,
  type ComposeChapterOutput,
} from "./agents/composer.js";
export {
  PLANNER_MEMO_SYSTEM_PROMPT,
  PLANNER_MEMO_USER_TEMPLATE,
  buildPlannerUserMessage,
  buildGoldenOpeningGuidance,
  type PlannerUserMessageInput,
} from "./agents/planner-prompts.js";
export {
  gatherPlanningMaterials,
  type PlanningMaterials,
} from "./utils/planning-materials.js";
export {
  buildProxyFetchInit,
  fetchWithProxy,
  resolveProxyUrl,
} from "./utils/proxy-fetch.js";
export { assertSafeBookId, deriveBookIdFromTitle, isSafeBookId } from "./utils/book-id.js";
export { safeChildPath } from "./utils/path-safety.js";
export {
  AutomationModeSchema,
  type AutomationMode,
  normalizeAutomationMode,
} from "./interaction/modes.js";
export {
  InteractionIntentTypeSchema,
  type InteractionIntentType,
  InteractionRequestSchema,
  type InteractionRequest,
} from "./interaction/intents.js";
export {
  ExecutionStatusSchema,
  ExecutionStateSchema,
  InteractionEventSchema,
  type ExecutionStatus,
  type ExecutionState,
  type InteractionEvent,
  isTerminalExecutionStatus,
} from "./interaction/events.js";
export {
  BookCreationDraftSchema,
  DraftRoundSchema,
  PendingDecisionSchema,
  InteractionMessageSchema,
  InteractionSessionSchema,
  type BookCreationDraft,
  type DraftRound,
  type PendingDecision,
  type InteractionMessage,
  type InteractionSession,
  bindActiveBook,
  clearCreationDraft,
  clearPendingDecision,
  updateAutomationMode,
  updateCreationDraft,
  appendInteractionMessage,
  appendInteractionEvent,
  BookSessionSchema,
  GlobalSessionSchema,
  type BookSession,
  type GlobalSession,
  createBookSession,
  appendBookSessionMessage,
} from "./interaction/session.js";
export {
  resolveProjectSessionPath,
  createProjectSession,
  loadProjectSession,
  persistProjectSession,
  resolveSessionActiveBook,
  loadGlobalSession,
  persistGlobalSession,
} from "./interaction/project-session-store.js";
export {
  loadBookSession,
  persistBookSession,
  listBookSessions,
  renameBookSession,
  deleteBookSession,
  migrateBookSession,
  createAndPersistBookSession,
  SessionAlreadyMigratedError,
} from "./interaction/book-session-store.js";
export {
  appendManualSessionMessages,
  appendTranscriptEvent,
  sessionsDir,
  readTranscriptEvents,
  nextTranscriptSeq,
  transcriptPath,
  legacyBookSessionPath,
} from "./interaction/session-transcript.js";
export {
  cleanRestoredAgentMessages,
  committedMessageEvents,
  deriveBookSessionFromTranscript,
  restoreAgentMessagesFromTranscript,
} from "./interaction/session-transcript-restore.js";
export {
  MessageEventSchema,
  RequestCommittedEventSchema,
  RequestFailedEventSchema,
  RequestStartedEventSchema,
  SessionCreatedEventSchema,
  SessionMetadataUpdatedEventSchema,
  TranscriptEventSchema,
} from "./interaction/session-transcript-schema.js";
export type {
  TranscriptEvent,
  MessageEvent,
  RequestCommittedEvent,
  RequestFailedEvent,
  RequestStartedEvent,
  SessionCreatedEvent,
  SessionMetadataUpdatedEvent,
} from "./interaction/session-transcript-schema.js";
export { routeInteractionRequest } from "./interaction/request-router.js";
export {
  routeNaturalLanguageIntent,
  type NaturalLanguageRoutingContext,
} from "./interaction/nl-router.js";
export {
  processProjectInteractionInput,
  processProjectInteractionRequest,
} from "./interaction/project-control.js";
export { createInteractionToolsFromDeps } from "./interaction/project-tools.js";
export { buildExportArtifact, writeExportArtifact } from "./interaction/export-artifact.js";
export {
  normalizeTruthFileName,
  classifyTruthAuthority,
  type TruthAuthority,
} from "./interaction/truth-authority.js";
export {
  executeEditTransaction,
  planEditTransaction,
  type EditRequest,
  type EditExecutionDeps,
  type ExecutedEditTransaction,
  type PlannedEditTransaction,
} from "./interaction/edit-controller.js";
export {
  runInteractionRequest,
  type InteractionRuntimeTools,
  type InteractionRuntimeResult,
} from "./interaction/runtime.js";
export {
  parseDraftDirectives,
  createDirectiveStreamFilter,
  type ParsedDraftResponse,
} from "./interaction/draft-directive-parser.js";

export {
  SHORT_FICTION_DEFAULT_CHAPTERS,
  SHORT_FICTION_MIN_CHAPTERS,
  SHORT_FICTION_MAX_CHAPTERS,
  SHORT_FICTION_DEFAULT_CHARS_PER_CHAPTER,
  SHORT_FICTION_MIN_CHARS_PER_CHAPTER,
  SHORT_FICTION_MAX_CHARS_PER_CHAPTER,
  ShortFictionOutlineAgent,
  ShortFictionOutlineReviewerAgent,
  ShortFictionOutlineReviserAgent,
  ShortFictionWriterAgent,
  ShortFictionDraftReviewerAgent,
  ShortFictionDraftReviserAgent,
  ShortFictionPackagingAgent,
  parseShortFictionBatchDraft,
  validateShortFictionDraftForFinal,
  renderShortFictionDraftMarkdown,
  type ShortFictionOutline,
  type ShortFictionBatchDraft,
  type ShortFictionChapter,
  type ShortFictionSalesPackage,
  type ShortFictionReference,
} from "./agents/short-fiction.js";
export {
  generateShortFictionCover,
  runShortFictionProduction,
  extractResponsesImageBase64,
  resolveCoverApiKey,
  type ShortFictionCoverOptions,
  type ShortFictionCoverResult,
  type ShortFictionRunOptions,
  type ShortFictionRunResult,
  type ShortFictionRunRuntimes,
} from "./pipeline/short-fiction-runner.js";

// Agent (pi-agent integration)
export * from "./agent/index.js";

// LLM
export { createLLMClient, chatCompletion, chatWithTools, createStreamMonitor, PartialResponseError, type LLMClient, type LLMResponse, type LLMMessage, type ToolDefinition, type ToolCall, type AgentMessage, type ChatWithToolsResult, type StreamProgress, type OnStreamProgress } from "./llm/provider.js";
export {
  SERVICE_PRESETS,
  SERVICE_TO_PI_PROVIDER,
  resolveServicePreset,
  resolveServiceProviderFamily,
  resolveServicePiProvider,
  resolveServiceModelsBaseUrl,
  guessServiceFromBaseUrl,
  listModelsForService,
  listServicesWithModelCount,
  type ServicePreset,
  type ModelInfo,
} from "./llm/service-presets.js";
export { resolveServiceModel, type ResolvedModel } from "./llm/service-resolver.js";
export { loadSecrets, saveSecrets, getServiceApiKey, type SecretsFile } from "./llm/secrets.js";
export {
  COVER_PROVIDER_PRESETS,
  coverSecretKey,
  resolveCoverProviderPreset,
  type CoverProviderId,
  type CoverProviderPreset,
} from "./llm/cover-providers.js";
export { migrateConfig, type MigrationResult } from "./llm/config-migration.js";
export { getAllEndpoints, getEndpoint, type InkosEndpoint, type InkosModel, type EndpointGroup } from "./llm/providers/index.js";
export { probeModelsFromUpstream, type ProbedModel } from "./llm/providers/probe.js";

// Agents
export { BaseAgent, type AgentContext } from "./agents/base.js";
export { ArchitectAgent, type ArchitectOutput } from "./agents/architect.js";
export { WriterAgent, type WriteChapterInput, type WriteChapterOutput, type TokenUsage } from "./agents/writer.js";
export { LengthNormalizerAgent, type NormalizeLengthInput, type NormalizeLengthOutput } from "./agents/length-normalizer.js";
export { ContinuityAuditor, type AuditResult, type AuditIssue } from "./agents/continuity.js";
export { ReviserAgent, DEFAULT_REVISE_MODE, type ReviseOutput, type ReviseMode } from "./agents/reviser.js";
export { PolisherAgent, type PolishChapterInput, type PolishChapterOutput } from "./agents/polisher.js";
export { RadarAgent, type RadarResult, type RadarRecommendation } from "./agents/radar.js";
export { FanqieRadarSource, QidianRadarSource, TextRadarSource, type RadarSource, type PlatformRankings, type RankingEntry } from "./agents/radar-source.js";
export { readGenreProfile, readBookRules, listAvailableGenres, getBuiltinGenresDir } from "./agents/rules-reader.js";
export { buildWriterSystemPrompt, buildGoldenOpeningDiscipline } from "./agents/writer-prompts.js";
export { analyzeAITells, type AITellResult, type AITellIssue } from "./agents/ai-tells.js";
export { analyzeSensitiveWords, type SensitiveWordResult, type SensitiveWordMatch } from "./agents/sensitive-words.js";
export { detectAIContent, type DetectionResult } from "./agents/detector.js";
export { analyzeStyle } from "./agents/style-analyzer.js";
export { analyzeDetectionInsights } from "./agents/detection-insights.js";
export { validatePostWrite, detectParagraphLengthDrift, detectParagraphShapeWarnings, detectDuplicateTitle, type PostWriteViolation } from "./agents/post-write-validator.js";
export { ChapterAnalyzerAgent, type AnalyzeChapterInput, type AnalyzeChapterOutput } from "./agents/chapter-analyzer.js";
export { parseWriterOutput, parseCreativeOutput, type ParsedWriterOutput, type CreativeOutput } from "./agents/writer-parser.js";
export { buildSettlerSystemPrompt, buildSettlerUserPrompt } from "./agents/settler-prompts.js";
export { parseSettlementOutput, type SettlementOutput } from "./agents/settler-parser.js";
export { parseSettlerDeltaOutput, type SettlerDeltaOutput } from "./agents/settler-delta-parser.js";
export { FanficCanonImporter, type FanficCanonOutput } from "./agents/fanfic-canon-importer.js";
export { getFanficDimensionConfig, FANFIC_DIMENSIONS, type FanficDimensionConfig } from "./agents/fanfic-dimensions.js";
export { buildFanficCanonSection, buildCharacterVoiceProfiles, buildFanficModeInstructions } from "./agents/fanfic-prompt-sections.js";
export * from "./prompts/index.js";

// Utils
export { isNewLayoutBook } from "./utils/outline-paths.js";
export { fetchUrl, searchWeb } from "./utils/web-search.js";
export { filterHooks, filterSummaries, filterSubplots, filterEmotionalArcs, filterCharacterMatrix } from "./utils/context-filter.js";
export { extractPOVFromOutline, filterMatrixByPOV, filterHooksByPOV } from "./utils/pov-filter.js";
export { ConsolidatorAgent } from "./agents/consolidator.js";
export { MemoryDB, type Fact, type StoredSummary } from "./state/memory-db.js";
export { StateValidatorAgent } from "./agents/state-validator.js";
export { loadRuntimeStateSnapshot, buildRuntimeStateArtifacts, saveRuntimeStateSnapshot, loadNarrativeMemorySeed, loadSnapshotCurrentStateFacts, type RuntimeStateArtifacts, type NarrativeMemorySeed } from "./state/runtime-state-store.js";
export { splitChapters, type SplitChapter } from "./utils/chapter-splitter.js";
export { countChapterLength, resolveLengthCountingMode, formatLengthCount, buildLengthSpec, isOutsideSoftRange, isOutsideHardRange, chooseNormalizeMode, type LengthLanguage } from "./utils/length-metrics.js";
export { createLogger, createStderrSink, createJsonLineSink, nullSink, type Logger, type LogSink, type LogLevel, type LogEntry } from "./utils/logger.js";
export { loadProjectConfig, GLOBAL_CONFIG_DIR, GLOBAL_ENV_PATH, isApiKeyOptionalForEndpoint } from "./utils/config-loader.js";
export { resolveEffectiveLLMConfig, type EffectiveLLMConfigResult, type EffectiveLLMDiagnostics, type LLMConfigCliOverrides, type LLMConfigMode, type LLMConsumer, type LLMValueSource } from "./utils/effective-llm-config.js";
export { loadLLMEnvLayers, mergeEnvMaps, studioIgnoredEnv, cliOverlayEnv, legacyEnv, type LLMEnvLayers, type LLMEnvMap } from "./utils/llm-env.js";
export { computeAnalytics, type AnalyticsData, type TokenStats } from "./utils/analytics.js";
export {
  collectStaleHookDebt,
  evaluateHookAdmission,
  classifyHookDisposition,
  type HookAdmissionCandidate,
  type HookAdmissionDecision,
  type HookDisposition,
} from "./utils/hook-governance.js";
export { arbitrateRuntimeStateDeltaHooks, type HookArbiterDecision } from "./utils/hook-arbiter.js";
export { analyzeHookHealth } from "./utils/hook-health.js";

// Pipeline
export { PipelineRunner, type PipelineConfig, type ChapterPipelineResult, type DraftResult, type PlanChapterResult, type ComposeChapterResult, type ReviseResult, type TruthFiles, type BookStatusInfo, type ImportChaptersInput, type ImportChaptersResult, type TokenUsageSummary } from "./pipeline/runner.js";
export { Scheduler, type SchedulerConfig } from "./pipeline/scheduler.js";
export { runAgentLoop, AGENT_TOOLS as AGENT_TOOLS, type AgentLoopOptions } from "./pipeline/agent.js";
export { detectChapter, detectAndRewrite, loadDetectionHistory, type DetectChapterResult, type DetectAndRewriteResult } from "./pipeline/detection-runner.js";

// State
export { StateManager } from "./state/manager.js";
export { bootstrapStructuredStateFromMarkdown } from "./state/state-bootstrap.js";
export { renderCurrentStateProjection, renderHooksProjection, renderChapterSummariesProjection } from "./state/state-projections.js";
export { applyRuntimeStateDelta, type RuntimeStateSnapshot } from "./state/state-reducer.js";
export { validateRuntimeState, type RuntimeStateValidationIssue } from "./state/state-validator.js";

// Notify
export { dispatchNotification, dispatchWebhookEvent, type NotifyMessage } from "./notify/dispatcher.js";
export type { TelegramConfig } from "./notify/telegram.js";
export type { FeishuConfig } from "./notify/feishu.js";
export type { WechatWorkConfig } from "./notify/wechat-work.js";
export type { WebhookConfig, WebhookEvent, WebhookPayload } from "./notify/webhook.js";

export async function sendTelegram(
  config: import("./notify/telegram.js").TelegramConfig,
  message: string,
): Promise<void> {
  const transport = await import("./notify/telegram.js");
  await transport.sendTelegram(config, message);
}

export async function sendFeishu(
  config: import("./notify/feishu.js").FeishuConfig,
  title: string,
  text: string,
): Promise<void> {
  const transport = await import("./notify/feishu.js");
  await transport.sendFeishu(config, title, text);
}

export async function sendWechatWork(
  config: import("./notify/wechat-work.js").WechatWorkConfig,
  text: string,
): Promise<void> {
  const transport = await import("./notify/wechat-work.js");
  await transport.sendWechatWork(config, text);
}

export async function sendWebhook(
  config: import("./notify/webhook.js").WebhookConfig,
  payload: import("./notify/webhook.js").WebhookPayload,
): Promise<void> {
  const transport = await import("./notify/webhook.js");
  await transport.sendWebhook(config, payload);
}
