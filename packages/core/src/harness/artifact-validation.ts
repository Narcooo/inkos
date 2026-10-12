import { join } from "node:path";
import type { WorkManifest, WorkProfile } from "./contracts.js";
import type { AtomicFileWrite } from "../utils/atomic-file-set.js";
import { ShortFictionBatchDraftSchema, renderShortFictionDraftMarkdown, renderShortFictionSalesPackage, formatShortFictionChapterHeading, validateShortFictionDraftForFinal } from "../agents/short-fiction.js";
import { ShortPackageToolSchema } from "../agents/short-fiction-tool.js";
import { Value } from "@sinclair/typebox/value";
import { countChapterLength, resolveLengthCountingMode } from "../utils/length-metrics.js";
import { TranslationProjectManifestSchema, TranslationGlossarySchema, TranslationChapterFileSchema, validateTranslationManifestOwnership } from "../translation/types.js";
import { StoryGraphSchema } from "../interactive-film/graph-schema.js";
import { assertVariableTypes } from "../interactive-film/validation.js";
import { assertGenericArtifactEditable } from './artifact-edit-policy.js';

export class ArtifactValidationError extends Error {
  constructor(readonly code: "ARTIFACT_INVALID" | "ARTIFACT_DERIVED" | "ARTIFACT_STRUCTURE_CHANGED", message: string, readonly authorityPath?: string) {
    super(message); this.name = "ArtifactValidationError";
  }
}

