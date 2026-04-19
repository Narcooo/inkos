import { Command } from "commander";
import {
  StateManager,
  analyzeAITells,
  computeAnalytics,
} from "@actalk/inkos-core";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { findProjectRoot, resolveBookId, log, logError } from "../utils.js";

interface ChapterEval {
  readonly number: number;
  readonly title: string;
  readonly wordCount: number;
  readonly auditIssueCount: number;
  readonly aiTellCount: number;
  readonly aiTellDensity: number; // issues per 1000 chars
  readonly paragraphWarnings: number;
  readonly status: string;
}

interface BookEval {
  readonly bookId: string;
  readonly totalChapters: number;
  readonly totalWords: number;
  readonly auditPassRate: number;
  readonly avgAiTellDensity: number;
  readonly avgParagraphWarnings: number;
  readonly hookResolveRate: number;
  readonly duplicateTitles: number;
  readonly qualityScore: number; // composite 0-100
  readonly chapters: ReadonlyArray<ChapterEval>;
  readonly qualityTrend: ReadonlyArray<{ chapter: number; score: number }>;
}

function computeChapterScore(ch: ChapterEval): number {
  // Per-chapter quality score (0-100)
  // Penalties: audit issues, AI tells, paragraph problems
  let score = 100;
  score -= ch.auditIssueCount * 5; // -5 per audit issue
  score -= ch.aiTellDensity * 20;  // -20 per AI tell per 1k chars
  score -= ch.paragraphWarnings * 3; // -3 per paragraph warning
  return Math.max(0, Math.min(100, score));
}

