import type { ContextPackage } from "../models/input-governance.js";

export function buildGovernedMemoryEvidenceBlocks(
  contextPackage: ContextPackage,
  language?: "zh" | "en",
): {
  readonly hooksBlock?: string;
  readonly summariesBlock?: string;
  readonly volumeSummariesBlock?: string;
} {
  const resolvedLanguage = language ?? "zh";
  const hookEntries = contextPackage.selectedContext.filter((entry) =>
    entry.source.startsWith("story/pending_hooks.md#"),
  );
  const summaryEntries = contextPackage.selectedContext.filter((entry) =>
    entry.source.startsWith("story/chapter_summaries.md#"),
  );
  const volumeSummaryEntries = contextPackage.selectedContext.filter((entry) =>
    entry.source.startsWith("story/volume_summaries.md#"),
  );

  return {
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
  };
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
