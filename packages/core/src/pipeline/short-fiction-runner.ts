import { beginAgentModelCall, agentTrajectoryHeaders, type AgentModelCallTrace } from "../llm/agent-trajectory.js";
import { recordExecutionEvidence, currentExecutionAuthorRequest, currentExecutionBaselineWork } from "../harness/execution-evidence.js";
import { createBuiltInWorkProfileRegistry } from "../harness/builtin-profiles.js";
import { withWorkMutationScope } from "../utils/work-mutation-scope.js";
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import { ShortRevisionPlanSchema, ShortPackageToolSchema } from "../agents/short-fiction-tool.js";
import { access, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, isAbsolute, relative } from "node:path";
import type { AgentContext } from "../agents/base.js";
import {
  SHORT_FICTION_DEFAULT_CHAPTERS,
  SHORT_FICTION_DEFAULT_CHARS_PER_CHAPTER,
  SHORT_FICTION_EN_DEFAULT_WORDS_PER_CHAPTER,
  ShortFictionDraftReviewerAgent,
  ShortFictionOutlineAgent,
  ShortFictionPackagingAgent,
  ShortFictionWriterAgent,
  ShortFictionBatchDraftSchema,
  findIncompleteShortFictionChapters,
  formatShortFictionChapterHeading,
  renderShortFictionDraftMarkdown,
  renderShortFictionSalesPackage,
  measureShortFictionDraft,
  validateShortFictionDraftForFinal,
  type ShortFictionBatchDraft,
  type ShortFictionDraftReview,
  type ShortFictionDraftReviewInput,
  type ShortFictionLanguage,
  type ShortFictionReference,
  type ShortFictionSalesPackage,
  type ShortRevisionProgress,
} from "../agents/short-fiction.js";
import {
  coverSecretKey,
  normalizeCoverBaseUrl,
  normalizeCoverModelReference,
  resolveCoverProviderPreset,
  type CoverProviderPreset,
} from "../llm/cover-providers.js";
import { loadSecrets } from "../llm/secrets.js";
import type { Observation } from "../models/observation.js";
import { ProjectConfigSchema } from "../models/project.js";
import { StateManager } from "../state/manager.js";
import { countChapterLength, resolveLengthCountingMode } from "../utils/length-metrics.js";
import { safeChildPath } from "../utils/path-safety.js";
import { toPosixPath as projectPath } from "../utils/posix-path.js";
import { commitAtomicFileSet, type AtomicFileWrite } from "../utils/atomic-file-set.js";
import { createWorkManifest, loadWorkManifest, saveWorkManifest } from "../harness/work-store.js";
import { syncWorkSourceArtifacts, captureWorkSourceState, changedWorkSourcePaths } from "../harness/source-sync.js";
import { readArtifactRevision } from "../harness/artifact-reader.js";
import { loadAvailableAgentSkills } from "../skills/builtin-loader.js";
import { hydrateActivatedSkillGuidance } from "../agent/skill-tool.js";
import { appendActivatedSkillGuidance } from "../agents/base.js";

import { readShortProductionState, writeShortProductionState, shortInputHash, type ShortProductionState } from "./short-production-state.js";

const SHORT_FICTION_DRAFT_COMPLETION_ATTEMPTS = 3;
const SHORT_DELIVERY_CONTRACT_CODES=new Set(["SHORT_CHAPTER_CONTRACT","SHORT_TITLE_MISMATCH","SHORT_OPENING_HOOK_CONTRACT"]);

function shortDraftMinimum(options: ShortFictionRunOptions) {
  const language = options.language ?? "zh";
  const ratio = options.minChapterLengthRatio;
  const identity={title:options.title,openingHookChars:options.openingHookChars};
  if (ratio === undefined) return { ...identity,language, minChapterLength: options.minChapterLength??1, maxChapterLength: options.maxChapterLength };
  if (!(ratio > 0 && ratio <= 1)) throw new Error("minChapterLengthRatio must be greater than 0 and at most 1");
  const target = options.charsPerChapter ?? (language === "en" ? SHORT_FICTION_EN_DEFAULT_WORDS_PER_CHAPTER : SHORT_FICTION_DEFAULT_CHARS_PER_CHAPTER);
  return { ...identity,language, minChapterLength: options.minChapterLength??Math.max(1, Math.ceil(target * ratio)), maxChapterLength: options.maxChapterLength };
}

export interface ShortFictionRunRuntimes {
  readonly planner: AgentContext;
  readonly writer: AgentContext;
  readonly draftReview: AgentContext;
  readonly package: AgentContext;
}

export interface ShortFictionRunOptions {
  readonly projectRoot: string;
  readonly title?: string;
  readonly direction: string;
  readonly runtimes: ShortFictionRunRuntimes;
  readonly reference?: ShortFictionReference;
  readonly storyId?: string;
  readonly chapterCount?: number;
  // Per-chapter length in the language's native unit: zh characters or en words.
  readonly charsPerChapter?: number;
  readonly minChapterLengthRatio?: number;
  readonly minChapterLength?: number;
  readonly openingHookChars?: number;
  readonly maxChapterLength?: number;
  readonly maxChaptersPerCall?: number;
  readonly retryStages?: ReadonlyArray<"review" | "package" | "cover">;
  readonly revisionRequest?: string;
  readonly reviewScope?: string;
  readonly revisionChapterNumbers?: ReadonlyArray<number>;
  readonly resumeOperationId?: string;
  readonly restartPendingRevision?: boolean;
  readonly language?: ShortFictionLanguage;
  readonly cover?: boolean;
  readonly coverBaseUrl?: string;
  readonly coverEndpoint?: string;
  readonly coverModel?: string;
  readonly coverSize?: string;
  readonly coverApiKeyEnv?: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (message: string) => void;
}

export interface ShortFictionRunResult {
  readonly revisionChanges?: {
    readonly chapterNumbers: readonly number[];
    readonly openingChanged: boolean;
    readonly titleChanged: boolean;
    readonly outlineChanged: boolean;
  };
  readonly delivery?: ShortProductionState['delivery'];
  readonly storyId: string;
  readonly stageResults?: ShortProductionState["stages"];
  readonly observations: ReadonlyArray<Observation>;
  readonly outlinePath: string;
  readonly draftReviewPath: string;
  readonly finalMarkdownPath: string;
  readonly finalJsonPath: string;
  readonly salesPackagePath: string;
  readonly coverPromptPath: string;
  readonly coverImagePath?: string;
  readonly coverError?: string;
  readonly packageError?: string;
}

export interface ShortFictionCoverOptions {
  readonly projectRoot: string;
  readonly authorRequest?: string;
  readonly workId?: string;
  readonly title: string;
  readonly intro?: string;
  readonly sellingPoints?: ReadonlyArray<string>;
  readonly coverPrompt?: string;
  readonly language?: ShortFictionLanguage;
  readonly outputDir?: string;
  readonly includeTitle?: boolean;
  readonly coverBaseUrl?: string;
  readonly coverEndpoint?: string;
  readonly coverModel?: string;
  readonly coverSize?: string;
  readonly coverApiKeyEnv?: string;
  readonly signal?: AbortSignal;
}

export interface ShortFictionCoverResult {
  readonly title: string;
  readonly workId: string;
  readonly outputDir: string;
  readonly coverPromptPath: string;
  readonly coverImagePath: string;
}

interface CoverStorySource {
  readonly artifactId: string;
  readonly revisionId: string;
  readonly checksum: string;
  readonly content: string;
}

