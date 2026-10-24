import { join, relative, sep } from "node:path";
import { loadCreationSource } from "../agent/creation-source.js";
import { safeChildPath } from "../utils/path-safety.js";
import { toPosixPath } from "../utils/posix-path.js";
import { commitAtomicFileSet, type AtomicFileWrite } from "../utils/atomic-file-set.js";
import { createCurrentArtifact } from "../harness/artifact-revisions.js";
import { createWorkManifest } from "../harness/work-store.js";
import { WorkManifestSchema } from "../harness/contracts.js";
import { extractTranslationSource } from "./source.js";
import { segmentTranslationText } from "./text.js";
import type {
  CreateTranslationProjectInput,
  TranslationChapterFile,
  TranslationChapterManifest,
  TranslationProjectCreateResult,
  TranslationProjectManifest,
} from "./types.js";

export async function createTranslationProjectFromFile(
  projectRoot: string,
  input: CreateTranslationProjectInput,
): Promise<TranslationProjectCreateResult> {
  if ([input.sources, input.filePath, input.sourceText].filter(value => value !== undefined).length > 1) {
    throw Object.assign(new Error("Choose registered sources, inline text, or a source file"), { code: "TRANSLATION_SOURCE_AMBIGUOUS" });
  }
  const workFile = input.filePath !== undefined
    && relative(projectRoot, safeChildPath(projectRoot, input.filePath)).split(sep)[0] === "works";
  const registered = input.sources || workFile ? await loadCreationSource({
    projectRoot, sources: input.sources, sourcePath: input.filePath, purpose: "reference",
  }) : undefined;
  // An agent must pass registered references instead of retyping another Work.
  // Direct callers and genuinely pasted author text retain inline import.
  if (!registered && input.sourceText?.trim()) {
    await loadCreationSource({ projectRoot, sourceText: input.sourceText, purpose: "reference" });
  }
  if (registered) input = { ...input, filePath: undefined, sourceText: registered.text, title: input.title ?? registered.name };
  const source = await extractTranslationSource(projectRoot, input);
  const now = new Date().toISOString();
  const id = `${now.replace(/[:.]/g, "-")}-${slug(source.title)}`;
  const baseDir = join("works", id, "source");
  const writes: AtomicFileWrite[] = input.sourceText !== undefined ? [{ relativePath: join(baseDir, "source-input.md"), content: input.sourceText }] : [];

  const chapters: TranslationChapterManifest[] = [];
  for (const [index, chapter] of source.chapters.entries()) {
    const number = index + 1;
    const sourceChapterPath = join(baseDir, "source", `chapter-${number.toString().padStart(4, "0")}.json`);
    const translatedChapterPath = join(baseDir, "translated", `chapter-${number.toString().padStart(4, "0")}.json`);
    const segments = segmentTranslationText(chapter.content, input.segmentMaxChars).map((segment, segmentIndex) => ({
      index: segmentIndex + 1,
      source: segment,
    }));
    const chapterFile: TranslationChapterFile = {
      number,
      title: chapter.title,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      segments,
    };
    writes.push(
      { relativePath: sourceChapterPath, content: `${JSON.stringify(chapterFile, null, 2)}\n` },
      { relativePath: translatedChapterPath, content: `${JSON.stringify({ ...chapterFile, segments: [] }, null, 2)}\n` },
    );
    chapters.push({
      number,
      title: chapter.title,
      sourcePath: toPosixPath(sourceChapterPath),
      translatedPath: toPosixPath(translatedChapterPath),
      segmentCount: segments.length,
      charCount: chapter.content.length,
      translatedSegments: 0,
    });
  }

  const manifest: TranslationProjectManifest = {
    id,
    title: input.title?.trim() || source.title,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    createdAt: now,
    updatedAt: now,
    source: {
      kind: source.kind,
      path: input.sourceText !== undefined ? toPosixPath(join(baseDir, "source-input.md")) : source.sourcePath,
      charCount: source.charCount,
      ...(source.totalPages !== undefined ? { totalPages: source.totalPages } : {}),
    },
    chapters,
  };
  const manifestPath = join(baseDir, "manifest.json");
  const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
  const glossaryContent = `${JSON.stringify({ terms: input.glossary ?? [] }, null, 2)}\n`;
  const reviewContent = "# Translation Review\n\nPending.\n";
  writes.push(
    { relativePath: manifestPath, content: manifestContent },
    { relativePath: join(baseDir, "glossary.json"), content: glossaryContent },
    { relativePath: join(baseDir, "review-report.md"), content: reviewContent },
  );
  const work = createWorkManifest({
    id,
    title: manifest.title,
    profileId: "translation",
    language: manifest.targetLanguage,
    now,
    metadata: { sourceLanguage: manifest.sourceLanguage, targetLanguage: manifest.targetLanguage, sourceOrigin: registered ? "work" : input.sourceText !== undefined ? "inline" : "file" },
  });
  const artifacts = writes.map((write) => createCurrentArtifact({
    artifactId: toPosixPath(relative(baseDir,write.relativePath)).replace(/\.(json|md)$/,"").replaceAll("/","-"),
    artifactKind: translationArtifactKind(write.relativePath),
    path: toPosixPath(relative(join("works", id), write.relativePath)),
    content: write.content,
    contentType: write.relativePath.endsWith(".md") ? "text/markdown" : "application/json",
    createdAt: now,
    metadata: { sourcePath: toPosixPath(write.relativePath) },
  }));
  const workContent = `${JSON.stringify(WorkManifestSchema.parse({ ...work, artifacts, lineage: registered?.lineage ?? work.lineage }), null, 2)}\n`;
  await commitAtomicFileSet({
    rootDir: projectRoot,
    writes: [
      ...writes,
      { relativePath: join("works", id, "work.json"), content: workContent },
    ],
  });

  return {
    projectDir: toPosixPath(baseDir),
    manifestPath: toPosixPath(manifestPath),
    manifest,
  };
}

function translationArtifactKind(path: string): string {
  if (path.endsWith("manifest.json")) return "translation-manifest";
  if (path.endsWith("glossary.json")) return "glossary";
  if (path.endsWith("review-report.md")) return "review";
  if (path.includes("/translated/")) return "translation-chapter";
  return "source-chapter";
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "translation";
}
