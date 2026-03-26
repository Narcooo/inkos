/**
 * Pipeline Telemetry — observabilidad estructurada para el pipeline.
 *
 * Emite eventos de telemetría a través del Logger, permitiendo:
 * - Atribución de costos por agente
 * - Auditoría de decisiones de presupuesto de contexto
 * - Tendencias de calidad por dimensión
 * - Métricas de prompt (longitud, bloques incluidos/descartados)
 */

import type { Logger } from "../utils/logger.js";
import type { BudgetResult, BudgetDecision } from "../utils/context-budget.js";

// ---------------------------------------------------------------------------
// Tipos de eventos de telemetría
// ---------------------------------------------------------------------------

/** Agentes que participan en el pipeline */
export type PipelineAgent = "writer" | "auditor" | "reviser" | "settler" | "detector" | "architect" | "radar";

/** Registro de uso de tokens por agente individual */
export interface AgentTokenRecord {
  readonly agent: PipelineAgent;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

/** Resumen de presupuesto de contexto para un capítulo */
export interface ContextBudgetSummary {
  readonly totalTokens: number;
  readonly budgetLimit: number;
  readonly blocksIncluded: number;
  readonly blocksDegraded: number;
  readonly blocksDropped: number;
  /** Detalles de bloques degradados o descartados */
  readonly degradedBlocks: ReadonlyArray<{
    readonly name: string;
    readonly level: number;
    readonly dropped: boolean;
  }>;
}

/** Resumen de calidad por dimensión de auditoría */
export interface DimensionQuality {
  readonly dimension: string;
  readonly severity: "critical" | "warning" | "info";
  readonly count: number;
}

/** Snapshot de telemetría completo para un capítulo */
export interface ChapterTelemetry {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly timestamp: string;
  /** Uso de tokens desglosado por agente */
  readonly agentTokens: ReadonlyArray<AgentTokenRecord>;
  /** Resumen de presupuesto de contexto (si aplica) */
  readonly contextBudget?: ContextBudgetSummary;
  /** Issues de auditoría por dimensión */
  readonly auditDimensions?: ReadonlyArray<DimensionQuality>;
  /** Ruta de revisión elegida */
  readonly revisionRoute?: "light" | "full" | "none";
  /** Resultado de detección */
  readonly detection?: {
    readonly score: number;
    readonly passed: boolean;
    readonly rewriteAttempts: number;
  };
  /** Duración total del pipeline para este capítulo (ms) */
  readonly durationMs?: number;
}

// ---------------------------------------------------------------------------
// Clase principal de telemetría
// ---------------------------------------------------------------------------

/**
 * Recolector de telemetría para una sola ejecución de capítulo.
 * Acumula datos durante el pipeline y emite un resumen final al logger.
 */
export class PipelineTelemetry {
  private readonly log: Logger;
  private readonly bookId: string;
  private readonly chapterNumber: number;
  private readonly startTime: number;
  private readonly agentTokens: AgentTokenRecord[] = [];
  private contextBudget?: ContextBudgetSummary;
  private auditDimensions?: DimensionQuality[];
  private revisionRoute?: "light" | "full" | "none";
  private detection?: ChapterTelemetry["detection"];

  constructor(logger: Logger, bookId: string, chapterNumber: number) {
    this.log = logger.child("telemetry");
    this.bookId = bookId;
    this.chapterNumber = chapterNumber;
    this.startTime = Date.now();
  }

  /** Registra uso de tokens para un agente. */
  recordAgentTokens(
    agent: PipelineAgent,
    usage?: { readonly promptTokens: number; readonly completionTokens: number; readonly totalTokens: number },
  ): void {
    if (!usage) return;
    this.agentTokens.push({
      agent,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
    });

    this.log.debug("Agent token usage", {
      agent,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
    });
  }