/** Reuse the structured context in our saved request, not a new interpretation of its prose. */
function coverContextFromRequest(markdown: string, currentSources: readonly CoverStorySource[]): ShortFictionSalesPackage | undefined {
  const block = /^```json[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*(?:\r?\n|$)/mu.exec(markdown)?.[1];
  if (!block) return undefined;
  let request: unknown;
  try { request = JSON.parse(block); } catch { return undefined; }
  if (!request || typeof request !== 'object') return undefined;
  const value = request as { version?: unknown; visualBrief?: unknown; storyReference?: { title?: unknown; synopsis?: unknown; sellingPoints?: unknown; sources?: unknown } };
  if (value.version !== 1 || !value.storyReference) return undefined;
  const priorSources = Array.isArray(value.storyReference.sources) ? value.storyReference.sources : [];
  if (priorSources.length !== currentSources.length || !currentSources.every(current => priorSources.some(prior =>
    prior?.artifactId === current.artifactId && prior.revisionId === current.revisionId && prior.checksum === current.checksum))) return undefined;
  const context = { title: value.storyReference.title, intro: value.storyReference.synopsis,
    sellingPoints: value.storyReference.sellingPoints, coverPrompt: value.visualBrief };
  if (typeof context.title !== 'string' || typeof context.intro !== 'string' || typeof context.coverPrompt !== 'string'
    || !Array.isArray(context.sellingPoints) || !context.sellingPoints.every(point => typeof point === 'string')) return undefined;
  return {title: context.title, intro: context.intro, sellingPoints: context.sellingPoints, coverPrompt: context.coverPrompt, rawContent: ''};
}

export async function runShortFictionProduction(
  options: ShortFictionRunOptions,
): Promise<ShortFictionRunResult> {
  const root = options.projectRoot;
  const providedStoryId = options.storyId
    ? safeSegment(options.storyId)
    : options.title?.trim()
      ? safeSegment(slugify(options.title))
      : undefined;

  const execute = async () => {
  if (providedStoryId) {
    const completed = await loadCompletedShortRun(root, providedStoryId, options);
    if (completed) return completed;
  }

  try {
    return await produceShort(options, root, providedStoryId);
  } catch (error) {
    if (providedStoryId && await projectFileExists(root, join("works", providedStoryId, "work.json"))) {
      try {
        await syncWorkSourceArtifacts({ projectRoot: root, workId: providedStoryId, accept: false });
      } catch (syncError) {
        throw new AggregateError([error, syncError], `Short-fiction production failed and candidate artifacts could not be recorded for ${providedStoryId}`);
      }
    }
    throw providedStoryId&&!options.signal?.aborted
      ? await shortDraftRecoveryError(error,{...options,storyId:providedStoryId}) : error;
  }
  };
  return providedStoryId ? withWorkMutationScope(root, providedStoryId, () => new StateManager(root).acquireBookLock(providedStoryId), execute) : execute();
}

async function loadCompletedShortRun(
  root: string,
  storyId: string,
  options: ShortFictionRunOptions,
): Promise<ShortFictionRunResult | null> {
  const baseDir = shortWorkBaseDir(storyId);
  const required = [
    join(baseDir, "outline", "v001.md"),
    join(baseDir, "drafts", "v001", "draft.json"),
    join(baseDir, "final", "full.md"),
    join(baseDir, "final", "short-story.json"),
    join(baseDir, "final", "sales-package.json"),
    join(baseDir, "final", "sales-package.md"),
    join(baseDir, "final", "cover-prompt.md"),
  ];
  if (!(await Promise.all(required.map((path) => projectFileExists(root, path)))).every(Boolean)) return null;
  const draft = await tryReadShortFictionDraft(root, join(baseDir, "final", "short-story.json"));
  if (!draft) return null;
  try { validateShortFictionDraftForFinal(draft, {
    expectedChapters: options.chapterCount ?? SHORT_FICTION_DEFAULT_CHAPTERS,
    ...shortDraftMinimum(options),
  }); } catch { return null; }
  if (await projectFileExists(root, join(baseDir, "reviews", "package-warning.md"))) return null;
  const png = join(baseDir, "final", "cover.png");
  const jpg = join(baseDir, "final", "cover.jpg");
  const coverImagePath = await projectFileExists(root, png)
    ? projectPath(png)
    : await projectFileExists(root, jpg)
      ? projectPath(jpg)
      : undefined;
  if (options.cover !== false && !coverImagePath) return null;
  if (options.retryStages?.length) return null;
  const state = await readShortProductionState(root, baseDir);
  const outline = await tryReadProjectText(root, join(baseDir, "outline", "v001.md"));
  const inputHash = shortInputHash({ draft, outline, intent: state?.intent ?? "" });
  if (state && (state.stages.review?.inputHash !== inputHash || state.stages.package?.inputHash !== inputHash)) return null;
  if (state?.stages.review?.status === "completed" && state.stages.review.requestHash !== shortReviewRequestHash({
    ...options,
    storyId,
    title: options.title ?? state.target?.title ?? draft.storyTitle,
    minChapterLength: options.minChapterLength ?? state.target?.minChapterLength,
    maxChapterLength: options.maxChapterLength ?? state.target?.maxChapterLength,
    openingHookChars: options.openingHookChars ?? state.target?.openingHookChars,
    chapterCount: options.chapterCount ?? state.target?.chapterCount,
    charsPerChapter: options.charsPerChapter ?? state.target?.charsPerChapter,
    language: options.language ?? state.target?.language,
  })) return null;
  if(state?.delivery&&state.stages.package?.reviewHash!==shortInputHash(state.delivery))return null;
  const observations: Observation[] = state
    ? Object.values(state.stages).flatMap(stage => stage?.observations ?? [])
    : [{ code: "production-history-unavailable", category: "execution", assessment: "unavailable", summary: "This manuscript predates persisted stage results. Review status requires verification.", evidence: [projectPath(join(baseDir, "reviews", "draft-v001.md"))] }];
  return buildShortRunResult(storyId, baseDir, observations, { coverImagePath,
    packageError: state?.stages.package?.error, coverError: state?.stages.cover?.error, stageResults: state?.stages,delivery:state?.delivery });
}

/** Source identity alone cannot establish that a different review request ran. */
function shortReviewRequestHash(options: ShortFictionRunOptions): string {
  const baseline = currentExecutionBaselineWork();
  const artifact = baseline && baseline.id === options.storyId ? baseline.artifacts.find(item => item.revisions.some(revision =>
    revision.id === item.currentRevisionId && revision.path === "source/final/short-story.json")) : undefined;
  return shortInputHash({
    evidenceVersion: 1,
    constraints: shortDraftMinimum(options),
    comparison: {scope:baseline === undefined ? "parent_revision" : "episode_start",artifactId:artifact?.id,revisionId:artifact?.currentRevisionId},
    authorRequest: currentExecutionAuthorRequest(),
    revisionRequest: options.revisionRequest,
    reviewScope: options.reviewScope ?? "whole-story",
    chapterCount: options.chapterCount,
    charsPerChapter: options.charsPerChapter,
    language: options.language ?? "zh",
    model: options.runtimes.draftReview.model,
    activatedSkills: options.runtimes.draftReview.activatedSkills,
  });
}

export type ShortProductionStage = "outline" | "draft" | "review" | "package";
export interface ShortProductionStageResult { readonly storyId: string; readonly stage: ShortProductionStage; readonly stageStatus: "completed" | "failed"; readonly observations: ReadonlyArray<Observation>; readonly artifactPaths: ReadonlyArray<string>; readonly delivery?:ShortProductionState['delivery']; }

export async function runShortFictionStage(options: ShortFictionRunOptions & { readonly storyId: string; readonly stage: ShortProductionStage }): Promise<ShortProductionStageResult> {
  const base = shortWorkBaseDir(safeSegment(options.storyId));
  if (options.stage !== "outline" && !(await projectFileExists(options.projectRoot, join(base, "outline", "v001.md")))) throw Object.assign(new Error("Create the outline first"), { code: "SHORT_OUTLINE_REQUIRED" });
  if (["review", "package"].includes(options.stage) && !(await projectFileExists(options.projectRoot, join(base, "final", "short-story.json")))) throw Object.assign(new Error("A complete manuscript is required"), { code: "SHORT_MANUSCRIPT_REQUIRED" });
  const state = await readShortProductionState(options.projectRoot, base);
  try {
    return await produceShort({ ...options, chapterCount: options.chapterCount ?? state?.target?.chapterCount, charsPerChapter: options.charsPerChapter ?? state?.target?.charsPerChapter, maxChapterLength: options.maxChapterLength ?? state?.target?.maxChapterLength, language: state?.target?.language ?? options.language, cover: false, retryStages: options.stage === "review" ? ["review"] : options.stage === "package" ? ["package"] : [] }, options.projectRoot, options.storyId, undefined, options.stage);
  } catch (error) {
    if (options.stage !== "draft" || options.signal?.aborted) throw error;
    throw await shortDraftRecoveryError(error,options);
  }
}

async function shortDraftRecoveryError(error:unknown,options:ShortFictionRunOptions & {storyId:string}):Promise<unknown>{
  const base=shortWorkBaseDir(options.storyId);
  const path=join(base,"drafts","v001-partial","draft.json");
  const partial=await tryReadShortFictionDraft(options.projectRoot,path);
  if(!partial)return error;
  const state=await readShortProductionState(options.projectRoot,base);
  const target={...state?.target,...Object.fromEntries(Object.entries(options).filter(([,value])=>value!==undefined))};
  const incompleteChapterNumbers=findIncompleteShortFictionChapters(partial,shortDraftMinimum(target as ShortFictionRunOptions));
  const recovery={action:"short-fiction__draft_short_fiction",parameters:{workId:options.storyId},workId:options.storyId,path:projectPath(path),persistedChapterNumbers:partial.chapters.filter(chapter=>chapter.title.trim()&&chapter.content.trim()).map(chapter=>chapter.number),validChapterNumbers:partial.chapters.filter(chapter=>!incompleteChapterNumbers.includes(chapter.number)).map(chapter=>chapter.number),incompleteChapterNumbers,requestedChapterCount:target.chapterCount};
  return Object.assign(new Error(`${error instanceof Error?error.message:String(error)}\nPersisted draft checkpoint: ${JSON.stringify(recovery)}`,{cause:error}),{code:(error as {code?:string})?.code??"SHORT_DRAFT_FAILED",recovery});
}

async function produceShort(options: ShortFictionRunOptions, root: string, providedStoryId: string | undefined, revisedDraft?: ShortFictionBatchDraft): Promise<ShortFictionRunResult>;
async function produceShort(options: ShortFictionRunOptions, root: string, providedStoryId: string | undefined, revisedDraft: ShortFictionBatchDraft | undefined, stopAfter: ShortProductionStage): Promise<ShortProductionStageResult>;
async function produceShort(
  options: ShortFictionRunOptions,
  root: string,
  providedStoryId: string | undefined,
  revisedDraft?: ShortFictionBatchDraft,
  stopAfter?: ShortProductionStage,
): Promise<ShortFictionRunResult | ShortProductionStageResult> {
  const savedTarget=providedStoryId?(await readShortProductionState(root,shortWorkBaseDir(providedStoryId)))?.target:undefined;
  options={...options,title:options.title??savedTarget?.title,minChapterLength:options.minChapterLength??savedTarget?.minChapterLength,openingHookChars:options.openingHookChars??savedTarget?.openingHookChars,maxChapterLength:options.maxChapterLength??savedTarget?.maxChapterLength,chapterCount:options.chapterCount??savedTarget?.chapterCount,charsPerChapter:options.charsPerChapter??savedTarget?.charsPerChapter};
  const language = options.language ?? "zh";
  let minimum = shortDraftMinimum(options);
  const chapterCount = positiveInteger(options.chapterCount, SHORT_FICTION_DEFAULT_CHAPTERS, "chapterCount");
  const charsPerChapter = language === "en"
    ? positiveInteger(options.charsPerChapter, SHORT_FICTION_EN_DEFAULT_WORDS_PER_CHAPTER, "charsPerChapter")
    : positiveInteger(options.charsPerChapter, SHORT_FICTION_DEFAULT_CHARS_PER_CHAPTER, "charsPerChapter");

  // Resume the current outline from disk when this Work already exists.
  const resumedOutline = providedStoryId
    ? await tryReadProjectText(root, join(shortWorkBaseDir(providedStoryId), "outline", "v001.md"))
    : undefined;

  let outlineMarkdown: string;
  let storyId: string;
  let baseDir: string;
  let workTitle: string;
  let sourceBefore: ReadonlyMap<string, string>;
  if (providedStoryId && resumedOutline?.trim()) {
    storyId = providedStoryId;
    baseDir = shortWorkBaseDir(storyId);
    sourceBefore = await captureWorkSourceState(root, storyId);
    outlineMarkdown = resumedOutline;
    await ensureShortWork(root, storyId, options.title?.trim() || storyId, language);
    workTitle = options.title?.trim() || (await loadWorkManifest(root, storyId)).title;
    options.onProgress?.("Resuming from existing outline (skipping outline stages)...");
  } else {
    options.onProgress?.("Creating short fiction outline...");
    const outlineAgent = new ShortFictionOutlineAgent(options.runtimes.planner);
    const outlineV1 = await outlineAgent.createOutline({
      title: options.title,
      direction: options.direction,
      chapterCount,
      charsPerChapter,
      reference: options.reference,
      language,
    });

    storyId = providedStoryId ?? safeSegment(slugify(outlineV1.storyTitle || options.direction));
    baseDir = shortWorkBaseDir(storyId);
    sourceBefore = await captureWorkSourceState(root, storyId);
    workTitle = options.title?.trim() || outlineV1.storyTitle || storyId;
    await ensureShortWork(root, storyId, workTitle, language);
    await writeText(root, join(baseDir, "outline", "v001.md"), outlineV1.rawContent);
    outlineMarkdown = await readFile(safeChildPath(root, join(baseDir, "outline", "v001.md")), "utf8");
  }
  const previousState = await readShortProductionState(root, baseDir);
  options={...options,title:workTitle};
  minimum={...minimum,title:workTitle};
  let productionState: ShortProductionState = {
    version: 2, target: { title:workTitle,chapterCount, charsPerChapter, minChapterLength:minimum.minChapterLength,maxChapterLength: options.maxChapterLength,openingHookChars:options.openingHookChars, language }, intent: previousState?.intent ?? (options.revisionRequest ? "" : options.direction),
    revisionRequest: stopAfter === "package" ? previousState?.revisionRequest : options.revisionRequest,
    reviewScope: stopAfter === "package" ? previousState?.reviewScope : options.reviewScope ?? "whole-story",
    stages: previousState?.stages ?? {},
  };
  await writeShortProductionState(root, baseDir, productionState);
  await syncWorkSourceArtifacts({ projectRoot: root, workId: storyId, accept: false });

  const stageResult = async (stage: ShortProductionStage, paths: string[]): Promise<ShortProductionStageResult> => {
    if(stage!=='outline')await refreshDelivery();
    const acceptPaths = stage === "review"
      ? ["source/reviews/draft-v001.md", "source/reviews/draft-warning.md", "source/production-state.json"]
      : stage === "package"
      ? ["source/final/sales-package.json", "source/final/sales-package.md", "source/final/cover-prompt.md", "source/reviews/package-warning.md", "source/production-state.json"]
      : stage === "draft" ? [...shortManuscriptPaths(finalDraft), ...await changedWorkSourcePaths(root, storyId, sourceBefore)] : [];
    await syncWorkSourceArtifacts({ projectRoot: root, workId: storyId, accept: stage !== "outline", acceptPaths, title: stage === "outline" ? workTitle : finalDraft.storyTitle });
    const stageStatus = (stage === "review" || stage === "package") && productionState.stages[stage]?.status === "failed" ? "failed" : "completed";
    return { storyId, stage, stageStatus, delivery:productionState.delivery,observations: [...Object.values(productionState.stages).flatMap(item => item?.observations ?? []),...(productionState.delivery?.observations??[]).filter(o=>SHORT_DELIVERY_CONTRACT_CODES.has(o.code))], artifactPaths: paths.map(path => projectPath(join(baseDir, path))) };
  };
  if (stopAfter === "outline") return stageResult("outline", ["outline/v001.md"]);
  let finalDraft: ShortFictionBatchDraft;
  let draftReviewObservations: ReadonlyArray<Observation> = [];
  let draftReviewWarning: string | undefined;
  let packageWarning: string | undefined;
  let salesPackage: ShortFictionSalesPackage | undefined;
  async function refreshDelivery(){
    const inputHash=shortInputHash({draft:finalDraft,outline:outlineMarkdown,intent:productionState.intent});
    const review=productionState.stages.review;
    const verified=review?.status==='completed'&&review.inputHash===inputHash;
    const lengthIssues:Observation[]=findIncompleteShortFictionChapters(finalDraft,minimum).map(number=>({
      code:'SHORT_CHAPTER_CONTRACT',category:'quality',assessment:'issue',scope:`chapter:${number}`,targetHash:inputHash,
      summary:`Chapter ${number} does not satisfy the configured manuscript length or text contract.`,evidence:[projectPath(join(baseDir,'final','chapters',String(number).padStart(4,'0')+'.md'))],
    }));
    const measurements=measureShortFictionDraft(finalDraft,language);
    const {openingHookLength}=measurements;
    const contractIssues:Observation[]=[...lengthIssues];
    if(finalDraft.storyTitle!==workTitle)contractIssues.push({code:"SHORT_TITLE_MISMATCH",category:"quality",assessment:"issue",targetHash:inputHash,summary:"The manuscript title differs from the confirmed title.",evidence:[projectPath(join(baseDir,"final","short-story.json"))]});
    if(options.openingHookChars&&(openingHookLength<Math.floor(options.openingHookChars*0.75)||openingHookLength>Math.ceil(options.openingHookChars*1.25)))contractIssues.push({code:"SHORT_OPENING_HOOK_CONTRACT",category:"quality",assessment:"issue",targetHash:inputHash,summary:"The independent opening scene does not satisfy the requested length.",evidence:[projectPath(join(baseDir,"final","short-story.json"))]});
    const observations=[...contractIssues,...(verified?review.observations.filter(o=>o.assessment==='issue'):[])];
    productionState={...productionState,delivery:{status:observations.length?'needs_revision':verified?'checks_passed':'unverified',inputHash,observations,measurements,target:productionState.target}};
    await writeShortProductionState(root,baseDir,productionState);
  }
  try {
    options.onProgress?.("Writing full short fiction draft...");
    const writer = new ShortFictionWriterAgent(options.runtimes.writer);
    const persistDraftBatch = async (
      draft: ShortFictionBatchDraft,
      completedChapterNumbers: ReadonlyArray<number>,
    ) => {
      await writeDraftArtifacts(root, baseDir, "v001-partial", draft, language);
      await syncWorkSourceArtifacts({ projectRoot: root, workId: storyId, accept: false });
      const saved=draft.chapters.filter(chapter=>chapter.title.trim()&&chapter.content.trim()).length;
      options.onProgress?.(language==='en'
        ? `Saved ${saved} candidate chapters; ${completedChapterNumbers.length} currently meet the text and length requirements.`
        : `已保存 ${saved} 章候选正文，${completedChapterNumbers.length} 章已满足篇幅与文本要求。`);
    };
    const reviewOrPackageOnly=stopAfter==='review'||stopAfter==='package';
    const preserveManuscript=reviewOrPackageOnly||revisedDraft!==undefined;
    const currentDraft = revisedDraft ?? (providedStoryId
      ? await tryReadShortFictionDraft(root, (reviewOrPackageOnly||options.retryStages?.length)?join(baseDir,'final','short-story.json'):join(baseDir, "drafts", "v001", "draft.json"))
      : undefined);
    const resumedDraft = currentDraft ?? await tryReadShortFictionDraft(
      root,
      join(baseDir, "drafts", "v001-partial", "draft.json"),
    );
    if(reviewOrPackageOnly&&!resumedDraft)throw Object.assign(new Error('A persisted complete manuscript is required for review or packaging'),{code:'SHORT_MANUSCRIPT_REQUIRED'});
    const draftInput={
      direction: productionState.intent,
      maxChaptersPerCall: options.maxChaptersPerCall,
      outlineMarkdown,
      chapterCount,
      charsPerChapter,
      ...minimum,
      language,
      onBatchComplete:persistDraftBatch,
    };
    const candidateDraft=resumedDraft??await writer.writeDraft(draftInput);
    let draftV1=preserveManuscript?candidateDraft:await writer.continueDraft({...draftInput,draft:candidateDraft});
    let missingFromDraft = preserveManuscript ? [] : findIncompleteShortFictionChapters(draftV1, minimum);
    if (missingFromDraft.length > 0) {
      await writeDraftArtifacts(root, baseDir, "v001-partial", draftV1, language);
      for (let attempt = 1; missingFromDraft.length > 0 && attempt <= SHORT_FICTION_DRAFT_COMPLETION_ATTEMPTS; attempt += 1) {
        options.onProgress?.(`Completing missing short fiction chapters: ${missingFromDraft.join(", ")}...`);
        draftV1 = await writer.continueDraft({
          direction: productionState.intent,
          maxChaptersPerCall: options.maxChaptersPerCall,
          outlineMarkdown,
          chapterCount,
          charsPerChapter,
          ...minimum,
          language,
          draft: draftV1,
          onBatchComplete: persistDraftBatch,
        });
        missingFromDraft = findIncompleteShortFictionChapters(draftV1, minimum);
        if (missingFromDraft.length > 0) {
          await writeDraftArtifacts(root, baseDir, "v001-partial", draftV1, language);
        }
      }
    }
    validateShortFictionDraftForFinal(draftV1, { expectedChapters: chapterCount, ...minimum, ...(preserveManuscript?{minChapterLength:1,maxChapterLength:undefined,title:undefined,openingHookChars:undefined}:{}) });
    await writeDraftArtifacts(root, baseDir, "v001", draftV1, language);

    finalDraft = draftV1;
    const reviewedWork = await syncWorkSourceArtifacts({ projectRoot: root, workId: storyId, accept: false });
    const reviewedArtifact = reviewedWork.artifacts.find(artifact => artifact.revisions.some(revision => revision.path === "source/drafts/v001/draft.json"))!;
    const reviewedHash = `sha256:${createHash("sha256").update(await readFile(safeChildPath(root, join(baseDir, "drafts", "v001", "draft.json")))).digest("hex")}`;
    const reviewedRevision = reviewedArtifact.revisions.find(revision => revision.checksum === reviewedHash)!;
    if (stopAfter === "draft") {
      await writeFinalArtifacts(root, baseDir, finalDraft, language);
      return stageResult("draft", ["final/short-story.json", "final/full.md"]);
    }
    const inputHash = shortInputHash({ draft: draftV1, outline: outlineMarkdown, intent: productionState.intent });
    if (stopAfter !== "package") {
    options.onProgress?.("Reviewing completed short fiction...");
    const draftReviewer = new ShortFictionDraftReviewerAgent(options.runtimes.draftReview);
    const requestHash = shortReviewRequestHash({...options, ...minimum, storyId, chapterCount, charsPerChapter, language});
    let reviewComparison: Omit<NonNullable<ShortFictionDraftReviewInput["comparison"]>, "draft"> | undefined;
    try {
      const baseline = currentExecutionBaselineWork();
      const baselineArtifact = baseline?.id === storyId ? baseline.artifacts.find(artifact => artifact.revisions.some(revision =>
        revision.id === artifact.currentRevisionId && revision.path === "source/final/short-story.json")) : undefined;
      const baselineId = baseline === undefined ? reviewedRevision.parentRevisionId : baselineArtifact?.currentRevisionId;
      let comparison: ShortFictionDraftReviewInput["comparison"];
      if (baselineId) {
        const before = await readArtifactRevision({projectRoot:root,workId:storyId,artifactId:baselineArtifact?.id ?? reviewedArtifact.id,revisionId:baselineId});
        comparison = {scope:baseline === undefined ? "parent_revision" : "episode_start",
          before:{artifactId:before.artifact.id,revisionId:before.revision.id,checksum:before.revision.checksum},
          after:{artifactId:reviewedArtifact.id,revisionId:reviewedRevision.id,checksum:reviewedRevision.checksum},
          draft:ShortFictionBatchDraftSchema.parse(JSON.parse(before.bytes.toString("utf8")))};
        reviewComparison = {scope:comparison.scope,before:comparison.before,after:comparison.after};
      }
      const cachedReview = productionState.stages.review;
      const reuseReview = cachedReview?.status === "completed" && cachedReview.inputHash === inputHash
        && cachedReview.requestHash === requestHash && !options.retryStages?.includes("review");
      const draftReview = reuseReview
        ? { summary: "", observations: cachedReview.observations }
        : await draftReviewer.reviewDraft({
        direction: productionState.intent,
        revisionRequest: currentExecutionAuthorRequest() ?? options.revisionRequest,
        reviewScope: productionState.reviewScope,
        outlineMarkdown,
        draft: draftV1,
        chapterCount,
        charsPerChapter,
        ...minimum,
        comparison,
        language,
      });
      draftReviewObservations = draftReview.observations.map(observation => ({ ...observation,
        category: "quality", assessment: observation.assessment ?? "observation", scope: productionState.reviewScope, targetHash: reviewedHash, target: { workId: storyId, artifactId: reviewedArtifact.id, revisionId: reviewedRevision.id } }));
      if (!reuseReview) await writeText(
        root,
        join(baseDir, "reviews", "draft-v001.md"),
        renderShortFictionReview(draftReview, language),
      );
      await rm(safeChildPath(root, join(baseDir, "reviews", "draft-warning.md")), { force: true });
    } catch (error) {
      options.signal?.throwIfAborted();
      draftReviewWarning = error instanceof Error ? error.message : String(error);
      await writeText(root, join(baseDir, "reviews", "draft-warning.md"), language === "en"
        ? `# Review unavailable\n\nThe complete draft remains available.\n\n## Reason\n\n${draftReviewWarning}`
        : `# 审稿暂不可用\n\n完整正文已经保留。\n\n## 原因\n\n${draftReviewWarning}`);
    }

    productionState = { ...productionState, stages: { ...productionState.stages, review: {
      status: draftReviewWarning ? "failed" : "completed", inputHash, requestHash, updatedAt: new Date().toISOString(),
      comparison: reviewComparison,
      error: draftReviewWarning,
      observations: draftReviewWarning ? [{ code: "draft-review", category: "execution", assessment: "unavailable",
        summary: draftReviewWarning, evidence: [projectPath(join(baseDir, "reviews", "draft-warning.md"))], scope: productionState.reviewScope, targetHash: inputHash }] : [...draftReviewObservations],
    } } };
    await writeShortProductionState(root, baseDir, productionState);
    }
    if (stopAfter === "review") return stageResult("review", [draftReviewWarning ? "reviews/draft-warning.md" : "reviews/draft-v001.md", "production-state.json"]);
    if(!reviewOrPackageOnly)await writeFinalArtifacts(root, baseDir, finalDraft, language);

    options.onProgress?.("Generating synopsis and cover prompt...");
    await refreshDelivery();
    const packager = new ShortFictionPackagingAgent(options.runtimes.package);
    try {
      const cachedPackage = productionState.stages.package;
      const reviewHash=shortInputHash(productionState.delivery);
      const savedPackage = await tryReadProjectText(root, join(baseDir, "final", "sales-package.json"));
      const packageDirection=stopAfter==="package"&&options.direction.trim()&&options.direction!==productionState.intent
        ? [productionState.intent,language==="en"?"Current packaging request:":"本次包装要求：",options.direction].join("\n\n")
        : productionState.intent;
      salesPackage = cachedPackage?.status === "completed" && cachedPackage.inputHash === inputHash && cachedPackage.reviewHash===reviewHash && savedPackage && !options.retryStages?.includes("package")
        ? JSON.parse(savedPackage) as ShortFictionSalesPackage
        : await packager.generatePackage({
        direction: packageDirection,
        outlineMarkdown,
        draft: finalDraft,
        language,
        reviewContext:JSON.stringify(productionState.delivery),
      });
      await writePackageArtifacts(root, baseDir, salesPackage, language);
      await rm(safeChildPath(root, join(baseDir, "reviews", "package-warning.md")), { force: true });
    } catch (error) {
      options.signal?.throwIfAborted();
      packageWarning = error instanceof Error ? error.message : String(error);
      await writeText(root, join(baseDir, "reviews", "package-warning.md"), language === "en"
        ? `# Packaging requires retry\n\nThe complete story remains available. Synopsis and cover packaging failed without invalidating the prose.\n\n## Reason\n\n${packageWarning}`
        : `# 包装阶段需要重试\n\n完整正文已经保留。简介与封面包装失败不会再把正文标成失败。\n\n## 原因\n\n${packageWarning}`);
    }
    productionState = { ...productionState, stages: { ...productionState.stages, package: {
      status: packageWarning ? "failed" : "completed", inputHash, reviewHash:shortInputHash(productionState.delivery),updatedAt: new Date().toISOString(), error: packageWarning,
      observations: packageWarning ? [{ code: "package-generation", category: "execution", assessment: "unavailable", summary: packageWarning, evidence: [], targetHash: inputHash }] : [],
    } } };
    await writeShortProductionState(root, baseDir, productionState);
  } catch (error) {
    throw error;
  }

  if (stopAfter === "package") return stageResult("package", packageWarning
    ? ["reviews/package-warning.md", "production-state.json"]
    : ["final/sales-package.json", "final/sales-package.md", "final/cover-prompt.md"]);
  const coverArtifacts: { readonly coverImagePath?: string; readonly coverError?: string; readonly coverErrorCode?: string } = options.cover === false
    ? { coverError: "disabled" }
    : packageWarning || !salesPackage?.coverPrompt.trim()
    ? {
        coverErrorCode: "SHORT_COVER_PACKAGE_REQUIRED",
        coverError: "Cover generation requires a completed sales package with a story-grounded visual brief. Retry packaging, then resume cover generation.",
      }
    : await generateCoverArtifact({
        root,
        baseDir,
        salesPackage,
        authorRequest: currentExecutionAuthorRequest() ?? options.direction,
        language,
        coverBaseUrl: options.coverBaseUrl,
        coverEndpoint: options.coverEndpoint,
        coverModel: options.coverModel,
        coverSize: options.coverSize,
        coverApiKeyEnv: options.coverApiKeyEnv,
        signal: options.signal,
      }).catch((error: unknown) => {
        options.signal?.throwIfAborted();
        return { coverError: String(error) };
      });

  if (options.cover !== false) {
    productionState = { ...productionState, stages: { ...productionState.stages, cover: {
      status: coverArtifacts.coverError ? "failed" : "completed", inputHash: shortInputHash(salesPackage ?? null),
      updatedAt: new Date().toISOString(), error: coverArtifacts.coverError,
      observations: coverArtifacts.coverError ? [{ code: coverArtifacts.coverErrorCode ?? "cover-generation", category: "execution", assessment: "unavailable", summary: coverArtifacts.coverError, evidence: [] }] : [],
    } } };
    await writeShortProductionState(root, baseDir, productionState);
  }
  await refreshDelivery();
  const observations = [...Object.values(productionState.stages).flatMap(stage => stage?.observations ?? []),...(productionState.delivery?.observations??[]).filter(o=>SHORT_DELIVERY_CONTRACT_CODES.has(o.code))];
  await syncWorkSourceArtifacts({ projectRoot: root, workId: storyId, accept: true, title: finalDraft.storyTitle,
    acceptPaths: [...shortManuscriptPaths(finalDraft), ...await changedWorkSourcePaths(root, storyId, sourceBefore)],
  });

  return buildShortRunResult(storyId, baseDir, observations, { ...coverArtifacts, packageError: packageWarning, stageResults: productionState.stages,delivery:productionState.delivery });
}

