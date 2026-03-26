import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { readFileSafe } from "../utils/read-file-safe.js";
import { readAllStoryFiles, readTruthFiles, readStateFiles, readViewFiles } from "../utils/story-files.js";
import { readGenreProfile } from "./rules-reader.js";
import { readBookRules } from "./rules-reader.js";
import { applyBudget, type BudgetBlock, type BudgetResult } from "../utils/context-budget.js";
import { buildSlidingWindowSummaries } from "../utils/summary-compressor.js";
import { buildRecentChapterFull, buildRecentChapterTail } from "../utils/recent-chapter-compressor.js";
import { routeForCreativeWrite } from "./context-router.js";
import type { ChapterTaskCard, RoutedContext } from "./context-layers.js";
import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { BookRules } from "../models/book-rules.js";
import type { Logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

/** Todas las fuentes de verdad leídas del disco para un capítulo. */
export interface WriterRawFiles {
  readonly storyBible: string;
  readonly volumeOutline: string;
  readonly styleGuide: string;
  readonly currentState: string;
  readonly ledger: string;
  readonly hooks: string;
  readonly chapterSummaries: string;
  readonly subplotBoard: string;
  readonly emotionalArcs: string;
  readonly characterMatrix: string;
  readonly styleProfileRaw: string;
  readonly parentCanon: string;
  readonly fanficCanon: string;
  readonly recentChapters: string;
}

/** Material enriquecido derivado de los archivos crudos. */
export interface WriterDerivedContext {
  readonly genreProfile: GenreProfile;
  readonly genreBody: string;
  readonly bookRules: BookRules | null;
  readonly bookRulesBody: string;
  readonly styleFingerprint: string | undefined;
  readonly dialogueFingerprints: string;
  readonly relevantSummaries: string;
  readonly hasParentCanon: boolean;
  readonly hasFanficCanon: boolean;
}

/** Resultado final del ensamblaje de contexto del Writer. */
export interface WriterContext {
  readonly raw: WriterRawFiles;
  readonly derived: WriterDerivedContext;
  readonly budget: BudgetResult;
}

// ---------------------------------------------------------------------------
// Constante de presupuesto por defecto
// ---------------------------------------------------------------------------

/** Presupuesto de tokens por defecto para el prompt del Writer (deja ~28k para output) */
const DEFAULT_CONTEXT_BUDGET = 100_000;

/** Número de capítulos recientes a cargar como contexto */
const DEFAULT_RECENT_WINDOW = 3;

// ---------------------------------------------------------------------------
// Función principal de ensamblaje
// ---------------------------------------------------------------------------

/**
 * Lee todos los archivos de verdad, enriquece el contexto y aplica el
 * presupuesto de tokens. Devuelve un WriterContext listo para ser
 * consumido por WriterAgent.
 */
export async function buildWriterContext(
  projectRoot: string,
  book: BookConfig,
  bookDir: string,
  chapterNumber: number,
  opts?: {
    readonly externalContext?: string;
    readonly contextBudget?: number;
    readonly recentWindow?: number;
    readonly logger?: Logger;
  },
): Promise<WriterContext> {
  // ── Paso 1: leer archivos en paralelo ──
  const raw = await readAllTruthFiles(bookDir, chapterNumber, opts?.recentWindow);

  // ── Paso 2: cargar perfil de género y reglas ──
  const { profile: genreProfile, body: genreBody } =
    await readGenreProfile(projectRoot, book.genre);
  const parsedBookRules = await readBookRules(bookDir);
  const bookRules = parsedBookRules?.rules ?? null;
  const bookRulesBody = parsedBookRules?.body ?? "";

  // ── Paso 3: derivar contexto enriquecido ──
  const styleFingerprint = buildStyleFingerprint(raw.styleProfileRaw);
  const dialogueFingerprints = extractDialogueFingerprints(raw.recentChapters, raw.storyBible);
  const relevantSummaries = findRelevantSummaries(raw.chapterSummaries, raw.volumeOutline, chapterNumber);
  const hasParentCanon = raw.parentCanon !== "(文件尚未创建)";
  const hasFanficCanon = raw.fanficCanon !== "(文件尚未创建)";

  const derived: WriterDerivedContext = {
    genreProfile,
    genreBody,
    bookRules,
    bookRulesBody,
    styleFingerprint,
    dialogueFingerprints,
    relevantSummaries,
    hasParentCanon,
    hasFanficCanon,
  };

  // ── Paso 4: construir bloques de presupuesto y aplicar ──
  const budget = buildAndApplyBudget(raw, derived, opts?.externalContext, opts?.contextBudget, opts?.logger);

  return { raw, derived, budget };
}

// ---------------------------------------------------------------------------
// Lectura de archivos
// ---------------------------------------------------------------------------

const FALLBACK = "(文件尚未创建)";

async function readAllTruthFiles(bookDir: string, chapterNumber: number, recentWindow?: number): Promise<WriterRawFiles> {
  const storyDir = join(bookDir, "story");

  const sf = await readAllStoryFiles(storyDir, FALLBACK);
  const storyBible = sf.storyBible;
  const volumeOutline = sf.volumeOutline;
  const styleGuide = sf.styleGuide;
  const currentState = sf.currentState;
  const ledger = sf.particleLedger;
  const hooks = sf.pendingHooks;
  const chapterSummaries = sf.chapterSummaries;
  const subplotBoard = sf.subplotBoard;
  const emotionalArcs = sf.emotionalArcs;
  const characterMatrix = sf.characterMatrix;
  const styleProfileRaw = sf.styleProfile;
  const parentCanon = sf.parentCanon;
  const fanficCanon = sf.fanficCanon;
  const recentChapters = await loadRecentChapters(bookDir, chapterNumber, recentWindow);

  return {
    storyBible, volumeOutline, styleGuide, currentState, ledger, hooks,
    chapterSummaries, subplotBoard, emotionalArcs, characterMatrix, styleProfileRaw,
    parentCanon, fanficCanon, recentChapters,
  };
}

/**
 * Carga los últimos N capítulos como contexto para el Writer.
 * @param windowSize Número de capítulos recientes (por defecto 3)
 */
export async function loadRecentChapters(
  bookDir: string,
  _currentChapter: number,
  windowSize: number = DEFAULT_RECENT_WINDOW,
): Promise<string> {
  const chaptersDir = join(bookDir, "chapters");
  try {
    const files = await readdir(chaptersDir);
    const mdFiles = files
      .filter((f) => f.endsWith(".md") && !f.startsWith("index"))
      .sort()
      .slice(-windowSize);

    if (mdFiles.length === 0) return "";

    const contents = await Promise.all(
      mdFiles.map((f) => readFile(join(chaptersDir, f), "utf-8")),
    );

    return contents.join("\n\n---\n\n");
  } catch {
    return "";
  }
}

/**
 * Genera niveles de degradación para N capítulos recientes:
 * - L0: todos los capítulos completos
 * - L1: último capítulo completo + capítulos anteriores solo tail
 * - L2: solo último capítulo completo
 * - L3: solo último capítulo tail
 */
export function buildRecentChaptersLevels(recentChapters: string): string[] {
  if (!recentChapters) return [""];

  // Separar por el delimitador de capítulos
  const chapters = recentChapters.split(/\n\n---\n\n/);
  if (chapters.length <= 1) {
    // Solo un capítulo — degradación simple
    return [
      buildRecentChapterFull(recentChapters),
      buildRecentChapterTail(recentChapters),
    ];
  }

  const lastChapter = chapters[chapters.length - 1]!;
  const olderChapters = chapters.slice(0, -1);

  // L0: todos completos
  const l0 = chapters.join("\n\n---\n\n");

  // L1: último completo + anteriores solo tail
  const olderTails = olderChapters.map((c) => buildRecentChapterTail(c));
  const l1 = [...olderTails, lastChapter].join("\n\n---\n\n");

  // L2: solo último capítulo completo
  const l2 = lastChapter;

  // L3: solo último capítulo tail
  const l3 = buildRecentChapterTail(lastChapter);

  return [l0, l1, l2, l3];
}

// ---------------------------------------------------------------------------
// Derivaciones de contexto
// ---------------------------------------------------------------------------

/** Construye el resumen de estilo a partir del JSON de perfil. */
export function buildStyleFingerprint(styleProfileRaw: string): string | undefined {
  if (!styleProfileRaw || styleProfileRaw === FALLBACK) return undefined;
  try {
    const profile = JSON.parse(styleProfileRaw);
    const lines: string[] = [];
    if (profile.avgSentenceLength) lines.push(`- 平均句长：${profile.avgSentenceLength}字`);
    if (profile.sentenceLengthStdDev) lines.push(`- 句长标准差：${profile.sentenceLengthStdDev}`);
    if (profile.avgParagraphLength) lines.push(`- 平均段落长度：${profile.avgParagraphLength}字`);
    if (profile.paragraphLengthRange) lines.push(`- 段落长度范围：${profile.paragraphLengthRange.min}-${profile.paragraphLengthRange.max}字`);
    if (profile.vocabularyDiversity) lines.push(`- 词汇多样性(TTR)：${profile.vocabularyDiversity}`);
    if (profile.topPatterns?.length > 0) lines.push(`- 高频句式：${profile.topPatterns.join("、")}`);
    if (profile.rhetoricalFeatures?.length > 0) lines.push(`- 修辞特征：${profile.rhetoricalFeatures.join("、")}`);
    return lines.length > 0 ? lines.join("\n") : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extrae huellas de diálogo de los capítulos recientes.
 * Para cada personaje con ≥2 líneas de diálogo, calcula marcadores de estilo.
 */
export function extractDialogueFingerprints(recentChapters: string, _storyBible: string): string {
  if (!recentChapters) return "";

  const dialogueRegex = /(?:(.{1,6})(?:说道|道|喝道|冷声道|笑道|怒道|低声道|大声道|喝骂道|冷笑道|沉声道|喊道|叫道|问道|答道|嗤笑|冷哼|沉吟|悠然道|呢喃|低语|反问|呵斥)\s*[：:]\s*["「]([^"」]+)["」])|["「]([^"」]{2,})["」]/g;

  const characterDialogues = new Map<string, string[]>();
  let match: RegExpExecArray | null;
  let lastSpeaker: string | undefined;

  while ((match = dialogueRegex.exec(recentChapters)) !== null) {
    const speaker = match[1]?.trim() ?? lastSpeaker;
    const line = match[2] ?? match[3] ?? "";
    
    if (speaker && line.length > 1) {
      const existing = characterDialogues.get(speaker) ?? [];
      characterDialogues.set(speaker, [...existing, line]);
      if (match[1]) lastSpeaker = speaker; // Solo actualizar lastSpeaker si hubo tag explícito
    }
  }

  // Solo incluir personajes con ≥2 líneas
  const fingerprints: string[] = [];
  for (const [character, lines] of characterDialogues) {
    if (lines.length < 2) continue;

    const avgLen = Math.round(lines.reduce((sum, l) => sum + l.length, 0) / lines.length);
    const isShort = avgLen < 15;

    // Detectar palabras/frases frecuentes (≥2 apariciones)
    const wordCounts = new Map<string, number>();
    for (const line of lines) {
      for (let i = 0; i < line.length - 1; i++) {
        const bigram = line.slice(i, i + 2);
        wordCounts.set(bigram, (wordCounts.get(bigram) ?? 0) + 1);
      }
    }
    const frequentWords = [...wordCounts.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([w]) => `「${w}」`);

    // Marcadores de estilo
    const markers: string[] = [];
    if (isShort) markers.push("短句为主");
    else markers.push("长句为主");

    const questionCount = lines.filter((l) => l.includes("？") || l.includes("?")).length;
    if (questionCount > lines.length * 0.3) markers.push("反问多");

    if (frequentWords.length > 0) markers.push(`常用${frequentWords.join("")}`);

    fingerprints.push(`${character}：${markers.join("，")}`);
  }

  return fingerprints.length > 0 ? fingerprints.join("；") : "";
}

/**
 * Busca resúmenes de capítulos relevantes basándose en nombres y hooks
 * mencionados en el outline del volumen actual.
 */
export function findRelevantSummaries(
  chapterSummaries: string,
  volumeOutline: string,
  chapterNumber: number,
): string {
  if (!chapterSummaries || chapterSummaries === FALLBACK) return "";
  if (!volumeOutline || volumeOutline === FALLBACK) return "";

  // Extraer nombres de personajes del outline (patrones de nombres chinos)
  const nameRegex = /[\u4e00-\u9fff]{2,4}(?=[，、。：]|$)/g;
  const outlineNames = new Set<string>();
  let nameMatch: RegExpExecArray | null;
  while ((nameMatch = nameRegex.exec(volumeOutline)) !== null) {
    outlineNames.add(nameMatch[0]);
  }

  // Extraer hook IDs del outline
  const hookRegex = /H\d{2,}/g;
  const hookIds = new Set<string>();
  let hookMatch: RegExpExecArray | null;
  while ((hookMatch = hookRegex.exec(volumeOutline)) !== null) {
    hookIds.add(hookMatch[0]);
  }

  if (outlineNames.size === 0 && hookIds.size === 0) return "";

  // Buscar filas coincidentes en los resúmenes
  const rows = chapterSummaries.split("\n").filter((line) =>
    line.startsWith("|") && !line.startsWith("| 章节") && !line.startsWith("|--") && !line.startsWith("| -"),
  );

  const matchedRows = rows.filter((row) => {
    for (const name of outlineNames) {
      if (row.includes(name)) return true;
    }
    for (const hookId of hookIds) {
      if (row.includes(hookId)) return true;
    }
    return false;
  });

  // Excluir el último capítulo (su texto completo ya está en contexto)
  const filteredRows = matchedRows.filter((row) => {
    const chNumMatch = row.match(/\|\s*(\d+)\s*\|/);
    if (!chNumMatch) return true;
    const num = parseInt(chNumMatch[1]!, 10);
    return num < chapterNumber - 1;
  });

  return filteredRows.length > 0 ? filteredRows.join("\n") : "";
}

// ---------------------------------------------------------------------------
// Presupuesto de contexto
// ---------------------------------------------------------------------------

function buildAndApplyBudget(
  raw: WriterRawFiles,
  derived: WriterDerivedContext,
  externalContext: string | undefined,
  budgetLimit: number | undefined,
  logger?: Logger,
): BudgetResult {
  const compressedSummaries = buildSlidingWindowSummaries(raw.chapterSummaries);

  const budgetBlocks: BudgetBlock[] = [
    // P0: nunca se descartan
    { name: "volume_outline", priority: 0, required: true, levels: [raw.volumeOutline] },
    { name: "pending_hooks", priority: 0, required: true, levels: [raw.hooks] },
    { name: "current_state", priority: 0, required: true, levels: [raw.currentState] },
    // P1: se pueden reducir pero son de alto valor
    { name: "story_bible", priority: 1, levels: [raw.storyBible] },
    { name: "recent_chapters", priority: 1, levels: buildRecentChaptersLevels(raw.recentChapters) },
    { name: "chapter_summaries", priority: 1, levels: [compressedSummaries] },
    // P2: se degradan de forma prioritaria
    { name: "subplot_board", priority: 2, levels: [raw.subplotBoard] },
    { name: "emotional_arcs", priority: 2, levels: [raw.emotionalArcs] },
    { name: "character_matrix", priority: 2, levels: [raw.characterMatrix] },
    { name: "relevant_summaries", priority: 2, levels: [derived.relevantSummaries] },
    // P3: se descartan primero
    { name: "dialogue_fingerprints", priority: 3, levels: [derived.dialogueFingerprints] },
    { name: "style_fingerprint", priority: 3, levels: [derived.styleFingerprint ?? ""] },
    { name: "parent_canon", priority: 2, levels: [derived.hasParentCanon ? raw.parentCanon : ""] },
    { name: "fanfic_canon", priority: 3, levels: [derived.hasFanficCanon ? raw.fanficCanon : ""] },
  ].filter((b) => b.levels.some((l) => l.length > 0));

  // Ledger solo si el género tiene sistema numérico
  const ledgerText = derived.genreProfile.numericalSystem ? raw.ledger : "";
  if (ledgerText) {
    budgetBlocks.push({ name: "ledger", priority: 1, levels: [ledgerText] });
  }
  if (externalContext) {
    budgetBlocks.push({ name: "external_context", priority: 0, required: true, levels: [externalContext] });
  }

  const limit = budgetLimit ?? DEFAULT_CONTEXT_BUDGET;
  const budgetResult = applyBudget(budgetBlocks, limit);

  // Logging de decisiones
  const degradedBlocks = budgetResult.decisions.filter((d) => d.selectedLevel > 0 || d.dropped);
  if (degradedBlocks.length > 0) {
    logger?.warn(
      `Context budget: ${budgetResult.totalTokens} tokens (limit ${limit}), ` +
      `${degradedBlocks.length} blocks degraded/dropped`,
    );
    for (const d of degradedBlocks) {
      logger?.info(
        `  [budget] ${d.name}: level=${d.selectedLevel} tokens=${d.estimatedTokens} dropped=${d.dropped}`,
      );
    }
  } else {
    logger?.info(
      `Context budget: ${budgetResult.totalTokens} tokens (limit ${limit}), all blocks at full level`,
    );
  }

  return budgetResult;
}

// ---------------------------------------------------------------------------
// Layered Context Bridge — conecta la lectura existente con el nuevo router
// ---------------------------------------------------------------------------

/**
 * Construye un contexto enrutado por capas (cinco capas) para la generación creativa.
 *
 * Esta función actúa como puente entre la infraestructura de lectura existente
 * (WriterRawFiles + WriterDerivedContext) y el nuevo sistema de capas (RoutedContext).
 *
 * Uso: reemplaza buildAndApplyBudget para consumidores que migran al nuevo pipeline.
 * Los consumidores legacy pueden seguir usando buildWriterContext + buildAndApplyBudget.
 */
export interface LayeredContextBundle {
  readonly routedContext: RoutedContext;
  readonly genreProfile: GenreProfile;
  readonly genreBody: string;
  readonly bookRules: BookRules | null;
  readonly bookRulesBody: string;
  readonly styleGuide: string;
}

export async function buildLayeredContext(
  projectRoot: string,
  bookDir: string,
  book: BookConfig,
  chapterNumber: number,
  taskCard: ChapterTaskCard,
  chapterType: string,
  opts?: {
    readonly recentChapterContent?: string;
    readonly auditDriftCorrection?: string;
    readonly recentViolations?: readonly string[];
    readonly styleModuleIds?: readonly string[];
    readonly styleModulesContent?: string;
    /** [R5] Si se proporciona, el presupuesto de contexto se calcula como maxModelTokens * 0.6 */
    readonly maxModelTokens?: number;
    readonly logger?: Logger;
  },
): Promise<LayeredContextBundle> {
  const storyDir = join(bookDir, "story");

  // Leer archivos clasificados por tripartita
  const [truth, state, view] = await Promise.all([
    readTruthFiles(storyDir),
    readStateFiles(storyDir),
    readViewFiles(storyDir),
  ]);

  // Leer materiales derivados necesarios para el router
  const parsedRules = await readBookRules(bookDir);
  const bookRules = parsedRules?.rules ?? null;
  const bookRulesBody = parsedRules?.body ?? "";
  const styleFingerprint = buildStyleFingerprint(view.styleProfile);

  // Obtener contenido del capítulo reciente si no se proporcionó
  let recentContent = opts?.recentChapterContent ?? "";
  if (!recentContent && chapterNumber > 1) {
    try {
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const paddedPrev = String(chapterNumber - 1).padStart(4, "0");
      const prevFile = files.find((f) => f.startsWith(paddedPrev) && f.endsWith(".md"));
      if (prevFile) {
        const raw = await readFile(join(chaptersDir, prevFile), "utf-8");
        recentContent = buildRecentChapterTail(raw);
      }
    } catch {
      // No crítico — si no se puede leer, L3 lo maneja graciosamente
    }
  }

  // Leer perfil de género
  const { profile: genreProfile, body: genreBody } = await readGenreProfile(projectRoot, book.genre);

  const routedContext = routeForCreativeWrite(
    taskCard,
    truth,
    state,
    view,
    bookRules,
    genreProfile,
    chapterNumber,
    chapterType,
    book.chapterWordCount,
    book.targetChapters,
    {
      recentChapterContent: recentContent,
      auditDriftCorrection: opts?.auditDriftCorrection,
      recentViolations: opts?.recentViolations,
      styleModuleIds: opts?.styleModuleIds,
      styleModulesContent: opts?.styleModulesContent,
      styleFingerprint,
      dialogueFingerprints: extractDialogueFingerprints(recentContent, truth.storyBible),
    },
  );

  return { 
    routedContext, 
    genreProfile, 
    genreBody, 
    bookRules, 
    bookRulesBody, 
    styleGuide: truth.styleGuide 
  };
}

