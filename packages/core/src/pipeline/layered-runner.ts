/**
 * Layered Pipeline Runner — orquesta los seis pasos del pipeline de escritura.
 *
 * Extraído de runner.ts (R1) para mejorar la mantenibilidad.
 * S0 → S1 → S2 → S3 → S4 → S5 + Truth Guard
 */

import type { BookConfig } from "../models/book.js";
import type { PipelineConfig } from "./runner.js";
import type { AgentContext } from "../agents/base.js";
import type { Logger } from "../utils/logger.js";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSafe } from "../utils/read-file-safe.js";
import { createLLMClient } from "../llm/provider.js";

// Agents
import { TaskCardAgent } from "../agents/task-card-agent.js";
import { WriterAgent } from "../agents/writer.js";
import { CorrectionAgent } from "../agents/correction-agent.js";
import { ReviserAgent } from "../agents/reviser.js";
import { SemanticTruthGuard } from "../agents/truth-guard.js";
import { evaluateTruthCandidates } from "../agents/truth-guard.js";

// Context + Routing
import { buildLayeredContext } from "../agents/writer-context.js";
import { validateCreativeWriteContext } from "../agents/context-router.js";
import { routeStyle } from "../agents/style-router.js";
import { readGenreProfile, readBookRules } from "../agents/rules-reader.js";

// Validation + Correction
import { validatePostWrite } from "../agents/post-write-validator.js";
import { detectFaults, decideCorrectionPath, extractCorrectionRules } from "../agents/fault-handler.js";

// State files
import { readStateFiles, readViewFiles } from "../utils/story-files.js";

// Telemetry
import { PipelineTelemetry } from "./pipeline-telemetry.js";

// Types (re-exported)
import type { StyleRouteResult } from "../agents/style-router.js";
import type { PostWriteViolation } from "../agents/post-write-validator.js";
import type { FaultSignal } from "../agents/fault-handler.js";
import type { GuardResult } from "../agents/truth-guard.js";
import type { ChapterTaskCard } from "../agents/context-layers.js";
import type { TriSettlementOutput } from "../agents/reviser.js";
import type { ChapterTelemetry } from "./pipeline-telemetry.js";
import type { AgentLLMOverride, LLMConfig } from "../models/project.js";

// ===========================
// Result Interface
// ===========================

export interface LayeredChapterResult {
  readonly chapterNumber: number;
  readonly title: string;
  readonly content: string;
  readonly preWriteCheck: string;
  readonly wordCount: number;
  readonly taskCard: ChapterTaskCard;
  readonly styleRoute: StyleRouteResult;
  readonly correctionPath: "4A" | "4B" | "pass";
  readonly correctionApplied: boolean;
  readonly faults: readonly FaultSignal[];
  readonly settlement: TriSettlementOutput;
  readonly guardResult: GuardResult;
  readonly postWriteErrors: readonly PostWriteViolation[];
  readonly postWriteWarnings: readonly PostWriteViolation[];
  readonly telemetry?: ChapterTelemetry;
}

// ===========================
// Layered Pipeline Runner
// ===========================

export class LayeredPipelineRunner {
  private readonly config: PipelineConfig;

  constructor(config: PipelineConfig) {
    this.config = config;
  }