interface ShortRevisionCheckpoint {
  readonly operationId?: string;
  readonly inputHash: string;
  readonly sourceHash?: string;
  readonly review?: string;
  readonly request?: Pick<ShortFictionRunOptions, "direction" | "chapterCount" | "charsPerChapter" |
    "minChapterLength" | "maxChapterLength" | "openingHookChars" | "revisionChapterNumbers">;
  readonly progress?: ShortRevisionProgress;
  readonly finalization?: {
    readonly baseline: { readonly draft: ShortFictionBatchDraft; readonly outlineMarkdown: string };
    readonly result: { readonly draft: ShortFictionBatchDraft; readonly outlineMarkdown: string };
  };
}

export async function reviseShortFictionProduction(options: ShortFictionRunOptions & { readonly storyId: string }): Promise<ShortFictionRunResult> {
  await loadWorkManifest(options.projectRoot, options.storyId);
  const release=await new StateManager(options.projectRoot).acquireBookLock(options.storyId);
  try { return await reviseShortFictionWithLock(options); }
  finally { await release(); }
}

async function reviseShortFictionWithLock(options: ShortFictionRunOptions & { readonly storyId: string }): Promise<ShortFictionRunResult> {
  const work = await loadWorkManifest(options.projectRoot, options.storyId);
  if(!createBuiltInWorkProfileRegistry(options.projectRoot).require(work.profileId).capabilityIds.includes("short-fiction")) throw new Error("Short revision requires a short-fiction Work");
  const base = shortWorkBaseDir(options.storyId);
  let draft = await tryReadShortFictionDraft(options.projectRoot,join(base,"final","short-story.json"));
  if(!draft) throw Object.assign(new Error("Complete the saved draft before revising the accepted manuscript."),{
    code:"SHORT_MANUSCRIPT_NOT_READY",
    recovery:{action:"short-fiction__draft_short_fiction",parameters:{workId:work.id},
      reason:"The saved draft checkpoint is not an accepted manuscript. Complete and repair it through the draft stage while preserving the existing Work contract."},
  });
  const language = work.language === "en" ? "en" : "zh";
  const state=await readShortProductionState(options.projectRoot,base);
  const checkpointPath = join(".inkos", "short-revisions", `${work.id}.json`);
  const savedText = await tryReadProjectText(options.projectRoot, checkpointPath);
  const saved = savedText ? JSON.parse(savedText) as ShortRevisionCheckpoint : undefined;
  let outlineMarkdown = await readFile(safeChildPath(options.projectRoot, join(base, "outline", "v001.md")), "utf8");
  let sourceHash = shortInputHash({ draft, outlineMarkdown });
  let review = await tryReadProjectText(options.projectRoot, join(base, "reviews", "draft-v001.md")) ?? "";
  const recovery = (checkpoint: ShortRevisionCheckpoint) => ({
    action: "short-fiction__revise_short_fiction",
    parameters: checkpoint.operationId ? { resumeOperationId: checkpoint.operationId } : undefined,
    workId: work.id, checkpointPath,
    completedChapterNumbers: checkpoint.progress?.completed ?? [],
    pendingChapterNumbers: checkpoint.progress?.plan.chapters.map(chapter => chapter.number)
      .filter(number => !checkpoint.progress?.completed.includes(number)) ?? [],
    reason: "Continue the saved revision by its operation ID. To replace its instructions or scope, start an explicit new revision with restartPendingRevision=true; the previous checkpoint will be archived.",
  });
  if (options.resumeOperationId) {
    if (options.direction.trim() || options.restartPendingRevision || [options.chapterCount, options.charsPerChapter,
      options.maxChapterLength, options.minChapterLength, options.minChapterLengthRatio,
      options.openingHookChars, options.revisionChapterNumbers].some(value => value !== undefined)) {
      throw Object.assign(new Error("A revision resume accepts only its operation ID, not new instructions or constraints."), { code: "SHORT_REVISION_RESUME_CONFLICT" });
    }
    if (!saved?.request || saved.operationId !== options.resumeOperationId) {
      throw Object.assign(new Error("The requested revision operation is not the pending operation for this Work."), { code: "SHORT_REVISION_NOT_FOUND" });
    }
    const finalization = saved.finalization;
    const ownedSources = finalization ? [
      shortInputHash({ draft: finalization.baseline.draft, outlineMarkdown: finalization.result.outlineMarkdown }),
      shortInputHash(finalization.result),
    ] : [];
    if (saved.sourceHash !== sourceHash && !ownedSources.includes(sourceHash)) {
      throw Object.assign(new Error("The manuscript or outline changed after this revision began. Start an explicit new revision from the current source."), { code: "SHORT_REVISION_SOURCE_CHANGED" });
    }
    if (finalization) {
      // Completing review/packaging must not rewrite chapters or reset the change baseline.
      draft = ShortFictionBatchDraftSchema.parse(finalization.baseline.draft);
      outlineMarkdown = finalization.baseline.outlineMarkdown;
      sourceHash = shortInputHash({ draft, outlineMarkdown });
    }
    // Persist only creative inputs. Runtime contexts can contain credentials and are never serialized.
    options = { ...options, ...saved.request };
    review = saved.review ?? "";
  } else if (!options.direction.trim()) {
    throw Object.assign(new Error("Supply a new revision instruction or the pending operation ID."), { code: "SHORT_REVISION_REQUEST_REQUIRED" });
  }
  const chapterCount=options.chapterCount===undefined?draft.chapters.length:positiveInteger(options.chapterCount,draft.chapters.length,"chapterCount");
  if(options.revisionChapterNumbers&&chapterCount!==draft.chapters.length)throw Object.assign(new Error("A chapter-count change requires whole-manuscript scope; describe which source chapters to retain in the instruction."),{code:"SHORT_REVISION_SCOPE_CONFLICT"});
  const revisionOptions: ShortFictionRunOptions = {...options,revisionRequest:options.direction,language,chapterCount,
    title:state?.target?.title??draft.storyTitle,minChapterLength:options.minChapterLength??state?.target?.minChapterLength,openingHookChars:options.openingHookChars??state?.target?.openingHookChars,
    charsPerChapter:options.charsPerChapter ?? (options.maxChapterLength!==undefined?Math.min(state?.target?.charsPerChapter??options.maxChapterLength,options.maxChapterLength):state?.target?.charsPerChapter),
    minChapterLengthRatio:options.minChapterLengthRatio??createBuiltInWorkProfileRegistry(options.projectRoot).require(work.profileId).production.minChapterLengthRatio,
    maxChapterLength:options.maxChapterLength ?? state?.target?.maxChapterLength,cover:false};
  const minimum = shortDraftMinimum(revisionOptions);
  const chapterNumbers=options.revisionChapterNumbers;
  if(chapterNumbers?.some(number=>!Number.isInteger(number)||number<1||number>draft.chapters.length)) throw new Error("Invalid revision chapter scope");
  const inputHash=createHash("sha256").update(JSON.stringify({revisionPlanVersion:6,draft,outlineMarkdown,review,direction:options.direction,target:revisionOptions.charsPerChapter,chapterCount,chapterNumbers,minimum})).digest("hex");
  const reuse = saved && !options.restartPendingRevision && (options.resumeOperationId || saved.inputHash === inputHash);
  if (saved && !reuse && !options.restartPendingRevision) {
    throw Object.assign(new Error("A revision is already pending. Resume it by ID or explicitly replace it; changed retry wording does not discard its progress."), {
      code: "SHORT_REVISION_PENDING", recovery: recovery(saved),
    });
  }
  let resume: ShortRevisionProgress | undefined;
  if (reuse && saved.progress) {
    const plan = Value.Parse(ShortRevisionPlanSchema, saved.progress.plan);
    const checkpointDraft = ShortFictionBatchDraftSchema.parse(saved.progress.draft);
    const completed: unknown = saved.progress.completed;
    if (!Array.isArray(completed) || completed.some(number => !Number.isInteger(number) || !plan.chapters.some(chapter => chapter.number === number))) throw new Error("Invalid short revision checkpoint");
    resume = { plan, draft: checkpointDraft, completed: completed as number[] };
  }
  let checkpoint: ShortRevisionCheckpoint = {
    operationId: reuse && saved.operationId ? saved.operationId : randomUUID(), inputHash, sourceHash, review,
    request: {
      direction: revisionOptions.direction, chapterCount, charsPerChapter: revisionOptions.charsPerChapter,
      minChapterLength: minimum.minChapterLength, maxChapterLength: minimum.maxChapterLength,
      openingHookChars: minimum.openingHookChars, revisionChapterNumbers: chapterNumbers,
    },
    progress: resume,
    finalization: reuse ? saved.finalization : undefined,
  };
  await commitAtomicFileSet({ rootDir: options.projectRoot, writes: [
    ...(savedText && options.restartPendingRevision ? [textWrite(join(".inkos", "short-revisions", "archive", `${randomUUID()}.json`), savedText)] : []),
    textWrite(checkpointPath, JSON.stringify(checkpoint, null, 2)),
  ] });
  const revised = checkpoint.finalization?.result ?? await new ShortFictionWriterAgent(options.runtimes.writer).reviseDraft({
    direction:options.direction,language,chapterCount,
    charsPerChapter: revisionOptions.charsPerChapter ?? (language==="en"?SHORT_FICTION_EN_DEFAULT_WORDS_PER_CHAPTER:SHORT_FICTION_DEFAULT_CHARS_PER_CHAPTER),
    minChapterLength:minimum.minChapterLength,maxChapterLength:minimum.maxChapterLength,openingHookChars:minimum.openingHookChars,draft,chapterNumbers,
    outlineMarkdown,review,resume,
    onRevisionProgress:async(progress)=>{
      checkpoint = { ...checkpoint, progress };
      await commitAtomicFileSet({rootDir:options.projectRoot,writes:[textWrite(checkpointPath,JSON.stringify(checkpoint,null,2))]});
      options.onProgress?.(`Short revision progress: ${progress.completed.length}/${progress.plan.chapters.length} chapters`);
    },
  }).catch(error => {
    const failure = error instanceof Error ? error : new Error(String(error));
    throw Object.assign(failure, { recovery: recovery(checkpoint) });
  });
  const outlineWrite = textWrite(join(base, "outline", "v001.md"), revised.outlineMarkdown);
  checkpoint = { ...checkpoint, finalization: {
    baseline: { draft, outlineMarkdown },
    result: { draft: revised.draft, outlineMarkdown: String(outlineWrite.content) },
  } };
  await commitAtomicFileSet({rootDir:options.projectRoot,writes:[
    outlineWrite,
    textWrite(join(base,"drafts","v001","draft.json"),JSON.stringify(revised.draft,null,2)),
    textWrite(checkpointPath, JSON.stringify(checkpoint, null, 2)),
  ]});
  try {
    const result=await produceShort(revisionOptions,options.projectRoot,options.storyId,revised.draft);
    const committedDraft=ShortFictionBatchDraftSchema.parse(JSON.parse(await readFile(safeChildPath(options.projectRoot,join(base,"final","short-story.json")),"utf8")));
    const beforeChapters=new Map(draft.chapters.map(chapter=>[chapter.number,chapter]));
    const afterChapters=new Map(committedDraft.chapters.map(chapter=>[chapter.number,chapter]));
    const changedChapterNumbers=[...new Set([...beforeChapters.keys(),...afterChapters.keys()])].filter(number=>{
      const before=beforeChapters.get(number),after=afterChapters.get(number);
      return before?.title!==after?.title||before?.content!==after?.content;
    }).sort((a,b)=>a-b);
    const revisionChanges={chapterNumbers:changedChapterNumbers,
      openingChanged:(draft.openingHook??"")!==(committedDraft.openingHook??""),
      titleChanged:draft.storyTitle!==committedDraft.storyTitle,
      outlineChanged:outlineMarkdown!==await readFile(safeChildPath(options.projectRoot,join(base,"outline","v001.md")),"utf8"),
    };
    await rm(safeChildPath(options.projectRoot,checkpointPath),{force:true});
    return {...result,revisionChanges};
  }
  catch(error) {
    await syncWorkSourceArtifacts({projectRoot:options.projectRoot,workId:options.storyId,accept:false});
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { recovery: recovery(checkpoint) });
  }
}

