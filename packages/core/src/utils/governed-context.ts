import type { ContextPackage } from "../models/input-governance.js";

export function buildGovernedMemoryEvidenceBlocks(
  contextPackage: ContextPackage,
  language?: "zh" | "en",
): {
  readonly hookDebtBlock?: string;
  readonly hooksBlock?: string;
  readonly summariesBlock?: string;
  readonly volumeSummariesBlock?: string;
  readonly titleHistoryBlock?: string;
  readonly moodTrailBlock?: string;
  readonly canonBlock?: string;
} {
  const resolvedLanguage = language ?? "zh";
  const hookEntries = contextPackage.selectedContext.filter((entry) =>
    entry.source.startsWith("story/pending_hooks.md#"),
  );
  const hookDebtEntries = contextPackage.selectedContext.filter((entry) =>
    entry.source.startsWith("runtime/hook_debt#"),
  );
  const summaryEntries = contextPackage.selectedContext.filter((entry) =>
    entry.source.startsWith("story/chapter_summaries.md#"),
  );
  const volumeSummaryEntries = contextPackage.selectedContext.filter((entry) =>
    entry.source.startsWith("story/volume_summaries.md#"),
  );
  const titleHistoryEntries = contextPackage.selectedContext.filter((entry) =>
    entry.source === "story/chapter_summaries.md#recent_titles",
  );
  const moodTrailEntries = contextPackage.selectedContext.filter((entry) =>
    entry.source === "story/chapter_summaries.md#recent_mood_type_trail",
  );
  const canonEntries = contextPackage.selectedContext.filter((entry) =>
    entry.source === "story/parent_canon.md"
    || entry.source === "story/fanfic_canon.md",
  );

  return {
    hookDebtBlock: hookDebtEntries.length > 0
      ? renderHookDebtBlock(
          resolvedLanguage === "en" ? "Hook Debt Briefs" : "Hook Debt Briefs",
          hookDebtEntries,
        )
      : undefined,
    hooksBlock: hookEntries.length > 0
      ? renderEvidenceBlock(
          resolvedLanguage === "en" ? "Selected Hook Evidence" : "已选伏笔证据",
          hookEntries,
        )
      : undefined,
    summariesBlock: summaryEntries.length > 0
      ? renderEvidenceBlock(
          resolvedLanguage === "en" ? "Selected Chapter Summary Evidence" : "已选章节摘要证据",
          summaryEntries,
        )
      : undefined,
    volumeSummariesBlock: volumeSummaryEntries.length > 0
      ? renderEvidenceBlock(
          resolvedLanguage === "en" ? "Selected Volume Summary Evidence" : "已选卷级摘要证据",
          volumeSummaryEntries,
        )
      : undefined,
    titleHistoryBlock: titleHistoryEntries.length > 0
      ? renderEvidenceBlock(
          resolvedLanguage === "en" ? "Recent Title History" : "近期标题历史",
          titleHistoryEntries,
        )
      : undefined,
    moodTrailBlock: moodTrailEntries.length > 0
      ? renderEvidenceBlock(
          resolvedLanguage === "en" ? "Recent Mood / Chapter Type Trail" : "近期情绪/章节类型轨迹",
          moodTrailEntries,
        )
      : undefined,
    canonBlock: canonEntries.length > 0
      ? renderEvidenceBlock(
          resolvedLanguage === "en" ? "Canon Evidence" : "正典约束证据",
          canonEntries,
        )
      : undefined,
  };
}

function renderHookDebtBlock(
  heading: string,
  entries: ContextPackage["selectedContext"],
): string {
  return `\n## ${heading}\n${entries.map((entry) => `- ${entry.excerpt ?? entry.reason}`).join("\n")}\n`;
}

function renderEvidenceBlock(
  heading: string,
  entries: ContextPackage["selectedContext"],
): string {
  const lines = entries.map((entry) =>
    `- ${entry.source}: ${entry.excerpt ?? entry.reason}`,
  );

  return `\n## ${heading}\n${lines.join("\n")}\n`;
}
