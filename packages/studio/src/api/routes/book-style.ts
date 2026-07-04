// ── Per-Book Style Analysis API (Issue #328) ──
//
// Routes (mounted at /api/v1/books):
//   POST   /:id/style/analyze   — Analyze style for selected chapters
//   GET    /:id/style/profiles  — Get all chapter style profiles

import { Hono } from "hono";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ApiError } from "../errors.js";

interface ChapterStyleProfile {
  readonly chapterNumber: number;
  readonly title: string;
  readonly avgSentenceLength: number;
  readonly sentenceLengthStdDev: number;
  readonly avgParagraphLength: number;
  readonly vocabularyDiversity: number;
  readonly topPatterns: readonly string[];
  readonly rhetoricalFeatures: readonly string[];
  readonly wordCount: number;
}

interface CompareResult {
  readonly chapterNumber: number;
  readonly title: string;
  readonly profile: ChapterStyleProfile;
  readonly deviationFromAverage: {
    readonly avgSentenceLength: number;
    readonly sentenceLengthStdDev: number;
    readonly avgParagraphLength: number;
    readonly vocabularyDiversity: number;
  };
}

interface StyleAnalyzeResult {
  readonly chapters: readonly ChapterStyleProfile[];
  readonly comparison: readonly CompareResult[];
  readonly averageProfile: {
    readonly avgSentenceLength: number;
    readonly sentenceLengthStdDev: number;
    readonly avgParagraphLength: number;
    readonly vocabularyDiversity: number;
  };
  readonly anomalies: readonly {
    readonly chapterNumber: number;
    readonly dimension: string;
    readonly value: number;
    readonly average: number;
    readonly deviation: number;
  }[];
  readonly failedChapters?: readonly number[];
}

async function loadChapterContent(
  bookDir: string,
  chapterNumber: number,
): Promise<{ title: string; content: string } | null> {
  const chaptersDir = join(bookDir, "chapters");
  const padded = String(chapterNumber).padStart(4, "0");
  try {
    const files = await readdir(chaptersDir);
    const match = files.find((f) => f.startsWith(padded) && f.endsWith(".md"));
    if (!match) return null;
    const content = await readFile(join(chaptersDir, match), "utf-8");
    // Extract title from first heading or filename
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch?.[1] ?? match.replace(/^\d{4}_/, "").replace(/\.md$/, "");
    return { title, content };
  } catch {
    return null;
  }
}

async function loadChapterIndex(
  bookDir: string,
): Promise<readonly { number: number; title: string }[]> {
  try {
    const raw = await readFile(join(bookDir, "chapters", "index.json"), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((ch: unknown) => {
        const rec = ch as Record<string, unknown>;
        return {
          number: typeof rec.number === "number" ? rec.number : 0,
          title: typeof rec.title === "string" ? rec.title : `第${rec.number}章`,
        };
      });
    }
    if (parsed && typeof parsed === "object" && "chapters" in (parsed as Record<string, unknown>)) {
      const chapters = (parsed as { chapters: unknown[] }).chapters;
      return chapters.map((ch: unknown) => {
        const rec = ch as Record<string, unknown>;
        return {
          number: typeof rec.number === "number" ? rec.number : 0,
          title: typeof rec.title === "string" ? rec.title : `第${rec.number}章`,
        };
      });
    }
    return [];
  } catch {
    return [];
  }
}