export const evalCommand = new Command("eval")
  .description("Evaluate writing quality for a book — outputs structured quality report")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--json", "Output JSON only")
  .option("--chapters <range>", "Chapter range (e.g. 1-10, 5-20)")
  .action(async (bookIdArg: string | undefined, opts: { json?: boolean; chapters?: string }) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const state = new StateManager(root);
      const index = await state.loadChapterIndex(bookId);
      const bookDir = state.bookDir(bookId);
      const chaptersDir = join(bookDir, "chapters");

      // Parse chapter range
      let startCh = 1;
      let endCh = Infinity;
      if (opts.chapters) {
        const parts = opts.chapters.split("-");
        startCh = parseInt(parts[0]!, 10);
        endCh = parts[1] ? parseInt(parts[1], 10) : startCh;
      }

      const filteredIndex = index.filter(
        (ch) => ch.number >= startCh && ch.number <= endCh,
      );

      // Read chapter files and evaluate each
      const chapterFiles = await readdir(chaptersDir).catch(() => [] as string[]);
      const allTitles = index.map((ch) => ch.title);
      const chapterEvals: ChapterEval[] = [];

      for (const ch of filteredIndex) {
        const paddedNum = String(ch.number).padStart(4, "0");
        const file = chapterFiles.find(
          (f) => f.startsWith(paddedNum) && f.endsWith(".md"),
        );
        let content = "";
        if (file) {
          content = await readFile(join(chaptersDir, file), "utf-8");
        }

        const aiTells = content ? analyzeAITells(content) : { issues: [] };
        // Simple paragraph shape check: count short paragraphs
        const paragraphs = content.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0 && !p.startsWith("#"));
        const shortParas = paragraphs.filter((p) => p.length < 35);
        const paragraphWarningCount = shortParas.length > paragraphs.length * 0.4 ? 1 : 0;

        const aiTellDensity = content.length > 0
          ? (aiTells.issues.length / content.length) * 1000
          : 0;

        chapterEvals.push({
          number: ch.number,
          title: ch.title,
          wordCount: ch.wordCount,
          auditIssueCount: ch.auditIssues.length,
          aiTellCount: aiTells.issues.length,
          aiTellDensity: Math.round(aiTellDensity * 100) / 100,
          paragraphWarnings: paragraphWarningCount,
          status: ch.status,
        });
      }

      // Hook health: parse markdown for status counts
      const hooksContent = await readFile(
        join(bookDir, "story", "pending_hooks.md"),
        "utf-8",
      ).catch(() => "");
      let hookResolveRate = 0;
      if (hooksContent) {
        const lines = hooksContent.split("\n");
        let totalHooks = 0;
        let resolvedHooks = 0;
        for (const line of lines) {
          if (/^\|.*\|.*\|/.test(line) && !line.includes("---") && !line.toLowerCase().includes("hook") && !line.toLowerCase().includes("伏笔")) {
            totalHooks++;
            if (/resolved|已回收|已解决/i.test(line)) resolvedHooks++;
          }
        }
        hookResolveRate = totalHooks > 0
          ? Math.round((resolvedHooks / totalHooks) * 100)
          : 0;
      }

      // Duplicate titles: simple exact match
      const titleSet = new Set<string>();
      let duplicateTitles = 0;
      for (const title of allTitles) {
        const norm = title.trim().toLowerCase();
        if (titleSet.has(norm)) duplicateTitles++;
        titleSet.add(norm);
      }

      // Composite score
      const analytics = computeAnalytics(bookId, index);
      const avgAiTellDensity = chapterEvals.length > 0
        ? chapterEvals.reduce((s, c) => s + c.aiTellDensity, 0) / chapterEvals.length
        : 0;
      const avgParagraphWarnings = chapterEvals.length > 0
        ? chapterEvals.reduce((s, c) => s + c.paragraphWarnings, 0) / chapterEvals.length
        : 0;

      // Quality score: weighted composite (0-100)
      const qualityScore = Math.round(
        analytics.auditPassRate * 0.3 +                        // 30% audit
        Math.max(0, 100 - avgAiTellDensity * 30) * 0.25 +     // 25% AI tells
        Math.max(0, 100 - avgParagraphWarnings * 10) * 0.15 +  // 15% paragraphs
        hookResolveRate * 0.2 +                                 // 20% hooks
        Math.max(0, 100 - duplicateTitles * 20) * 0.1,         // 10% title dedup
      );

      // Quality trend (per-chapter scores)
      const qualityTrend = chapterEvals.map((ch) => ({
        chapter: ch.number,
        score: computeChapterScore(ch),
      }));

      const result: BookEval = {
        bookId,
        totalChapters: filteredIndex.length,
        totalWords: filteredIndex.reduce((s, c) => s + c.wordCount, 0),
        auditPassRate: analytics.auditPassRate,
        avgAiTellDensity: Math.round(avgAiTellDensity * 100) / 100,
        avgParagraphWarnings: Math.round(avgParagraphWarnings * 100) / 100,
        hookResolveRate,
        duplicateTitles,
        qualityScore,
        chapters: chapterEvals,
        qualityTrend,
      };

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        log(`\nQuality Report: "${bookId}"\n`);
        log(`  Quality Score: ${qualityScore}/100`);
        log(`  Chapters: ${result.totalChapters}`);
        log(`  Words: ${result.totalWords.toLocaleString()}`);
        log("");
        log("  Dimensions:");
        log(`    Audit pass rate:      ${analytics.auditPassRate}%`);
        log(`    AI tell density:      ${avgAiTellDensity.toFixed(2)} / 1k chars`);
        log(`    Paragraph warnings:   ${avgParagraphWarnings.toFixed(1)} avg/chapter`);
        log(`    Hook resolve rate:    ${hookResolveRate}%`);
        log(`    Duplicate titles:     ${duplicateTitles}`);
        log("");
        log("  Quality Trend:");
        for (const { chapter, score } of qualityTrend) {
          const bar = "█".repeat(Math.round(score / 5)) + "░".repeat(20 - Math.round(score / 5));
          log(`    Ch.${String(chapter).padStart(3)} ${bar} ${score}`);
        }
        log("");

        // Drift detection: compare first half vs second half
        if (qualityTrend.length >= 6) {
          const mid = Math.floor(qualityTrend.length / 2);
          const firstHalf = qualityTrend.slice(0, mid).reduce((s, c) => s + c.score, 0) / mid;
          const secondHalf = qualityTrend.slice(mid).reduce((s, c) => s + c.score, 0) / (qualityTrend.length - mid);
          const drift = Math.round(secondHalf - firstHalf);
          log(`  Quality Drift: ${drift > 0 ? "+" : ""}${drift} (${drift >= 0 ? "stable/improving" : "DEGRADING"})`);
        }
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Eval failed: ${e}`);
      }
      process.exit(1);
    }
  });
