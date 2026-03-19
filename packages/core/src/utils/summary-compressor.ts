/**
 * Summary Compressor — Ventana deslizante para chapter_summaries.md.
 *
 * Mantiene los últimos N capítulos con resúmenes completos y
 * pliega los capítulos más antiguos en resúmenes de etapa.
 */

// === Types ===

interface SummaryRow {
  readonly chapter: number;
  readonly raw: string;
  /** Columnas extraídas de la fila de la tabla */
  readonly columns: readonly string[];
}

interface CompressedResult {
  /** Resúmenes completos de los capítulos recientes */
  readonly recent: string;
  /** Resúmenes de etapa plegados para capítulos antiguos */
  readonly compressed: string;
  /** Estadísticas para debug */
  readonly stats: {
    readonly totalRows: number;
    readonly recentRows: number;
    readonly compressedGroups: number;
  };
}

// === Core Functions ===

/**
 * Comprime la tabla de resúmenes de capítulos con ventana deslizante.
 *
 * - Los últimos `recentWindowSize` capítulos se mantienen con su fila completa.
 * - Los capítulos más antiguos se agrupan cada `groupSize` capítulos y se
 *   pliegan en una sola fila resumen.
 */
export function compressSummaries(
  summariesMd: string,
  recentWindowSize: number = 20,
  groupSize: number = 10,
): CompressedResult {
  if (!summariesMd || summariesMd === "(文件尚未创建)") {
    return { recent: "", compressed: "", stats: { totalRows: 0, recentRows: 0, compressedGroups: 0 } };
  }

  const { header, rows } = parseSummaryTable(summariesMd);

  if (rows.length <= recentWindowSize) {
    // No hay necesidad de comprimir — todo cabe en la ventana reciente
    return {
      recent: summariesMd,
      compressed: "",
      stats: { totalRows: rows.length, recentRows: rows.length, compressedGroups: 0 },
    };
  }

  // Divide entre viejos y recientes
  const cutoff = rows.length - recentWindowSize;
  const oldRows = rows.slice(0, cutoff);
  const recentRows = rows.slice(cutoff);

  // Pliega los viejos en grupos
  const groups = groupRows(oldRows, groupSize);
  const compressedLines = groups.map((group) => foldGroup(group));

  // Reconstruye la tabla de resúmenes recientes
  const recentTable = [header, ...recentRows.map((r) => r.raw)].join("\n");

  // Construye la sección de historia comprimida
  const compressedSection = compressedLines.length > 0
    ? `### 历史阶段概述\n\n${compressedLines.join("\n\n")}`
    : "";

  return {
    recent: recentTable,
    compressed: compressedSection,
    stats: {
      totalRows: rows.length,
      recentRows: recentRows.length,
      compressedGroups: groups.length,
    },
  };
}

/**
 * Construye el texto de resúmenes listo para insertar en un Prompt.
 * Combina la historia comprimida + los resúmenes recientes completos.
 */
export function buildSlidingWindowSummaries(
  summariesMd: string,
  recentWindowSize: number = 20,
): string {
  const result = compressSummaries(summariesMd, recentWindowSize);

  if (!result.compressed && !result.recent) return "";

  const parts: string[] = [];
  if (result.compressed) {
    parts.push(result.compressed);
  }
  if (result.recent) {
    parts.push(result.recent);
  }
  return parts.join("\n\n");
}

// === Internal Helpers ===

/**
 * Analiza la tabla Markdown de resúmenes.
 * Espera formato:
 * | 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |
 * |------|------|----------|----------|----------|----------|----------|----------|
 * | 1    | XXX  | ...      | ...      | ...      | ...      | ...      | ...      |
 */
function parseSummaryTable(md: string): { header: string; rows: SummaryRow[] } {
  const lines = md.split("\n");
  const headerLines: string[] = [];
  const dataRows: SummaryRow[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed.startsWith("|")) {
      // Líneas no-tabla (título, líneas vacías) → parte del header
      if (dataRows.length === 0) {
        headerLines.push(line);
      }
      continue;
    }

    // Detecta separador de tabla (|---|---|)
    if (/^\|[\s-:|]+\|$/.test(trimmed)) {
      headerLines.push(line);
      continue;
    }

    // Detecta fila de encabezado
    if (trimmed.includes("章节") && trimmed.includes("标题")) {
      headerLines.push(line);
      continue;
    }

    // Fila de datos
    const columns = trimmed
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    const chapterNum = parseInt(columns[0] ?? "0", 10);
    if (!isNaN(chapterNum) && chapterNum > 0) {
      dataRows.push({
        chapter: chapterNum,
        raw: line,
        columns,
      });
    }
  }

  return {
    header: headerLines.join("\n"),
    rows: dataRows,
  };
}

function groupRows(rows: readonly SummaryRow[], groupSize: number): SummaryRow[][] {
  const groups: SummaryRow[][] = [];
  for (let i = 0; i < rows.length; i += groupSize) {
    groups.push(rows.slice(i, i + groupSize));
  }
  return groups;
}

/**
 * Pliega un grupo de filas de resumen en una línea de etapa comprimida.
 * Extrae y combina: rango de capítulos, personajes principales, eventos clave.
 */
function foldGroup(group: SummaryRow[]): string {
  if (group.length === 0) return "";

  const firstChapter = group[0]!.chapter;
  const lastChapter = group[group.length - 1]!.chapter;
  const range = `第${firstChapter}-${lastChapter}章`;

  // Recopila personajes únicos (columna 2 = 出场人物)
  const allCharacters = new Set<string>();
  for (const row of group) {
    const chars = row.columns[2] ?? "";
    for (const name of chars.split(/[,，、]/)) {
      const trimmed = name.trim();
      if (trimmed) allCharacters.add(trimmed);
    }
  }

  // Recopila eventos clave (columna 3 = 关键事件)
  const events: string[] = [];
  for (const row of group) {
    const event = (row.columns[3] ?? "").trim();
    if (event && event !== "-") events.push(event);
  }

  // Recopila dinámica de ganchos (columna 5 = 伏笔动态)
  const hooks: string[] = [];
  for (const row of group) {
    const hook = (row.columns[5] ?? "").trim();
    if (hook && hook !== "-") hooks.push(hook);
  }

  const characterList = [...allCharacters].slice(0, 8).join("、");
  const eventSummary = events.slice(0, 5).join("；");
  const hookSummary = hooks.length > 0 ? ` | 伏笔：${hooks.slice(0, 3).join("、")}` : "";

  return `**${range}**：${characterList} | ${eventSummary}${hookSummary}`;
}
