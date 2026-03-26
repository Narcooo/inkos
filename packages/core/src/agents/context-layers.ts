/**
 * Context Layers — Definiciones de la arquitectura de cinco capas
 * y la clasificación tripartita (Truth / State / View).
 *
 * Cada capa tiene un propósito claro y reglas de inyección distintas.
 * La generación creativa (S2) solo recibe cortes mínimos de cada capa,
 * nunca los archivos completos.
 */

import type { BookRules } from "../models/book-rules.js";
import type { GenreProfile } from "../models/genre-profile.js";

// ===========================
// Clasificación Tripartita
// ===========================

/**
 * Categoría de archivo según la clasificación tripartita.
 * - truth: largo plazo, baja frecuencia de actualización, alta confianza
 * - state: frecuencia media, avance por capítulo
 * - view: análisis temporal, vistas de recuperación
 */
export type FileCategory = "truth" | "state" | "view";

/** Archivos Truth — estables a largo plazo, actualizados con poca frecuencia. */
export interface TruthFiles {
  readonly storyBible: string;
  readonly bookRules: string;
  readonly volumeOutline: string;
  readonly styleGuide: string;
  readonly parentCanon: string;
  readonly fanficCanon: string;
}

/** Archivos State — actualizados por capítulo, transportan progresión narrativa. */
export interface StateFiles {
  readonly currentState: string;
  readonly pendingHooks: string;
  readonly particleLedger: string;
  readonly emotionalArcs: string;
}

/** Archivos View — análisis temporal, vistas y resúmenes. */
export interface ViewFiles {
  readonly chapterSummaries: string;
  readonly subplotBoard: string;
  readonly characterMatrix: string;
  readonly styleProfile: string;
}

// ===========================
// Chapter Task Card (S0 Output)
// ===========================

/** Tarjeta de tarea — controlador principal de la generación del capítulo. */
export interface ChapterTaskCard {
  /** Lo que este capítulo DEBE cambiar en la narrativa */
  readonly chapterGoal: string;
  /** Líneas narrativas activas (principal + secundarias) */
  readonly activeLines: readonly string[];
  /** Conflicto o presión central del capítulo */
  readonly corePressure: string;
  /** Movimientos explícitamente prohibidos */
  readonly forbiddenMoves: readonly string[];
  /** Tipo de gancho final (代价显形 / 局面升级 / 余压保留) */
  readonly hookType: string;
}

// ===========================
// Five Context Layers
// ===========================

/**
 * L1 — Capa de tarea del capítulo (prioridad más alta).
 *
 * Corta, dura, primera prioridad del capítulo actual.
 * No contiene descripciones de fondo extensas.
 * Es el controlador principal de la generación.
 */
export interface TaskLayer {
  /** Tarjeta de tarea del capítulo */
  readonly taskCard: ChapterTaskCard;
  /** Número de capítulo */
  readonly chapterNumber: number;
  /** Objetivo de palabras */
  readonly wordTarget: number;
  /** Tipo de capítulo inferido (过渡/冲突/高潮/收束) */
  readonly chapterType: string;
}

/**
 * L2 — Capa de control de riesgos (capa guardia).
 *
 * Restricciones fuertes, legibles por máquina, enumerables.
 * Inyectada por separado, nunca enterrada en texto largo.
 * Previene rebotes, abstracción y resurgimiento de inercia vieja.
 */
export interface RiskLayer {
  /** Paquete de palabras prohibidas del proyecto */
  readonly blacklistTerms: readonly string[];
  /** Direcciones de diseño prohibidas en la fase actual */
  readonly forbiddenDirections: readonly string[];
  /** Palabras de alta fatiga con límite de uso */
  readonly fatigueWordBudget: string;
  /** Corrección de deriva de auditorías recientes */
  readonly auditDriftCorrection: string;
  /** Violaciones recientes de post-write */
  readonly recentViolations: readonly string[];
}

/**
 * L3 — Capa de estado de continuidad (carryover).
 *
 * Solo contiene información de estado "directamente relevante al capítulo actual".
 * Local, minimizada, NO equivalente al archivo de estado dinámico completo.
 */
export interface ContinuityLayer {
  /** Situación clave del final del capítulo anterior (≤500 caracteres) */
  readonly previousChapterTail: string;
  /** Estado actual del protagonista y conflicto (extracto, no archivo completo) */
  readonly currentAnchor: string;
  /** Ganchos pendientes relevantes (solo open/progressing de los últimos ~5 capítulos) */
  readonly relevantHooks: string;
  /** Resúmenes recientes (solo 2-3 líneas más recientes) */
  readonly recentSummaryLines: string;
  /** Tensiones de relación residuales */
  readonly relationTensions: string;
}

