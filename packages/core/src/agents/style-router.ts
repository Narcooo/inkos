/**
 * Style Router — selecciona módulos de estilo y temperature según el tipo de capítulo.
 *
 * Integra la inferencia de tipo de capítulo existente (chapter-temperature.ts)
 * con el nuevo sistema de módulos de estilo (style-modules.ts).
 */

import { inferChapterType } from "../utils/chapter-temperature.js";
import {
  selectModulesForChapterType,
  combineModuleContent,
  combineRevisionChecks,
  getStyleModule,
} from "./style-modules.js";

// ===========================
// Router Output
// ===========================

export interface StyleRouteResult {
  /** IDs de los módulos de estilo activos */
  readonly activeModuleIds: readonly string[];
  /** Contenido combinado de los módulos (para inyectar en prompt) */
  readonly modulesContent: string;
  /** Verificaciones de revisión combinadas (para inyectar en prompt de auditoría) */
  readonly revisionChecks: string;
  /** Temperatura recomendada para la generación */
  readonly temperature: number;
  /** Multiplicador de conteo de palabras */
  readonly wordCountMultiplier: number;
  /** Tipo de capítulo detectado */
  readonly detectedChapterType: string;
}

// ===========================
// Chapter Type Mapping
// ===========================

/**
 * Mapea los tipos de capítulo detectados por chapter-temperature.ts
 * a los tipos usados por los módulos de estilo.
 */
const CHAPTER_TYPE_TO_STYLE: Record<string, string> = {
  // Chino
  "过渡": "过渡",
  "铺垫": "过渡",
  "冲突": "冲突",
  "对抗": "冲突",
  "对抗/冲突": "冲突",
  "高潮": "高潮",
  "爽点": "高潮",
  "高潮/爽点": "高潮",
  "收束": "收束",
  "卷末": "收束",
  // Inglés
  "transition": "transition",
  "setup": "setup",
  "conflict": "conflict",
  "confrontation": "conflict",
  "climax": "climax",
  "payoff": "climax",
  "closure": "closure",
  "arc-end": "closure",
};

/**
 * Detecta si un capítulo es pesado en diálogo basándose en
 * pistas del outline o tipo de capítulo.
 */
const DIALOGUE_HEAVY_HINTS = [
  "对话", "交谈", "沟通", "协商", "审讯", "质问", "争吵",
  "dialogue", "conversation", "negotiation", "argument", "interrogation",
];

// ===========================
// Router
// ===========================

/**
 * Enruta los módulos de estilo para un capítulo.
 *
 * @param volumeOutline - Outline del volumen (para inferir tipo de capítulo)
 * @param chapterNumber - Número de capítulo
 * @param language - Idioma del proyecto
 * @param chapterTypeOverride - Override del tipo de capítulo (si ya se conoce)
 */
export function routeStyle(
  volumeOutline: string,
  chapterNumber: number,
  language: "zh" | "en" = "zh",
  chapterTypeOverride?: string,
): StyleRouteResult {
  // Inferir tipo de capítulo y temperatura
  const inference = inferChapterType(volumeOutline, chapterNumber);
  const rawType = chapterTypeOverride ?? inference.detectedType;

  // Mapear al tipo de estilo
  const styleType = CHAPTER_TYPE_TO_STYLE[rawType] ?? rawType;

  // Detectar si es pesado en diálogo
  const outlineSlice = extractOutlineContext(volumeOutline, chapterNumber);
  const isDialogueHeavy = DIALOGUE_HEAVY_HINTS.some((hint) =>
    outlineSlice.toLowerCase().includes(hint.toLowerCase()),
  );

  // Seleccionar módulos
  const moduleIds = selectModulesForChapterType(styleType, language, isDialogueHeavy);

  return {
    activeModuleIds: moduleIds,
    modulesContent: combineModuleContent(moduleIds),
    revisionChecks: combineRevisionChecks(moduleIds),
    temperature: inference.temperature,
    wordCountMultiplier: inference.wordCountMultiplier,
    detectedChapterType: rawType,
  };
}

/**
 * Extrae el contexto del outline cercano al capítulo actual
 * para detectar pistas de estilo.
 */
function extractOutlineContext(volumeOutline: string, chapterNumber: number): string {
  if (!volumeOutline) return "";

  const lines = volumeOutline.split("\n");
  const patterns = [
    new RegExp(`第${chapterNumber}章`, "i"),
    new RegExp(`[Cc]hapter\\s*${chapterNumber}\\b`),
  ];

  for (const pattern of patterns) {
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i]!)) {
        const start = Math.max(0, i - 1);
        const end = Math.min(lines.length, i + 5);
        return lines.slice(start, end).join("\n");
      }
    }
  }

  return "";
}
