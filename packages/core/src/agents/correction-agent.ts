/**
 * Correction Agent — S4A del pipeline de seis pasos.
 *
 * Ejecuta corrección ligera sobre un borrador que falló la revisión S3
 * pero NO requiere reescritura completa (eso es S4B → volver a S2).
 *
 * Diseño:
 * - NO recarga contexto del libro completo
 * - NO lee truth/state/view files
 * - Solo recibe el borrador + 3-5 reglas de corrección específicas + L2 riesgos
 * - temperature = 0.3, maxTokens ajustado al largo del borrador
 *
 * Casos de uso (4A):
 * - Estilo rebota levemente
 * - Palabras abstractas resurgen
 * - Tarea del capítulo parcialmente desenfocada
 * - Gancho se desvía
 * - Escena se vuelve abstracta
 */

import { BaseAgent } from "./base.js";
import type { RiskLayer } from "./context-layers.js";

// ===========================
// Correction Agent
// ===========================

export class CorrectionAgent extends BaseAgent {
  get name(): string {
    return "correction";
  }

  /**
   * Aplica corrección ligera sobre un borrador.
   *
   * @param content - El borrador a corregir
   * @param correctionRules - 3-5 reglas de corrección específicas (del resultado de S3)
   * @param riskLayer - L2 para prevenir rebotes durante la corrección
   * @param language - Idioma del proyecto
   * @returns Contenido corregido
   */
  async correctLight(
    content: string,
    correctionRules: readonly string[],
    riskLayer: RiskLayer,
    language: "zh" | "en" = "zh",
  ): Promise<{ correctedContent: string; appliedRules: string[] }> {
    const systemPrompt = language === "en"
      ? this.buildSystemPromptEN(riskLayer)
      : this.buildSystemPromptZH(riskLayer);

    const userPrompt = language === "en"
      ? this.buildUserPromptEN(content, correctionRules)
      : this.buildUserPromptZH(content, correctionRules);

    // maxTokens proporcional al contenido — la corrección debe ser similar en largo
    const estimatedTokens = Math.ceil(content.length * 0.4) + 500;
    const maxTokens = Math.min(estimatedTokens, 16384);

    const response = await this.chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.3, maxTokens },
    );

    return {
      correctedContent: this.extractCorrectedContent(response.content),
      appliedRules: [...correctionRules],
    };
  }

  // ----- Prompt builders -----

  private buildSystemPromptZH(riskLayer: RiskLayer): string {
    const parts = [
      `你是一个章节纠偏专家。你的唯一任务是根据给定的纠偏规则，修正章节草稿中的具体问题。`,
      ``,
      `## 核心原则`,
      `- 只修改违规部分，保留其余所有内容`,
      `- 不改变章节结构、情节走向或人物决策`,
      `- 不添加新内容、新情节或新描述`,
      `- 不删除未被纠偏规则指出的内容`,
      `- 纠偏后的文本长度应与原文接近`,
    ];

    // 注入风险层禁令
    if (riskLayer.blacklistTerms.length > 0) {
      parts.push("", "## 禁用词（纠偏后也不能出现）");
      parts.push(riskLayer.blacklistTerms.join("、"));
    }
    if (riskLayer.fatigueWordBudget) {
      parts.push("", "## 疲劳词预算");
      parts.push(riskLayer.fatigueWordBudget);
    }

    parts.push("", "## 输出格式", "直接输出纠偏后的完整正文，不要任何标记或解释。");

    return parts.join("\n");
  }

  private buildSystemPromptEN(riskLayer: RiskLayer): string {
    const parts = [
      `You are a chapter correction specialist. Your sole task is to fix specific issues in a chapter draft based on the given correction rules.`,
      ``,
      `## Core Principles`,
      `- Only modify parts that violate the rules; preserve everything else`,
      `- Do not change chapter structure, plot direction, or character decisions`,
      `- Do not add new content, scenes, or descriptions`,
      `- Do not remove content not flagged by the correction rules`,
      `- Corrected text length should be close to the original`,
    ];

    if (riskLayer.blacklistTerms.length > 0) {
      parts.push("", "## Banned Terms (must not appear after correction)");
      parts.push(riskLayer.blacklistTerms.join(", "));
    }
    if (riskLayer.fatigueWordBudget) {
      parts.push("", "## Fatigue Word Budget");
      parts.push(riskLayer.fatigueWordBudget);
    }

    parts.push("", "## Output Format", "Output ONLY the corrected full text, no markers or explanations.");

    return parts.join("\n");
  }

  private buildUserPromptZH(content: string, rules: readonly string[]): string {
    const parts = [
      "## 纠偏规则（请严格执行以下每一条）",
      "",
      ...rules.map((r, i) => `${i + 1}. ${r}`),
      "",
      "## 当前章节草稿",
      "",
      content,
    ];
    return parts.join("\n");
  }

  private buildUserPromptEN(content: string, rules: readonly string[]): string {
    const parts = [
      "## Correction Rules (apply each of the following strictly)",
      "",
      ...rules.map((r, i) => `${i + 1}. ${r}`),
      "",
      "## Current Chapter Draft",
      "",
      content,
    ];
    return parts.join("\n");
  }

  // ----- Output extraction -----

  /**
   * Extrae el contenido corregido de la respuesta del LLM.
   * El agente debería devolver solo el texto, pero a veces agrega marcadores.
   */
  private extractCorrectedContent(raw: string): string {
    // Intentar extraer de code fence si existe
    const fenceMatch = raw.match(/```(?:markdown)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) return fenceMatch[1]!.trim();

    // Eliminar líneas que parecen comentarios del agente
    const lines = raw.split("\n");
    const contentLines = lines.filter(
      (l) => !l.startsWith("---") && !l.startsWith("## 纠偏") && !l.startsWith("## Correction"),
    );

    return contentLines.join("\n").trim();
  }
}
