// Models
export { type BookConfig, type Platform, type Genre, type BookStatus, type FanficMode, type ChapterReviewMode, type RevisionGate, BookConfigSchema, PlatformSchema, GenreSchema, BookStatusSchema, FanficModeSchema, normalizePlatformId, normalizePlatformOrOther, resolveChapterReviewMode, resolveRevisionGate } from "./models/book.js";
export { type ChapterMeta, type ChapterStatus, ChapterMetaSchema, ChapterStatusSchema } from "./models/chapter.js";
export { type ProjectConfig, type LLMConfig, type NotifyChannel, type DetectionConfig, type QualityGates, type FoundationConfig, type WritingConfig, type AgentLLMOverride, type InputGovernanceMode, type ResearchSearchConfig, ProjectConfigSchema, LLMConfigSchema, AgentLLMOverrideSchema, DetectionConfigSchema, QualityGatesSchema, FoundationConfigSchema, WritingConfigSchema, InputGovernanceModeSchema, ResearchSearchConfigSchema } from "./models/project.js";
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
  type PlayActionKind,
  type PlayActionIntentInput,
  type PlayActionIntent,
  type PlayEntityType,
  type PlayEntityInput,
  type PlayEntity,
  type PlayVisibility,
  type PlayEdgeInput,
  type PlayEdge,
  type PlayStateSlotKind,
  type PlayStateSlotInput,
  type PlayStateSlot,
  type PlayEvidenceStatus,
  type PlayEvidenceTransitionInput,
  type PlayEvidenceTransition,
  type PlayEventInput,
  type PlayEvent,
  type PlayMutationInput,
  type PlayMutation,
  PlayActionKindSchema,
  PlayActionIntentSchema,
  PlayEntityTypeSchema,
  PlayEntitySchema,
  PlayVisibilitySchema,
  PlayEdgeSchema,
  PlayStateSlotKindSchema,
  PlayStateSlotSchema,
  PlayEvidenceStatusSchema,
  PlayEvidenceTransitionSchema,
  PlayEventSchema,
  PlayMutationSchema,
} from "./models/play.js";
export {
  PlayActionInterpreterAgent,
  PlayWorldMutatorAgent,
  PlaySceneRendererAgent,
  PlaySceneReconcilerAgent,
  type PlayActionInterpreterInput,
  type PlayWorldMutatorInput,
  type PlaySceneRenderInput,
  type PlaySceneReconcileInput,
  type PlaySceneRender,
} from "./play/play-agents.js";
export { PlayDB } from "./play/play-db.js";
export { createPlayDB, type PlayGraphDB } from "./play/play-db-factory.js";
export { PlayFileDB, type PlayGraphSnapshot } from "./play/play-file-db.js";
export {
  applyPlayMutation,
  type PlayReducerDB,
  type ApplyPlayMutationInput,
  type ApplyPlayMutationResult,
} from "./play/play-reducer.js";
export {
  PlayRunner,
  type PlayActionInterpreterLike,
  type PlayWorldMutatorLike,
  type PlaySceneRendererLike,
  type PlayRunnerOptions,
  type PlayStepResult,
} from "./play/play-runner.js";
export { PlayStore, type PlayTranscriptTurn, type PlayWorld, type PlayWorldInput, type PlayRunSummary } from "./play/play-store.js";
export {
  buildPlayEntityImagePrompt,
  buildPlaySceneImagePrompt,
  readPlayImageManifest,
  setPlayImageEntry,
  playImageFileName,
  generatePlayImage,
  readPlayImageSettings,
  writePlayImageSettings,
  DEFAULT_PLAY_IMAGE_SETTINGS,
  type PlayImageEntry,
  type PlayImageManifest,
  type PlayImageSettings,
} from "./play/play-image.js";
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
} from "./models/input-governance.js";
export {
  AgentSkillSchema,
  createSkillRegistry,
  loadConfiguredAgentSkills,
  loadExternalAgentSkills,
  parseAgentSkillDocument,
  type AgentSkill,
  type CreateSkillRegistryOptions,
  type ExternalSkillDiagnostic,
  type LoadConfiguredAgentSkillsInput,
  type LoadExternalAgentSkillsInput,
  type LoadExternalAgentSkillsResult,
  type ParseAgentSkillDocumentOptions,
  type SkillRegistry,
  type SkillResolutionInput,
  type SkillResolutionResult,
} from "./skills/index.js";
export {
  BUILTIN_PROMPTS,
  BUILTIN_PROMPT_PACKS,
  PromptPackManifestSchema,
  PromptPackPromptNotFoundError,
  getBuiltinPrompt,
  listBuiltinPromptPacks,
  listBuiltinPrompts,
  loadPromptPackPrompt,
  promptOverridePath,
  type BuiltinPrompt,
  type LoadedPromptPackPrompt,
  type LoadPromptPackPromptInput,
  type PromptPackManifest,
  type PromptSource,
} from "./prompts/index.js";
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
export { toPosixPath } from "./utils/posix-path.js";
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
  ActionSourceSchema,
  ActionPayloadSchema,
  CreateBookActionPayloadSchema,
  GenerateCoverActionPayloadSchema,
  InteractiveFilmCreateActionPayloadSchema,
  PlayStartActionPayloadSchema,
  RequestedIntentSchema,
  SkillIdSchema,
  ScriptCreateActionPayloadSchema,
  ScriptTargetFormatSchema,
  ShortRunActionPayloadSchema,
  StoryboardCreateActionPayloadSchema,
  WriteNextActionPayloadSchema,
  type ActionSource,
  type ActionPayload,
  type RequestedIntent,
  normalizeActionSource,
  normalizeActionPayload,
  normalizeSkillIdList,
  normalizeRequestedIntent,
  normalizePlayMode,
  isExplicitWriteChapterCommand,
  isUsablePlayInitialScene,
  isWriteNextInstruction,
} from "./interaction/action-envelope.js";
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
  SessionKindSchema,
  PlayModeSchema,
  GlobalSessionSchema,
  type BookSession,
  type SessionKind,
  type PlayMode,
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
  SHORT_FICTION_EN_DEFAULT_WORDS_PER_CHAPTER,
  SHORT_FICTION_EN_MIN_WORDS_PER_CHAPTER,
  SHORT_FICTION_EN_MAX_WORDS_PER_CHAPTER,
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
  type ShortFictionLanguage,
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

