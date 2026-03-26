/**
 * Lectura centralizada de archivos de verdad (truth files) del directorio story/.
 * Elimina la duplicación de lectura individual en runner, continuity, reviser y writer-context.
 *
 * Clasificación tripartita:
 * - Truth: largo plazo, baja frecuencia, alta confianza
 * - State: frecuencia media, avance por capítulo
 * - View: análisis temporal, vistas de recuperación
 */

import { readFileSafe } from "./read-file-safe.js";
import { join } from "node:path";

const DEFAULT_FALLBACK = "(文件不存在)";

// Re-exportar las interfaces tripartitas de context-layers
export type { TruthFiles, StateFiles, ViewFiles } from "../agents/context-layers.js";

// Importar los tipos para uso interno
import type { TruthFiles, StateFiles, ViewFiles } from "../agents/context-layers.js";

/** Todos los archivos de verdad de un libro, leídos en paralelo. */
export interface StoryFiles {
  readonly storyBible: string;
  readonly volumeOutline: string;
  readonly bookRules: string;
  readonly currentState: string;
  readonly particleLedger: string;
  readonly pendingHooks: string;
  readonly chapterSummaries: string;
  readonly subplotBoard: string;
  readonly emotionalArcs: string;
  readonly characterMatrix: string;
  readonly styleGuide: string;
  readonly styleProfile: string;
  readonly parentCanon: string;
  readonly fanficCanon: string;
}

// ===========================
// Three-way Reading Functions
// ===========================

/**
 * Lee solo los archivos Truth (largo plazo, estables).
 * story_bible, book_rules, volume_outline, style_guide, parent_canon, fanfic_canon.
 */
export async function readTruthFiles(
  storyDir: string,
  fallback = DEFAULT_FALLBACK,
): Promise<TruthFiles> {
  const [storyBible, bookRules, volumeOutline, styleGuide, parentCanon, fanficCanon] =
    await Promise.all([
      readFileSafe(join(storyDir, "story_bible.md"), fallback),
      readFileSafe(join(storyDir, "book_rules.md"), fallback),
      readFileSafe(join(storyDir, "volume_outline.md"), fallback),
      readFileSafe(join(storyDir, "style_guide.md"), fallback),
      readFileSafe(join(storyDir, "parent_canon.md"), fallback),
      readFileSafe(join(storyDir, "fanfic_canon.md"), fallback),
    ]);

  return { storyBible, bookRules, volumeOutline, styleGuide, parentCanon, fanficCanon };
}

/**
 * Lee solo los archivos State (frecuencia media, avance por capítulo).
 * current_state, pending_hooks, particle_ledger, emotional_arcs.
 */
export async function readStateFiles(
  storyDir: string,
  fallback = DEFAULT_FALLBACK,
): Promise<StateFiles> {
  const [currentState, pendingHooks, particleLedger, emotionalArcs] =
    await Promise.all([
      readFileSafe(join(storyDir, "current_state.md"), fallback),
      readFileSafe(join(storyDir, "pending_hooks.md"), fallback),
      readFileSafe(join(storyDir, "particle_ledger.md"), fallback),
      readFileSafe(join(storyDir, "emotional_arcs.md"), fallback),
    ]);

  return { currentState, pendingHooks, particleLedger, emotionalArcs };
}

/**
 * Lee solo los archivos View (análisis temporal, vistas).
 * chapter_summaries, subplot_board, character_matrix, style_profile.
 */
export async function readViewFiles(
  storyDir: string,
  fallback = DEFAULT_FALLBACK,
): Promise<ViewFiles> {
  const [chapterSummaries, subplotBoard, characterMatrix, styleProfile] =
    await Promise.all([
      readFileSafe(join(storyDir, "chapter_summaries.md"), fallback),
      readFileSafe(join(storyDir, "subplot_board.md"), fallback),
      readFileSafe(join(storyDir, "character_matrix.md"), fallback),
      readFileSafe(join(storyDir, "style_profile.json"), fallback),
    ]);

  return { chapterSummaries, subplotBoard, characterMatrix, styleProfile };
}

// ===========================
// Legacy Unified Reader
// ===========================

/**
 * Lee todos los archivos de verdad del directorio story/ en paralelo.
 * Cada consumidor puede destructurar solo los campos que necesita.
 *
 * Mantenido para compatibilidad — nuevos consumidores deben preferir
 * readTruthFiles / readStateFiles / readViewFiles según la clasificación tripartita.
 */
export async function readAllStoryFiles(
  storyDir: string,
  fallback = DEFAULT_FALLBACK,
): Promise<StoryFiles> {
  const [truth, state, view] = await Promise.all([
    readTruthFiles(storyDir, fallback),
    readStateFiles(storyDir, fallback),
    readViewFiles(storyDir, fallback),
  ]);

  return {
    storyBible: truth.storyBible,
    volumeOutline: truth.volumeOutline,
    bookRules: truth.bookRules,
    currentState: state.currentState,
    particleLedger: state.particleLedger,
    pendingHooks: state.pendingHooks,
    chapterSummaries: view.chapterSummaries,
    subplotBoard: view.subplotBoard,
    emotionalArcs: state.emotionalArcs,
    characterMatrix: view.characterMatrix,
    styleGuide: truth.styleGuide,
    styleProfile: view.styleProfile,
    parentCanon: truth.parentCanon,
    fanficCanon: truth.fanficCanon,
  };
}
