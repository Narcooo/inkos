/**
 * Inferencia dinámica de temperature y word count para el Writer, basada
 * en el tipo de capítulo deducido del volume_outline.
 *
 * - Capítulos de alta acción (高潮/战斗) → temp alta + más palabras
 * - Diálogos/transiciones → temp baja + menos palabras
 */

/** Tipo de capítulo detectable con temperature y multiplicador de word count. */
interface ChapterTypeMapping {
  readonly type: string;
  /** Palabras clave que indican este tipo de capítulo (en el outline). */
  readonly keywords: ReadonlyArray<string>;
  /** Temperature recomendada para este tipo. */
  readonly temperature: number;
  /** Multiplicador de word count relativo al base (1.0 = sin cambio). */
  readonly wordCountMultiplier: number;
}

const CHAPTER_TYPE_MAPPINGS: ReadonlyArray<ChapterTypeMapping> = [
  // 高潮/战斗 — más creatividad + más espacio para escenas épicas
  {
    type: "climax",
    keywords: ["高潮", "决战", "大战", "生死", "爆发", "总攻", "最终", "终极", "climax", "showdown", "battle"],
    temperature: 0.85,
    wordCountMultiplier: 1.2,
  },
  // 冲突/对抗 — creatividad moderada-alta, espacio normal-alto
  {
    type: "conflict",
    keywords: ["冲突", "对抗", "对决", "争斗", "反击", "激战", "危机", "conflict", "confrontation", "fight"],
    temperature: 0.75,
    wordCountMultiplier: 1.1,
  },
  // 过渡/铺垫 — precisión para mantener coherencia, más conciso
  {
    type: "transition",
    keywords: ["过渡", "铺垫", "准备", "日常", "休整", "修炼", "setup", "transition", "preparation"],
    temperature: 0.65,
    wordCountMultiplier: 0.85,
  },
  // 对话密集/谋略 — baja temp, diálogos concisos
  {
    type: "dialogue",
    keywords: ["对话", "谈判", "谋略", "密谈", "交涉", "会议", "审讯", "密谋", "dialogue", "negotiation", "strategy"],
    temperature: 0.6,
    wordCountMultiplier: 0.85,
  },
  // 收束/结局 — precisión moderada, longitud normal
  {
    type: "resolution",
    keywords: ["收束", "收尾", "结局", "落幕", "尾声", "resolution", "epilogue", "aftermath"],
    temperature: 0.65,
    wordCountMultiplier: 0.9,
  },
];

/** Temperature por defecto cuando no se detecta tipo de capítulo. */
const DEFAULT_TEMPERATURE = 0.7;

/**
 * Extrae la sección relevante del volume_outline para un capítulo dado.
 * Busca menciones de "第N章" o "chapter N" en el outline.
 */
function extractChapterSection(volumeOutline: string, chapterNumber: number): string {
  if (!volumeOutline) return "";

  const lines = volumeOutline.split("\n");
  const chapterPatterns = [
    new RegExp(`第${chapterNumber}章`),
    new RegExp(`第${chapterNumber}[\\s\\-]`),
    new RegExp(`[Cc]hapter\\s*${chapterNumber}\\b`),
    new RegExp(`^\\s*${chapterNumber}[.、]`),
  ];

  // Buscar línea del capítulo y capturar hasta la siguiente referencia de capítulo
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (chapterPatterns.some((p) => p.test(lines[i]!))) {
      startIdx = i;
      break;
    }
  }

  if (startIdx < 0) return "";

  // Capturar hasta la siguiente referencia de capítulo o fin
  let endIdx = lines.length;
  const nextPatterns = [
    new RegExp(`第${chapterNumber + 1}章`),
    new RegExp(`第${chapterNumber + 1}[\\s\\-]`),
    new RegExp(`[Cc]hapter\\s*${chapterNumber + 1}\\b`),
    new RegExp(`^\\s*${chapterNumber + 1}[.、]`),
  ];

  for (let i = startIdx + 1; i < lines.length; i++) {
    if (nextPatterns.some((p) => p.test(lines[i]!))) {
      endIdx = i;
      break;
    }
  }

  return lines.slice(startIdx, endIdx).join("\n");
}

/** Resultado de la inferencia de tipo de capítulo. */
export interface ChapterTypeInference {
  readonly temperature: number;
  readonly detectedType: string;
  readonly wordCountMultiplier: number;
}

/**
 * Detecta el tipo de capítulo a partir del volume_outline.
 * Retorna temperature, tipo detectado y multiplicador de word count.
 */
export function inferChapterType(
  volumeOutline: string,
  chapterNumber: number,
): ChapterTypeInference {
  const section = extractChapterSection(volumeOutline, chapterNumber);

  if (!section) {
    return { temperature: DEFAULT_TEMPERATURE, detectedType: "default", wordCountMultiplier: 1.0 };
  }

  // Contar coincidencias de keywords por tipo — el que más hits tenga gana
  let bestType = "default";
  let bestScore = 0;
  let bestTemp = DEFAULT_TEMPERATURE;
  let bestMultiplier = 1.0;

  for (const mapping of CHAPTER_TYPE_MAPPINGS) {
    let score = 0;
    for (const kw of mapping.keywords) {
      if (section.includes(kw)) {
        score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestType = mapping.type;
      bestTemp = mapping.temperature;
      bestMultiplier = mapping.wordCountMultiplier;
    }
  }

  return { temperature: bestTemp, detectedType: bestType, wordCountMultiplier: bestMultiplier };
}

/**
 * Compat wrapper: infiere solo temperature (para código existente).
 */
export function inferChapterTemperature(
  volumeOutline: string,
  chapterNumber: number,
): { readonly temperature: number; readonly detectedType: string } {
  const { temperature, detectedType } = inferChapterType(volumeOutline, chapterNumber);
  return { temperature, detectedType };
}

/**
 * Calcula el word count ajustado para un capítulo dado.
 *
 * @param baseWordCount - Word count base del libro (ej: 3000)
 * @param volumeOutline - Contenido del volume_outline
 * @param chapterNumber - Número de capítulo
 * @returns Word count ajustado redondeado a centenas.
 */
export function inferChapterWordCount(
  baseWordCount: number,
  volumeOutline: string,
  chapterNumber: number,
): { readonly wordCount: number; readonly detectedType: string; readonly multiplier: number } {
  const { detectedType, wordCountMultiplier } = inferChapterType(volumeOutline, chapterNumber);
  // Redondear a centenas para no generar números extraños (ej: 2550 → 2600)
  const adjusted = Math.round((baseWordCount * wordCountMultiplier) / 100) * 100;
  return { wordCount: adjusted, detectedType, multiplier: wordCountMultiplier };
}