// Narrative forecast (issue #342): non-canonical multi-branch story projection
export {
  FORECAST_MIN_BRANCHES,
  FORECAST_MAX_BRANCHES,
  FORECAST_DEFAULT_BRANCHES,
  FORECAST_MIN_HORIZON,
  FORECAST_MAX_HORIZON,
  FORECAST_DEFAULT_HORIZON,
  NarrativeForecastSchema,
  ForecastBranchSchema,
  parseForecastModelOutput,
  type NarrativeForecast,
  type ForecastBranch,
  type ForecastBeat,
  type ForecastRisk,
  type ForecastStatus,
  type ForecastModelOutput,
} from "./forecast/schema.js";
export { ForecastStore, assertSafeForecastId, type ForecastStoreOptions } from "./forecast/store.js";
export {
  buildForecastContext,
  computeContextFingerprint,
  renderForecastContextMarkdown,
  type ForecastContext,
  type ForecastContextSections,
} from "./forecast/context-builder.js";
export { NarrativeForecastAgent, type ForecastGenerationInput } from "./forecast/agent.js";
export { renderForecastComparisonMarkdown, renderSelectedBranchPlanMarkdown } from "./forecast/render.js";
export {
  createNarrativeForecast,
  getNarrativeForecast,
  selectNarrativeBranch,
  type CreateNarrativeForecastOptions,
  type GetNarrativeForecastOptions,
  type SelectNarrativeBranchOptions,
  type NarrativeForecastCreateResult,
  type NarrativeForecastGetResult,
  type NarrativeForecastSelectResult,
} from "./forecast/runner.js";

// Agent (pi-agent integration)
export * from "./agent/index.js";

