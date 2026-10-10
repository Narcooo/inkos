import type {ShortFictionMeasurements} from "../agents/short-fiction.js";

export type ShortFictionLanguage = "zh" | "en";

export interface ShortFictionReferencePromptInput { readonly text?: string; }
export interface ShortFictionOutlinePromptInput {
  readonly title?: string;
  readonly direction: string;
  readonly chapterCount: number;
  readonly charsPerChapter: number;
  readonly reference?: ShortFictionReferencePromptInput;
}
export interface ShortFictionDraftPromptInput {
  readonly title?: string;
  readonly openingHookChars?: number;
  readonly direction: string;
  readonly outlineMarkdown: string;
  readonly chapterCount: number;
  readonly charsPerChapter: number;
  readonly maxChapterLength?: number;
  readonly minChapterLength?: number;
  readonly chapterNumbers?: readonly number[];
  readonly previousDraftMarkdown?: string;
}
export interface ShortFictionDraftReviewPromptInput extends ShortFictionDraftPromptInput { readonly draftMarkdown: string; readonly revisionRequest?: string; readonly reviewScope?: string; readonly measurements?: ShortFictionMeasurements; readonly comparison?: unknown; }
export interface ShortFictionPackagePromptInput {
  readonly direction: string;
  readonly draftMarkdown: string;
  readonly draftTitle: string;
}

export function buildShortFictionOutlineSystemPrompt(language: ShortFictionLanguage = "zh"): string {
  return language === "en"
    ? "Create the complete short-story plan using the activated short-writing Skill and only the supplied material. Submit it through the outline tool."
    : "按已激活的短篇写作 Skill 和用户材料生成完整短篇方案，通过方案工具提交。";
}

export function buildShortFictionOutlineUserPrompt(input: ShortFictionOutlinePromptInput, language: ShortFictionLanguage = "zh"): string {
  const reference = input.reference?.text?.trim();
  return [
    language === "en" ? "## Creative Direction" : "## 创作方向",
    input.direction,
    ...(input.title?[language==="en"?`Confirmed title: ${input.title}. Preserve it exactly.`:`已确定书名：${input.title}。书名保持原样。`]:[]),
    "",
    language === "en" ? "## Target" : "## 目标",
    language === "en"
      ? `${input.chapterCount} chapters; about ${input.charsPerChapter} words per chapter.`
      : `${input.chapterCount} 章；每章约 ${input.charsPerChapter} 字。`,
    ...(reference ? ["", language === "en" ? "## Reference" : "## 参考材料", reference] : []),
  ].join("\n");
}
export function buildShortFictionWriterSystemPrompt(language: ShortFictionLanguage = "zh"): string {
  return language === "en"
    ? "Write exactly the requested chapter batch using the activated short-writing Skill and the full plan. Submit complete chapters through the draft tool."
    : "按已激活的短篇写作 Skill 和完整方案写本批指定章节，通过初稿工具提交完整章节。";
}

export function buildShortFictionWriterUserPrompt(input: ShortFictionDraftPromptInput, language: ShortFictionLanguage = "zh"): string {
  const chapters = requestedShortFictionChapters(input);
  const previous = input.previousDraftMarkdown?.trim();
  return [
    language === "en" ? "## Task" : "## 任务",
    language === "en"
      ? `Write only chapters ${chapters.join(", ")} of ${input.chapterCount}; about ${input.charsPerChapter} words each.`
      : `只写第 ${chapters.join("、")} 章；全篇 ${input.chapterCount} 章，每章约 ${input.charsPerChapter} 字。`,
    ...(input.title?[language==="en"?`Confirmed title: ${input.title}. Preserve it exactly.`:`已确定书名：${input.title}。书名保持原样。`]:[]),
    ...(input.openingHookChars&&chapters.includes(1)?[language==="en"?`Also submit an independent opening scene of about ${input.openingHookChars} words before chapter one. Keep the complete first chapter separate.`:`另交约 ${input.openingHookChars} 字的正文前独立开篇场面，放在 openingHook 字段；第一章仍须完整，不能用开篇钩子代替。`]:[]),
    ...(input.maxChapterLength !== undefined ? [language === "en" ? `Maximum per chapter: ${input.maxChapterLength} words.` : `每章正文最多 ${input.maxChapterLength} 个非空白字符（含标点）。`] : []),
    ...(input.minChapterLength !== undefined ? [language === "en" ? `Minimum per chapter: ${input.minChapterLength} words.` : `每章正文至少 ${input.minChapterLength} 个非空白字符（含标点）。`] : []),
    "",
    language === "en" ? "## Direction" : "## 创作方向",
    input.direction,
    "",
    language === "en" ? "## Plan" : "## 故事方案",
    input.outlineMarkdown,
    ...(previous ? ["", language === "en" ? "## Persisted previous chapters" : "## 已落盘前文章节", previous] : []),
  ].join("\n");
}
export function buildShortFictionDraftReviewSystemPrompt(language: ShortFictionLanguage = "zh"): string {
  return language === "en"
    ? "Review the persisted draft with the activated short-writing Skill. Attribute every finding to its sourceId and select a short inclusive startLine/endLine range from the numbered source; the host copies the exact excerpt. Distinguish outline differences from manuscript contradictions. Submit evidence-backed observations and a concise summary through the review tool. An empty observations array is valid."
    : "按已激活的短篇写作 Skill 审查已落盘成稿。每项观察指定 sourceId 和该编号来源内一小段连续的 startLine/endLine（含首尾行），系统按行号截取原文。区分大纲差异与正文内部矛盾。通过审稿工具提交有证据的观察和简短总结；observations 为空是合法结果。";
}

