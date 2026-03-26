/**
 * Task Card Agent — S0 del pipeline de seis pasos.
 *
 * Genera una tarjeta de tarea estructurada (ChapterTaskCard) antes de que
 * comience la generación del capítulo. La tarjeta actúa como controlador
 * principal — todas las demás capas se enrutan según ella.
 *
 * Diseño de costos (Gap #4):
 * - Entrada mínima: corte del outline actual (≤500 chars) + ancla del estado (≤200 chars)
 * - maxTokens = 1024
 * - Soporta modelOverrides["task-card"] para usar modelos baratos
 * - Soporta taskCardOverride para saltar S0 enteramente
 *
 * Arranque en frío (Gap #6):
 * - Capítulo 1: no tiene "estado del capítulo anterior"
 * - Genera la tarjeta solo desde el primer nodo del outline + reglas doradas
 */

import { BaseAgent } from "./base.js";
import type { ChapterTaskCard } from "./context-layers.js";

// ===========================
// Task Card Agent
// ===========================

export class TaskCardAgent extends BaseAgent {
  get name(): string {
    return "task-card";
  }

  /**
   * Genera una tarjeta de tarea para el siguiente capítulo.
   *
   * @param outlineSlice - Corte del volume_outline relevante al capítulo actual (≤500 chars)
   * @param currentAnchor - Ancla del estado actual: situación, conflicto, objetivo (≤200 chars)
   * @param chapterNumber - Número de capítulo a escribir
   * @param language - Idioma del proyecto ('zh' o 'en')
   */
  async generateTaskCard(
    outlineSlice: string,
    currentAnchor: string,
    chapterNumber: number,
    pendingHooks: string = "",
    language: "zh" | "en" = "zh",
  ): Promise<ChapterTaskCard> {
    const systemPrompt = language === "en"
      ? this.buildSystemPromptEN()
      : this.buildSystemPromptZH();

    const userPrompt = language === "en"
      ? this.buildUserPromptEN(outlineSlice, currentAnchor, chapterNumber, pendingHooks)
      : this.buildUserPromptZH(outlineSlice, currentAnchor, chapterNumber, pendingHooks);

    const response = await this.chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.3, maxTokens: 1024 },
    );

    return this.parseTaskCard(response.content, language);
  }

  // ----- Prompt builders -----

  private buildSystemPromptZH(): string {
    return `你是一个章节任务规划器。根据大纲节点和当前状态，生成一张极简的章节任务卡。

任务卡必须是纯 JSON 格式，包含以下字段：
- chapter_goal: 本章必须改变什么（一句话）
- active_lines: 本章激活的叙事线（主线+支线，数组）
- core_pressure: 本章核心冲突/压力（一句话）
- forbidden_moves: 本章禁止的动作（数组，如"禁止解释型扩写"）
- hook_type: 结尾钩子类型（"代价显形" / "局面升级" / "余压保留" 之一）

规则：
- 每个字段必须简短、具体、可执行
- chapter_goal 不能是泛化描述（如"推进剧情"），必须指明具体变化
- forbidden_moves 至少包含一条
- 只输出 JSON，不要任何解释文字
- 优先寻找回收或推进已有“待解决伏笔”的机会，使剧情更连贯`;
  }

  private buildSystemPromptEN(): string {
    return `You are a chapter task planner. Given an outline node and current state, generate a minimal chapter task card.

The task card must be pure JSON with these fields:
- chapter_goal: What this chapter MUST change (one sentence)
- active_lines: Active narrative lines (main + sub, array)
- core_pressure: Core conflict/pressure of this chapter (one sentence)
- forbidden_moves: Forbidden actions (array, e.g. "no expository expansion")
- hook_type: End-of-chapter hook type ("cost-revealed" / "stakes-raised" / "pressure-retained")

Rules:
- Each field must be short, specific, and actionable
- chapter_goal cannot be generic ("advance the plot") — must specify concrete change
- forbidden_moves must contain at least one item
- Output ONLY JSON, no explanation text
- Prioritize opportunities to resolve or advance existing "Pending Hooks" to ensure narrative coherence`;
  }

  private buildUserPromptZH(outlineSlice: string, currentAnchor: string, chapterNumber: number, pendingHooks: string): string {
    const parts = [`## 第${chapterNumber}章 任务规划\n`];

    if (chapterNumber <= 3) {
      parts.push(`> 黄金三章规则：第${chapterNumber}章属于开篇黄金期，必须快速建立：`);
      if (chapterNumber === 1) parts.push("> - 抛出核心冲突，开篇直接进入冲突场景");
      if (chapterNumber === 2) parts.push("> - 展现金手指/核心优势，让读者看到差异化");
      if (chapterNumber === 3) parts.push("> - 明确短期目标，给读者一个清晰的追读动力");
      parts.push("");
    }

    parts.push("### 当前大纲节点");
    parts.push(outlineSlice.slice(0, 500));

    if (currentAnchor && chapterNumber > 1) {
      parts.push("\n### 上章结束状态");
      parts.push(currentAnchor.slice(0, 200));
    }

    if (pendingHooks && pendingHooks !== "(文件不存在)") {
      // Filtrar a solo las líneas abiertas para no saturar
      const openHooks = pendingHooks.split("\n")
        .filter(line => line.toLowerCase().includes("open") || line.toLowerCase().includes("progressing"))
        .slice(0, 15) // Limitar a las 15 más antiguas/recientes
        .join("\n");
      
      if (openHooks) {
        parts.push("\n### 待解决伏笔（待回收/待推进）");
        parts.push(openHooks.slice(0, 600));
      }
    }

    parts.push("\n请根据以上信息生成本章任务卡（纯 JSON）。");
    return parts.join("\n");
  }

  private buildUserPromptEN(outlineSlice: string, currentAnchor: string, chapterNumber: number, pendingHooks: string): string {
    const parts = [`## Chapter ${chapterNumber} Task Planning\n`];

    if (chapterNumber <= 3) {
      parts.push(`> Golden chapters rule: Chapter ${chapterNumber} is in the opening golden period.`);
      if (chapterNumber === 1) parts.push("> - Throw out the core conflict. Open directly into a conflict scene.");
      if (chapterNumber === 2) parts.push("> - Reveal the protagonist's edge. Show differentiation.");
      if (chapterNumber === 3) parts.push("> - Establish a clear short-term goal. Give readers a reason to keep reading.");
      parts.push("");
    }

    parts.push("### Current Outline Node");
    parts.push(outlineSlice.slice(0, 500));

    if (currentAnchor && chapterNumber > 1) {
      parts.push("\n### Previous Chapter End State");
      parts.push(currentAnchor.slice(0, 200));
    }

    if (pendingHooks && pendingHooks !== "(文件不存在)") {
      const openHooks = pendingHooks.split("\n")
        .filter(line => line.toLowerCase().includes("open") || line.toLowerCase().includes("progressing"))
        .slice(0, 15)
        .join("\n");
      
      if (openHooks) {
        parts.push("\n### Pending Hooks (To resolve/advance)");
        parts.push(openHooks.slice(0, 600));
      }
    }

    parts.push("\nGenerate the task card for this chapter (pure JSON only).");
    return parts.join("\n");
  }

  // ----- Parser -----

  /**
   * Analiza la respuesta del LLM para extraer la tarjeta de tarea.
   * Tolerante a markdown code fences y texto adicional.
   */
  private parseTaskCard(raw: string, language: "zh" | "en"): ChapterTaskCard {
    // Intentar extraer JSON de code fences
    const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const jsonStr = fenceMatch ? fenceMatch[1]! : raw;

    // Buscar el objeto JSON más externo
    const braceStart = jsonStr.indexOf("{");
    const braceEnd = jsonStr.lastIndexOf("}");
    if (braceStart < 0 || braceEnd < 0) {
      return this.fallbackTaskCard(language);
    }

    try {
      const parsed = JSON.parse(jsonStr.slice(braceStart, braceEnd + 1));
      return {
        chapterGoal: String(parsed.chapter_goal ?? parsed.chapterGoal ?? ""),
        activeLines: Array.isArray(parsed.active_lines ?? parsed.activeLines)
          ? (parsed.active_lines ?? parsed.activeLines).map(String)
          : [],
        corePressure: String(parsed.core_pressure ?? parsed.corePressure ?? ""),
        forbiddenMoves: Array.isArray(parsed.forbidden_moves ?? parsed.forbiddenMoves)
          ? (parsed.forbidden_moves ?? parsed.forbiddenMoves).map(String)
          : [],
        hookType: String(parsed.hook_type ?? parsed.hookType ?? ""),
      };
    } catch {
      return this.fallbackTaskCard(language);
    }
  }

  private fallbackTaskCard(language: "zh" | "en"): ChapterTaskCard {
    return {
      chapterGoal: language === "en" ? "Advance the current arc" : "推进当前主线",
      activeLines: [language === "en" ? "main" : "主线"],
      corePressure: language === "en" ? "Escalate conflict" : "升级当前冲突",
      forbiddenMoves: [language === "en" ? "No expository dumping" : "禁止解释型扩写"],
      hookType: language === "en" ? "stakes-raised" : "局面升级",
    };
  }
}