  /**
   * Ejecuta el pipeline de seis pasos para un capítulo:
   * S0 → S1 → S2 → S3 → S4 → S5
   */
  async run(
    book: BookConfig,
    chapterNumber: number,
  ): Promise<LayeredChapterResult> {
    const bookDir = join(this.config.projectRoot, "books", book.id);
    const storyDir = join(bookDir, "story");
    const logger = this.config.logger;
    const language = (book.language ?? "zh") as "zh" | "en";

    // [R7] Telemetría unificada
    const telemetry = logger ? new PipelineTelemetry(logger, book.id, chapterNumber) : undefined;

    logger?.info(`[layered] Starting ch${chapterNumber} six-step pipeline`);

    // ── S0: Task Card Generation ──
    logger?.info(`[layered] S0: generating task card`);
    const taskCardAgent = new TaskCardAgent(this.agentCtxFor("task-card", book.id));
    const outlineRaw = await readFileSafe(join(storyDir, "volume_outline.md"));
    const stateRaw = await readFileSafe(join(storyDir, "current_state.md"));
    const hooksRaw = await readFileSafe(join(storyDir, "pending_hooks.md"));

    const taskCard = await taskCardAgent.generateTaskCard(
      extractOutlineSlice(outlineRaw, chapterNumber),
      stateRaw.slice(0, 200),
      chapterNumber,
      hooksRaw,
      language,
    );

    // ── S1: Context Routing ──
    logger?.info(`[layered] S1: routing context`);
    const styleRoute = routeStyle(outlineRaw, chapterNumber, language);
    const recentViolations = await this.loadRecentViolations(bookDir);

    // [R5] Presupuesto dinámico basado en maxTokens del modelo
    const maxModelTokens = this.config.defaultLLMConfig?.maxTokens;

    const { routedContext, genreProfile, genreBody, bookRules, bookRulesBody, styleGuide } = await buildLayeredContext(
      this.config.projectRoot, bookDir, book, chapterNumber, taskCard, styleRoute.detectedChapterType,
      { 
        styleModuleIds: [...styleRoute.activeModuleIds], 
        styleModulesContent: styleRoute.modulesContent, 
        recentViolations,
        maxModelTokens,
        logger 
      },
    );

    const ctxViolations = validateCreativeWriteContext(routedContext);
    if (ctxViolations.violations.length > 0) {
      logger?.warn(`[layered] S1: ${ctxViolations.violations.length} prohibition violations`);
    }

    // ── S2: Creative Write ──
    logger?.info(`[layered] S2: creative write`);
    const writer = new WriterAgent(this.agentCtxFor("writer", book.id));
    const wordTarget = Math.round((book.chapterWordCount * styleRoute.wordCountMultiplier) / 100) * 100;

    const creative = await writer.runCreativeWrite({
      book,
      routedContext,
      genreProfile,
      genreBody,
      bookRules,
      bookRulesBody,
      styleGuide,
      language,
      temperatureOverride: styleRoute.temperature,
      wordCountOverride: wordTarget,
    });
    telemetry?.recordAgentTokens("writer", creative.tokenUsage);

    // ── S3: Review ──
    const postWriteResult = validatePostWrite(creative.content, genreProfile, bookRules, language);
    const postWriteErrors = postWriteResult.filter((v) => v.severity === "error");
    const postWriteWarnings = postWriteResult.filter((v) => v.severity === "warning");
    const faults = detectFaults(creative.content, postWriteResult, [], language);
    const correctionPath = decideCorrectionPath(faults);

    logger?.info(`[layered] S3: ${postWriteErrors.length}E/${postWriteWarnings.length}W/${faults.length}F → ${correctionPath}`);

    // ── S4: Correction ──
    let finalContent = creative.content;
    let correctionApplied = false;

    if (correctionPath === "4A") {
      const correctionAgent = new CorrectionAgent(this.agentCtxFor("correction", book.id));
      const result = await correctionAgent.correctLight(
        creative.content, extractCorrectionRules(faults), routedContext.risk, language,
      );
      finalContent = result.correctedContent;
      correctionApplied = true;
    } else if (correctionPath === "4B") {
      logger?.warn(`[layered] S4B: re-running S2`);
      const retry = await writer.runCreativeWrite({
        book,
        routedContext,
        genreProfile,
        genreBody,
        bookRules,
        bookRulesBody,
        styleGuide,
        language,
        temperatureOverride: Math.max(0.3, styleRoute.temperature - 0.2),
        wordCountOverride: wordTarget,
      });
      telemetry?.recordAgentTokens("writer", retry.tokenUsage);
      
      // [P0] Protect S4B: secondary validation
      const retryResult = validatePostWrite(retry.content, genreProfile, bookRules, language);
      const retryErrors = retryResult.filter(v => v.severity === "error");
      if (retryErrors.length > 0) {
        logger?.error(`[layered] S4B rewrite still contains ${retryErrors.length} errors. Blocking settlement.`);
      }
      
      finalContent = retry.content;
      correctionApplied = true;
    }

    // ── S5: Settlement ──
    const [sf, vf] = await Promise.all([readStateFiles(storyDir), readViewFiles(storyDir)]);
    const reviser = new ReviserAgent(this.agentCtxFor("reviser", book.id));
    const settlement = await reviser.settleChapterLayered({
      approvedContent: finalContent, taskCard, chapterNumber, book, stateFiles: sf, viewFiles: vf,
    });
    telemetry?.recordAgentTokens("settler", settlement.tokenUsage);

    // ── S5B: Truth Guard (Structural + Semantic) ──
    const structuralGuard = evaluateTruthCandidates(settlement.truthCandidates, "normal", logger);
    
    // Semantic guard (only for high-stakes changes)
    const semanticGuardAgent = new SemanticTruthGuard(this.agentCtxFor("truth-guard", book.id));
    const guardResult = await semanticGuardAgent.evaluateSemanticAlignment(
      structuralGuard.accepted,
      {
        relevantCharacterSettings: routedContext.truthSlice.relevantCharacterSettings,
        relevantWorldRules: routedContext.truthSlice.relevantWorldRules,
      },
      language,
    );

    // [P1] Enforcement: Filter out rejected candidates
    const finalAcceptedTruth = guardResult.accepted;
    if (guardResult.rejected.length > 0) {
      logger?.warn(`[layered] ${guardResult.rejected.length} truth candidates REJECTED by guard.`);
    }

    logger?.info(`[layered] ch${chapterNumber} done — ${finalContent.length} chars (Guard: ${finalAcceptedTruth.length}/${settlement.truthCandidates.length} accepted)`);

    // [P1] Audit History Feedback: Save current errors for next chapter
    if (postWriteErrors.length > 0) {
      const violations = postWriteErrors.map(v => `${v.rule}: ${v.description}`);
      await this.saveRecentViolations(bookDir, violations);
    }

    // [R7] Finalizar telemetría
    const chapterTelemetry = telemetry?.finalize();

    return {
      chapterNumber, title: creative.title, content: finalContent,
      preWriteCheck: creative.preWriteCheck, wordCount: finalContent.length,
      taskCard, styleRoute, correctionPath, correctionApplied,
      faults, settlement, guardResult, postWriteErrors, postWriteWarnings,
      telemetry: chapterTelemetry,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private agentCtxFor(agent: string, bookId: string): AgentContext {
    // Soporte para model overrides por agente
    const override = this.config.modelOverrides?.[agent];
    if (override && typeof override === "object") {
      const typed = override as AgentLLMOverride;
      const overrideClient = createLLMClient({
        provider: typed.provider ?? "openai",
        baseUrl: typed.baseUrl ?? "",
        apiKey: typed.apiKeyEnv ? process.env[typed.apiKeyEnv] ?? "" : "",
        model: typed.model,
        stream: typed.stream ?? true,
      } as LLMConfig);
      return {
        client: overrideClient,
        model: typed.model,
        projectRoot: this.config.projectRoot,
        bookId,
        logger: this.config.logger,
        onStreamProgress: this.config.onStreamProgress,
      };
    }
    const modelName = typeof override === "string" ? override : this.config.model;
    return {
      client: this.config.client,
      model: modelName,
      projectRoot: this.config.projectRoot,
      bookId,
      logger: this.config.logger,
      onStreamProgress: this.config.onStreamProgress,
    };
  }

  private async saveRecentViolations(bookDir: string, violations: string[]): Promise<void> {
    const historyPath = join(bookDir, "story", "recent_violations.json");
    try {
      await writeFile(historyPath, JSON.stringify(violations, null, 2), "utf-8");
    } catch (e) {
      this.config.logger?.warn(`Failed to save audit history: ${e}`);
    }
  }

  private async loadRecentViolations(bookDir: string): Promise<string[]> {
    const historyPath = join(bookDir, "story", "recent_violations.json");
    try {
      const raw = await readFile(historyPath, "utf-8");
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
}

// ===========================
// Utilities
// ===========================

function extractOutlineSlice(outline: string, chapterNumber: number): string {
  if (!outline) return "";
  const lines = outline.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp(`第${chapterNumber}章|[Cc]hapter\\s*${chapterNumber}\\b`).test(lines[i]!)) {
      return lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 6)).join("\n").slice(0, 500);
    }
  }
  return outline.slice(0, 500);
}
