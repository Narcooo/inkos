/**
 * Revision Router — enruta automáticamente las issues de auditoría
 * hacia reviseChapterLight o reviseChapter según la naturaleza del problema.
 *
 * Regla: si TODAS las issues de severidad warning/critical son de tipo
 * estilístico (no requieren truth files), se usa la ruta ligera.
 */

import type { AuditIssue } from "../agents/continuity.js";

// ---------------------------------------------------------------------------
// Categorías estilísticas — no requieren truth files para corrección
// ---------------------------------------------------------------------------

/**
 * Nombres de dimensiones de auditoría que solo involucran estilo/forma.
 * Estas issues pueden resolverse con reviseChapterLight (sin cargar truth files).
 */
const STYLISTIC_CATEGORIES = new Set<string>([
  "文风检查",       // 8 — estilo de escritura
  "词汇疲劳",       // 10 — fatiga léxica
  "台词失真",       // 16 — diálogo poco natural
  "流水账",         // 17 — narración plana
  "段落等长",       // 20 — párrafos de longitud uniforme
  "套话密度",       // 21 — densidad de clichés
  "公式化转折",     // 22 — transiciones formulaicas
  "列表式结构",     // 23 — estructura de lista
  "AIGC检测",       // detección AI (desde detection-runner)
  "ai-tells",       // marcadores AI (desde ai-tells analyzer)
  "sensitive-word",  // palabras sensibles (nivel warning, no block)
]);

// ---------------------------------------------------------------------------
// Clasificación
// ---------------------------------------------------------------------------

export interface ClassifiedIssues {
  /** Issues que solo requieren ajuste estilístico */
  readonly stylistic: ReadonlyArray<AuditIssue>;
  /** Issues que requieren truth files para corrección */
  readonly narrative: ReadonlyArray<AuditIssue>;
}

/**
 * Clasifica issues en estilísticas vs narrativas.
 * Solo considera issues con severity warning o critical.
 */
export function classifyIssues(issues: ReadonlyArray<AuditIssue>): ClassifiedIssues {
  const stylistic: AuditIssue[] = [];
  const narrative: AuditIssue[] = [];

  for (const issue of issues) {
    if (issue.severity === "info") continue;

    if (isStylisticCategory(issue.category)) {
      stylistic.push(issue);
    } else {
      narrative.push(issue);
    }
  }

  return { stylistic, narrative };
}

/**
 * Determina si se puede usar la ruta ligera.
 * True = todas las issues actionable son estilísticas → reviseChapterLight.
 * False = hay al menos una issue narrativa → reviseChapter completo.
 */
export function shouldUseLight(issues: ReadonlyArray<AuditIssue>): boolean {
  const { stylistic, narrative } = classifyIssues(issues);

  // Sin issues actionable → no hay nada que corregir, no importa la ruta
  if (stylistic.length === 0 && narrative.length === 0) return false;

  return narrative.length === 0;
}

/**
 * Formatea una lista de issues como instrucciones de texto para reviseChapterLight.
 * Genera un prompt conciso que el reviser ligero puede seguir sin truth files.
 */
export function formatIssuesAsInstructions(issues: ReadonlyArray<AuditIssue>): string {
  const lines: string[] = ["请根据以下审稿意见修订章节：", ""];

  for (const issue of issues) {
    if (issue.severity === "info") continue;
    lines.push(`- [${issue.severity}] ${issue.category}：${issue.description}`);
    if (issue.suggestion) {
      lines.push(`  修改建议：${issue.suggestion}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Comprueba si una categoría es puramente estilística.
 * Usa coincidencia exacta primero, luego fuzzy (contención de subcadena).
 */
function isStylisticCategory(category: string): boolean {
  if (STYLISTIC_CATEGORIES.has(category)) return true;

  // Coincidencia fuzzy: para categorías que vienen con variaciones menores
  for (const known of STYLISTIC_CATEGORIES) {
    if (category.includes(known) || known.includes(category)) return true;
  }

  return false;
}