/**
 * L4 — Capa de estilo activo.
 *
 * 1-2 módulos de estilo principales + máximo 1 auxiliar.
 * Cargados bajo demanda, estrictamente prohibido inyectar todo el estilo simultáneamente.
 * El estilo debe servir a la tarea, no ser decoración.
 */
export interface StyleLayer {
  /** IDs de los módulos de estilo activos */
  readonly activeModuleIds: readonly string[];
  /** Contenido core de los módulos activos (ya combinado) */
  readonly modulesContent: string;
  /** Guía de fingerprint de estilo (si existe) */
  readonly styleFingerprint?: string;
  /** Fingerprints de diálogo por personaje */
  readonly dialogueFingerprints: string;
}

/**
 * L5 — Capa de fragmentos de verdad selectivos.
 *
 * Solo extractos directamente relevantes al capítulo actual.
 * Fragmentados, solo lectura, nunca inyección completa.
 * JAMÁS confundir con la capa de estado.
 */
export interface TruthSliceLayer {
  /** Fragmentos de settings de personajes que aparecen en este capítulo */
  readonly relevantCharacterSettings: string;
  /** Reglas del mundo necesarias para la línea actual */
  readonly relevantWorldRules: string;
  /** Fragmento del outline relevante al capítulo actual */
  readonly relevantOutlineSlice: string;
  /** Restricciones de ganchos a largo plazo relevantes */
  readonly relevantLongTermHooks: string;
}

/**
 * Contexto enrutado completo — las cinco capas ya recortadas,
 * listo para ser inyectado en un prompt de generación o corrección.
 */
export interface RoutedContext {
  readonly task: TaskLayer;
  readonly risk: RiskLayer;
  readonly continuity: ContinuityLayer;
  readonly style: StyleLayer;
  readonly truthSlice: TruthSliceLayer;
}

// ===========================
// Layer Builder Functions
// ===========================

const NAME_PATTERN = /[\u4e00-\u9fff]{2,4}/g;
const HOOK_ID_PATTERN = /H\d{2,3}/g;

/**
 * Construye L1 (tarea) a partir de la tarjeta y configuración del libro.
 */
export function buildTaskLayer(
  taskCard: ChapterTaskCard,
  chapterNumber: number,
  wordTarget: number,
  chapterType: string,
): TaskLayer {
  return { taskCard, chapterNumber, wordTarget, chapterType };
}

/**
 * Construye L2 (riesgos) a partir de reglas del libro, perfil de género
 * y estado de corrección de deriva de auditorías.
 */
export function buildRiskLayer(
  bookRules: BookRules | null,
  genreProfile: GenreProfile,
  auditDriftCorrection: string = "",
  recentViolations: readonly string[] = [],
): RiskLayer {
  // Palabras/frases prohibidas del proyecto
  const blacklistTerms: string[] = [];
  if (bookRules?.prohibitions) {
    blacklistTerms.push(...bookRules.prohibitions);
  }

  // Direcciones prohibidas por bloqueo de género
  const forbiddenDirections: string[] = [];
  if (bookRules?.genreLock?.forbidden) {
    forbiddenDirections.push(...bookRules.genreLock.forbidden);
  }

  // Presupuesto de palabras de fatiga
  const fatigueWords = bookRules?.fatigueWordsOverride?.length
    ? bookRules.fatigueWordsOverride
    : genreProfile.fatigueWords;
  const fatigueWordBudget = fatigueWords.length > 0
    ? `高疲劳词（每词上限1次/章）: ${fatigueWords.join("、")}`
    : "";

  return {
    blacklistTerms,
    forbiddenDirections,
    fatigueWordBudget,
    auditDriftCorrection,
    recentViolations: [...recentViolations],
  };
}

/**
 * Construye L3 (continuidad) — extrae solo los datos mínimos
 * directamente relevantes al capítulo actual.
 */
