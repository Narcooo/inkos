/**
 * Detection pipeline runner — handles detection, auto-rewrite loop, and history tracking.
 * Extracted from runner.ts to keep runner under 800 lines.
 */

import type { DetectionConfig } from "../models/project.js";
import type { DetectionHistoryEntry } from "../models/detection.js";
import type { AgentContext } from "../agents/base.js";
import { detectAIContent, type DetectionResult } from "../agents/detector.js";
import { analyzeAITells, type AITellResult } from "../agents/ai-tells.js";
import { ReviserAgent } from "../agents/reviser.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface DetectChapterResult {
  readonly chapterNumber: number;
  readonly detection: DetectionResult;
  readonly passed: boolean;
}

export interface DetectAndRewriteResult {
  readonly chapterNumber: number;
  readonly originalScore: number;
  readonly finalScore: number;
  readonly attempts: number;
  readonly passed: boolean;
  readonly finalContent: string;
}

/** Run detection on a single chapter's content. */
export async function detectChapter(
  config: DetectionConfig,
  content: string,
  chapterNumber: number,
): Promise<DetectChapterResult> {
  const detection = await detectAIContent(config, content);
  return {
    chapterNumber,
    detection,
    passed: detection.score <= config.threshold,
  };
}

/**
 * Detect-and-rewrite loop: detect → revise (light) → regression check → re-detect,
 * until score passes threshold or max retries reached.
 *
 * Mejoras sobre la versión original:
 * 1. Instrucciones progresivas — cada intento aumenta la agresividad
 * 2. Diagnóstico Tier-1 — inyecta feedback de ai-tells para guiar la reescritura
 * 3. Regresión Tier-1 — descarta reescrituras que empeoran las métricas de ai-tells
 */
export async function detectAndRewrite(
  config: DetectionConfig,
  ctx: AgentContext,
  bookDir: string,
  content: string,
  chapterNumber: number,
  genre?: string,
): Promise<DetectAndRewriteResult> {
  const maxRetries = config.maxRetries;

  let currentContent = content;
  const firstDetection = await detectAIContent(config, currentContent);
  const originalScore = firstDetection.score;

  if (firstDetection.score <= config.threshold) {
    await recordHistory(bookDir, {
      chapterNumber,
      timestamp: firstDetection.detectedAt,
      provider: firstDetection.provider,
      score: firstDetection.score,
      action: "detect",
      attempt: 0,
    });
    return {
      chapterNumber,
      originalScore,
      finalScore: firstDetection.score,
      attempts: 0,
      passed: true,
      finalContent: currentContent,
    };
  }

  let finalScore = firstDetection.score;
  let attempts = 0;

  for (let i = 0; i < maxRetries; i++) {
    attempts = i + 1;

    // Diagnóstico Tier-1: obtener feedback de ai-tells sobre el contenido actual
    const preTells = analyzeAITells(currentContent);

    // Construir instrucciones progresivas + diagnóstico
    const instructions = buildAntiDetectInstructions(finalScore, config.threshold, attempts, preTells);

    // Reescritura ligera (sin truth files)
    const reviser = new ReviserAgent(ctx);
    const lightResult = await reviser.reviseChapterLight(currentContent, chapterNumber, instructions);

    if (lightResult.revisedContent.length === 0) break;

    // Regresión Tier-1: comprobar que la reescritura no empeoró los marcadores AI
    const postTells = analyzeAITells(lightResult.revisedContent);
    if (postTells.issues.length > preTells.issues.length) {
      // Reescritura introdujo nuevos problemas Tier-1 — descartar y reintentar
      await recordHistory(bookDir, {
        chapterNumber,
        timestamp: new Date().toISOString(),
        provider: "tier1-regression",
        score: finalScore,
        action: "rewrite",
        attempt: attempts,
      });
      continue;
    }

    currentContent = lightResult.revisedContent;

    // Re-detect con API externa
    const reDetection = await detectAIContent(config, currentContent);
    finalScore = reDetection.score;

    await recordHistory(bookDir, {
      chapterNumber,
      timestamp: reDetection.detectedAt,
      provider: reDetection.provider,
      score: reDetection.score,
      action: "rewrite",
      attempt: attempts,
    });

    if (finalScore <= config.threshold) break;
  }

  return {
    chapterNumber,
    originalScore,
    finalScore,
    attempts,
    passed: finalScore <= config.threshold,
    finalContent: currentContent,
  };
}

