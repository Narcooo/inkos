/**
 * Truth Guard — motor de reglas puro (sin LLM) para proteger los archivos Truth.
 *
 * Evalúa los candidatos a cambio de Truth generados por S5 settlement
 * y decide si aprobar o rechazar cada uno según reglas de protección.
 *
 * Gap #3: candidatos aprobados → escribir, rechazados → log + warn
 * Gap #9: modo import permite escritura directa sin verificación
 */

import type { TruthCandidate } from "./reviser.js";
import type { Logger } from "../utils/logger.js";
import { BaseAgent, type AgentContext } from "./base.js";

// ===========================
// Guard Mode
// ===========================

/**
 * Modo de operación del guard.
 * - normal: aplica todas las reglas de protección
 * - import: permite todas las escrituras (inicialización de proyecto)
 */
export type GuardMode = "normal" | "import";

// ===========================
// Guard Result
// ===========================

export interface GuardDecision {
  readonly candidate: TruthCandidate;
  readonly accepted: boolean;
  readonly reason: string;
}

export interface GuardResult {
  readonly decisions: readonly GuardDecision[];
  readonly accepted: readonly TruthCandidate[];
  readonly rejected: readonly TruthCandidate[];
}

// ===========================
// Protection Rules
// ===========================

/** Campos que no pueden ser eliminados ni vaciados de story_bible */
const PROTECTED_FIELDS = new Set([
  "protagonist",
  "核心设定",
  "世界规则",
  "主角",
  "core_setting",
  "world_rules",
]);

/** Porcentaje máximo de hooks que se pueden eliminar en un solo capítulo */
const MAX_HOOK_DELETION_RATIO = 0.3;

/** Campos de personaje que nunca pueden cambiar (inmutables) */
const IMMUTABLE_CHARACTER_FIELDS = new Set([
  "name",
  "姓名",
  "protagonist.name",
  "主角.姓名",
]);

// ===========================
// Truth Guard
// ===========================

/**
 * Evalúa candidatos a cambios de Truth y decide si aprobar o rechazar.
 *
 * Reglas de protección:
 * 1. Campos protegidos no pueden ser eliminados ni vaciados
 * 2. Eliminación masiva de hooks limitada a ≤30% por capítulo
 * 3. Campos inmutables de personaje no pueden cambiar
 * 4. En modo import, todo se aprueba automáticamente
 */
export function evaluateTruthCandidates(
  candidates: readonly TruthCandidate[],
  mode: GuardMode = "normal",
  logger?: Logger,
): GuardResult {
  // Modo import: aprobar todo sin verificación
  if (mode === "import") {
    const decisions = candidates.map((c) => ({
      candidate: c,
      accepted: true,
      reason: "import mode: auto-approved",
    }));
    return {
      decisions,
      accepted: [...candidates],
      rejected: [],
    };
  }

  const decisions: GuardDecision[] = [];
  const accepted: TruthCandidate[] = [];
  const rejected: TruthCandidate[] = [];

  for (const candidate of candidates) {
    const decision = evaluateCandidate(candidate);
    decisions.push(decision);

    if (decision.accepted) {
      accepted.push(candidate);
      logger?.info(`Truth guard: accepted ${candidate.file}/${candidate.field}`);
    } else {
      rejected.push(candidate);
      logger?.warn(
        `Truth guard: rejected ${candidate.file}/${candidate.field} — ${decision.reason}`,
      );
    }
  }

  return { decisions, accepted, rejected };
}

// ===========================
// Semantic Truth Guard (LLM)
// ===========================

export class SemanticTruthGuard extends BaseAgent {
  get name(): string {
    return "truth-guard";
  }

  /**
   * Realiza una auditoría semántica de los candidatos a Truth.
   * Verifica que los cambios en personajes o reglas no contradigan lo establecido.
   */
  async evaluateSemanticAlignment(
    candidates: readonly TruthCandidate[],
    truthSlice: {
      readonly relevantCharacterSettings: string;
      readonly relevantWorldRules: string;
    },
    language: "zh" | "en" = "zh",
  ): Promise<GuardResult> {
    const highStakes = candidates.filter(
      (c) => 
        (c.changeType === "MODIFY" || c.changeType === "NEW") && 
        (c.file.includes("bible") || c.file.includes("matrix") || c.file.includes("character") || c.file.includes("subplot"))
    );

    if (highStakes.length === 0) {
      return { decisions: [], accepted: [...candidates], rejected: [] };
    }

    const systemPrompt = language === "en"
      ? "You are the Truth Guard. Your job is to ensure that proposed changes to story facts (Truth) are semantically consistent with existing core settings."
      : "你是不中OS的真值守卫。你的职责是确保对故事设定（真值）的修改在语义上与现有核心设定保持一致。";

    const userPrompt = this.buildSemanticPrompt(highStakes, truthSlice, language);

    const response = await this.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    const auditResults = this.parseSemanticResponse(response.content, highStakes, language);
    
    const decisions: GuardDecision[] = [];
    const accepted: TruthCandidate[] = [];
    const rejected: TruthCandidate[] = [];

    // Mapear resultados a candidatos originales
    for (const candidate of candidates) {
      const audit = auditResults.find(a => a.file === candidate.file && a.field === candidate.field);
      if (audit) {
        decisions.push({ candidate, accepted: audit.accepted, reason: audit.reason });
        if (audit.accepted) accepted.push(candidate);
        else rejected.push(candidate);
      } else {
        // Si no era high-stakes, se asume aprobado por defecto (o ya pasó el guard estructural)
        decisions.push({ candidate, accepted: true, reason: "Skipped semantic audit (low stakes)" });
        accepted.push(candidate);
      }
    }

    return { decisions, accepted, rejected };
  }

