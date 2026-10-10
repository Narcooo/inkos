import { join } from "node:path";
import { commitAtomicFileSet } from "../utils/atomic-file-set.js";
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
  TranslationChapterManifest,
  TranslationModelPort,
  TranslationProjectManifest,
  TranslationSegment,
} from "./types.js";
import { syncWorkSourceArtifacts, captureWorkSourceState, changedWorkSourcePaths } from "../harness/source-sync.js";

export async function runTranslationProject(
  projectRoot: string,
  projectId: string,
  options: {
    readonly model: TranslationModelPort;
    readonly batchSize?: number;
  },
): Promise<RunTranslationProjectResult> {
  const sourceBefore = await captureWorkSourceState(projectRoot, projectId);
  try {
    let manifest = await loadTranslationManifest(projectRoot, projectId);
    let glossary = [...await loadTranslationGlossary(projectRoot, projectId)];
    const reportLines = [`# Translation Review`, ""];
    let translatedSegments = 0;
    let reviewedChapters = 0;
    const reviewSourcePaths:string[]=[];
    const batchSize = Math.max(1, Math.min(options.batchSize ?? 8, 32));

  for (const chapterInfo of manifest.chapters) {
    const source = await loadTranslationChapter(projectRoot, chapterInfo.sourcePath);
    let translated: TranslationChapterFile;
    try {
      translated = await loadTranslationChapter(projectRoot, chapterInfo.translatedPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      translated = { ...source, segments: [] };
    }
    const translatedByIndex = new Map(translated.segments.map((segment) => [segment.index, segment]));
    let translatedTitle = translated.title;
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
      if (result.chapterTitle?.trim()) translatedTitle = result.chapterTitle.trim();
      const expected = new Set(batch.map((segment) => segment.index));
      const returned = new Set<number>();
      for (const item of result.segments) {
        if (!expected.has(item.index)) {
          throw new Error(`Translation returned unknown segment ${item.index}.`);
        }
        if (returned.has(item.index)) {
          throw new Error(`Translation returned duplicate segment ${item.index}.`);
        }
        if(!item.target.trim())throw Object.assign(new Error(`Translation returned an empty target for segment ${item.index}.`),{code:"TRANSLATION_TARGET_EMPTY",segmentIndex:item.index});
        returned.add(item.index);
        const original = source.segments.find((segment) => segment.index === item.index);
        if (!original) throw new Error(`Translation source segment ${item.index} is missing.`);
        translatedByIndex.set(item.index, {
          ...original,
          target: item.target,
          ...(item.notes?.trim() ? { notes: item.notes.trim() } : {}),
        });
        translatedSegments++;
      }
      const missing = [...expected].filter((index) => !returned.has(index));
      if (missing.length > 0) {
        throw new Error(`Translation omitted segment(s): ${missing.join(", ")}.`);
      }
      if (result.glossary?.length) {
        glossary = [...mergeGlossaryTerms([...glossary, ...result.glossary])];
      }
      await saveTranslationProgress(projectRoot, projectId, chapterInfo.translatedPath, {
        ...source,
        title: translatedTitle,
        segments: orderedTranslatedSegments(source.segments, translatedByIndex),
      }, glossary);
    }

    const completedChapter = await loadTranslationChapter(projectRoot, chapterInfo.translatedPath);
    let reviewSummary: string | undefined;
    let observations: Awaited<ReturnType<NonNullable<TranslationModelPort["reviewChapter"]>>>["observations"] | undefined;
    if (options.model.reviewChapter && completedChapter.segments.some((segment) => segment.target?.trim())) {
      const review = await options.model.reviewChapter({
        sourceLanguage: manifest.sourceLanguage,
        targetLanguage: manifest.targetLanguage,
        chapterTitle: completedChapter.title,
        segments: completedChapter.segments,
        glossary,
      });
      reviewedChapters++;
      reviewSourcePaths.push(chapterInfo.translatedPath);
      reviewSummary = review.summary;
      observations = review.observations;
      reportLines.push(`## ${completedChapter.title}`, "", `- summary: ${review.summary}`, "");
      for (const observation of review.observations) {
        reportLines.push(`- ${observation.code}: ${observation.summary}`);
        for (const evidence of observation.evidence) reportLines.push(`  - evidence: ${evidence}`);
      }
      reportLines.push("");
    }
    manifest = updateChapterProgress(
      manifest,
      chapterInfo.number,
      completedChapter.segments.filter((segment) => segment.target?.trim()).length,
      completedChapter.title,
      reviewSummary,
      observations,
    );
    await saveTranslationManifest(projectRoot, manifest);
  }

    const reportPath = `works/${projectId}/source/review-report.md`;
    await commitAtomicFileSet({
      rootDir: projectRoot,
      writes: [{
        relativePath: reportPath,
        content: `${reportLines.join("\n").trimEnd()}\n`,
      }],
    });
    const reviewedWork = await syncWorkSourceArtifacts({ projectRoot, workId: projectId, accept: true,
      acceptPaths: await changedWorkSourcePaths(projectRoot, projectId, sourceBefore),
    });
    const observations = manifest.chapters.flatMap(chapter => {
      const path = chapter.translatedPath.slice(`works/${projectId}/`.length);
      const artifact = reviewedWork.artifacts.find(artifact => artifact.revisions.some(revision => revision.id === artifact.currentRevisionId && revision.path === path));
      const revision = artifact?.revisions.find(revision => revision.id === artifact.currentRevisionId);
      return (chapter.observations ?? []).map(observation => ({
        ...observation, category: observation.category ?? "quality" as const,
        assessment: observation.assessment ?? "observation" as const,
        scope: observation.scope ?? `chapter:${chapter.number}`,
        ...(artifact && revision ? { targetHash: revision.checksum, target: {workId: projectId, artifactId: artifact.id, revisionId: revision.id} } : {}),
      }));
    });
    const totalSegments=manifest.chapters.reduce((sum,chapter)=>sum+chapter.segmentCount,0);
    const completedSegments=manifest.chapters.reduce((sum,chapter)=>sum+chapter.translatedSegments,0);
    return {
      projectId,
      translatedSegments,
      reviewedChapters,
      reviewSourcePaths,
      observations,
      reportPath,
      totalSegments,completedSegments,pendingSegments:totalSegments-completedSegments,
    };
  } catch (error) {
    try {
      await syncWorkSourceArtifacts({ projectRoot, workId: projectId, accept: false });
    } catch (syncError) {
      throw new AggregateError([error, syncError], `Translation failed and candidate artifacts could not be recorded for ${projectId}`);
    }
    throw error;
  }
}

function orderedTranslatedSegments(
  sourceSegments: ReadonlyArray<TranslationSegment>,
  translatedByIndex: ReadonlyMap<number, TranslationSegment>,
): ReadonlyArray<TranslationSegment> {
  return sourceSegments.map((segment) => translatedByIndex.get(segment.index) ?? segment);
}

function updateChapterProgress(
  manifest: TranslationProjectManifest,
  chapterNumber: number,
  translatedSegments: number,
  translatedTitle: string,
  reviewSummary?: string,
  observations?: TranslationChapterManifest["observations"],
): TranslationProjectManifest {
  return {
    ...manifest,
    updatedAt: new Date().toISOString(),
    chapters: manifest.chapters.map((chapter) =>
      chapter.number === chapterNumber
        ? { ...chapter, title: translatedTitle, translatedSegments, reviewSummary, observations }
        : chapter,
    ),
  };
}