  /** Registra decisiones de presupuesto de contexto. */
  recordContextBudget(budgetResult: BudgetResult, budgetLimit: number): void {
    const degradedBlocks = budgetResult.decisions.filter(
      (d) => d.selectedLevel > 0 || d.dropped,
    );
    const summary: ContextBudgetSummary = {
      totalTokens: budgetResult.totalTokens,
      budgetLimit,
      blocksIncluded: budgetResult.decisions.filter((d) => !d.dropped).length,
      blocksDegraded: degradedBlocks.filter((d) => !d.dropped).length,
      blocksDropped: budgetResult.decisions.filter((d) => d.dropped).length,
      degradedBlocks: degradedBlocks.map((d) => ({
        name: d.name,
        level: d.selectedLevel,
        dropped: d.dropped,
      })),
    };
    this.contextBudget = summary;

    if (degradedBlocks.length > 0) {
      this.log.info("Context budget applied", {
        totalTokens: summary.totalTokens,
        limit: budgetLimit,
        degraded: summary.blocksDegraded,
        dropped: summary.blocksDropped,
        details: summary.degradedBlocks,
      });
    }
  }

  /** Registra resultados de auditoría por dimensión. */
  recordAuditDimensions(
    issues: ReadonlyArray<{ readonly severity: string; readonly category: string }>,
  ): void {
    // Agrupa por dimensión
    const dimMap = new Map<string, { severity: string; count: number }>();
    for (const issue of issues) {
      const existing = dimMap.get(issue.category);
      if (existing) {
        existing.count++;
        // Escalar severidad al peor caso
        if (issue.severity === "critical") existing.severity = "critical";
        else if (issue.severity === "warning" && existing.severity !== "critical") existing.severity = "warning";
      } else {
        dimMap.set(issue.category, { severity: issue.severity, count: 1 });
      }
    }

    this.auditDimensions = [...dimMap.entries()].map(([dimension, { severity, count }]) => ({
      dimension,
      severity: severity as DimensionQuality["severity"],
      count,
    }));

    if (this.auditDimensions.length > 0) {
      this.log.info("Audit dimensions", {
        total: issues.length,
        byDimension: this.auditDimensions,
      });
    }
  }

  /** Registra la ruta de revisión elegida. */
  recordRevisionRoute(route: "light" | "full" | "none"): void {
    this.revisionRoute = route;
  }

  /** Registra resultado de detección. */
  recordDetection(score: number, passed: boolean, rewriteAttempts: number): void {
    this.detection = { score, passed, rewriteAttempts };
  }