function renderShortFictionReview(
  review: ShortFictionDraftReview,
  language: ShortFictionLanguage,
): string {
  const observations = review.observations.length > 0
    ? review.observations.flatMap((observation) => [
        `### ${observation.code}`,
        observation.summary,
        ...(observation.evidence.length > 0
          ? [
              "",
              language === "en" ? "Evidence:" : "证据：",
              ...observation.evidence.map((item) => `- ${item}`),
            ]
          : []),
        "",
      ])
    : [language === "en" ? "No evidence-backed observations." : "没有有证据的审稿观察。"];
  return [
    language === "en" ? "# Draft review" : "# 成稿审查",
    "",
    review.summary,
    "",
    language === "en" ? "## Observations" : "## 审稿观察",
    "",
    ...observations,
  ].join("\n").trim();
}

function buildShortRunResult(
  storyId: string,
  baseDir: string,
  observations: ReadonlyArray<Observation>,
  coverArtifacts: {
    readonly coverImagePath?: string;
    readonly coverError?: string;
    readonly packageError?: string;
    readonly stageResults?: ShortProductionState["stages"];
    readonly delivery?: ShortProductionState['delivery'];
  },
): ShortFictionRunResult {
  return {
    storyId,
    stageResults: coverArtifacts.stageResults,
    delivery:coverArtifacts.delivery,
    observations,
    outlinePath: projectPath(join(baseDir, "outline", "v001.md")),
    draftReviewPath: projectPath(join(baseDir, "reviews", "draft-v001.md")),
    finalMarkdownPath: projectPath(join(baseDir, "final", "full.md")),
    finalJsonPath: projectPath(join(baseDir, "final", "short-story.json")),
    salesPackagePath: projectPath(join(baseDir, "final", "sales-package.md")),
    coverPromptPath: projectPath(join(baseDir, "final", "cover-prompt.md")),
    coverImagePath: coverArtifacts.coverImagePath,
    coverError: coverArtifacts.coverError,
    packageError: coverArtifacts.packageError,
  };
}