// LLM
export { createLLMClient, chatCompletion, createStreamMonitor, PartialResponseError, type LLMClient, type LLMResponse, type LLMMessage, type StreamProgress, type OnStreamProgress } from "./llm/provider.js";
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
  normalizeCoverBaseUrl,
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
export { isNewLayoutBook, isBookFoundationComplete } from "./utils/outline-paths.js";
export { fetchUrl, searchWeb } from "./utils/web-search.js";
export {
  runResearchReport,
  type ResearchDepth,
  type ResearchInput,
  type ResearchPurpose,
  type ResearchReport,
} from "./agents/researcher.js";
export { filterHooks, filterSummaries, filterSubplots, filterEmotionalArcs, filterCharacterMatrix } from "./utils/context-filter.js";
export { extractPOVFromOutline, filterMatrixByPOV, filterHooksByPOV } from "./utils/pov-filter.js";
export { ConsolidatorAgent } from "./agents/consolidator.js";
export { MemoryDB, type Fact, type StoredSummary } from "./state/memory-db.js";
export { StateValidatorAgent } from "./agents/state-validator.js";
export { loadRuntimeStateSnapshot, buildRuntimeStateArtifacts, saveRuntimeStateSnapshot, loadNarrativeMemorySeed, loadSnapshotCurrentStateFacts, type RuntimeStateArtifacts, type NarrativeMemorySeed } from "./state/runtime-state-store.js";
export { splitChapters, type SplitChapter } from "./utils/chapter-splitter.js";
export * from "./translation/index.js";
export { countChapterLength, resolveLengthCountingMode, formatLengthCount, buildLengthSpec, defaultChapterLength, DEFAULT_CHAPTER_LENGTH_ZH, DEFAULT_CHAPTER_LENGTH_EN, isOutsideSoftRange, isOutsideHardRange, chooseNormalizeMode, type LengthLanguage } from "./utils/length-metrics.js";
export { createLogger, createStderrSink, createJsonLineSink, nullSink, type Logger, type LogSink, type LogLevel, type LogEntry } from "./utils/logger.js";
export { inferLanguage, type WritingLanguage } from "./utils/language.js";
export { loadProjectConfig, GLOBAL_CONFIG_DIR, GLOBAL_ENV_PATH, isApiKeyOptionalForEndpoint } from "./utils/config-loader.js";
export { resolveEffectiveLLMConfig, type EffectiveLLMConfigResult, type EffectiveLLMDiagnostics, type LLMConfigCliOverrides, type LLMConfigMode, type LLMConsumer, type LLMValueSource } from "./utils/effective-llm-config.js";
export { loadLLMEnvLayers, mergeEnvMaps, studioIgnoredEnv, cliOverlayEnv, legacyEnv, type LLMEnvLayers, type LLMEnvMap } from "./utils/llm-env.js";
export type { ContextCompressionCallback, ContextCompressionCategory, ContextCompressionEvent, ContextCompressionPhase } from "./models/context-compression.js";
export { computeAnalytics, type AnalyticsData, type TokenStats } from "./utils/analytics.js";
export {
  evaluateBookQuality,
  computeChapterEvalScore,
  type BookEval,
  type ChapterEval,
  type EvaluateBookQualityOptions,
} from "./utils/book-eval.js";
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
export { PipelineRunner, type PipelineConfig, type ChapterPipelineResult, type WriteChaptersOptions, type DraftResult, type PlanChapterResult, type ComposeChapterResult, type ReviseResult, type TruthFiles, type BookStatusInfo, type ImportChaptersInput, type ImportChaptersResult, type TokenUsageSummary } from "./pipeline/runner.js";
export { Scheduler, type SchedulerConfig } from "./pipeline/scheduler.js";
export { detectChapter, detectAndRewrite, loadDetectionHistory, type DetectChapterResult, type DetectAndRewriteResult } from "./pipeline/detection-runner.js";
export { runScriptCreation, runStoryboardCreation, runInteractiveFilmCreation, createStoryboardAssetsManifest, type ScriptCreationRunOptions, type ScriptCreationRunResult, type StoryboardAssetsManifest, type StoryboardCreationRunOptions, type StoryboardCreationRunResult, type InteractiveFilmCreationRunOptions, type InteractiveFilmCreationRunResult, type StoryboardImageAsset, type StoryboardImageAssetVariant } from "./pipeline/script-storyboard-runner.js";
export { ScriptCreationAgent, StoryboardCreationAgent, InteractiveFilmCreationAgent, renderScriptSpec, renderStoryboardSpec, renderInteractiveFilmSpec, type ScriptCreationInput, type ScriptTargetFormat, type StoryboardCreationInput, type InteractiveFilmCreationInput } from "./agents/script-storyboard.js";

// State
export { BookWriteLockError, StateManager } from "./state/manager.js";
export { syncChapterWordCounts, type ChapterWordCountChange, type ChapterWordSyncDeps, type ChapterWordSyncResult } from "./state/chapter-word-sync.js";
export { deleteLatestChapter, type ChapterDeleteDeps, type DeleteLatestChapterOptions, type DeleteLatestChapterResult } from "./state/chapter-delete.js";
export {
  archiveChapterVersion,
  listChapterVersions,
  readChapterPlanDocument,
  readChapterUserBrief,
  readChapterVersion,
  saveChapterUserBrief,
  type ChapterVersion,
  type ChapterVersionSource,
} from "./state/chapter-workspace.js";
export { bootstrapStructuredStateFromMarkdown } from "./state/state-bootstrap.js";
export { renderCurrentStateProjection, renderHooksProjection, renderChapterSummariesProjection } from "./state/state-projections.js";
export { applyRuntimeStateDelta, type RuntimeStateSnapshot } from "./state/state-reducer.js";
export { validateRuntimeState, type RuntimeStateValidationIssue } from "./state/state-validator.js";

