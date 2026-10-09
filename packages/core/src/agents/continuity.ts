import { BaseAgent } from "./base.js";
import type { ContextPackage } from "../models/input-governance.js";
import { renderNarrativeSelectedContext } from "../utils/narrative-control.js";
import { numberReviewSource, type Observation } from "../models/observation.js";
import {loadWorkManifest} from '../harness/work-store.js';
import {readArtifactRevision} from '../harness/artifact-reader.js';
import {currentExecutionBaselineWork} from '../harness/execution-evidence.js';
import {chapterDocumentBody} from '../utils/chapter-document.js';
import {changedSourceRegion} from '../utils/source-text.js';
import {chapterReviewContentHash} from '../utils/chapter-review-hash.js';

export interface AuditResult {
  readonly observations: ReadonlyArray<Observation>;
  readonly summary: string;
  readonly unavailable?: boolean;
  readonly reviewedContentHash?: string;
  readonly reviewedArtifact?: {workId:string;artifactId:string;revisionId:string};
  readonly tokenUsage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

export class ContinuityAuditor extends BaseAgent {
  get name(): string {
    return "continuity-auditor";
  }

  async auditChapter(
    _bookDir: string,
    chapterContent: string,
    chapterNumber: number,
    _genre: string | undefined,
    options: {
      readonly language: "zh" | "en";
      readonly contextPackage: ContextPackage;
      readonly temperature?: number;
    },
  ): Promise<AuditResult> {
    const isEnglish = options.language === "en";
    const systemPrompt = isEnglish
      ? "Audit this chapter against the activated review Skill and supplied governed context. Identify each observation with a code, assessment and exact numbered source lines. Do not estimate length; the host computes it. Return a concise overall summary. An empty observations array is valid."
      : "按已激活的审稿 Skill 和权威上下文审查本章。为每条观察提交代码、判断以及所给编号原文中的确切证据行。不估算字数，字数由宿主计算。提交简短总结，observations 为空是合法结果。";
    const governedContext = renderNarrativeSelectedContext(
      options.contextPackage.selectedContext,
      options.language,
    );
    const sources = new Map([["governed-context", governedContext], [`chapter-${chapterNumber}`, chapterContent]]);
    const primarySourceId=`chapter-${chapterNumber}`;
    let reviewedArtifact:AuditResult['reviewedArtifact'];
    let comparison:{scope:'episode_start'|'parent_revision';sourceId:string;before:{revisionId:string;checksum:string};after:{revisionId:string;checksum:string};changedRegion:ReturnType<typeof changedSourceRegion>}|undefined;
    if(this.ctx.bookId){
      let work;
      try{work=await loadWorkManifest(this.ctx.projectRoot,this.ctx.bookId);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      const prefix=`source/chapters/${String(chapterNumber).padStart(4,'0')}_`;
      const artifact=work?.artifacts.find(a=>a.revisions.some(r=>r.id===a.currentRevisionId&&r.path.startsWith(prefix)&&r.path.endsWith('.md')));
      if(work&&artifact?.currentRevisionId){
        const current=await readArtifactRevision({projectRoot:this.ctx.projectRoot,workId:work.id,artifactId:artifact.id,revisionId:artifact.currentRevisionId});
        const body=(text:string)=>chapterDocumentBody(text,chapterNumber,'',options.language);
        // A draft audit must not claim the identity of a different persisted revision.
        if(body(current.bytes.toString('utf8'))===chapterContent){
          reviewedArtifact={workId:work.id,artifactId:artifact.id,revisionId:current.revision.id};
          const baseline=currentExecutionBaselineWork();
          const beforeId=baseline===undefined?current.revision.parentRevisionId:baseline?.id===work.id?baseline.artifacts.find(a=>a.id===artifact.id)?.currentRevisionId:undefined;
          if(beforeId){
            const before=await readArtifactRevision({projectRoot:this.ctx.projectRoot,workId:work.id,artifactId:artifact.id,revisionId:beforeId});
            const beforeText=body(before.bytes.toString('utf8'));
            const sourceId=beforeId===current.revision.id?primarySourceId:`${primarySourceId}@${beforeId}`;
            if(sourceId!==primarySourceId)sources.set(sourceId,beforeText);
            comparison={scope:baseline===undefined?'parent_revision':'episode_start',sourceId,before:{revisionId:beforeId,checksum:before.revision.checksum},after:{revisionId:current.revision.id,checksum:current.revision.checksum},changedRegion:changedSourceRegion(beforeText,chapterContent)};
          }
        }
      }
    }
    const userPrompt = JSON.stringify({ chapterNumber,comparison, sources: [...sources].map(([sourceId, content]) => ({ sourceId, numberedLines: numberReviewSource(content) })) });

    const { result, usage } = await this.submitSourcedReview(
      [
        { role: "system", content: systemPrompt },
        ...(comparison?[{role:'system' as const,content:'Separately check the actual before/current changes against the author-authorized revision region. Classify verified changes outside that region as scope and cite both versions. Classify ordinary content findings as quality and tool/external-operation claims as execution. Missing comparison evidence is unavailable, not a scope violation. A narrow edit request does not narrow a separately requested whole-chapter review.'}]:[]),
        { role: "user", content: userPrompt },
      ],
      sources, {
        name: "submit_chapter_review",
        label: isEnglish ? "Submit chapter review" : "提交章节审稿",
        description: isEnglish
          ? "Submit evidence-backed observations only."
          : "只提交有证据的审稿观察。",
      },
      { temperature: options.temperature, maxTokens: Math.min(4096, this.ctx.client.defaults.maxTokens),categoryRequired:!!comparison,
        validateObservations:observations=>{
          for(const observation of observations.filter(item=>item.category==='scope'&&item.assessment==='issue')){
            const ids=new Set(observation.sourceRefs.map(ref=>ref.sourceId));
            if(!comparison||comparison.before.revisionId===comparison.after.revisionId||!ids.has(comparison.sourceId)||!ids.has(primarySourceId))throw Object.assign(new Error('A scope violation requires distinct verified before/current sources and citations to both.'),{code:'REVIEW_SCOPE_EVIDENCE_REQUIRED'});
          }
        },
      },
    );
    return {
      observations: result.observations,
      summary: result.summary,
      tokenUsage: usage,
      reviewedContentHash: chapterReviewContentHash(chapterContent,chapterNumber),
      ...(reviewedArtifact?{reviewedArtifact}:{}),
    };
  }
}