export function buildShortFictionDraftReviewUserPrompt(input: ShortFictionDraftReviewPromptInput, language: ShortFictionLanguage = "zh"): string {
  return [
    language === "en" ? "## Direction" : "## 创作方向", input.direction,
    "", language === "en" ? "## Source: outline (plan, not manuscript)" : "## Source: outline（大纲）", input.outlineMarkdown,
    "", language === "en" ? "## Review scope" : "## 审查范围", input.reviewScope ?? "whole-story",
    ...(input.revisionRequest ? ["", language === "en" ? "## Latest revision request" : "## 最近修改请求", input.revisionRequest] : []),
    "", language === "en" ? "## Requested manuscript constraints" : "## 成稿约束",
    JSON.stringify({chapterCount:input.chapterCount,targetChapterLength:input.charsPerChapter,minChapterLength:input.minChapterLength,
      maxChapterLength:input.maxChapterLength,openingHookTarget:input.openingHookChars,title:input.title,unit:input.measurements?.unit}),
    ...(input.comparison ? ["", language === "en" ? "## Verified revision comparison" : "## 已核验的修订对照", JSON.stringify(input.comparison),
      language === "en" ? "Compare the requested scope with these verified changes. Baseline sources supply the earlier text for changed chapters. Unchanged chapters were compared in full; do not infer a change from a missing duplicate baseline source. Cite both baseline and current sources for a claimed unauthorized change."
        : "按请求范围核验这些已确认的变化。baseline 来源提供发生变化章节的旧文；标为未变的章节已经过全文比较，不要因未重复提供旧文而推断其发生变化。判断越界改动时同时引用旧版与当前来源。"] : []),
    ...(input.measurements ? ["", language==="en"?"## Host-verified manuscript measurements":"## 宿主核验的成稿计量",
      JSON.stringify({contentScope:"complete_manuscript",chapterLengthScope:"prose_excluding_chapter_headings",...input.measurements}),
      language==="en"?"Use these measured lengths. Numbered source lines below contain the complete supplied manuscript; line numbering does not mean an excerpt.":"篇幅判断采用以上实测值。以下编号来源包含所提供的完整正文；编号用于引用，不表示节选。"] : []),
    "", language === "en" ? "## Draft under review" : "## 待审正文", input.draftMarkdown,
  ].join("\n");
}

export function buildShortFictionPackageSystemPrompt(language: ShortFictionLanguage = "zh"): string {
  return language === "en"
    ? "Package the persisted draft using the activated short-writing Skill. Preserve its actual title and plot, then submit through the package tool."
    : "按已激活的短篇写作 Skill 包装已落盘正文，保留实际标题与剧情，通过包装工具提交。";
}

export function buildShortFictionPackageUserPrompt(input: ShortFictionPackagePromptInput, language: ShortFictionLanguage = "zh"): string {
  return [
    language === "en" ? "## Direction" : "## 创作方向", input.direction,
    "", language === "en" ? "## Persisted draft" : "## 已落盘正文", input.draftMarkdown.trim(),
    "", language === "en" ? "## Existing title" : "## 当前标题", input.draftTitle,
  ].join("\n");
}
function requestedShortFictionChapters(input: ShortFictionDraftPromptInput): number[] {
  const requested = input.chapterNumbers?.filter((chapter) => Number.isInteger(chapter) && chapter >= 1 && chapter <= input.chapterCount);
  return requested && requested.length > 0
    ? [...new Set(requested)].sort((a, b) => a - b)
    : Array.from({ length: input.chapterCount }, (_, index) => index + 1);
}
