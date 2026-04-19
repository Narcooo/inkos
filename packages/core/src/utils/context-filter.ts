/**
 * Smart context filtering for Writer and Auditor prompts.
 *
 * Reduces noise by injecting only relevant parts of truth files.
 * Every filter falls back to the full input if filtering would empty it.
 */

import { DEFAULT_CHAPTER_CADENCE_WINDOW } from "./chapter-cadence.js";

/** Filter pending_hooks: remove resolved/closed hooks. */
export function filterHooks(hooks: string): string {
  if (!hooks || hooks === "(文件尚未创建)") return hooks;
  return filterTableRows(hooks, (row) => {
    const lower = row.toLowerCase();
    return !lower.includes("已回收") && !lower.includes("resolved") && !lower.includes("closed");
  });
}

/** Filter chapter_summaries: keep only the most recent N chapters. */
export function filterSummaries(
  summaries: string,
  currentChapter: number,
  keepRecent = DEFAULT_CHAPTER_CADENCE_WINDOW,
): string {
  if (!summaries || summaries === "(文件尚未创建)") return summaries;
  return filterTableRows(summaries, (row) => {
    const match = row.match(/\|\s*(\d+)\s*\|/);
    if (!match) return true;
    return parseInt(match[1]!, 10) > currentChapter - keepRecent;
  });
}

/** Filter subplot_board: remove closed/resolved subplots. */
export function filterSubplots(board: string): string {
  if (!board || board === "(文件尚未创建)") return board;
  return filterTableRows(board, (row) => {
    const lower = row.toLowerCase();
    return !lower.includes("已回收") && !lower.includes("closed") && !lower.includes("resolved") && !lower.includes("已完结");
  });
}

/** Filter emotional_arcs: keep only the most recent N chapters. */
export function filterEmotionalArcs(
  arcs: string,
  currentChapter: number,
  keepRecent = DEFAULT_CHAPTER_CADENCE_WINDOW,
): string {
  if (!arcs || arcs === "(文件尚未创建)") return arcs;
  return filterTableRows(arcs, (row) => {
    const match = row.match(/\|\s*(\d+)\s*\|/);
    if (!match) return true;
    return parseInt(match[1]!, 10) > currentChapter - keepRecent;
  });
}

/**
 * Filter character_matrix: keep only characters mentioned in the volume outline
 * current section + protagonist.
 */
export function filterCharacterMatrix(
  matrix: string,
  volumeOutline: string,
  protagonistName?: string,
): string {
  if (!matrix || matrix === "(文件尚未创建)") return matrix;

  // Extract names from outline
  const names = extractNames(volumeOutline);
  if (protagonistName) names.add(protagonistName);
  if (names.size === 0) return matrix;

  // Split into sections (### 角色档案, ### 相遇记录, ### 信息边界)
  const sections = matrix.split(/(?=^###)/m);
  const filtered = sections.map((section) => {
    const result = filterTableRows(section, (row) => {
      for (const name of names) {
        if (row.includes(name)) return true;
      }
      return false;
    });
    // Keep section even if no matching rows (preserve headers for structure)
    return result;
  });

  const result = filtered.join("\n");
  // Fallback: if filtering removed all data rows, return original
  const dataRowCount = result.split("\n").filter((l) => l.startsWith("|") && !l.includes("---") && !isHeaderRow(l)).length;
  return dataRowCount > 0 ? result : matrix;
}

/**
 * Extract character names from text.
 * Chinese: 2-4 char sequences before punctuation.
 * English: Capitalized words 3+ chars.
 */
function extractNames(text: string): Set<string> {
  const names = new Set<string>();

  // Chinese names
  const cnRegex = /[\u4e00-\u9fff]{2,4}(?=[，、。：\s]|$)/g;
  let match: RegExpExecArray | null;
  while ((match = cnRegex.exec(text)) !== null) {
    names.add(match[0]);
  }

  // English names
  const enRegex = /\b[A-Z][a-z]{2,}\b/g;
  while ((match = enRegex.exec(text)) !== null) {
    names.add(match[0]);
  }

  return names;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isHeaderRow(line: string): boolean {
  // First data-like row in a table (contains column names)
  return /^\|\s*(章节|角色|支线|hook_id|Chapter|Character|Subplot)/i.test(line);
}

/**
 * Generic markdown table row filter.
 * Keeps header rows + separator rows + rows passing the predicate.
 * Falls back to original if filtering empties all data rows.
 */
function filterTableRows(content: string, predicate: (row: string) => boolean): string {
  const lines = content.split("\n");
  const nonTableLines: string[] = [];
  const headerLines: string[] = [];
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line.startsWith("|")) {
      nonTableLines.push(line);
    } else if (line.includes("---") || isHeaderRow(line)) {
      headerLines.push(line);
    } else {
      dataLines.push(line);
    }
  }

  const filtered = dataLines.filter(predicate);

  // Fallback: if no rows pass, return original
  if (filtered.length === 0 && dataLines.length > 0) {
    return content;
  }

  return [...nonTableLines, ...headerLines, ...filtered].join("\n");
}