  /** Emite el resumen final de telemetría. */
  finalize(): ChapterTelemetry {
    const durationMs = Date.now() - this.startTime;
    const telemetry: ChapterTelemetry = {
      bookId: this.bookId,
      chapterNumber: this.chapterNumber,
      timestamp: new Date().toISOString(),
      agentTokens: this.agentTokens,
      contextBudget: this.contextBudget,
      auditDimensions: this.auditDimensions,
      revisionRoute: this.revisionRoute,
      detection: this.detection,
      durationMs,
    };

    // Emitir resumen compacto
    const totalTokens = this.agentTokens.reduce((sum, a) => sum + a.totalTokens, 0);
    const costByAgent: Record<string, number> = {};
    for (const record of this.agentTokens) {
      costByAgent[record.agent] = (costByAgent[record.agent] ?? 0) + record.totalTokens;
    }

    this.log.info("Chapter pipeline complete", {
      bookId: this.bookId,
      chapter: this.chapterNumber,
      durationMs,
      totalTokens,
      costByAgent,
      revisionRoute: this.revisionRoute ?? "none",
      auditIssueCount: this.auditDimensions?.reduce((s, d) => s + d.count, 0) ?? 0,
      budgetDropped: this.contextBudget?.blocksDropped ?? 0,
    });

    return telemetry;
  }
}

// ---------------------------------------------------------------------------
// Utilidades de agregación para analytics
// ---------------------------------------------------------------------------

/** Agrega múltiples registros de telemetría en un resumen por agente. */
export function aggregateAgentCosts(
  records: ReadonlyArray<ChapterTelemetry>,
): ReadonlyArray<{ agent: string; totalTokens: number; percentage: number }> {
  const agentTotals = new Map<string, number>();
  let grandTotal = 0;

  for (const ch of records) {
    for (const rec of ch.agentTokens) {
      agentTotals.set(rec.agent, (agentTotals.get(rec.agent) ?? 0) + rec.totalTokens);
      grandTotal += rec.totalTokens;
    }
  }

  return [...agentTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([agent, totalTokens]) => ({
      agent,
      totalTokens,
      percentage: grandTotal > 0 ? Math.round((totalTokens / grandTotal) * 100) : 0,
    }));
}

/**
 * Analiza tendencias de calidad por dimensión: detecta dimensiones
 * que empeoran en los últimos N capítulos.
 */
export function analyzeDimensionTrends(
  records: ReadonlyArray<ChapterTelemetry>,
  windowSize: number = 5,
): ReadonlyArray<{
  dimension: string;
  recentCount: number;
  totalCount: number;
  trend: "worsening" | "stable" | "improving";
}> {
  // Contar issues totales y recientes por dimensión
  const totalCounts = new Map<string, number>();
  const recentCounts = new Map<string, number>();

  const sorted = [...records].sort((a, b) => a.chapterNumber - b.chapterNumber);
  const recentStart = Math.max(0, sorted.length - windowSize);

  for (let i = 0; i < sorted.length; i++) {
    for (const dim of sorted[i]!.auditDimensions ?? []) {
      totalCounts.set(dim.dimension, (totalCounts.get(dim.dimension) ?? 0) + dim.count);
      if (i >= recentStart) {
        recentCounts.set(dim.dimension, (recentCounts.get(dim.dimension) ?? 0) + dim.count);
      }
    }
  }

  const results: Array<{
    dimension: string;
    recentCount: number;
    totalCount: number;
    trend: "worsening" | "stable" | "improving";
  }> = [];

  for (const [dimension, totalCount] of totalCounts) {
    const recentCount = recentCounts.get(dimension) ?? 0;

    // Tasa de ocurrencia: reciente vs histórica
    const totalChapters = sorted.length;
    const windowChapters = Math.min(windowSize, totalChapters);
    const olderChapters = totalChapters - windowChapters;

    const recentRate = windowChapters > 0 ? recentCount / windowChapters : 0;
    const olderCount = totalCount - recentCount;
    const olderRate = olderChapters > 0 ? olderCount / olderChapters : 0;

    let trend: "worsening" | "stable" | "improving";
    if (recentRate > olderRate * 1.5) {
      trend = "worsening";
    } else if (recentRate < olderRate * 0.5) {
      trend = "improving";
    } else {
      trend = "stable";
    }

    results.push({ dimension, recentCount, totalCount, trend });
  }

  return results.sort((a, b) => b.totalCount - a.totalCount);
}

/** Resumen de bloques de contexto frecuentemente degradados/descartados. */
export function analyzeContextBudgetTrends(
  records: ReadonlyArray<ChapterTelemetry>,
): ReadonlyArray<{
  block: string;
  degradedCount: number;
  droppedCount: number;
  totalChapters: number;
}> {
  const blockStats = new Map<string, { degraded: number; dropped: number }>();
  let chaptersWithBudget = 0;

  for (const ch of records) {
    if (!ch.contextBudget) continue;
    chaptersWithBudget++;
    for (const block of ch.contextBudget.degradedBlocks) {
      const existing = blockStats.get(block.name) ?? { degraded: 0, dropped: 0 };
      if (block.dropped) {
        existing.dropped++;
      } else {
        existing.degraded++;
      }
      blockStats.set(block.name, existing);
    }
  }

  return [...blockStats.entries()]
    .sort((a, b) => (b[1].degraded + b[1].dropped) - (a[1].degraded + a[1].dropped))
    .map(([block, stats]) => ({
      block,
      degradedCount: stats.degraded,
      droppedCount: stats.dropped,
      totalChapters: chaptersWithBudget,
    }));
}