async function projectFileExists(root: string, path: string): Promise<boolean> {
  try {
    await access(safeChildPath(root, path));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function tryReadProjectText(root: string, path: string): Promise<string | undefined> {
  try {
    return await readFile(safeChildPath(root, path), "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function tryReadShortFictionDraft(
  root: string,
  path: string,
): Promise<ShortFictionBatchDraft | undefined> {
  const raw = await tryReadProjectText(root, path);
  if (!raw) return undefined;
  return ShortFictionBatchDraftSchema.parse(JSON.parse(raw));
}

export async function generateShortFictionCover(
  options: ShortFictionCoverOptions,
): Promise<ShortFictionCoverResult> {
  options.signal?.throwIfAborted();
  const title = options.title.trim();
  if (!title) {
    throw new Error("title is required for cover generation.");
  }

  const requestedDir = options.outputDir ? projectPath(isAbsolute(options.outputDir) ? relative(options.projectRoot, options.outputDir) : options.outputDir).replace(/\/+$/u, "") : undefined;
  const canonical = requestedDir?.match(/^works\/([^/]+)(?:\/(source(?:\/final)?))?$/u);
  if (requestedDir?.startsWith("works/") && !canonical) throw Object.assign(new Error("Cover output must be a Work source or source/final directory"), {code:"COVER_OUTPUT_INVALID"});
  const requestedWorkId = canonical?.[1] ?? (requestedDir ? safeSegment(basename(requestedDir)) : undefined);
  if (options.workId && requestedWorkId && options.workId !== requestedWorkId) throw Object.assign(new Error("Cover output must target the active Work"), {code:"COVER_WORK_MISMATCH"});
  const workId = options.workId ?? requestedWorkId ?? `cover-${safeSegment(slugify(title))}`;
  if ([".",".."].includes(workId) || /[\\/]/u.test(workId)) throw Object.assign(new Error("Invalid cover Work ID"), {code:"COVER_OUTPUT_INVALID"});
  await ensureVisualWork(options.projectRoot, workId, title, options.language ?? "zh");
  const work=await loadWorkManifest(options.projectRoot,workId);
  const packageArtifact=work.artifacts.find(artifact=>artifact.revisions.some(revision=>revision.id===artifact.currentRevisionId&&revision.path==='source/final/sales-package.json'));
  let persistedPackage:ShortFictionSalesPackage|undefined;
  if(packageArtifact){
    const {bytes}=await readArtifactRevision({projectRoot:options.projectRoot,workId,artifactId:packageArtifact.id});
    const document:unknown=JSON.parse(bytes.toString('utf8'));
    if(!Value.Check(ShortPackageToolSchema,document))throw Object.assign(new Error('The current sales package is invalid'),{code:'COVER_PACKAGE_INVALID'});
    persistedPackage={...document,rawContent:''};
  }
  const sourceDir=canonical?.[2]??(persistedPackage?'source/final':'source');
  const outputDir = join("works", workId, sourceDir);
  let previousRequest: string | undefined;
  const previousPrompt = work.artifacts.find(artifact => artifact.revisions.some(revision =>
    revision.id === artifact.currentRevisionId && revision.path === `${sourceDir}/cover-prompt.md`));
  if (!persistedPackage && previousPrompt) {
    const {bytes} = await readArtifactRevision({projectRoot: options.projectRoot, workId, artifactId: previousPrompt.id});
    previousRequest = bytes.toString('utf8');
  }
  const storySources: CoverStorySource[] = [];
  const sourceMaterial = work.artifacts.find(artifact => artifact.revisions.some(revision =>
    revision.id === artifact.currentRevisionId && revision.path === 'source/source-material.md'));
  if (sourceMaterial) {
    const {bytes, revision} = await readArtifactRevision({projectRoot: options.projectRoot, workId, artifactId: sourceMaterial.id});
    storySources.push({artifactId: sourceMaterial.id, revisionId: revision.id, checksum: revision.checksum, content: bytes.toString('utf8')});
  }
  const persistedContext = persistedPackage ?? (previousRequest ? coverContextFromRequest(previousRequest, storySources) : undefined);
  const salesPackage: ShortFictionSalesPackage = {
    title,
    intro: options.intro?.trim() ?? persistedContext?.intro ?? "",
    sellingPoints: normalizeSellingPoints(options.sellingPoints ?? persistedContext?.sellingPoints),
    coverPrompt: options.coverPrompt?.trim() ?? persistedContext?.coverPrompt ?? "",
    rawContent: "",
  };
  const promptPath = join(outputDir, "cover-prompt.md");
  const authorRequest = currentExecutionAuthorRequest() ?? options.authorRequest ?? options.coverPrompt;
  const imagePrompt = buildCoverImagePrompt(salesPackage, options.language, options.includeTitle, authorRequest, storySources);
  await writeText(options.projectRoot, promptPath, imagePrompt);

  const artifact = await generateCoverImageArtifact({
    root: options.projectRoot,
    outputDir,
    includeTitle: options.includeTitle,
    salesPackage,
    authorRequest,
    storySources,
    language: options.language,
    coverBaseUrl: options.coverBaseUrl,
    coverEndpoint: options.coverEndpoint,
    coverModel: options.coverModel,
    coverSize: options.coverSize,
    coverApiKeyEnv: options.coverApiKeyEnv,
    signal: options.signal,
  });
  await syncWorkSourceArtifacts({ projectRoot: options.projectRoot, workId, accept: true,
    acceptPaths: ["cover-prompt.md", "cover-request.md", "cover.png", "cover.jpg"].map(file => projectPath(join(sourceDir, file))) });

  return {
    title,
    workId,
    outputDir: projectPath(outputDir),
    coverPromptPath: projectPath(promptPath),
    coverImagePath: artifact.coverImagePath,
  };
}

async function writeDraftArtifacts(
  root: string,
  baseDir: string,
  version: string,
  draft: ShortFictionBatchDraft,
  language: ShortFictionLanguage = "zh",
): Promise<void> {
  const draftDir = join(baseDir, "drafts", version);
  const completedChapters = draft.chapters.filter((chapter) => chapter.title.trim() && chapter.content.trim());
  await commitAtomicFileSet({
    rootDir: root,
    writes: [
      textWrite(join(draftDir, "full.md"), renderShortFictionDraftMarkdown(draft, language)),
      textWrite(join(draftDir, "draft.json"), JSON.stringify(draft, null, 2)),
      ...completedChapters.map((chapter) => textWrite(
        join(draftDir, "chapters", `${String(chapter.number).padStart(4, "0")}.md`),
        [
      `# ${formatShortFictionChapterHeading(chapter.number, chapter.title, language)}`,
      "",
      chapter.content,
        ].join("\n"),
      )),
    ],
    deletes:await obsoleteChapterFiles(root,join(draftDir,"chapters"),completedChapters),
  });
}

async function writeFinalArtifacts(
  root: string,
  baseDir: string,
  draft: ShortFictionBatchDraft,
  language: ShortFictionLanguage = "zh",
): Promise<void> {
  const finalDir = join(baseDir, "final");
  const markdown = renderShortFictionDraftMarkdown(draft, language);
  await commitAtomicFileSet({
    rootDir: root,
    writes: [
      textWrite(join(finalDir, "full.md"), markdown),
      textWrite(join(finalDir, `${safeFileName(draft.storyTitle)}.md`), markdown),
      textWrite(join(finalDir, "short-story.json"), JSON.stringify(draft, null, 2)),
      ...draft.chapters.map((chapter) => textWrite(
        join(finalDir, "chapters", `${String(chapter.number).padStart(4, "0")}.md`),
        [
          `# ${formatShortFictionChapterHeading(chapter.number, chapter.title, language)}`,
          "",
          chapter.content,
        ].join("\n"),
      )),
    ],
    deletes:await obsoleteChapterFiles(root,join(finalDir,"chapters"),draft.chapters),
  });
}

function shortManuscriptPaths(draft: ShortFictionBatchDraft): string[] {
  return ["source/outline/v001.md", "source/final/full.md", "source/final/short-story.json",
    projectPath(join("source/final", `${safeFileName(draft.storyTitle)}.md`)),
    ...draft.chapters.map(chapter => `source/final/chapters/${String(chapter.number).padStart(4, "0")}.md`),
  ];
}

async function obsoleteChapterFiles(root:string,directory:string,chapters:ReadonlyArray<{number:number}>):Promise<string[]>{
  const current=new Set(chapters.map(chapter=>`${String(chapter.number).padStart(4,"0")}.md`));
  let files:string[];
  try{files=await readdir(safeChildPath(root,directory));}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return [];throw error;}
  return files.filter(file=>/^\d+\.md$/.test(file)&&!current.has(file)).map(file=>join(directory,file));
}

async function writePackageArtifacts(
  root: string,
  baseDir: string,
  salesPackage: ShortFictionSalesPackage,
  language: ShortFictionLanguage = "zh",
): Promise<void> {
  const finalDir = join(baseDir, "final");
  const packageMarkdown = renderShortFictionSalesPackage(salesPackage, language);
  await commitAtomicFileSet({
    rootDir: root,
    writes: [
      textWrite(join(finalDir, "sales-package.json"), JSON.stringify(salesPackage, null, 2)),
      textWrite(join(finalDir, "sales-package.md"), packageMarkdown),
      textWrite(join(finalDir, "cover-prompt.md"), salesPackage.coverPrompt),
    ],
  });
}

async function generateCoverArtifact(input: {
  readonly root: string;
  readonly baseDir: string;
  readonly salesPackage: ShortFictionSalesPackage;
  readonly authorRequest?: string;
  readonly language?: ShortFictionLanguage;
  readonly coverBaseUrl?: string;
  readonly coverEndpoint?: string;
  readonly coverModel?: string;
  readonly coverSize?: string;
  readonly coverApiKeyEnv?: string;
  readonly signal?: AbortSignal;
}): Promise<{ readonly coverImagePath: string }> {
  return generateCoverImageArtifact({
    ...input,
    outputDir: join(input.baseDir, "final"),
  });
}

async function generateCoverImageArtifact(input: {
  readonly root: string;
  readonly outputDir: string;
  readonly includeTitle?: boolean;
  readonly salesPackage: ShortFictionSalesPackage;
  readonly authorRequest?: string;
  readonly storySources?: readonly CoverStorySource[];
  readonly language?: ShortFictionLanguage;
  readonly coverBaseUrl?: string;
  readonly coverEndpoint?: string;
  readonly coverModel?: string;
  readonly coverSize?: string;
  readonly coverApiKeyEnv?: string;
  readonly signal?: AbortSignal;
}): Promise<{ readonly coverImagePath: string }> {
  const request = await resolveCoverGenerationRequest({
    root: input.root,
    coverBaseUrl: input.coverBaseUrl,
    coverEndpoint: input.coverEndpoint,
    coverModel: input.coverModel,
    coverApiKeyEnv: input.coverApiKeyEnv,
  });
  const size = input.coverSize || process.env.INKOS_COVER_SIZE || "1024x1360";
  const available = await loadAvailableAgentSkills({ projectRoot: input.root });
  const skills = new Map(available.skills.map(skill => [skill.id, skill]));
  const skillIds = input.outputDir.endsWith("final") ? ["inkos-story-cover", "inkos-short-writing"] : ["inkos-story-cover"];
  const activations = skillIds.map(id => {
    const skill = skills.get(id);
    if (!skill) throw new Error(`Required cover Skill unavailable: ${id}`);
    return { skill, resources: [] };
  });
  const prompt = appendActivatedSkillGuidance([{ role: "user", content: buildCoverImagePrompt(input.salesPackage, input.language, input.includeTitle, input.authorRequest, input.storySources) }],
    await hydrateActivatedSkillGuidance(activations, JSON.stringify(input.salesPackage)))
    .map(message => message.content).join("\n\n");
  await writeText(input.root, join(input.outputDir, "cover-request.md"), prompt);
  const reference = await loadImageReference(input.root, join(input.outputDir, "cover.png"))
    ?? await loadImageReference(input.root, join(input.outputDir, "cover.jpg"));
  const { buffer, extension } = await generateImageFromPrompt(
    request,
    prompt,
    size,
    input.signal,
    reference,
  );
  const coverPath = join(input.outputDir, extension === "jpg" ? "cover.jpg" : "cover.png");
  await writeBinary(input.root, coverPath, buffer);
  return { coverImagePath: projectPath(coverPath) };
}

/**
 * Generate one image from a free-text prompt via whichever image API the cover
 * config resolves to (gemini / images / responses). Shared by cover generation
 * and the interactive-world (Play) illustration feature so both go through the
 * same provider plumbing.
 */
export interface ImageReference {
  readonly buffer: Buffer;
  readonly mimeType: "image/png" | "image/jpeg";
}

/** Only saved image bytes inside this project may become a provider reference. */
export async function loadImageReference(root: string, path: string): Promise<ImageReference | undefined> {
  const canonicalRoot = await realpath(root);
  let canonicalPath: string;
  try { canonicalPath = await realpath(safeChildPath(root, path)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  const child = relative(canonicalRoot, canonicalPath);
  if (child === ".." || child.startsWith("../") || isAbsolute(child)) throw Object.assign(new Error("Image reference must remain inside the project."), {code:"IMAGE_REFERENCE_OUTSIDE_PROJECT"});
  const buffer = await readFile(canonicalPath);
  const mimeType = buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png"
    : buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 ? "image/jpeg" : undefined;
  if (!mimeType) throw Object.assign(new Error("The image reference is not a PNG or JPEG."), {code:"IMAGE_REFERENCE_INVALID"});
  return {buffer, mimeType};
}

export async function generateImageFromPrompt(
  request: ShortFictionCoverRequest,
  prompt: string,
  size: string,
  signal?: AbortSignal,
  reference?: ImageReference,
): Promise<{ readonly buffer: Buffer; readonly extension: "png" | "jpg" }> {
  const trace = beginAgentModelCall();
  recordExecutionEvidence("model-call-started", { trace, model: request.model, modality: "image", prompt, size,
    ...(reference ? {reference:{mimeType:reference.mimeType,byteLength:reference.buffer.length,checksum:`sha256:${createHash("sha256").update(reference.buffer).digest("hex")}`}} : {}),
  });
  try {
    const image = await generateImageFromPromptImpl({ ...request, trace }, prompt, size, signal, reference);
    recordExecutionEvidence("model-call-completed", { modelCallId: trace?.modelCallId, status: "done", modality: "image", byteLength: image.buffer.length, checksum: `sha256:${createHash("sha256").update(image.buffer).digest("hex")}` });
    return image;
  } catch (error) {
    recordExecutionEvidence("model-call-completed", { modelCallId: trace?.modelCallId, status: "error", modality: "image", error: String(error) });
    throw error;
  }
}

async function generateImageFromPromptImpl(request: ShortFictionCoverRequest, prompt: string, size: string, signal?: AbortSignal, reference?: ImageReference): Promise<{ readonly buffer: Buffer; readonly extension: "png" | "jpg" }> {
  if (request.api === "gemini") {
    const payload = await generateGeminiCover(request, prompt, signal, reference);
    return { buffer: Buffer.from(payload.base64, "base64"), extension: payload.extension };
  }
  if (request.api === "images") {
    return generateImagesCover(request, prompt, size, signal, reference);
  }

  const endpoint = request.endpoint ?? `${request.baseUrl.replace(/\/+$/u, "")}/responses`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${request.apiKey}`,
      ...agentTrajectoryHeaders(request.endpoint ?? request.baseUrl, request.trace, 1, { effort: "disabled" }),
    },
    body: JSON.stringify({
      model: request.model,
      input: reference ? [{role:"user",content:[{type:"input_text",text:prompt},{type:"input_image",image_url:`data:${reference.mimeType};base64,${reference.buffer.toString("base64")}`}]}] : prompt,
      tools: [{ type: "image_generation", size }],
    }),
    signal,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`image generation failed: HTTP ${response.status} ${text}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error(`image generation returned non-JSON response: ${String(error)}`);
  }

  const imageBase64 = extractResponsesImageBase64(payload);
  if (!imageBase64) {
    throw new Error("image generation response did not include image_generation_call result.");
  }
  return { buffer: Buffer.from(imageBase64, "base64"), extension: "png" };
}

export interface ShortFictionCoverRequest {
  readonly api: CoverProviderPreset["api"];
  readonly trace?: AgentModelCallTrace;
  readonly baseUrl: string;
  readonly endpoint?: string;
  readonly model: string;
  readonly apiKey: string;
}

export async function resolveCoverGenerationRequest(input: {
  readonly root: string;
  readonly coverBaseUrl?: string;
  readonly coverEndpoint?: string;
  readonly coverModel?: string;
  readonly coverApiKeyEnv?: string;
}): Promise<ShortFictionCoverRequest> {
  if (input.coverEndpoint || input.coverBaseUrl || process.env.INKOS_COVER_ENDPOINT || process.env.INKOS_COVER_BASE_URL) {
    const endpoint = resolveCoverEndpoint(input.coverEndpoint, input.coverBaseUrl);
    const baseUrl = input.coverBaseUrl || process.env.INKOS_COVER_BASE_URL || endpoint
      .replace(/\/responses\/?$/u, "")
      .replace(/\/images\/generations\/?$/u, "");
    const requestedModel = input.coverModel || process.env.INKOS_COVER_MODEL;
    const preset = ["kkaiapi", "openai", "google"].map(resolveCoverProviderPreset)
      .find(provider => provider && normalizeCoverBaseUrl(baseUrl) === provider.baseUrl);
    return {
      api: endpoint.includes("/responses") ? "responses" : "images",
      baseUrl,
      endpoint,
      model: preset ? normalizeCoverModelReference(requestedModel, preset) : requestedModel || "gpt-image-2",
      apiKey: resolveCoverApiKey(input.coverApiKeyEnv || "INKOS_COVER_API_KEY"),
    };
  }

  const projectCover = await readProjectCoverConfig(input.root);
  if (!projectCover) {
    throw new Error("cover endpoint is required. Configure cover generation in Studio or set INKOS_COVER_BASE_URL.");
  }

  const preset = resolveCoverProviderPreset(projectCover.service);
  if (!preset) {
    throw new Error(`Unsupported cover service: ${projectCover.service}`);
  }
  const apiKey = await resolveProjectCoverApiKey(input.root, projectCover.service);
  if (!apiKey) {
    throw new Error(`Cover API key is required. Configure a cover key for ${preset.label}.`);
  }

  return {
    api: preset.api,
    baseUrl: projectCover.baseUrl || preset.baseUrl,
    model: normalizeCoverModelReference(input.coverModel, preset, projectCover.model),
    apiKey,
  };
}

async function readProjectCoverConfig(root: string): Promise<{
  readonly service: string;
  readonly model?: string;
  readonly baseUrl?: string;
} | undefined> {
  const parsed = ProjectConfigSchema.parse(JSON.parse(await readFile(join(root, "inkos.json"), "utf-8")));
  const cover = parsed.llm.cover;
  if (!cover) return undefined;
  const baseUrl = normalizeCoverBaseUrl(cover.baseUrl);
  return {
    service: cover.service,
    model: cover.model,
    ...(baseUrl ? { baseUrl } : {}),
  };
}

async function resolveProjectCoverApiKey(root: string, service: string): Promise<string> {
  const secrets = await loadSecrets(root);
  return secrets.services[coverSecretKey(service)]?.apiKey
    || secrets.services[service]?.apiKey
    || process.env[`${service.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_API_KEY`]
    || "";
}

async function generateImagesCover(
  request: ShortFictionCoverRequest,
  prompt: string,
  size: string,
  signal?: AbortSignal,
  reference?: ImageReference,
): Promise<{ readonly buffer: Buffer; readonly extension: "png" | "jpg" }> {
  const generationEndpoint = request.endpoint ?? `${request.baseUrl.replace(/\/+$/u, "")}/images/generations`;
  const endpoint = reference ? generationEndpoint.replace(/\/images\/(?:generations|edits)\/?$/u, "/images/edits") : generationEndpoint;
  if (reference && !endpoint.endsWith("/images/edits")) throw Object.assign(new Error("The configured image endpoint has no compatible image-edit route."), {code:"IMAGE_EDIT_ENDPOINT_REQUIRED"});
  const form = reference ? new FormData() : undefined;
  if (form && reference) {
    form.set("model", request.model); form.set("prompt", prompt); form.set("n", "1"); form.set("size", size);
    form.set("image", new Blob([new Uint8Array(reference.buffer)], {type:reference.mimeType}), reference.mimeType === "image/png" ? "reference.png" : "reference.jpg");
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...(form ? {} : {"Content-Type": "application/json"}),
      Authorization: `Bearer ${request.apiKey}`,
      ...agentTrajectoryHeaders(request.endpoint ?? request.baseUrl, request.trace, 1, { effort: "disabled" }),
    },
    body: form ?? JSON.stringify({
      model: request.model,
      prompt,
      n: 1,
      size,
    }),
    signal,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`cover generation failed: HTTP ${response.status} ${text}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error(`cover generation returned non-JSON response: ${String(error)}`);
  }

  const image = extractImagesGenerationImage(payload);
  recordExecutionEvidence('image-http-response',{
    modelCallId:request.trace?.modelCallId,status:response.status,requestId:response.headers.get('x-request-id'),
    responseBytes:Buffer.byteLength(text),responseHash:createHash('sha256').update(text).digest('hex'),
    payloadKeys:payload&&typeof payload==='object'?Object.keys(payload):[],imagePresent:!!image,
  });
  if (image?.base64) {
    return {
      buffer: Buffer.from(image.base64, "base64"),
      extension: image.extension,
    };
  }
  if (image?.url) {
    return downloadGeneratedCoverImage(image.url, request.apiKey, request.endpoint ?? request.baseUrl, signal);
  }
  throw new Error("cover generation response did not include image URL or base64 data.");
}

export function extractImagesGenerationImage(payload: unknown): (
  | { readonly base64: string; readonly extension: "png" | "jpg"; readonly url?: undefined }
  | { readonly url: string; readonly base64?: undefined; readonly extension?: undefined }
) | undefined {
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return undefined;

  for (const item of data) {
    const record = item as { b64_json?: unknown; url?: unknown };
    if (typeof record.b64_json === "string" && record.b64_json.trim()) {
      return { base64: record.b64_json.trim(), extension: "png" };
    }
    if (typeof record.url === "string" && record.url.trim()) {
      return { url: record.url.trim() };
    }
  }

  return undefined;
}

async function downloadGeneratedCoverImage(
  url: string,
  apiKey: string,
  providerUrl: string,
  signal?: AbortSignal,
): Promise<{ readonly buffer: Buffer; readonly extension: "png" | "jpg" }> {
  const response = await fetch(url, { signal });
  const providerOrigin = new URL(providerUrl).origin;
  const trusted = new URL(url).origin === providerOrigin
    && (!response.url || new URL(response.url).origin === providerOrigin);
  const fallbackResponse = trusted && (response.status === 401 || response.status === 403)
    ? await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` }, redirect: "error", signal })
    : response;
  if (!fallbackResponse.ok) {
    const text = await fallbackResponse.text();
    throw Object.assign(new Error(`cover image download failed: HTTP ${fallbackResponse.status} ${text}`), {code:"IMAGE_DOWNLOAD_FAILED", status:fallbackResponse.status});
  }
  const contentType = fallbackResponse.headers.get("content-type") ?? "";
  const buffer = Buffer.from(await fallbackResponse.arrayBuffer());
  return {
    buffer,
    extension: coverImageExtension(contentType, url),
  };
}

function coverImageExtension(contentType: string, url: string): "png" | "jpg" {
  const normalized = `${contentType} ${url}`.toLowerCase();
  return normalized.includes("jpeg") || normalized.includes(".jpg") || normalized.includes(".jpeg") ? "jpg" : "png";
}

async function generateGeminiCover(
  request: ShortFictionCoverRequest,
  prompt: string,
  signal?: AbortSignal,
  reference?: ImageReference,
): Promise<{ readonly base64: string; readonly extension: "png" | "jpg" }> {
  const endpoint = `${request.baseUrl.replace(/\/+$/u, "")}/models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(request.apiKey)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }, ...(reference ? [{inlineData:{mimeType:reference.mimeType,data:reference.buffer.toString("base64")}}] : [])] }],
      generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
    }),
    signal,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`cover generation failed: HTTP ${response.status} ${text}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error(`cover generation returned non-JSON response: ${String(error)}`);
  }

  const image = extractGeminiImageBase64(payload);
  if (!image) {
    throw new Error("cover generation response did not include Gemini inline image data.");
  }
  return image;
}

