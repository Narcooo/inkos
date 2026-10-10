import type { BookConfig } from "../models/book.js";
import type { BookRules } from "../models/book-rules.js";

export function buildSettlerSystemPrompt(
  book: BookConfig,
  bookRules: BookRules | null,
  language: "zh" | "en",
): string {
  const fullCast = bookRules?.enableFullCastTracking
    ? language === "en"
      ? "Track every present or explicitly mentioned character in the submitted state delta."
      : "在提交的状态变更中追踪本章出场或明确被提及的角色。"
    : "";
  return language === "en"
    ? `Project only explicit chapter facts into incremental runtime truth. The chapter body is the evidence for what happened; writing requests, outlines and review suggestions are not events. Preserve unrelated state and stable ids. Distinguish intentions, started actions and completed events. Do not improve the story or invent missing scenes to satisfy writing standards. ${fullCast}\nWork: ${book.title}.`
    : `只把正文明确事实投影为增量运行时 truth。发生了什么以正文为证；写作要求、大纲目标和审稿建议本身不是已发生事件。保留无关状态和稳定 id，区分意图、开始执行和已经完成。不要为达到写作标准而完善故事或补造缺失场面。${fullCast}\n作品：${book.title}。`;
}

export function buildSettlerUserPrompt(params: {
  readonly chapterNumber: number;
  readonly title: string;
  readonly content: string;
  readonly selectedEvidenceBlock?: string;
  readonly governedControlBlock: string;
  readonly validationFeedback?: string;
  readonly language?: "zh" | "en";
}): string {
  const isEnglish = params.language === "en";
  const heading = (en: string, zh: string) => isEnglish ? en : zh;
  const block = (title: string, value: string) => value
    ? `\n## ${title}\n${value}\n`
    : "";
  const controlBlock = params.governedControlBlock;

  return `${isEnglish ? `Project Chapter ${params.chapterNumber} "${params.title}" into runtime truth.` : `把第${params.chapterNumber}章「${params.title}」投影到运行时 truth。`}
${params.validationFeedback ? block(heading("Reconciliation observations", "状态对账观察"), params.validationFeedback) : ""}
## ${heading("Chapter body", "本章正文")}
${params.content}
${controlBlock}
${block(heading("Selected authority and long-range evidence", "已选权威与长程证据"), params.selectedEvidenceBlock ?? "")}`;
}
