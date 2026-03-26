/**
 * Context Router — enruta el contexto por tipo de proceso (paso de la pipeline).
 *
 * Cada paso de la pipeline de escritura recibe SOLO la información que necesita.
 * El router aplica la "lista de prohibición": ciertos datos completos NUNCA
 * entran en el prompt de generación creativa.
 */

import type {
  RoutedContext,
  TruthFiles,
  StateFiles,
  ViewFiles,
  ChapterTaskCard,
  RiskLayer,
  ContinuityLayer,
  StyleLayer,
  TruthSliceLayer,
} from "./context-layers.js";

import {
  buildTaskLayer,
  buildRiskLayer,
  buildContinuityLayer,
  buildTruthSliceLayer,
} from "./context-layers.js";

import type { BookRules } from "../models/book-rules.js";
import type { GenreProfile } from "../models/genre-profile.js";

// ===========================
// Tipos de proceso
// ===========================

/**
 * Tipo de proceso dentro de la pipeline de seis pasos.
 *
 * - creative-write: S2. Recibe las cinco capas recortadas. Prohibido totalidad.
 * - light-correction: S4A. Solo recibe el draft + violaciones + L2 riesgos.
 * - settlement: S5. Recibe el contenido aprobado + State + View completas.
 */
export type ProcessType = "creative-write" | "light-correction" | "settlement";

// ===========================
// Router Options
// ===========================

export interface RouterOptions {
  /** Contenido de los capítulos recientes (para L3 previousChapterTail) */
  readonly recentChapterContent?: string;
  /** Corrección de deriva de auditorías previas */
  readonly auditDriftCorrection?: string;
  /** Violaciones recientes de post-write */
  readonly recentViolations?: readonly string[];
  /** Módulos de estilo activos (IDs y contenido ya seleccionados por style-router) */
  readonly styleModuleIds?: readonly string[];
  readonly styleModulesContent?: string;
  /** Fingerprint de estilo (de style_profile.json) */
  readonly styleFingerprint?: string;
  /** Fingerprints de diálogo */
  readonly dialogueFingerprints?: string;
}

// ===========================
// Creative Write Context
// ===========================

/**
 * Enruta el contexto para la generación creativa (S2).
 *
 * Aplica la lista de prohibición: ningún archivo Truth/State/View completo
 * entra en el prompt. Solo capas recortadas y fragmentos relevantes.
 */
export function routeForCreativeWrite(
  taskCard: ChapterTaskCard,
  truth: TruthFiles,
  state: StateFiles,
  view: ViewFiles,
  bookRules: BookRules | null,
  genreProfile: GenreProfile,
  chapterNumber: number,
  chapterType: string,
  wordTarget: number,
  targetChapters?: number,
  opts: RouterOptions = {},
): RoutedContext {
  // L1 — Capa de tarea (inyección completa de la tarjeta)
  const task = buildTaskLayer(taskCard, chapterNumber, wordTarget, chapterType);

  // L2 — Capa de riesgos (inyección completa)
  const risk = buildRiskLayer(
    bookRules,
    genreProfile,
    opts.auditDriftCorrection,
    opts.recentViolations,
  );

  // L3 — Capa de continuidad (SOLO extractos mínimos)
  const continuity = buildContinuityLayer(
    state.currentState,
    state.pendingHooks,
    opts.recentChapterContent ?? "",
    view.chapterSummaries,
    chapterNumber,
    taskCard,
  );

  // L4 — Capa de estilo (solo módulos activos)
  const style: StyleLayer = {
    activeModuleIds: opts.styleModuleIds ?? [],
    modulesContent: opts.styleModulesContent ?? "",
    styleFingerprint: opts.styleFingerprint,
    dialogueFingerprints: opts.dialogueFingerprints ?? "",
  };

  // L5 — Fragmentos de verdad (SOLO fragmentos relevantes, NUNCA archivos completos)
  const truthSlice = buildTruthSliceLayer(
    taskCard,
    truth.storyBible,
    view.characterMatrix,
    view.subplotBoard,
    truth.volumeOutline,
    chapterNumber,
    targetChapters,
  );

  return { task, risk, continuity, style, truthSlice };
}

// ===========================
// Light Correction Context
// ===========================