export function extractResponsesImageBase64(payload: unknown): string | undefined {
  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) return undefined;

  for (const item of output) {
    const record = item as { type?: unknown; result?: unknown; content?: unknown };
    if (record.type === "image_generation_call" && typeof record.result === "string" && record.result.trim()) {
      return record.result.trim();
    }
    if (Array.isArray(record.content)) {
      for (const contentItem of record.content) {
        const contentRecord = contentItem as { result?: unknown; image_base64?: unknown };
        if (typeof contentRecord.result === "string" && contentRecord.result.trim()) return contentRecord.result.trim();
        if (typeof contentRecord.image_base64 === "string" && contentRecord.image_base64.trim()) return contentRecord.image_base64.trim();
      }
    }
  }

  return undefined;
}

export function extractGeminiImageBase64(payload: unknown): { readonly base64: string; readonly extension: "png" | "jpg" } | undefined {
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return undefined;

  for (const candidate of candidates) {
    const parts = (candidate as { content?: { parts?: unknown } }).content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const inlineData = (part as { inlineData?: unknown; inline_data?: unknown }).inlineData
        ?? (part as { inlineData?: unknown; inline_data?: unknown }).inline_data;
      const record = inlineData as { data?: unknown; mimeType?: unknown; mime_type?: unknown } | undefined;
      if (typeof record?.data !== "string" || !record.data.trim()) continue;
      const mimeType = String(record.mimeType ?? record.mime_type ?? "image/png").toLowerCase();
      return {
        base64: record.data.trim(),
        extension: mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png",
      };
    }
  }

  return undefined;
}

