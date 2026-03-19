import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { readFileSafe } from "../utils/read-file-safe.js";
import { readGenreProfile } from "./rules-reader.js";
import { readBookRules } from "./rules-reader.js";
import { applyBudget, type BudgetBlock, type BudgetResult } from "../utils/context-budget.js";
import { buildSlidingWindowSummaries } from "../utils/summary-compressor.js";
import { buildRecentChapterFull, buildRecentChapterTail } from "../utils/recent-chapter-compressor.js";
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
    readonly logger?: Logger;
  },
): Promise<WriterContext> {
  // ── Paso 1: leer archivos en paralelo ──
  const raw = await readAllTruthFiles(bookDir, chapterNumber);

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

async function readAllTruthFiles(bookDir: string, chapterNumber: number): Promise<WriterRawFiles> {
  const storyDir = join(bookDir, "story");

  const [
    storyBible, volumeOutline, styleGuide, currentState, ledger, hooks,
    chapterSummaries, subplotBoard, emotionalArcs, characterMatrix, styleProfileRaw,
    parentCanon,
  ] = await Promise.all([
    readFileSafe(join(storyDir, "story_bible.md"), FALLBACK),
    readFileSafe(join(storyDir, "volume_outline.md"), FALLBACK),
    readFileSafe(join(storyDir, "style_guide.md"), FALLBACK),
    readFileSafe(join(storyDir, "current_state.md"), FALLBACK),
    readFileSafe(join(storyDir, "particle_ledger.md"), FALLBACK),
    readFileSafe(join(storyDir, "pending_hooks.md"), FALLBACK),
    readFileSafe(join(storyDir, "chapter_summaries.md"), FALLBACK),
    readFileSafe(join(storyDir, "subplot_board.md"), FALLBACK),
    readFileSafe(join(storyDir, "emotional_arcs.md"), FALLBACK),
    readFileSafe(join(storyDir, "character_matrix.md"), FALLBACK),
    readFileSafe(join(storyDir, "style_profile.json"), FALLBACK),
    readFileSafe(join(storyDir, "parent_canon.md"), FALLBACK),
  ]);

  const fanficCanon = await readFileSafe(join(storyDir, "fanfic_canon.md"), FALLBACK);
  const recentChapters = await loadRecentChapters(bookDir, chapterNumber);

  return {
    storyBible, volumeOutline, styleGuide, currentState, ledger, hooks,
    chapterSummaries, subplotBoard, emotionalArcs, characterMatrix, styleProfileRaw,
    parentCanon, fanficCanon, recentChapters,
  };
}

/** Lee el último capítulo escrito como contexto reciente. */
export async function loadRecentChapters(
  bookDir: string,
  _currentChapter: number,
): Promise<string> {
  const chaptersDir = join(bookDir, "chapters");
  try {
    const files = await readdir(chaptersDir);
    const mdFiles = files
      .filter((f) => f.endsWith(".md") && !f.startsWith("index"))
      .sort()
      .slice(-1);

    if (mdFiles.length === 0) return "";

    const contents = await Promise.all(
      mdFiles.map((f) => readFile(join(chaptersDir, f), "utf-8")),
    );

    return contents.join("\n\n---\n\n");
  } catch {
    return "";
  }
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

  const dialogueRegex = /(?:(.{1,6})(?:说道|道|喝道|冷声道|笑道|怒道|低声道|大声道|喝骂道|冷笑道|沉声道|喊道|叫道|问道|答道)\s*[：:]\s*["""「]([^"""」]+)["""」])|["""「]([^"""」]{2,})["""」]/g;

  const characterDialogues = new Map<string, string[]>();
  let match: RegExpExecArray | null;

  while ((match = dialogueRegex.exec(recentChapters)) !== null) {
    const speaker = match[1]?.trim();
    const line = match[2] ?? match[3] ?? "";
    if (speaker && line.length > 1) {
      const existing = characterDialogues.get(speaker) ?? [];
      characterDialogues.set(speaker, [...existing, line]);
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
    { name: "recent_chapters", priority: 1, levels: [
      buildRecentChapterFull(raw.recentChapters),
      buildRecentChapterTail(raw.recentChapters),
    ] },
    { name: "chapter_summaries", priority: 1, levels: [compressedSummaries] },
    // P2: se degradan de forma prioritaria
    { name: "subplot_board", priority: 2, levels: [raw.subplotBoard] },
    { name: "emotional_arcs", priority: 2, levels: [raw.emotionalArcs] },
    { name: "character_matrix", priority: 2, levels: [raw.characterMatrix] },
    { name: "relevant_summaries", priority: 2, levels: [derived.relevantSummaries] },
    // P3: se descartan primero
    { name: "dialogue_fingerprints", priority: 3, levels: [derived.dialogueFingerprints] },
    { name: "style_fingerprint", priority: 3, levels: [derived.styleFingerprint ?? ""] },
    { name: "parent_canon", priority: 3, levels: [derived.hasParentCanon ? raw.parentCanon : ""] },
    { name: "fanfic_canon", priority: 2, levels: [derived.hasFanficCanon ? raw.fanficCanon : ""] },
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