  private buildSemanticPrompt(
    candidates: readonly TruthCandidate[],
    truthSlice: any,
    language: string
  ): string {
    const parts = language === "en" 
      ? ["### Existing Core Settings", "#### Character Settings", truthSlice.relevantCharacterSettings, "#### World Rules", truthSlice.relevantWorldRules, "\n### Proposed Changes"]
      : ["### 现有的核心设定", "#### 角色设定", truthSlice.relevantCharacterSettings, "#### 世界规则", truthSlice.relevantWorldRules, "\n### 待审议的修改提案"];

    candidates.forEach(c => {
      parts.push(`- [${c.changeType}] ${c.file} -> ${c.field}: "${c.currentValue}" -> "${c.proposedValue}"`);
    });

    parts.push(language === "en"
      ? "\nAnalyze if any proposal contradicts the core settings. Output JSON list: `[{ \"file\": string, \"field\": string, \"accepted\": boolean, \"reason\": string }]`"
      : "\n分析上述提案是否与核心设定存在冲突。输出 JSON 列表：`[{ \"file\": string, \"field\": string, \"accepted\": boolean, \"reason\": string }]`"
    );

    return parts.join("\n");
  }

  private parseSemanticResponse(content: string, candidates: readonly TruthCandidate[], _language: string): any[] {
    try {
      const jsonMatch = content.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch {
      // [P1] 宁可错杀不可漏过：解析失败时标记为驳回
    }
    return candidates.map(c => ({ 
      file: c.file, 
      field: c.field, 
      accepted: false, 
      reason: "Semantic audit parser failed (malformed JSON)" 
    }));
  }
}

/**
 * Evalúa un solo candidato contra las reglas de protección.
 */
function evaluateCandidate(candidate: TruthCandidate): GuardDecision {
  // Regla 1: campos protegidos no pueden ser vaciados
  if (PROTECTED_FIELDS.has(candidate.field)) {
    if (!candidate.proposedValue || candidate.proposedValue.trim() === "") {
      return {
        candidate,
        accepted: false,
        reason: `Protected field "${candidate.field}" cannot be emptied`,
      };
    }
  }

  // Regla 2: campos inmutables de personaje
  if (IMMUTABLE_CHARACTER_FIELDS.has(candidate.field)) {
    if (candidate.currentValue !== candidate.proposedValue) {
      return {
        candidate,
        accepted: false,
        reason: `Immutable field "${candidate.field}" cannot be changed (${candidate.currentValue} → ${candidate.proposedValue})`,
      };
    }
  }

  // Regla 3: eliminación masiva de hooks
  if (candidate.file === "pending_hooks.md" || candidate.file.includes("hook")) {
    const currentCount = countTableRows(candidate.currentValue);
    const proposedCount = countTableRows(candidate.proposedValue);
    if (currentCount > 0 && proposedCount < currentCount) {
      const deletionRatio = (currentCount - proposedCount) / currentCount;
      if (deletionRatio > MAX_HOOK_DELETION_RATIO) {
        return {
          candidate,
          accepted: false,
          reason: `Hook batch deletion too aggressive: ${Math.round(deletionRatio * 100)}% > ${MAX_HOOK_DELETION_RATIO * 100}% limit (${currentCount} → ${proposedCount})`,
        };
      }
    }
  }

  // Regla 4: balance numérico básico (si contiene números)
  if (candidate.file === "particle_ledger.md" || candidate.file.includes("ledger")) {
    const balanceCheck = checkNumericalBalance(candidate.proposedValue);
    if (!balanceCheck.valid) {
      return {
        candidate,
        accepted: false,
        reason: `Numerical balance violation: ${balanceCheck.detail}`,
      };
    }
  }

  // Pasó todas las reglas
  return {
    candidate,
    accepted: true,
    reason: "All protection rules passed",
  };
}

// ===========================
// Helpers
// ===========================

/** Cuenta las filas de datos en una tabla markdown (excluyendo encabezado y separador). */
function countTableRows(content: string): number {
  if (!content) return 0;
  return content
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.startsWith("|") && !trimmed.startsWith("|---") && !trimmed.startsWith("| ID");
    })
    .length;
}

/**
 * Verificación básica de balance numérico.
 * Busca patrones "inicio + delta = final" en tablas de ledger.
 */
function checkNumericalBalance(content: string): { valid: boolean; detail: string } {
  if (!content) return { valid: true, detail: "" };

  // Buscar filas tipo: | recurso | inicio | +/- delta | final |
  const rows = content.split("\n").filter((l) => l.trim().startsWith("|"));
  for (const row of rows) {
    const cells = row
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    // Buscar patrón numérico de 3+ celdas con dígitos
    const numericCells = cells.filter((c) => /^[+-]?\d+/.test(c));
    if (numericCells.length >= 3) {
      const start = parseInt(numericCells[0]!, 10);
      const delta = parseInt(numericCells[1]!, 10);
      const end = parseInt(numericCells[2]!, 10);
      if (!isNaN(start) && !isNaN(delta) && !isNaN(end)) {
        if (start + delta !== end) {
          return {
            valid: false,
            detail: `${cells[0]}: ${start} + ${delta} ≠ ${end}`,
          };
        }
      }
    }
  }

  return { valid: true, detail: "" };
}