export function resolveCoverApiKey(apiKeyEnv: string): string {
  const apiKey = process.env[apiKeyEnv];
  if (!apiKey) {
    throw new Error(`Cover API key is required. Set ${apiKeyEnv} or pass coverApiKeyEnv.`);
  }
  return apiKey;
}

function resolveCoverEndpoint(coverEndpoint?: string, coverBaseUrl?: string): string {
  const endpoint = coverEndpoint || process.env.INKOS_COVER_ENDPOINT;
  if (endpoint) return endpoint;
  const baseUrl = coverBaseUrl || process.env.INKOS_COVER_BASE_URL;
  if (!baseUrl) {
    throw new Error("cover endpoint is required. Set INKOS_COVER_BASE_URL or disable cover generation.");
  }
  return `${baseUrl.replace(/\/+$/u, "")}/images/generations`;
}

function buildCoverImagePrompt(
  salesPackage: ShortFictionSalesPackage,
  language: ShortFictionLanguage = "zh",
  includeTitle = true,
  authorRequest?: string,
  storySources: readonly CoverStorySource[] = [],
): string {
  const request = {
    version: 1,
    authorRequest: authorRequest?.trim() || null,
    printedTitle: includeTitle ? salesPackage.title : null,
    visualBrief: salesPackage.coverPrompt,
    storyReference: { title: salesPackage.title, synopsis: salesPackage.intro, sellingPoints: salesPackage.sellingPoints,
      ...(storySources.length ? {sources: storySources} : {}) },
  };
  return [
    `## Cover request\n\n\`\`\`json\n${JSON.stringify(request, null, 2)}\n\`\`\``,
    language === "en"
      ? "Render printedTitle exactly and legibly when present; null means no main title. Do not defer the requested lettering to a later step. authorRequest is the actual request, not copy to print. Any additional lettering must be explicitly requested there. visualBrief proposes the imagery; it cannot authorize extra text. storyReference supplies story context only: do not print its synopsis, selling points, evaluations or labels on the image."
      : "printedTitle 非空时，将其原样、清晰地排入本张图；为空时不呈现主标题，不把已要求的排字推迟到后续步骤。authorRequest 是作者实际要求，本身不是要印出的文案；其他文字只有在其中明确要求印出时才可添加。visualBrief 是画面方案，不能自行授权额外文字。storyReference 只提供故事背景，不能把其中的简介、卖点、评价或字段标签排到图上。",
  ].join("\n\n");
}