/** Append an entry to detection_history.json. */
async function recordHistory(
  bookDir: string,
  entry: DetectionHistoryEntry,
): Promise<void> {
  const historyPath = join(bookDir, "story", "detection_history.json");
  let history: DetectionHistoryEntry[] = [];

  try {
    const raw = await readFile(historyPath, "utf-8");
    history = JSON.parse(raw);
  } catch {
    // File doesn't exist yet
  }

  history.push(entry);

  await mkdir(join(bookDir, "story"), { recursive: true });
  await writeFile(historyPath, JSON.stringify(history, null, 2), "utf-8");
}

/** Load detection history from disk. */
export async function loadDetectionHistory(
  bookDir: string,
): Promise<ReadonlyArray<DetectionHistoryEntry>> {
  const historyPath = join(bookDir, "story", "detection_history.json");
  try {
    const raw = await readFile(historyPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Instrucciones progresivas para anti-detect
// ---------------------------------------------------------------------------

/** Nivel base de agresividad */
const BASE_TECHNIQUES = [
  "1. 打破句式规律：连续短句→长短交替，句式不可预测",
  "2. 口语化替代书面语",
  '3. 减少"了"字密度',
  "4. 情绪外化：用动作替代心理描写",
  "5. 段落长度差异化",
  '6. 消灭"不禁""仿佛""宛如"等AI标记词',
];

/** Nivel progresivo — se activa en retry ≥2 */
const ESCALATION_TECHNIQUES = [
  "7. 插入角色内心吐槽或独白，打破叙事节奏",
  "8. 用不完整句、省略句替代完整陈述句",
  "9. 增加感官细节（气味、触感、温度）替代抽象描述",
  "10. 对话中加入口头禅、语气词、断句",
];

/** Nivel máximo — se activa en retry ≥3 */
const DEEP_TECHNIQUES = [
  "11. 重写段落结构：将线性叙述改为倒叙/插叙片段",
  "12. 用比喻和具象化替代所有抽象概念",
  "13. 删除所有总结性/概括性句子，只保留场景和动作",
];

/**
 * Construye instrucciones de anti-detect con agresividad progresiva
 * y diagnóstico de ai-tells integrado.
 */
function buildAntiDetectInstructions(
  currentScore: number,
  threshold: number,
  attempt: number,
  aiTellsDiag: AITellResult,
): string {
  const lines: string[] = [
    "请对以下章节进行反AI检测改写，保持剧情不变。",
    `当前AI检测分数 ${currentScore.toFixed(2)}，需要降到 ${threshold} 以下。`,
    `这是第 ${attempt} 次尝试${attempt > 1 ? "，请比上次更大幅度地改写" : ""}。`,
    "",
    "改写手法：",
    ...BASE_TECHNIQUES,
  ];

  if (attempt >= 2) {
    lines.push(...ESCALATION_TECHNIQUES);
  }
  if (attempt >= 3) {
    lines.push(...DEEP_TECHNIQUES);
  }

  // Inyectar diagnóstico Tier-1 si hay issues detectadas
  if (aiTellsDiag.issues.length > 0) {
    lines.push("", "⚠️ 当前文本的AI特征问题（必须优先解决）：");
    for (const issue of aiTellsDiag.issues) {
      lines.push(`  - ${issue.category}：${issue.description}`);
      if (issue.suggestion) {
        lines.push(`    → ${issue.suggestion}`);
      }
    }
  }

  return lines.join("\n");
}
