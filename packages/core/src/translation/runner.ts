import { join } from "node:path";
import {
  commitProductionArtifacts,
  createProductionRunSnapshot,
  writeProductionRunSnapshot,
} from "../production/harness.js";
import {
  loadTranslationChapter,
  loadTranslationGlossary,
  loadTranslationManifest,
  mergeGlossaryTerms,
  saveTranslationProgress,
  saveTranslationManifest,
} from "./run-store.js";
import type {
  RunTranslationProjectResult,
  TranslationChapterFile,
  TranslationModelPort,
  TranslationProjectManifest,
  TranslationSegment,
} from "./types.js";

export async function runTranslationProject(
  projectRoot: string,
  projectId: string,
  options: {
    readonly model: TranslationModelPort;
    readonly batchSize?: number;
  },
): Promise<RunTranslationProjectResult> {
  const runPath = join("translations", projectId, "status.json");
  const baseArtifacts = [
    join("translations", projectId, "manifest.json"),
    join("translations", projectId, "glossary.json"),
  ];
  await writeProductionRunSnapshot({
    rootDir: projectRoot,
    runPath,
    run: createProductionRunSnapshot({
      kind: "translation",
      id: projectId,
      status: "running",
      stage: "translate",
      artifacts: baseArtifacts,
      observations: [],
    }),
  });

  try {
    let manifest = await loadTranslationManifest(projectRoot, projectId);
    let glossary = [...await loadTranslationGlossary(projectRoot, projectId)];
    const reportLines = [`# Translation Review`, ""];
    let translatedSegments = 0;
    let reviewedChapters = 0;
    const batchSize = Math.max(1, Math.min(options.batchSize ?? 8, 32));

  for (const chapterInfo of manifest.chapters) {
    const source = await loadTranslationChapter(projectRoot, chapterInfo.sourcePath);
    const translated = await loadTranslationChapter(projectRoot, chapterInfo.translatedPath).catch(() => ({
      ...source,
      segments: [],
    } satisfies TranslationChapterFile));
    const translatedByIndex = new Map(translated.segments.map((segment) => [segment.index, segment]));
    const pending = source.segments.filter((segment) => !translatedByIndex.get(segment.index)?.target?.trim());

    for (let offset = 0; offset < pending.length; offset += batchSize) {
      const batch = pending.slice(offset, offset + batchSize);
      const result = await options.model.translateSegments({
        sourceLanguage: manifest.sourceLanguage,
        targetLanguage: manifest.targetLanguage,
        chapterTitle: source.title,
        segments: batch,
        glossary,
      });
      for (const item of result.segments) {
        const original = source.segments.find((segment) => segment.index === item.index);
        if (!original) continue;
        translatedByIndex.set(item.index, {
          ...original,
          target: item.target,
          ...(item.notes?.trim() ? { notes: item.notes.trim() } : {}),
        });
        translatedSegments++;
      }
      if (result.glossary?.length) {
        glossary = [...mergeGlossaryTerms([...glossary, ...result.glossary])];
      }
      await saveTranslationProgress(projectRoot, projectId, chapterInfo.translatedPath, {
        ...source,
        segments: orderedTranslatedSegments(source.segments, translatedByIndex),
      }, glossary);
      await writeProductionRunSnapshot({
        rootDir: projectRoot,
        runPath,
        run: createProductionRunSnapshot({
          kind: "translation",
          id: projectId,
          status: "running",
          stage: "translate",
          artifacts: [...baseArtifacts, chapterInfo.translatedPath],
          observations: [],
          resumeCursor: `${chapterInfo.number}:${offset + batch.length}`,
        }),
      });
    }

    const completedChapter = await loadTranslationChapter(projectRoot, chapterInfo.translatedPath);
    let status: "translated" | "reviewed" = "translated";
    if (options.model.reviewChapter && completedChapter.segments.some((segment) => segment.target?.trim())) {
      const review = await options.model.reviewChapter({
        sourceLanguage: manifest.sourceLanguage,
        targetLanguage: manifest.targetLanguage,
        chapterTitle: source.title,
        segments: completedChapter.segments,
        glossary,
      });
      reviewedChapters++;
      status = review.passed ? "reviewed" : "translated";
      reportLines.push(`## ${source.title}`, "", `- passed: ${review.passed ? "yes" : "no"}`, `- summary: ${review.summary}`, "");
      for (const issue of review.issues) {
        reportLines.push(`- issue: ${issue}`);
      }
      reportLines.push("");
    }
    manifest = updateChapterStatus(manifest, chapterInfo.number, status);
    await saveTranslationManifest(projectRoot, manifest);
  }

    const reportPath = `translations/${projectId}/review-report.md`;
    const artifacts = [
      ...baseArtifacts,
      ...manifest.chapters.map((chapter) => chapter.translatedPath),
      reportPath,
    ];
    await commitProductionArtifacts({
      rootDir: projectRoot,
      artifacts: [{
        relativePath: reportPath,
        content: `${reportLines.join("\n").trimEnd()}\n`,
      }],
      runPath,
      run: createProductionRunSnapshot({
        kind: "translation",
        id: projectId,
        status: "complete",
        stage: "complete",
        artifacts,
        observations: [],
      }),
    });
    return {
      projectId,
      translatedSegments,
      reviewedChapters,
      reportPath,
    };
  } catch (error) {
    await writeProductionRunSnapshot({
      rootDir: projectRoot,
      runPath,
      run: createProductionRunSnapshot({
        kind: "translation",
        id: projectId,
        status: "failed",
        stage: "translate",
        artifacts: baseArtifacts,
        observations: [],
        error: error instanceof Error ? error.message : String(error),
      }),
    }).catch(() => undefined);
    throw error;
  }
}

function orderedTranslatedSegments(
  sourceSegments: ReadonlyArray<TranslationSegment>,
  translatedByIndex: ReadonlyMap<number, TranslationSegment>,
): ReadonlyArray<TranslationSegment> {
  return sourceSegments.map((segment) => translatedByIndex.get(segment.index) ?? segment);
}

function updateChapterStatus(
  manifest: TranslationProjectManifest,
  chapterNumber: number,
  status: "translated" | "reviewed",
): TranslationProjectManifest {
  return {
    ...manifest,
    updatedAt: new Date().toISOString(),
    chapters: manifest.chapters.map((chapter) =>
      chapter.number === chapterNumber ? { ...chapter, status } : chapter,
    ),
  };
}
