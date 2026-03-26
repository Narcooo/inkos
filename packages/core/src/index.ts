// Models
export { type BookConfig, type Platform, type Genre, type BookStatus, BookConfigSchema, PlatformSchema, GenreSchema, BookStatusSchema } from "./models/book.js";
export { type ChapterMeta, type ChapterStatus, ChapterMetaSchema, ChapterStatusSchema } from "./models/chapter.js";
export { type ProjectConfig, type LLMConfig, type NotifyChannel, type DetectionConfig, type QualityGates, type AgentLLMOverride, ProjectConfigSchema, LLMConfigSchema, AgentLLMOverrideSchema, DetectionConfigSchema, QualityGatesSchema } from "./models/project.js";
export { type CurrentState, type ParticleLedger, type PendingHooks, type PendingHook, type LedgerEntry } from "./models/state.js";
export { type GenreProfile, type ParsedGenreProfile, GenreProfileSchema, parseGenreProfile } from "./models/genre-profile.js";
export { type BookRules, type ParsedBookRules, BookRulesSchema, parseBookRules } from "./models/book-rules.js";
export { type DetectionHistoryEntry, type DetectionStats } from "./models/detection.js";
export { type StyleProfile } from "./models/style-profile.js";

// LLM
export { createLLMClient, chatCompletion, chatWithTools, createStreamMonitor, PartialResponseError, type LLMClient, type LLMResponse, type LLMMessage, type ToolDefinition, type ToolCall, type AgentMessage, type ChatWithToolsResult, type StreamProgress, type OnStreamProgress } from "./llm/provider.js";

// Agents
export { BaseAgent, type AgentContext } from "./agents/base.js";
export { ArchitectAgent, type ArchitectOutput } from "./agents/architect.js";
export { WriterAgent, type WriteChapterInput, type WriteChapterOutput, type TokenUsage } from "./agents/writer.js";
export { ContinuityAuditor, TIER2_DIMENSION_IDS, type AuditResult, type AuditIssue } from "./agents/continuity.js";
export { ReviserAgent, type ReviseOutput, type ReviseMode, type ReviseLightOutput, type SettlementOutput, type TriSettlementInput, type TriSettlementOutput, type TruthCandidate } from "./agents/reviser.js";
export { RadarAgent, type RadarResult, type RadarRecommendation } from "./agents/radar.js";
export { FanqieRadarSource, QidianRadarSource, TextRadarSource, type RadarSource, type PlatformRankings, type RankingEntry } from "./agents/radar-source.js";
export { readGenreProfile, readBookRules, listAvailableGenres, getBuiltinGenresDir } from "./agents/rules-reader.js";
export { buildWriterSystemPrompt } from "./agents/writer-prompts.js";
export { analyzeAITells, type AITellResult, type AITellIssue } from "./agents/ai-tells.js";
export { analyzeSensitiveWords, type SensitiveWordResult, type SensitiveWordMatch } from "./agents/sensitive-words.js";
export { detectAIContent, type DetectionResult } from "./agents/detector.js";
export { analyzeStyle } from "./agents/style-analyzer.js";
export { analyzeDetectionInsights } from "./agents/detection-insights.js";
export { validatePostWrite, type PostWriteViolation } from "./agents/post-write-validator.js";
export { ChapterAnalyzerAgent, type AnalyzeChapterInput, type AnalyzeChapterOutput } from "./agents/chapter-analyzer.js";
export { parseWriterOutput, parseCreativeOutput, type ParsedWriterOutput, type CreativeOutput } from "./agents/writer-parser.js";
export { buildSettlerSystemPrompt, buildSettlerUserPrompt } from "./agents/settler-prompts.js";
export { parseSettlementOutput } from "./agents/settler-parser.js";
export { FanficCanonImporter } from "./agents/fanfic-canon-importer.js";

// Layered Context Routing (new pipeline)
export { type LayeredContextBundle, buildLayeredContext, extractDialogueFingerprints } from "./agents/writer-context.js";
export { type ChapterTaskCard, type RoutedContext, type TruthFiles as LayeredTruthFiles, type StateFiles, type ViewFiles, type TaskLayer, type RiskLayer, type ContinuityLayer, type StyleLayer, type TruthSliceLayer, buildTaskLayer, buildRiskLayer, buildContinuityLayer, buildTruthSliceLayer } from "./agents/context-layers.js";
export { routeForCreativeWrite, routeForCorrection, routeForSettlement, validateCreativeWriteContext } from "./agents/context-router.js";
export { type StyleModule, getStyleModule, listModules, selectModulesForChapterType, combineModuleContent, combineRevisionChecks } from "./agents/style-modules.js";
export { TaskCardAgent } from "./agents/task-card-agent.js";
export { CorrectionAgent } from "./agents/correction-agent.js";
export { evaluateTruthCandidates, type GuardMode, type GuardResult, type GuardDecision } from "./agents/truth-guard.js";
export { routeStyle, type StyleRouteResult } from "./agents/style-router.js";
export { detectFaults, detectStateContamination, decideCorrectionPath, extractCorrectionRules, type FaultType, type FaultSignal, type FaultResponse } from "./agents/fault-handler.js";

// Utils
export { fetchUrl } from "./utils/web-search.js";
export { splitChapters, type SplitChapter } from "./utils/chapter-splitter.js";
export { readAllStoryFiles, readTruthFiles, readStateFiles, readViewFiles, type StoryFiles } from "./utils/story-files.js";
export { buildParagraphDiff, formatDiffForSettler, shouldUseIncrementalSettle, type ParagraphDiff, type ParagraphChange } from "./utils/paragraph-diff.js";
export { createLogger, createStderrSink, createJsonLineSink, nullSink, type Logger, type LogSink, type LogLevel, type LogEntry } from "./utils/logger.js";

// Pipeline
export { PipelineRunner, type PipelineConfig, type ChapterPipelineResult, type DraftResult, type ReviseResult, type TruthFiles, type BookStatusInfo, type ImportChaptersInput, type ImportChaptersResult, type TokenUsageSummary } from "./pipeline/runner.js";
export { shouldUseLight, classifyIssues, formatIssuesAsInstructions, type ClassifiedIssues } from "./pipeline/revision-router.js";
export { PipelineTelemetry, aggregateAgentCosts, analyzeDimensionTrends, analyzeContextBudgetTrends, type ChapterTelemetry, type AgentTokenRecord, type ContextBudgetSummary, type DimensionQuality, type PipelineAgent } from "./pipeline/pipeline-telemetry.js";
export { Scheduler, type SchedulerConfig } from "./pipeline/scheduler.js";
export { runAgentLoop, AGENT_TOOLS as AGENT_TOOLS, type AgentLoopOptions } from "./pipeline/agent.js";
export { detectChapter, detectAndRewrite, loadDetectionHistory, type DetectChapterResult, type DetectAndRewriteResult } from "./pipeline/detection-runner.js";

// State
export { StateManager } from "./state/manager.js";

// Notify
export { dispatchNotification, dispatchWebhookEvent, type NotifyMessage } from "./notify/dispatcher.js";
export { sendTelegram, type TelegramConfig } from "./notify/telegram.js";
export { sendFeishu, type FeishuConfig } from "./notify/feishu.js";
export { sendWechatWork, type WechatWorkConfig } from "./notify/wechat-work.js";
export { sendWebhook, type WebhookConfig, type WebhookEvent, type WebhookPayload } from "./notify/webhook.js";
