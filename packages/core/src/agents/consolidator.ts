import { BaseAgent } from "./base.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface ConsolidationResult {
  readonly volumeSummaries: string;
  readonly archivedVolumes: number;
  readonly retainedChapters: number;
}

/**
 * Consolidates chapter summaries into volume-level narrative summaries.
 * Reduces token usage for long books while preserving critical context.
 */
export class ConsolidatorAgent extends BaseAgent {
  get name(): string {
    return "consolidator";
  }

  /**
   * Consolidate chapter summaries by volume.
   * - Reads volume_outline to determine volume boundaries
   * - For each completed volume, LLM compresses chapter summaries into a narrative paragraph
   * - Archives detailed summaries, keeps only recent volume's per-chapter rows
   */
  async consolidate(bookDir: string): Promise<ConsolidationResult> {
    const storyDir = join(bookDir, "story");
    const summariesPath = join(storyDir, "chapter_summaries.md");
    const outlinePath = join(storyDir, "volume_outline.md");
    const volumeSummariesPath = join(storyDir, "volume_summaries.md");

    const [summariesRaw, outlineRaw] = await Promise.all([
      readFile(summariesPath, "utf-8").catch(() => ""),
      readFile(outlinePath, "utf-8").catch(() => ""),
    ]);

    if (!summariesRaw || !outlineRaw) {
      return { volumeSummaries: "", archivedVolumes: 0, retainedChapters: 0 };
    }

    // Parse volume boundaries from outline
    const volumeBoundaries = this.parseVolumeBoundaries(outlineRaw);
    if (volumeBoundaries.length === 0) {
      return { volumeSummaries: "", archivedVolumes: 0, retainedChapters: 0 };
    }

    // Parse chapter summaries into rows
    const { header, rows } = this.parseSummaryTable(summariesRaw);
    if (rows.length === 0) {
      return { volumeSummaries: "", archivedVolumes: 0, retainedChapters: 0 };
    }

    const maxChapter = Math.max(...rows.map((r) => r.chapter));

    // Determine which volumes are "completed" (all chapters written)
    const completedVolumes: Array<{ name: string; startCh: number; endCh: number; rows: typeof rows }> = [];
    const currentVolumeRows: typeof rows = [];

    for (const vol of volumeBoundaries) {
      const volRows = rows.filter((r) => r.chapter >= vol.startCh && r.chapter <= vol.endCh);
      if (vol.endCh <= maxChapter && volRows.length > 0) {
        completedVolumes.push({ ...vol, rows: volRows });
      } else {
        // Current/incomplete volume — keep detailed rows
        currentVolumeRows.push(...volRows);
      }
    }

    // Also keep any rows not covered by volume boundaries
    const coveredChapters = new Set(volumeBoundaries.flatMap((v) => {
      const chs: number[] = [];
      for (let i = v.startCh; i <= v.endCh; i++) chs.push(i);
      return chs;
    }));
    for (const r of rows) {
      if (!coveredChapters.has(r.chapter)) currentVolumeRows.push(r);
    }

    if (completedVolumes.length === 0) {
      return { volumeSummaries: "", archivedVolumes: 0, retainedChapters: currentVolumeRows.length };
    }

    // LLM consolidation for each completed volume
    const existingVolSummaries = await readFile(volumeSummariesPath, "utf-8").catch(() => "");
    const newSummaries: string[] = existingVolSummaries ? [existingVolSummaries.trim()] : ["# Volume Summaries\n"];

    for (const vol of completedVolumes) {
      const volSummaryRows = vol.rows.map((r) => r.raw).join("\n");

      const response = await this.chat([
        {
          role: "system",
          content: `You are a narrative summarizer. Compress chapter-by-chapter summaries into a single coherent paragraph (max 500 words) that captures the key events, character developments, and plot progression of this volume. Preserve specific names, locations, and plot points. Write in the same language as the input.`,
        },
        {
          role: "user",
          content: `Volume: ${vol.name} (Chapters ${vol.startCh}-${vol.endCh})\n\nChapter summaries:\n${header}\n${volSummaryRows}`,
        },
      ], { temperature: 0.3, maxTokens: 1024 });

      newSummaries.push(`\n## ${vol.name} (Ch.${vol.startCh}-${vol.endCh})\n\n${response.content.trim()}`);
    }

    // Write volume summaries
    await writeFile(volumeSummariesPath, newSummaries.join("\n"), "utf-8");

    // Archive detailed summaries
    const archiveDir = join(storyDir, "summaries_archive");
    await mkdir(archiveDir, { recursive: true });
    for (const vol of completedVolumes) {
      const archivePath = join(archiveDir, `vol_${vol.startCh}-${vol.endCh}.md`);
      await writeFile(archivePath, `# ${vol.name}\n\n${header}\n${vol.rows.map((r) => r.raw).join("\n")}`, "utf-8");
    }

    // Rewrite chapter_summaries.md with only current volume rows
    const retainedContent = currentVolumeRows.length > 0
      ? `${header}\n${currentVolumeRows.map((r) => r.raw).join("\n")}\n`
      : `${header}\n`;
    await writeFile(summariesPath, retainedContent, "utf-8");

    return {
      volumeSummaries: newSummaries.join("\n"),
      archivedVolumes: completedVolumes.length,
      retainedChapters: currentVolumeRows.length,
    };
  }

  private parseVolumeBoundaries(outline: string): Array<{ name: string; startCh: number; endCh: number }> {
    const volumes: Array<{ name: string; startCh: number; endCh: number }> = [];
    const lines = outline.split("\n");
    const volumeHeader = /^(第[一二三四五六七八九十百千万零〇\d]+卷|Volume\s+\d+)/i;
    const rangePattern = /[（(]\s*(?:第|[Cc]hapters?\s+)?(\d+)\s*[-–~～—]\s*(\d+)\s*(?:章)?\s*[）)]|(?:第|[Cc]hapters?\s+)(\d+)\s*[-–~～—]\s*(\d+)\s*(?:章)?/i;

    for (const rawLine of lines) {
      const line = rawLine.replace(/^#+\s*/, "").trim();
      if (!volumeHeader.test(line)) continue;

      const rangeMatch = line.match(rangePattern);
      if (!rangeMatch) continue;

      const startCh = parseInt(rangeMatch[1] ?? rangeMatch[3] ?? "0", 10);
      const endCh = parseInt(rangeMatch[2] ?? rangeMatch[4] ?? "0", 10);
      if (startCh <= 0 || endCh <= 0) continue;

      const rangeIndex = rangeMatch.index ?? line.length;
      const name = line.slice(0, rangeIndex).replace(/[（(]\s*$/, "").trim();
      if (name.length > 0) {
        volumes.push({ name, startCh, endCh });
      }
    }
    return volumes;
  }

  private parseSummaryTable(raw: string): { header: string; rows: Array<{ chapter: number; raw: string }> } {
    const lines = raw.split("\n");
    const headerLines = lines.filter((l) => l.startsWith("|") && (l.includes("章节") || l.includes("Chapter") || l.includes("---")));
    const dataLines = lines.filter((l) => l.startsWith("|") && !l.includes("章节") && !l.includes("Chapter") && !l.includes("---"));

    const header = headerLines.join("\n");
    const rows = dataLines.map((line) => {
      const match = line.match(/\|\s*(\d+)\s*\|/);
      return { chapter: match ? parseInt(match[1]!, 10) : 0, raw: line };
    }).filter((r) => r.chapter > 0);

    return { header, rows };
  }
}