// Notify
export { dispatchNotification, dispatchWebhookEvent, type NotifyMessage } from "./notify/dispatcher.js";
export type { NotifyFormat } from "./notify/format.js";
export type { TelegramConfig } from "./notify/telegram.js";
export type { FeishuConfig } from "./notify/feishu.js";
export type { WechatWorkConfig } from "./notify/wechat-work.js";
export type { WebhookConfig, WebhookEvent, WebhookPayload } from "./notify/webhook.js";

export async function sendTelegram(
  config: import("./notify/telegram.js").TelegramConfig,
  message: string,
  format?: import("./notify/format.js").NotifyFormat,
): Promise<void> {
  const transport = await import("./notify/telegram.js");
  await transport.sendTelegram(config, message, format);
}

export async function sendFeishu(
  config: import("./notify/feishu.js").FeishuConfig,
  title: string,
  text: string,
  format?: import("./notify/format.js").NotifyFormat,
): Promise<void> {
  const transport = await import("./notify/feishu.js");
  await transport.sendFeishu(config, title, text, format);
}

export async function sendWechatWork(
  config: import("./notify/wechat-work.js").WechatWorkConfig,
  text: string,
  format?: import("./notify/format.js").NotifyFormat,
): Promise<void> {
  const transport = await import("./notify/wechat-work.js");
  await transport.sendWechatWork(config, text, format);
}

export async function sendWebhook(
  config: import("./notify/webhook.js").WebhookConfig,
  payload: import("./notify/webhook.js").WebhookPayload,
): Promise<void> {
  const transport = await import("./notify/webhook.js");
  await transport.sendWebhook(config, payload);
}

// ── Interactive Film (story graph) ──
export {
  StoryGraphSchema,
  StoryNodeSchema,
  ChoiceSchema,
  VariableSchema,
  EndingSchema,
  ConditionSchema,
  EffectSchema,
  type StoryGraph,
  type StoryNode,
  type Choice,
  type Variable,
  type Ending,
  type Condition,
  type Effect,
  type VarValue,
  type NodeType,
} from "./interactive-film/graph-schema.js";
export {
  evaluateCondition,
  applyEffects,
  visibleChoices,
  initVarState,
  type VarState,
} from "./interactive-film/evaluator.js";
export {
  validateStoryGraph,
  reviewStoryGraph,
  type ValidationReport,
  type ValidationIssue,
} from "./interactive-film/validation.js";
export {
  loadStoryGraph,
  saveStoryGraph,
  storyGraphPath,
} from "./interactive-film/graph-store.js";
export {
  generateStoryGraph,
  buildStoryGraphFromLLMText,
  extractJson,
  type GenerateStoryGraphInput,
} from "./interactive-film/generate.js";
export {
  WorldAnchorSchema,
  CharacterSchema,
  VoiceProfileSchema,
  type WorldAnchor,
  type Character,
  type VoiceProfile,
} from "./interactive-film/graph-schema.js";
export {
  StoryGraphDeltaSchema,
  applyStoryGraphDelta,
  type StoryGraphDelta,
} from "./interactive-film/delta.js";
export {
  applyGraphDelta,
  loadAuthoringState,
  revertToSnapshot,
  authoringStatePath,
  type AuthoringState,
} from "./interactive-film/authoring-store.js";
export {
  buildWorldAnchorDelta,
  buildAddVariableDelta,
  buildDefineEndingDelta,
  buildRemoveNodeDelta,
  buildConnectChoiceDelta,
  buildUpsertCharactersDelta,
} from "./interactive-film/authoring-tools.js";
export { writeCharacterFacts, readCharacterVoices } from "./interactive-film/memory-link.js";
export {
  buildFillNodeDeltaFromLLMText,
  buildStructureDeltaFromLLMText,
} from "./interactive-film/authoring-generate.js";
export { summarizeStoryGraph, buildFilmAuthoringContext } from "./interactive-film/film-context.js";
export {
  generateNodeImage,
  defaultNodeImageDeps,
  type NodeImageDeps,
} from "./interactive-film/node-image.js";
export {
  enumerateRuntimePaths,
  type RuntimePath,
} from "./interactive-film/paths.js";
export {
  emotionScore,
  nodeEmotion,
  analyzeEmotionalArcs,
  analyzePathDistribution,
} from "./interactive-film/emotion.js";
export { exportInk } from "./interactive-film/export-ink.js";
export { buildPlayableHtml } from "./interactive-film/export-html.js";