/**
 * Contexto para corrección ligera (S4A).
 * Solo recibe el contenido a corregir, las reglas de corrección,
 * y la capa de riesgos. NO recibe archivos de verdad ni estado.
 */
export interface CorrectionContext {
  /** Borrador a corregir */
  readonly content: string;
  /** 3-5 reglas de corrección específicas */
  readonly correctionRules: readonly string[];
  /** Capa de riesgos (para prevenir rebotes) */
  readonly riskLayer: RiskLayer;
}

export function routeForCorrection(
  content: string,
  correctionRules: readonly string[],
  bookRules: BookRules | null,
  genreProfile: GenreProfile,
  auditDriftCorrection?: string,
): CorrectionContext {
  const riskLayer = buildRiskLayer(bookRules, genreProfile, auditDriftCorrection);
  return { content, correctionRules, riskLayer };
}

// ===========================
// Settlement Context
// ===========================

/**
 * Contexto para actualización de estado (S5).
 * Este es el ÚNICO proceso que puede acceder a los archivos State y View completos.
 * NUNCA accede a los archivos Truth directamente (solo a través del guard posterior).
 */
export interface SettlementContext {
  /** Contenido del capítulo aprobado */
  readonly approvedContent: string;
  /** Tarjeta de tarea del capítulo */
  readonly taskCard: ChapterTaskCard;
  /** Archivos State completos (lectura para diff, escritura permitida) */
  readonly stateFiles: StateFiles;
  /** Archivos View completos (lectura para diff, escritura permitida) */
  readonly viewFiles: ViewFiles;
  /** Perfil de género */
  readonly genreProfile: GenreProfile;
  /** Si tiene sistema numérico (para actualización del ledger) */
  readonly hasNumericalSystem: boolean;
}

export function routeForSettlement(
  approvedContent: string,
  taskCard: ChapterTaskCard,
  state: StateFiles,
  view: ViewFiles,
  genreProfile: GenreProfile,
): SettlementContext {
  return {
    approvedContent,
    taskCard,
    stateFiles: state,
    viewFiles: view,
    genreProfile,
    hasNumericalSystem: !!genreProfile.numericalSystem,
  };
}

// ===========================
// Prohibition Validation
// ===========================

/**
 * Lista de claves que NUNCA deben estar presentes en el contexto de generación creativa.
 * Estas claves representan archivos/datos completos que están prohibidos en el prompt S2.
 */
const CREATIVE_WRITE_PROHIBITED_KEYS = new Set([
  "fullCurrentState",
  "fullPendingHooks",
  "fullParticleLedger",
  "fullEmotionalArcs",
  "fullChapterSummaries",
  "fullSubplotBoard",
  "fullCharacterMatrix",
  "fullStoryBible",
  "fullStyleGuide",
  "fullStyleProfile",
]);

/**
 * Valida que un contexto enrutado para escritura creativa
 * NO contenga ningún dato completo prohibido.
 *
 * Usado en tests para garantizar que la lista de prohibición se respeta.
 */
export function validateCreativeWriteContext(context: RoutedContext): {
  valid: boolean;
  violations: string[];
} {
  const violations: string[] = [];

  // Verificar que los campos de cada capa son extractos, no archivos completos
  // (heurística: archivos completos típicamente superan los 2000 caracteres)
  const MAX_SLICE_SIZE = 3000;

  const checksMap: Record<string, string> = {
    "continuity.currentAnchor": context.continuity.currentAnchor,
    "continuity.relevantHooks": context.continuity.relevantHooks,
    "continuity.recentSummaryLines": context.continuity.recentSummaryLines,
    "continuity.previousChapterTail": context.continuity.previousChapterTail,
    "truthSlice.relevantCharacterSettings": context.truthSlice.relevantCharacterSettings,
    "truthSlice.relevantWorldRules": context.truthSlice.relevantWorldRules,
    "truthSlice.relevantOutlineSlice": context.truthSlice.relevantOutlineSlice,
    "truthSlice.relevantLongTermHooks": context.truthSlice.relevantLongTermHooks,
  };

  for (const [key, value] of Object.entries(checksMap)) {
    if (value.length > MAX_SLICE_SIZE) {
      violations.push(`${key} exceeds max slice size (${value.length} > ${MAX_SLICE_SIZE})`);
    }
  }

  return { valid: violations.length === 0, violations };
}
