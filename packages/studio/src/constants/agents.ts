export interface AgentMeta {
  readonly key: string;
  readonly labelZh: string;
  readonly labelEn: string;
  readonly descriptionZh: string;
  readonly category: "core" | "analysis" | "review" | "utility";
}

export const ALL_AGENTS: ReadonlyArray<AgentMeta> = [
  // Core
  { key: "Writer", labelZh: "Writer", labelEn: "Writer", descriptionZh: "核心写作", category: "core" },
  { key: "Planner", labelZh: "Planner", labelEn: "Planner", descriptionZh: "章节规划", category: "core" },
  { key: "Composer", labelZh: "Composer", labelEn: "Composer", descriptionZh: "上下文组装", category: "core" },
  { key: "Reviser", labelZh: "Reviser", labelEn: "Reviser", descriptionZh: "修订", category: "core" },
  { key: "Polisher", labelZh: "Polisher", labelEn: "Polisher", descriptionZh: "文字润色", category: "core" },
  { key: "Architect", labelZh: "Architect", labelEn: "Architect", descriptionZh: "基础设定生成", category: "core" },
  { key: "ShortFictionWriter", labelZh: "ShortFictionWriter", labelEn: "Short Fiction Writer", descriptionZh: "短篇写作", category: "core" },
  // Review
  { key: "ContinuityAuditor", labelZh: "ContinuityAuditor", labelEn: "Continuity Auditor", descriptionZh: "32维连续性审计", category: "review" },
  { key: "StateValidator", labelZh: "StateValidator", labelEn: "State Validator", descriptionZh: "状态验证", category: "review" },
  { key: "FoundationReviewer", labelZh: "FoundationReviewer", labelEn: "Foundation Reviewer", descriptionZh: "基础设定审核", category: "review" },
  { key: "ShortFictionAuditor", labelZh: "ShortFictionAuditor", labelEn: "Short Fiction Auditor", descriptionZh: "短篇审计", category: "review" },
  // Analysis
  { key: "ChapterAnalyzer", labelZh: "ChapterAnalyzer", labelEn: "Chapter Analyzer", descriptionZh: "章节分析", category: "analysis" },
  { key: "Radar", labelZh: "Radar", labelEn: "Radar", descriptionZh: "市场雷达", category: "analysis" },
  { key: "Observer", labelZh: "Observer", labelEn: "Observer", descriptionZh: "事实提取", category: "analysis" },
  // Utility
  { key: "LengthNormalizer", labelZh: "LengthNormalizer", labelEn: "Length Normalizer", descriptionZh: "字数归一化", category: "utility" },
  { key: "Consolidator", labelZh: "Consolidator", labelEn: "Consolidator", descriptionZh: "长期记忆合并", category: "utility" },
  { key: "Settler", labelZh: "Settler", labelEn: "Settler", descriptionZh: "状态结算", category: "utility" },
];

export const AGENT_CATEGORIES: Record<string, { zh: string; en: string }> = {
  core: { zh: "核心", en: "Core" },
  review: { zh: "审核/审计", en: "Review/Audit" },
  analysis: { zh: "分析", en: "Analysis" },
  utility: { zh: "工具", en: "Utility" },
};

export const CATEGORY_ORDER: ReadonlyArray<string> = ["core", "review", "analysis", "utility"];
