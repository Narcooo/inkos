/**
 * Paragraph-level diff builder — genera un resumen compacto de los cambios
 * entre el texto original y el revisado, a nivel de párrafo.
 *
 * Se usa en el settler incremental para enviar solo las diferencias al LLM,
 * reduciendo dramáticamente el prompt cuando la revisión es menor.
 */

export interface ParagraphChange {
  readonly type: "added" | "removed" | "modified";
  readonly index: number;
  readonly original?: string;
  readonly revised?: string;
}

export interface ParagraphDiff {
  readonly changes: ReadonlyArray<ParagraphChange>;
  readonly totalParagraphs: number;
  readonly changedParagraphs: number;
  /** Ratio de párrafos modificados (0-1). Valores bajos = revisión menor. */
  readonly changeRatio: number;
}

/**
 * Divide el texto en párrafos usando doble salto de línea como separador.
 */
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Compara dos textos a nivel de párrafo y produce un diff compacto.
 * Usa heurística LCS simplificada optimizada para textos de capítulos.
 */
export function buildParagraphDiff(original: string, revised: string): ParagraphDiff {
  const origParas = splitParagraphs(original);
  const revParas = splitParagraphs(revised);
  const changes: ParagraphChange[] = [];

  const maxLen = Math.max(origParas.length, revParas.length);

  // Heurística simple: comparación posicional con detección de similitud
  for (let i = 0; i < maxLen; i++) {
    const orig = origParas[i];
    const rev = revParas[i];

    if (orig === undefined && rev !== undefined) {
      // Párrafo nuevo
      changes.push({ type: "added", index: i, revised: rev });
    } else if (orig !== undefined && rev === undefined) {
      // Párrafo eliminado
      changes.push({ type: "removed", index: i, original: orig });
    } else if (orig !== undefined && rev !== undefined && orig !== rev) {
      // Párrafo modificado — verificar si es un cambio significativo
      const similarity = computeSimilarity(orig, rev);
      if (similarity < 0.95) {
        changes.push({ type: "modified", index: i, original: orig, revised: rev });
      }
    }
  }

  return {
    changes,
    totalParagraphs: maxLen,
    changedParagraphs: changes.length,
    changeRatio: maxLen > 0 ? changes.length / maxLen : 0,
  };
}

/**
 * Calcula la similitud aproximada entre dos textos usando bigram overlap.
 * Retorna un valor entre 0 (totalmente diferente) y 1 (idéntico).
 */
function computeSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const bigramsA = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) {
    bigramsA.add(a.slice(i, i + 2));
  }

  const bigramsB = new Set<string>();
  for (let i = 0; i < b.length - 1; i++) {
    bigramsB.add(b.slice(i, i + 2));
  }

  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }

  const union = bigramsA.size + bigramsB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Formatea el diff como texto legible para el LLM settler.
 * Incluye solo los párrafos que cambiaron con un formato compacto.
 */
export function formatDiffForSettler(diff: ParagraphDiff): string {
  if (diff.changes.length === 0) return "(无实质性变更)";

  const lines: string[] = [
    `修订变更摘要（共${diff.totalParagraphs}段，${diff.changedParagraphs}段有变化）：`,
    "",
  ];

  for (const change of diff.changes) {
    switch (change.type) {
      case "added":
        lines.push(`【新增段落 #${change.index + 1}】`);
        lines.push(change.revised!);
        lines.push("");
        break;
      case "removed":
        lines.push(`【删除段落 #${change.index + 1}】`);
        lines.push(`原文：${change.original!.slice(0, 200)}${change.original!.length > 200 ? "…" : ""}`);
        lines.push("");
        break;
      case "modified":
        lines.push(`【修改段落 #${change.index + 1}】`);
        lines.push(`修改后：${change.revised!}`);
        lines.push("");
        break;
    }
  }

  return lines.join("\n");
}

/**
 * Determina si debería usar settler incremental o completo.
 * Retorna true si la revisión es menor (< 30% de párrafos cambiados).
 */
export function shouldUseIncrementalSettle(diff: ParagraphDiff): boolean {
  // Sin cambios — no necesita settle
  if (diff.changedParagraphs === 0) return false;
  // Pocos cambios — incremental es más eficiente
  return diff.changeRatio < 0.3;
}
