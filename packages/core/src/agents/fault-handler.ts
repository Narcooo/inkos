/**
 * Fault Handler — detección de señales de fallo y respuesta.
 *
 * Tres tipos de fallos del sistema:
 * 1. Abstracción recurrente (抽象化回潮)
 * 2. Activación errónea de concepto alto (高概念误激活)
 * 3. Contaminación de archivos de estado (状态文件污染)
 *
 * Cada tipo tiene señales detectables y una respuesta recomendada.
 */

import type { PostWriteViolation } from "./post-write-validator.js";
import type { AuditIssue } from "./continuity.js";

// ===========================
// Fault Types
// ===========================

export type FaultType =
  | "abstraction-resurgence"
  | "high-concept-misfire"
  | "state-contamination";

export interface FaultSignal {
  readonly type: FaultType;
  readonly severity: "warning" | "critical";
  readonly evidence: readonly string[];
  readonly suggestedResponse: FaultResponse;
}

export type FaultResponse =
  | { readonly action: "4A"; readonly rules: readonly string[] }
  | { readonly action: "4B" }
  | { readonly action: "reduce-context" }
  | { readonly action: "state-rollback" };

// ===========================
// Signal Detection
// ===========================

/** Marcadores de abstracción en texto chino */
const ZH_ABSTRACTION_MARKERS = [
  "本质上", "从根本上", "深层次", "内在的", "意味着", "象征着",
  "折射出", "映射了", "体现了", "揭示了", "暗示着一种",
];

/** Marcadores de abstracción en texto inglés */
const EN_ABSTRACTION_MARKERS = [
  "fundamentally", "inherently", "essentially", "symbolized",
  "represented", "reflected", "revealed", "underlying",
  "on a deeper level", "at its core",
];

/** Marcadores de concepto alto en chino */
const ZH_HIGH_CONCEPT_MARKERS = [
  "维度", "法则", "规则开始", "世界的意志", "因果律",
  "轮回", "命运", "天道", "大道", "至高",
];

/** Marcadores de concepto alto en inglés */
const EN_HIGH_CONCEPT_MARKERS = [
  "dimension", "cosmic law", "world's will", "law of causality",
  "reincarnation", "fate", "destiny", "supreme",
];

/**
 * Analiza un capítulo generado y el resultado de su auditoría
 * para detectar señales de fallo del sistema.
 */
export function detectFaults(
  content: string,
  violations: readonly PostWriteViolation[],
  auditIssues: readonly AuditIssue[],
  language: "zh" | "en" = "zh",
): readonly FaultSignal[] {
  const faults: FaultSignal[] = [];

  // 1. Abstracción recurrente
  const abstractionSignal = detectAbstractionResurgence(content, violations, language);
  if (abstractionSignal) faults.push(abstractionSignal);

  // 2. Concepto alto
  const highConceptSignal = detectHighConceptMisfire(content, language);
  if (highConceptSignal) faults.push(highConceptSignal);

  // 3. Contaminación de estado (se detecta en archivos de estado, no en contenido)
  // Se llama por separado con detectStateContamination

  return faults;
}

/**
 * Detecta abstracción recurrente: explicaciones en lugar de escenas,
 * grandes palabras, pérdida de fisicalidad.
 */
function detectAbstractionResurgence(
  content: string,
  violations: readonly PostWriteViolation[],
  language: "zh" | "en",
): FaultSignal | null {
  const markers = language === "en" ? EN_ABSTRACTION_MARKERS : ZH_ABSTRACTION_MARKERS;
  const evidence: string[] = [];

  // Contar marcadores de abstracción
  let count = 0;
  for (const marker of markers) {
    const regex = new RegExp(marker, language === "en" ? "gi" : "g");
    const matches = content.match(regex);
    if (matches) {
      count += matches.length;
      evidence.push(`"${marker}" × ${matches.length}`);
    }
  }

  // Considerar violaciones de report_terms como señal adicional
  const reportViolations = violations.filter((v) =>
    v.rule === "报告术语" || v.rule === "report_terms",
  );
  if (reportViolations.length > 0) {
    evidence.push(`report terms violation: ${reportViolations.length}`);
    count += reportViolations.length * 2; // Peso extra
  }

  // Umbral: ≥3 marcadores = warning, ≥6 = critical
  if (count >= 6) {
    return {
      type: "abstraction-resurgence",
      severity: "critical",
      evidence,
      suggestedResponse: {
        action: "4A",
        rules: [
          language === "en"
            ? "Replace all abstract language with concrete, physical, observable detail"
            : "将所有抽象描述替换为具体的、物理的、可观察的细节",
          language === "en"
            ? "Remove any analytical or explanatory passages"
            : "删除所有分析性或解释性段落",
          language === "en"
            ? "Every sentence must be grounded in action, sensation, or dialogue"
            : "每个句子必须基于行动、感官体验或对话",
        ],
      },
    };
  }
  if (count >= 3) {
    return {
      type: "abstraction-resurgence",
      severity: "warning",
      evidence,
      suggestedResponse: {
        action: "4A",
        rules: [
          language === "en"
            ? "Reduce abstract language; prioritize showing over telling"
            : "减少抽象语言，优先表现而非阐释",
        ],
      },
    };
  }

  return null;
}