export function buildContinuityLayer(
  currentState: string,
  pendingHooks: string,
  recentChapterContent: string,
  chapterSummaries: string,
  chapterNumber: number,
  taskCard?: ChapterTaskCard,
): ContinuityLayer {
  // Capítulo 1: no hay historia previa
  if (chapterNumber <= 1) {
    return {
      previousChapterTail: "",
      currentAnchor: extractCurrentAnchor(currentState),
      relevantHooks: "",
      recentSummaryLines: "",
      relationTensions: "",
    };
  }

  return {
    previousChapterTail: extractPreviousChapterTail(recentChapterContent),
    currentAnchor: extractCurrentAnchor(currentState),
    relevantHooks: filterRelevantHooks(pendingHooks, chapterNumber, 3, taskCard),
    recentSummaryLines: extractRecentSummaryLines(chapterSummaries, chapterNumber),
    relationTensions: extractRelationTensions(currentState),
  };
}

/**
 * Construye L5 (fragmentos de verdad) — extrae solo los fragmentos
 * directamente relevantes al capítulo actual, basándose en la tarjeta de tarea.
 *
 * Implementa extracción de dos niveles (Gap #1):
 * - Pre-escritura: usa la tarjeta de tarea para inferir personajes/temas
 * - Post-escritura: usa el contenido real (en S5, no aquí)
 */
export function buildTruthSliceLayer(
  taskCard: ChapterTaskCard,
  storyBible: string,
  characterMatrix: string,
  subplotBoard: string,
  volumeOutline: string,
  chapterNumber: number,
  targetChapters?: number,
): TruthSliceLayer {
  // Extraer nombres y palabras clave del task card para buscar fragmentos relevantes
  const searchTerms = extractSearchTerms(taskCard);

  // Capítulos tempranos (≤5): ampliar presupuesto de extracción y añadir fallback
  // porque el TaskCard aún tiene pocas palabras clave y la story_bible es crítica para establecer el mundo.
  const isEarlyChapter = chapterNumber <= 5;
  const sliceMaxChars = isEarlyChapter ? 4000 : 1500;

  const characterSettings = extractRelevantParagraphs(storyBible, searchTerms, "character", sliceMaxChars);
  const worldRules = extractRelevantParagraphs(storyBible, searchTerms, "world", sliceMaxChars);

  // Fallback: si la búsqueda semántica no devuelve nada, inyectar el inicio de story_bible
  // para que el Writer tenga contexto mínimo del mundo.
  const FALLBACK_HEAD_CHARS = 2000;
  const characterFallback = !characterSettings && storyBible && !isFallback(storyBible)
    ? storyBible.slice(0, FALLBACK_HEAD_CHARS)
    : characterSettings;

  return {
    relevantCharacterSettings: characterFallback,
    relevantWorldRules: worldRules,
    relevantOutlineSlice: extractOutlineSlice(volumeOutline, chapterNumber, 1000, targetChapters),
    relevantLongTermHooks: extractRelevantParagraphs(subplotBoard, searchTerms, "hook"),
  };
}

// ===========================
// Internal Extraction Helpers
// ===========================

/**
 * Extrae el final del capítulo anterior (≤ 500 caracteres).
 * Toma los últimos párrafos del contenido reciente.
 */
function extractPreviousChapterTail(recentChapterContent: string, maxChars = 500): string {
  if (!recentChapterContent || isFallback(recentChapterContent)) return "";

  const trimmed = recentChapterContent.trim();
  if (trimmed.length <= maxChars) return trimmed;

  // Tomar desde el final, cortando en un salto de línea
  const tail = trimmed.slice(-maxChars);
  const firstNewline = tail.indexOf("\n");
  return firstNewline > 0 ? tail.slice(firstNewline + 1).trim() : tail.trim();
}

/**
 * Extrae el ancla actual (situación + conflicto + objetivo del protagonista)
 * de current_state.md — solo las secciones relevantes, no el archivo completo.
 */
function extractCurrentAnchor(currentState: string): string {
  if (!currentState || isFallback(currentState)) return "";

  // Buscar secciones relevantes por encabezado
  const relevantHeaders = ["当前", "主角", "冲突", "目标", "锚", "protagonist", "conflict", "goal", "anchor"];
  const lines = currentState.split("\n");
  const result: string[] = [];
  let capturing = false;

  for (const line of lines) {
    const isHeader = line.startsWith("#");
    if (isHeader) {
      const lower = line.toLowerCase();
      capturing = relevantHeaders.some((h) => lower.includes(h));
    }
    if (capturing) {
      result.push(line);
    }
  }

  // Si no se encontraron secciones, devolver un extracto limitado del inicio
  if (result.length === 0) {
    return currentState.slice(0, 800);
  }

  return result.join("\n").slice(0, 1200);
}

