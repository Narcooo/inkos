import type { ContextPackage } from "../models/input-governance.js";

export function buildGovernedMemoryEvidenceBlocks(contextPackage: ContextPackage): {
  readonly hooksBlock?: string;
  readonly summariesBlock?: string;
} {
  const hookEntries = contextPackage.selectedContext.filter((entry) =>
    entry.source.startsWith("story/pending_hooks.md#"),
  );
  const summaryEntries = contextPackage.selectedContext.filter((entry) =>
    entry.source.startsWith("story/chapter_summaries.md#"),
  );

  return {
    hooksBlock: hookEntries.length > 0
      ? renderEvidenceBlock("已选伏笔证据", hookEntries)
      : undefined,
    summariesBlock: summaryEntries.length > 0
      ? renderEvidenceBlock("已选章节摘要证据", summaryEntries)
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
