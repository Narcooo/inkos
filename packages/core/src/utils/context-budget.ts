/**
 * Context Budget — Estimación de tokens y control de presupuesto para prompts.
 *
 * Previene la explosión de prompts cuando los archivos de verdad (truth files)
 * crecen con el número de capítulos.
 */

// === Token Estimation ===

/**
 * Estima el número de tokens de un texto mixto (chino/inglés).
 * Coeficientes conservadores:
 * - Chino: ~1.8 tokens/carácter (conservador para evitar desbordes)
 * - Inglés/puntuación: ~0.25 tokens/carácter (~4 chars/token)
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  let chineseChars = 0;
  let otherChars = 0;

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    // CJK Unified Ideographs + common CJK ranges
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0xf900 && code <= 0xfaff)
    ) {
      chineseChars++;
    } else {
      otherChars++;
    }
  }

  return Math.ceil(chineseChars * 1.8 + otherChars * 0.25);
}

// === Budget Block Types ===

export interface BudgetBlock {
  /** Identificador del bloque (e.g. "pending_hooks", "chapter_summaries") */
  readonly name: string;
  /** Prioridad: 0 = más alta. Los bloques de mayor prioridad se degradan últimos. */
  readonly priority: number;
  /** Si es true, este bloque nunca se descarta. */
  readonly required?: boolean;
  /**
   * Representaciones del bloque en diferentes niveles de detalle.
   * levels[0] = versión completa, levels[1] = versión reducida, etc.
   * Un bloque puede tener 1-4 niveles.
   */
  readonly levels: readonly string[];
}

export interface BudgetDecision {
  readonly name: string;
  readonly priority: number;
  readonly selectedLevel: number;
  readonly estimatedTokens: number;
  readonly dropped: boolean;
}

export interface BudgetResult {
  /** Contenidos finales seleccionados por bloque */
  readonly blocks: Record<string, string>;
  /** Log de decisiones para debugging */
  readonly decisions: readonly BudgetDecision[];
  /** Tokens totales estimados */
  readonly totalTokens: number;
}

// === Budget Application ===

/**
 * Aplica el presupuesto de tokens a un conjunto de bloques de contexto.
 *
 * Algoritmo:
 * 1. Parte con todos los bloques en level 0 (versión completa)
 * 2. Si el total excede maxTokens, degrada los bloques de menor prioridad primero
 * 3. Dentro de la misma prioridad, degrada de level 0 → level N → descarte
 * 4. Los bloques con `required: true` nunca se descartan (pero se degradan a su último level)
 */
export function applyBudget(
  blocks: readonly BudgetBlock[],
  maxTokens: number,
): BudgetResult {
  // Inicializa cada bloque en level 0
  const selections = blocks.map((block) => ({
    block,
    currentLevel: 0,
    tokens: estimateTokens(block.levels[0] ?? ""),
  }));

  let totalTokens = selections.reduce((sum, s) => sum + s.tokens, 0);

  // Degrada iterativamente hasta que el total está dentro del presupuesto
  while (totalTokens > maxTokens) {
    // Encuentra el bloque degradable con la menor prioridad (número más alto)
    // y que aún tenga niveles de degradación disponibles
    let bestCandidate: (typeof selections)[number] | null = null;
    let bestPriority = -1;

    for (const sel of selections) {
      const maxLevel = sel.block.levels.length; // incluye "descarte" como nivel extra
      const canDegrade = sel.block.required
        ? sel.currentLevel < sel.block.levels.length - 1 // required: puede degradar pero no descartar
        : sel.currentLevel < maxLevel; // no-required: puede degradar y descartar

      if (canDegrade && sel.block.priority >= bestPriority) {
        bestPriority = sel.block.priority;
        bestCandidate = sel;
      }
    }

    // No hay más bloques que degradar — el presupuesto no se puede alcanzar
    if (!bestCandidate) break;

    const nextLevel = bestCandidate.currentLevel + 1;
    const isDropped = nextLevel >= bestCandidate.block.levels.length;

    const oldTokens = bestCandidate.tokens;
    const newTokens = isDropped
      ? 0
      : estimateTokens(bestCandidate.block.levels[nextLevel] ?? "");

    bestCandidate.currentLevel = nextLevel;
    bestCandidate.tokens = newTokens;
    totalTokens = totalTokens - oldTokens + newTokens;
  }

  // Construye el resultado
  const result: Record<string, string> = {};
  const decisions: BudgetDecision[] = [];

  for (const sel of selections) {
    const dropped = sel.currentLevel >= sel.block.levels.length;
    const content = dropped ? "" : (sel.block.levels[sel.currentLevel] ?? "");

    if (!dropped) {
      result[sel.block.name] = content;
    }

    decisions.push({
      name: sel.block.name,
      priority: sel.block.priority,
      selectedLevel: sel.currentLevel,
      estimatedTokens: sel.tokens,
      dropped,
    });
  }

  return {
    blocks: result,
    decisions,
    totalTokens,
  };
}

/**
 * Trunca texto para caber dentro de un presupuesto de tokens.
 * Preserva opcionalmente el encabezado de tablas Markdown.
 *
 * Solo para uso como fallback — preferir degradación por niveles.
 */
export function truncateToTokenBudget(
  text: string,
  maxTokens: number,
  preserveHeader: boolean = true,
): string {
  if (estimateTokens(text) <= maxTokens) return text;

  const lines = text.split("\n");

  // Identifica las líneas de encabezado de tabla Markdown (pipe row + separator row)
  let headerEndIndex = 0;
  if (preserveHeader && lines.length >= 2) {
    // Busca el patrón: | header | ... \n |---|---| ...
    for (let i = 0; i < Math.min(lines.length, 5); i++) {
      if (lines[i]!.trimStart().startsWith("|")) {
        headerEndIndex = i + 1;
      } else if (headerEndIndex > 0) {
        break;
      }
    }
  }

  const headerLines = lines.slice(0, headerEndIndex);
  const headerTokens = estimateTokens(headerLines.join("\n"));
  const remainingBudget = maxTokens - headerTokens;

  if (remainingBudget <= 0) {
    // Ni siquiera cabe el encabezado — trunca crudo
    return text.slice(0, Math.floor(maxTokens / 1.8));
  }

  // Recorre las líneas restantes hasta que se agote el presupuesto
  const bodyLines = lines.slice(headerEndIndex);
  const resultLines = [...headerLines];
  let usedTokens = headerTokens;

  for (const line of bodyLines) {
    const lineTokens = estimateTokens(line);
    if (usedTokens + lineTokens > maxTokens) break;
    resultLines.push(line);
    usedTokens += lineTokens;
  }

  return resultLines.join("\n");
}