/**
 * Filtra ganchos pendientes a solo los relevantes:
 * - Estado open o progressing
 * - Originados en los últimos ~5 capítulos
 */
function filterRelevantHooks(
  pendingHooks: string,
  chapterNumber: number,
  window = 3,
  taskCard?: ChapterTaskCard,
): string {
  if (!pendingHooks || isFallback(pendingHooks)) return "";

  const lines = pendingHooks.split("\n");
  const headerLines: string[] = [];
  const coreLines: string[] = [];
  const semanticLines: string[] = [];
  let inTable = false;

  // Extraer palabras clave de búsqueda del task card si existe
  const keywords = taskCard ? extractSearchTerms(taskCard) : [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Capturar las líneas de encabezado de tabla markdown
    if (trimmed.startsWith("|") && !inTable) {
      headerLines.push(line);
      inTable = true;
      continue;
    }
    if (inTable && trimmed.startsWith("|---")) {
      headerLines.push(line);
      continue;
    }
    if (!trimmed.startsWith("|")) {
      inTable = false;
      continue;
    }

    // Filtrar filas: solo open/progressing
    const isRelevantStatus = /open|progressing/i.test(trimmed);
    if (!isRelevantStatus) continue;

    // Extraer el número de capítulo de origen (e.g. "| 15 |" o "| H01 | 15 |")
    const chapterMatch = trimmed.match(/\|\s*(\d+)\s*\|/);
    const originChapter = chapterMatch ? parseInt(chapterMatch[1]!, 10) : 0;

    // 1. Criterio Temporal (Core): últimos N capítulos (uncondicional)
    const isRecent = originChapter >= chapterNumber - window;
    if (isRecent) {
      coreLines.push(line);
      continue;
    }

    // 2. Criterio Semántico (Elastic): mención en el TaskCard (back-retrieval)
    if (keywords.length > 0) {
      const lineLower = trimmed.toLowerCase();
      const isMatched = keywords.some(k => lineLower.includes(k.toLowerCase()));
      if (isMatched) {
        semanticLines.push(line);
      }
    }
  }

  const allRelevant = [...new Set([...coreLines, ...semanticLines])];
  if (allRelevant.length === 0) return "";

  // Devolver con encabezados si había tabla
  return (headerLines.length > 0)
    ? [...headerLines, ...allRelevant].join("\n")
    : allRelevant.join("\n");
}

/**
 * Extrae las 2-3 líneas de resumen más recientes de chapter_summaries.
 */
function extractRecentSummaryLines(
  chapterSummaries: string,
  chapterNumber: number,
  lineCount = 3,
): string {
  if (!chapterSummaries || isFallback(chapterSummaries)) return "";

  const lines = chapterSummaries.split("\n").filter((l) => l.trim().length > 0);

  // Buscar líneas de tabla con números de capítulo
  const tableLines = lines.filter((l) => l.trim().startsWith("|") && !l.trim().startsWith("|---"));
  const headerLines = tableLines.filter((_, i) => i === 0); // Encabezado de tabla

  // Tomar las últimas N líneas de datos (excluyendo el capítulo actual)
  const dataLines = tableLines.slice(1).filter((l) => {
    const chMatch = l.match(/\|\s*(\d+)\s*\|/);
    return chMatch ? parseInt(chMatch[1]!, 10) < chapterNumber : true;
  });

  const recent = dataLines.slice(-lineCount);
  if (recent.length === 0) return "";
  return [...headerLines, ...recent].join("\n");
}

/**
 * Extrae tensiones de relación del archivo de estado actual.
 */
function extractRelationTensions(currentState: string): string {
  if (!currentState || isFallback(currentState)) return "";

  const tensionHeaders = ["关系", "张力", "tension", "relationship"];
  const lines = currentState.split("\n");
  const result: string[] = [];
  let capturing = false;

  for (const line of lines) {
    const isHeader = line.startsWith("#");
    if (isHeader) {
      const lower = line.toLowerCase();
      capturing = tensionHeaders.some((h) => lower.includes(h));
    }
    if (capturing) {
      result.push(line);
    }
  }

  return result.join("\n").slice(0, 600);
}

/**
 * Extrae términos de búsqueda del task card para buscar fragmentos relevantes
 * en los archivos Truth/View (Gap #1: L5a pre-escritura).
 */