function normalizeSellingPoints(value: ReadonlyArray<string> | undefined): ReadonlyArray<string> {
  return (value ?? []).map((point) => point.trim()).filter(Boolean);
}

async function writeBinary(root: string, path: string, value: Buffer): Promise<void> {
  const resolved = safeChildPath(root, path);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, value);
}

function textWrite(relativePath: string, value: string): AtomicFileWrite {
  return {
    relativePath,
    content: `${value.trimEnd()}\n`,
  };
}

async function writeText(root: string, path: string, value: string): Promise<void> {
  const resolved = safeChildPath(root, path);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${value.trimEnd()}\n`, "utf-8");
}

function shortWorkBaseDir(storyId: string): string {
  return join("works", safeSegment(storyId), "source");
}

async function ensureShortWork(
  root: string,
  storyId: string,
  title: string,
  language: ShortFictionLanguage,
): Promise<void> {
  try {
    await loadWorkManifest(root, storyId);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await saveWorkManifest(root, createWorkManifest({
    id: storyId,
    title,
    profileId: "short-fiction",
    language,
  }));
}

async function ensureVisualWork(
  root: string,
  workId: string,
  title: string,
  language: ShortFictionLanguage,
): Promise<void> {
  try {
    const existing = await loadWorkManifest(root, workId);
    if (!createBuiltInWorkProfileRegistry(root).require(existing.profileId).capabilityIds.includes("visual")) {
      throw new Error(`Work "${workId}" already uses profile "${existing.profileId}".`);
    }
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await saveWorkManifest(root, createWorkManifest({
    id: workId,
    title,
    profileId: "visual-asset",
    language,
  }));
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const parsed = value ?? fallback;
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || `short-${Date.now()}`;
}

function safeSegment(value: string): string {
  const cleaned = value
    .replace(/[\\/:\0*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!cleaned || cleaned === "." || cleaned === "..") return `short-${Date.now()}`;
  return cleaned;
}

function safeFileName(value: string): string {
  const cleaned = value
    .replace(/[\\/:\0*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "short-fiction";
}