/** Validate authority documents and regenerate deterministic projections in the same commit. */
export function validatedArtifactWrites(work: WorkManifest, path: string, content: string, profile?: WorkProfile, previousContent?:string): AtomicFileWrite[] {
  if(profile)assertGenericArtifactEditable(work,path,profile);
  if (path.startsWith('source/exports/')) {
    const original = work.artifacts.find(artifact => `source/exports/${encodeURIComponent(artifact.id)}.md` === path);
    const authority = original?.revisions.find(revision => revision.id === original.currentRevisionId)?.path;
    throw Object.assign(new ArtifactValidationError('ARTIFACT_DERIVED', 'Exported artifacts are delivery copies. Revise the registered source artifact, then export it again.', authority), {
      recovery: original?.currentRevisionId
        ? {action: 'workspace__read', parameters: {workId: work.id, artifactId: original.id, revisionId: original.currentRevisionId}, reason: 'Read and revise the source, then export its updated revision.'}
        : {action: 'workspace__inspect_work', parameters: {workId: work.id}, reason: 'Select the registered source artifact rather than a delivery copy.'},
    });
  }
  const write = (path: string, content: string): AtomicFileWrite => ({ relativePath: join("works", work.id, path), content });
  const schema = profile?.artifactSchemas[path];
  let document: unknown;
  if (path.endsWith(".json") || (schema && schema!=="text")) {
    try { document = JSON.parse(content); }
    catch { throw new ArtifactValidationError("ARTIFACT_INVALID", "Artifact is not valid JSON"); }
  }
  try {
    if(schema==='short-manuscript')ShortFictionBatchDraftSchema.parse(document);
    if(schema==='short-package'&&!Value.Check(ShortPackageToolSchema,document))throw new Error('Invalid short package');
    if(schema==='translation-manifest')document=validateTranslationManifestOwnership(TranslationProjectManifestSchema.parse(document),work.id);
    if(schema==='translation-glossary')TranslationGlossarySchema.parse(document);
    if(schema==='translation-chapter')TranslationChapterFileSchema.parse(document);
    if(schema==='story-graph') {
      const graph = StoryGraphSchema.parse(document);
      if(graph.projectId!==work.id)throw new Error('Story graph belongs to another Work');
      assertVariableTypes(graph);
    }
  } catch(error){throw new ArtifactValidationError('ARTIFACT_INVALID',String(error));}
  const shortManuscript = work.profileId === "short-fiction" || Object.values(profile?.artifactSchemas ?? {}).includes("short-manuscript");
  if (shortManuscript && path.startsWith("source/drafts/")) {
    const chapter = path.match(/\/chapters\/(\d+)\.md$/);
    const hasManuscript=work.artifacts.some(artifact=>artifact.revisions.some(revision=>
      revision.id===artifact.currentRevisionId&&revision.path==="source/final/short-story.json"));
    throw Object.assign(new ArtifactValidationError("ARTIFACT_DERIVED", "Draft checkpoints are maintained by short-fiction production. Use the available draft or manuscript operation.", hasManuscript ? "source/final/short-story.json" : undefined), {
      recovery: hasManuscript
        ? {action:"short-fiction__revise_short_fiction",parameters:{...(chapter?{chapterNumbers:[Number(chapter[1])]}:{})},reason:"Apply the user request to the accepted manuscript and regenerate its projections."}
        : {action:"short-fiction__draft_short_fiction",parameters:{workId:work.id,minChapterLength:null,maxChapterLength:null,openingHookChars:null},reason:"Complete and repair the saved draft; no accepted manuscript exists yet."},
    });
  }
  if (shortManuscript && path.startsWith("source/final/")) {
    const authority = "source/final/short-story.json";
    if (path === "source/final/sales-package.json") {
      if (!Value.Check(ShortPackageToolSchema, document)) throw new ArtifactValidationError("ARTIFACT_INVALID", "Invalid short-fiction sales package", path);
      const sales = {...document, rawContent: ""};
      sales.rawContent = renderShortFictionSalesPackage(sales, work.language === "en" ? "en" : "zh");
      return [write(path, JSON.stringify(sales, null, 2)), write("source/final/sales-package.md", sales.rawContent), write("source/final/cover-prompt.md", sales.coverPrompt)];
    }
    if (path.endsWith(".md") && !["source/final/sales-package.md", "source/final/cover-prompt.md", "source/final/cover-request.md"].includes(path)) {
      throw new ArtifactValidationError("ARTIFACT_DERIVED", "Edit the manuscript authority document or use the short-fiction revision action", authority);
    }
    if (path === authority) {
      try {
        const parsed = ShortFictionBatchDraftSchema.parse(document);
        const language = work.language === "en" ? "en" : "zh";
        const draft = { ...parsed, chapters: parsed.chapters.map(chapter => ({ ...chapter,
          charCount: countChapterLength(chapter.content, resolveLengthCountingMode(language)),
        })) };
        validateShortFictionDraftForFinal(draft, { expectedChapters: draft.chapters.length, language });
        if (!draft.chapters.length || draft.chapters.some((chapter, index) => chapter.number !== index + 1)) throw new Error("Chapters must be contiguous");
        const markdown = renderShortFictionDraftMarkdown(draft, language);
        draft.rawContent = markdown;
        const projections = work.artifacts.flatMap(artifact => artifact.revisions.filter(revision => revision.id === artifact.currentRevisionId))
          .filter(revision => revision.path.startsWith("source/final/") && revision.path.endsWith(".md") && !revision.path.includes("/chapters/")
            && !["source/final/sales-package.md", "source/final/cover-prompt.md", "source/final/cover-request.md"].includes(revision.path));
        return [write(authority, JSON.stringify(draft, null, 2)), write("source/drafts/v001/draft.json", JSON.stringify(draft, null, 2)),
          write("source/drafts/v001/full.md", markdown), write("source/final/full.md", markdown),
          ...projections.filter(revision => revision.path !== "source/final/full.md").map(revision => write(revision.path, markdown)),
          ...draft.chapters.flatMap(chapter => ["source/final", "source/drafts/v001"].map(base => write(
            `${base}/chapters/${String(chapter.number).padStart(4, "0")}.md`,
            `# ${formatShortFictionChapterHeading(chapter.number, chapter.title, language)}\n\n${chapter.content}`,
          ))),
        ];
      } catch (error) { throw new ArtifactValidationError("ARTIFACT_INVALID", error instanceof Error ? error.message : String(error), authority); }
    }
    if (["source/final/sales-package.md", "source/final/cover-prompt.md"].includes(path)) {
      throw new ArtifactValidationError("ARTIFACT_DERIVED", "Regenerate packaging from the current manuscript", "source/final/sales-package.json");
    }
  }
  if ((work.profileId === "translation" || schema?.startsWith("translation-")) && document !== undefined) {
    if(path.includes("/translated/")&&previousContent!==undefined){
      const before=TranslationChapterFileSchema.parse(JSON.parse(previousContent));
      const after=TranslationChapterFileSchema.parse(document);
      const sourceShape=(chapter:typeof before)=>JSON.stringify({number:chapter.number,sourceLanguage:chapter.sourceLanguage,targetLanguage:chapter.targetLanguage,segments:chapter.segments.map(segment=>({index:segment.index,source:segment.source}))});
      if(sourceShape(before)!==sourceShape(after))throw Object.assign(new ArtifactValidationError("ARTIFACT_STRUCTURE_CHANGED","Translated chapter replacement must preserve every source segment, its index, order and source text. A paged preview is not the full chapter.",path),{
        expectedSegments:before.segments.length,receivedSegments:after.segments.length,lastSegmentIndex:before.segments.at(-1)?.index,
        recovery:{action:"translation__revise_paragraph",parameters:{workId:work.id,chapterNumber:before.number},reason:"Use the requested paragraph number starting at 1, or paragraph=last for the ending. Do not replace a JSON preview."},
      });
    }
    try {
      if (path.endsWith("/manifest.json")) document=validateTranslationManifestOwnership(TranslationProjectManifestSchema.parse(document),work.id);
      else if (path.endsWith("/glossary.json")) TranslationGlossarySchema.parse(document);
      else if (path.includes("/translated/")) TranslationChapterFileSchema.parse(document);
    } catch (error) { throw new ArtifactValidationError("ARTIFACT_INVALID", String(error)); }
  }
  return [write(path, schema==='translation-manifest'||(work.profileId==='translation'&&path.endsWith('/manifest.json')) ? JSON.stringify(document,null,2) : content)];
}
