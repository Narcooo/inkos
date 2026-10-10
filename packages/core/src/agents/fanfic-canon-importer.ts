import { BaseAgent } from "./base.js";
import type { FanficMode } from "../models/book.js";
import { FanficCanonToolSchema } from "./fanfic-canon-tool.js";
import { estimateTextTokens } from "../llm/provider.js";
import { semanticInputBudget, splitTextByEstimatedTokens } from "../llm/semantic-input.js";

export interface FanficCanonOutput {
  readonly fullDocument: string;
}

export class FanficCanonImporter extends BaseAgent {
  get name(): string {
    return "fanfic-canon-importer";
  }

  async importFromText(
    sourceText: string,
    sourceName: string,
    fanficMode: FanficMode,
    language: "zh" | "en" = "zh",
  ): Promise<FanficCanonOutput> {
    const source = await this.prepareSourceText(sourceText, sourceName, language);
    // A source that fits is already the best factual reference. Summarizing it
    // again discards details before the architect or writer can inspect them.
    if (!source.compiled) {
      return { fullDocument: [
        language === "en" ? `# Original source — ${sourceName}` : `# 原作正文 — ${sourceName}`,
        language === "en" ? `Adaptation mode: ${fanficMode}` : `同人模式：${fanficMode}`,
        language === "en"
          ? "The complete source below establishes original facts. Apply only the author's permitted deviations when creating the new story."
          : "下方完整原文是原作事实依据。创作新故事时，只按作者明确允许的范围改变原作。",
        "", source.text,
      ].join("\n\n") };
    }
    const systemPrompt = language === "en"
      ? `Extract factual reference notes from the supplied source, separating established characters, relationships, setting and original timeline events. Adaptation mode: ${fanficMode}. This mode guides which source facts are relevant; it does not authorize writing the adaptation, inventing scenes or treating a proposed divergence as an event that already occurred. Submit a readable Markdown canon document with source evidence and explicit uncertainty where needed. Keep original timeline events identifiable as source events, distinct from the future adaptation.${source.compiled ? " The input is a traceable semantic source package." : ""}`
      : `从给定原作中提取有依据的参考事实，区分已建立的人物、关系、设定和原作时间线事件。同人模式：${fanficMode}。模式只用于判断哪些原作事实相关，不是让你撰写同人正文、补造场面或把拟议的分歧当成已经发生的事件。提交可读 Markdown 正典资料，给出原作依据，缺少依据之处明确留白。原作时间线事件要保留其来源身份，不混作未来同人作品已经发生的历史。${source.compiled ? "输入是可追溯的语义资料包。" : ""}`;

    const { result } = await this.submitStructured(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: language === "en"
          ? `Source material for "${sourceName}":\n\n${source.text}`
          : `原作《${sourceName}》素材：\n\n${source.text}` },
      ],
      {
        name: "submit_fanfic_canon",
        label: "Submit fanfic canon",
        description: "Submit the source-grounded canon sections for host persistence.",
        parameters: FanficCanonToolSchema,
      },
      {professionalGuidance:false},
    );

    const canonMarkdown = result.canonMarkdown.trim();
    if (!canonMarkdown) throw new Error("Fanfic canon compiler returned an empty document.");
    const headings = language === "en"
      ? ["Fan-fiction Canon", "Source", "Material", "Mode", "Canon"]
      : ["同人正典", "来源", "素材", "同人模式", "正典内容"];
    const fullDocument = [
      `# ${headings[0]}（${sourceName}）`,
      "",
      `## ${headings[1]}`,
      `- ${headings[2]}: ${sourceName}`,
      `- ${headings[3]}: ${fanficMode}`,
      "",
      `## ${headings[4]}`,
      canonMarkdown,
    ].join("\n");

    return { fullDocument };
  }

  private async prepareSourceText(
    sourceText: string,
    sourceName: string,
    language: "zh" | "en",
  ): Promise<{ readonly text: string; readonly compiled: boolean }> {
    const budget = semanticInputBudget(this.ctx.client, { reservedOutputTokens: 16_384 });
    if (budget === undefined || estimateTextTokens(sourceText) <= budget) {
      return { text: sourceText, compiled: false };
    }

    const chunks = splitTextByEstimatedTokens(sourceText, budget);
    const notes: string[] = [];
    for (let index = 0; index < chunks.length; index++) {
      const response = await this.chat(
        [
          {
            role: "system",
            content: language === "en"
              ? "Extract a traceable Markdown evidence package from the complete source chunk. Record only source-supported facts, relationships and events, with their source context. Do not continue, adapt or improve the story."
              : "从完整原作片段提取可追溯 Markdown 资料包。只记录有原文依据的事实、关系和事件，并保留它们的来源语境。不要续写、改编或完善故事。",
          },
          {
            role: "user",
            content: [
              language === "en" ? `Source: ${sourceName}` : `原作：${sourceName}`,
              language === "en" ? `Chunk: ${index + 1}/${chunks.length}` : `片段：${index + 1}/${chunks.length}`,
              "",
              chunks[index],
            ].join("\n"),
          },
        ],
        {professionalGuidance:false},
      );
      const content = response.content.trim();
      if (!content) throw new Error(`Fanfic source compiler returned empty output for chunk ${index + 1}/${chunks.length}.`);
      notes.push([`## 片段 ${index + 1}/${chunks.length}`, content].join("\n\n"));
    }

    return {
      compiled: true,
      text: [
        language === "en" ? `# ${sourceName} semantic source package` : `# 《${sourceName}》语义资料包`,
        "",
        language === "en"
          ? "Compiled from every source chunk for traceable canon extraction."
          : "逐段读取完整原作素材后编译，用于可追溯正典抽取。",
        "",
        ...notes,
      ].join("\n"),
    };
  }
}