function extractSearchTerms(taskCard: ChapterTaskCard): readonly string[] {
  const terms = new Set<string>();

  // Extraer nombres chinos (2-4 caracteres)
  const allText = [
    taskCard.chapterGoal,
    taskCard.corePressure,
    ...taskCard.activeLines,
  ].join(" ");

  const nameMatches = allText.match(NAME_PATTERN);
  if (nameMatches) {
    for (const name of nameMatches) {
      terms.add(name);
    }
  }

  // Extraer IDs de gancho (H01, H02, etc.)
  const hookMatches = allText.match(HOOK_ID_PATTERN);
  if (hookMatches) {
    for (const hookId of hookMatches) {
      terms.add(hookId);
    }
  }

  // Extraer palabras inglesas significativas (capitalize = nombre propio)
  const englishNames = allText.match(/[A-Z][a-z]{2,}/g);
  if (englishNames) {
    for (const name of englishNames) {
      terms.add(name);
    }
  }

  // [P0] 别名增强 (Alias Awareness)
  // 常见中文停用字/高频字 — 作为别名展开后会产生大量误匹配
  const STOP_CHARS = new Set("的了是在有不人这中大上个到说时要就出会也对过能下多后作里用年为水与高");

  for (const term of [...terms]) {
    // 如果是中文 2-3 字人名
    if (/^[\u4e00-\u9fff]{2,3}$/.test(term)) {
      const surname = term.charAt(0);
      const lastName = term.charAt(term.length - 1);
      // 只添加非停用字的别名
      if (!STOP_CHARS.has(surname)) {
        terms.add(surname);
        terms.add(`老${surname}`);
      }
      if (!STOP_CHARS.has(lastName)) {
        terms.add(lastName);
      }
    }
  }

  return [...terms];
}

/**
 * Extrae párrafos relevantes de un archivo, buscando los que contienen
 * alguno de los términos de búsqueda.
 */
function extractRelevantParagraphs(
  fileContent: string,
  searchTerms: readonly string[],
  _type: "character" | "world" | "hook",
  maxChars = 1500,
): string {
  if (!fileContent || isFallback(fileContent) || searchTerms.length === 0) return "";

  // Dividir por secciones (encabezados markdown)
  const sections = fileContent.split(/(?=^#{1,3}\s)/m);
  const relevant: string[] = [];
  let totalChars = 0;

  for (const section of sections) {
    const matched = searchTerms.some((term) => section.includes(term));
    if (matched && totalChars + section.length <= maxChars) {
      relevant.push(section.trim());
      totalChars += section.length;
    }
  }

  return relevant.join("\n\n");
}

/**
 * Extrae la sección del outline más cercana al capítulo actual.
 */
function extractOutlineSlice(
  volumeOutline: string,
  chapterNumber: number,
  windowChars = 1000,
  targetChapters = 200,
): string {
  const safeTargetChapters = targetChapters || 200;
  if (!volumeOutline || isFallback(volumeOutline)) return "";

  // Buscar mención directa del capítulo
  const chapterPatterns = [
    new RegExp(`第${chapterNumber}章`, "i"),
    new RegExp(`[Cc]hapter\\s*${chapterNumber}\\b`),
    new RegExp(`\\b${chapterNumber}\\b`),
  ];

  const lines = volumeOutline.split("\n");
  let bestLineIdx = -1;

  for (const pattern of chapterPatterns) {
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i]!)) {
        bestLineIdx = i;
        break;
      }
    }
    if (bestLineIdx >= 0) break;
  }

  // [P1] 修复硬编码 200 问题
  if (bestLineIdx < 0) {
    const ratio = Math.min(chapterNumber / safeTargetChapters, 0.9);
    const charPos = Math.floor(volumeOutline.length * ratio);
    const start = Math.max(0, charPos - windowChars / 2);
    const slice = volumeOutline.slice(start, start + windowChars);
    // Ajustar al salto de línea más cercano
    const firstNewline = slice.indexOf("\n");
    return firstNewline > 0 ? slice.slice(firstNewline + 1) : slice;
  }

  // Tomar un rango alrededor de la línea encontrada
  const contextLines = 15;
  const startLine = Math.max(0, bestLineIdx - 3);
  const endLine = Math.min(lines.length, bestLineIdx + contextLines);
  const slice = lines.slice(startLine, endLine).join("\n");

  return slice.slice(0, windowChars);
}

/** Comprueba si un valor es un placeholder/fallback. */
function isFallback(value: string): boolean {
  return value === "(文件不存在)" || value === "(文件尚未创建)";
}