/**
 * Detecta activación errónea de concepto alto: expansión repentina
 * del worldbuilding, reglas nuevas de la nada, conceptos residuales.
 */
function detectHighConceptMisfire(
  content: string,
  language: "zh" | "en",
): FaultSignal | null {
  const markers = language === "en" ? EN_HIGH_CONCEPT_MARKERS : ZH_HIGH_CONCEPT_MARKERS;
  const evidence: string[] = [];
  let count = 0;

  for (const marker of markers) {
    const regex = new RegExp(marker, language === "en" ? "gi" : "g");
    const matches = content.match(regex);
    if (matches) {
      count += matches.length;
      evidence.push(`"${marker}" × ${matches.length}`);
    }
  }

  if (count >= 3) {
    return {
      type: "high-concept-misfire",
      severity: count >= 5 ? "critical" : "warning",
      evidence,
      suggestedResponse: count >= 5
        ? { action: "4B" }
        : {
            action: "4A",
            rules: [
              language === "en"
                ? "Remove all newly introduced worldbuilding concepts not in the outline"
                : "删除所有未出现在大纲中的新设定/新概念",
              language === "en"
                ? "Stay within the established world rules"
                : "保持在已有世界规则范围内",
            ],
          },
    };
  }

  return null;
}

/**
 * Detecta contaminación de archivos de estado:
 * el lenguaje del estado se vuelve abstracto o se parece a comentarios de modelo.
 */
export function detectStateContamination(
  stateContent: string,
  language: "zh" | "en" = "zh",
): FaultSignal | null {
  const evidence: string[] = [];

  // Marcadores de contaminación: el estado no debería contener lenguaje valorativo del modelo
  const zhContaminationMarkers = [
    "值得注意的是", "有趣的是", "这表明", "我们可以看到",
    "显然", "不难发现", "这象征着", "优秀的", "精彩的",
  ];
  const enContaminationMarkers = [
    "it's worth noting", "interestingly", "this suggests",
    "we can see", "obviously", "it's clear that",
    "symbolizes", "excellent", "brilliant",
  ];

  const markers = language === "en" ? enContaminationMarkers : zhContaminationMarkers;
  let count = 0;

  for (const marker of markers) {
    if (stateContent.toLowerCase().includes(marker.toLowerCase())) {
      count++;
      evidence.push(`"${marker}"`);
    }
  }

  if (count >= 3) {
    return {
      type: "state-contamination",
      severity: count >= 5 ? "critical" : "warning",
      evidence,
      suggestedResponse: { action: "state-rollback" },
    };
  }

  return null;
}

/**
 * Decide la ruta de corrección según las señales de fallo.
 *
 * Gap #12: Criterios cuantificados para decidir entre 4A y 4B:
 * - Cualquier fallo critical → 4B
 * - Solo warnings → 4A
 */
export function decideCorrectionPath(
  faults: readonly FaultSignal[],
): "4A" | "4B" | "pass" {
  if (faults.length === 0) return "pass";
  if (faults.some((f) => f.severity === "critical")) return "4B";
  return "4A";
}

/**
 * Extrae las reglas de corrección de las señales de fallo para 4A.
 */
export function extractCorrectionRules(
  faults: readonly FaultSignal[],
): readonly string[] {
  const rules: string[] = [];
  for (const fault of faults) {
    if (fault.suggestedResponse.action === "4A") {
      rules.push(...fault.suggestedResponse.rules);
    }
  }
  // Limitar a 5 reglas
  return rules.slice(0, 5);
}