function analyzeTextStyle(text: string): ChapterStyleProfile {
  // Simple in-place style analysis (no external dependency)
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const sentences = text
    .split(/[。！？.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const words = text.split(/[\s,，。！？、；;：:""''「」『』【】《》（）()\[\]{}]+/).filter((w) => w.length > 0);
  const uniqueWords = new Set(words.map((w) => w.toLowerCase()));

  const sentenceLengths = sentences.map((s) => s.length);
  const avgSentenceLength =
    sentenceLengths.length > 0
      ? sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length
      : 0;

  const sentenceLengthVariance =
    sentenceLengths.length > 0
      ? sentenceLengths.reduce((sum, len) => sum + (len - avgSentenceLength) ** 2, 0) /
        sentenceLengths.length
      : 0;
  const sentenceLengthStdDev = Math.sqrt(sentenceLengthVariance);

  const avgParagraphLength =
    paragraphs.length > 0
      ? paragraphs.reduce((a, b) => a + b.length, 0) / paragraphs.length
      : 0;

  const vocabularyDiversity = words.length > 0 ? uniqueWords.size / words.length : 0;

  // Extract common word patterns (2-gram)
  const bigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.push(`${words[i]}${words[i + 1]}`);
  }
  const bigramFreq = new Map<string, number>();
  for (const bg of bigrams) {
    bigramFreq.set(bg, (bigramFreq.get(bg) ?? 0) + 1);
  }
  const topPatterns = [...bigramFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([pattern]) => pattern);

  // Detect rhetorical features
  const rhetoricalFeatures: string[] = [];
  const questionCount = (text.match(/[？?]/g) ?? []).length;
  const exclamationCount = (text.match(/[！!]/g) ?? []).length;
  if (questionCount > sentences.length * 0.05) rhetoricalFeatures.push("反问/设问");
  if (exclamationCount > sentences.length * 0.03) rhetoricalFeatures.push("感叹/强调");
  if (vocabularyDiversity > 0.6) rhetoricalFeatures.push("词汇丰富");
  else if (vocabularyDiversity < 0.3) rhetoricalFeatures.push("词汇集中");

  return {
    chapterNumber: 0,
    title: "",
    avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
    sentenceLengthStdDev: Math.round(sentenceLengthStdDev * 10) / 10,
    avgParagraphLength: Math.round(avgParagraphLength),
    vocabularyDiversity: Math.round(vocabularyDiversity * 100) / 100,
    topPatterns,
    rhetoricalFeatures,
    wordCount: text.replace(/\s/g, "").length,
  };
}

export function createBookStyleRouter(bookDir: (id: string) => string) {
  const router = new Hono();

  // POST /:id/style/analyze — analyze style for selected chapters
  router.post("/:id/style/analyze", async (c) => {
    const id = c.req.param("id");
    const dir = bookDir(id);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new ApiError(400, "INVALID_JSON", "Request body must be valid JSON");
    }

    const { chapters: chaptersParam } = body as { chapters?: number[] | "all" };

    const index = await loadChapterIndex(dir);
    let targetChapters: readonly { number: number; title: string }[];

    if (chaptersParam === "all" || !chaptersParam) {
      targetChapters = index;
    } else if (Array.isArray(chaptersParam)) {
      targetChapters = chaptersParam
        .map((num) => index.find((ch) => ch.number === num))
        .filter((ch): ch is { number: number; title: string } => ch !== undefined);
    } else {
      targetChapters = index;
    }

    if (targetChapters.length === 0) {
      return c.json({ chapters: [], comparison: [], averageProfile: null, anomalies: [] });
    }

    const chapterProfiles: ChapterStyleProfile[] = [];
    const failedChapters: number[] = [];

    for (const ch of targetChapters) {
      const loaded = await loadChapterContent(dir, ch.number);
      if (!loaded) {
        failedChapters.push(ch.number);
        continue;
      }
      const profile = analyzeTextStyle(loaded.content);
      chapterProfiles.push({
        ...profile,
        chapterNumber: ch.number,
        title: loaded.title,
      });
    }

    // Calculate average profile
    const n = chapterProfiles.length;
    if (n === 0) {
      return c.json({
        chapters: [],
        comparison: [],
        averageProfile: null,
        anomalies: [],
        failedChapters,
      });
    }

    const avgSentenceLength =
      chapterProfiles.reduce((s, p) => s + p.avgSentenceLength, 0) / n;
    const avgSentenceLengthStdDev =
      chapterProfiles.reduce((s, p) => s + p.sentenceLengthStdDev, 0) / n;
    const avgParagraphLength =
      chapterProfiles.reduce((s, p) => s + p.avgParagraphLength, 0) / n;
    const avgVocabularyDiversity =
      chapterProfiles.reduce((s, p) => s + p.vocabularyDiversity, 0) / n;

    const averageProfile = {
      avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
      sentenceLengthStdDev: Math.round(avgSentenceLengthStdDev * 10) / 10,
      avgParagraphLength: Math.round(avgParagraphLength),
      vocabularyDiversity: Math.round(avgVocabularyDiversity * 100) / 100,
    };

    // Generate comparison for each chapter
    const comparison: CompareResult[] = chapterProfiles.map((p) => ({
      chapterNumber: p.chapterNumber,
      title: p.title,
      profile: p,
      deviationFromAverage: {
        avgSentenceLength: Math.round((p.avgSentenceLength - avgSentenceLength) * 10) / 10,
        sentenceLengthStdDev:
          Math.round((p.sentenceLengthStdDev - avgSentenceLengthStdDev) * 10) / 10,
        avgParagraphLength: Math.round(p.avgParagraphLength - avgParagraphLength),
        vocabularyDiversity:
          Math.round((p.vocabularyDiversity - avgVocabularyDiversity) * 100) / 100,
      },
    }));

    // Detect anomalies (deviation > 2 std dev)
    const anomalies: {
      chapterNumber: number;
      dimension: string;
      value: number;
      average: number;
      deviation: number;
    }[] = [];

    for (const ch of comparison) {
      const d = ch.deviationFromAverage;
      if (Math.abs(d.avgSentenceLength) > avgSentenceLength * 0.5) {
        anomalies.push({
          chapterNumber: ch.chapterNumber,
          dimension: "avgSentenceLength",
          value: ch.profile.avgSentenceLength,
          average: averageProfile.avgSentenceLength,
          deviation: d.avgSentenceLength,
        });
      }
      if (Math.abs(d.avgParagraphLength) > avgParagraphLength * 0.5) {
        anomalies.push({
          chapterNumber: ch.chapterNumber,
          dimension: "avgParagraphLength",
          value: ch.profile.avgParagraphLength,
          average: averageProfile.avgParagraphLength,
          deviation: d.avgParagraphLength,
        });
      }
      if (Math.abs(d.vocabularyDiversity) > averageProfile.vocabularyDiversity * 0.5) {
        anomalies.push({
          chapterNumber: ch.chapterNumber,
          dimension: "vocabularyDiversity",
          value: ch.profile.vocabularyDiversity,
          average: averageProfile.vocabularyDiversity,
          deviation: d.vocabularyDiversity,
        });
      }
    }

    return c.json({
      chapters: chapterProfiles,
      comparison,
      averageProfile,
      anomalies,
      failedChapters: failedChapters.length > 0 ? failedChapters : undefined,
    } satisfies StyleAnalyzeResult);
  });

  // GET /:id/style/profiles — get all chapter style profiles
  router.get("/:id/style/profiles", async (c) => {
    const id = c.req.param("id");
    const dir = bookDir(id);

    const index = await loadChapterIndex(dir);
    const profiles: ChapterStyleProfile[] = [];

    for (const ch of index) {
      const loaded = await loadChapterContent(dir, ch.number);
      if (!loaded) continue;
      const profile = analyzeTextStyle(loaded.content);
      profiles.push({
        ...profile,
        chapterNumber: ch.number,
        title: loaded.title,
      });
    }

    return c.json({ profiles });
  });

  return router;
}
