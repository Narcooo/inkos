import { BaseAgent } from "./base.js";
import { StateValidationToolSchema, StateProjectionReviewToolSchema } from "./state-validation-tool.js";
import type { Observation } from "../models/observation.js";
import { numberReviewSource, resolveObservationSources } from '../models/observation.js';
import type { RuntimeStateSnapshot } from '../state/state-reducer.js';

export interface ValidationResult {
  readonly observations: ReadonlyArray<Observation>;
  readonly consistent: boolean;
  readonly reconciliationRequired: boolean;
}

export interface StateValidationAuthorityContext {
  readonly storyFrame?: string;
  readonly bookRules?: string;
  readonly chapterSummaries?: string;
  readonly projection?: {
    readonly previous: Pick<RuntimeStateSnapshot,'currentState'|'hooks'>;
    readonly proposed: Pick<RuntimeStateSnapshot,'currentState'|'hooks'>;
  };
}

export function withStateProjectionContext(
  authority: StateValidationAuthorityContext | undefined,
  previous?: RuntimeStateSnapshot,
  proposed?: RuntimeStateSnapshot,
): StateValidationAuthorityContext | undefined {
  return previous && proposed ? {...authority,projection:{previous,proposed}} : authority;
}

/**
 * Validates Settler output by comparing old and new truth files via LLM.
 * Catches contradictions, missing state changes, and temporal inconsistencies.
 *
 * The model submits a typed reconciliation decision; prose has no authority.
 */
export class StateValidatorAgent extends BaseAgent {
  get name(): string {
    return "state-validator";
  }

  async validate(
    chapterContent: string,
    chapterNumber: number,
    oldState: string,
    newState: string,
    oldHooks: string,
    newHooks: string,
    language: "zh" | "en" = "zh",
    authorityContext?: StateValidationAuthorityContext,
  ): Promise<ValidationResult> {
    // An unchanged projection may have omitted a state change in this chapter.
    // Equality with the baseline is not evidence of factual correctness.
    if (authorityContext?.projection) return this.validateProjection(chapterContent,language,authorityContext);
    const langInstruction = language === "en"
      ? "Respond in English."
      : "用中文回答。";

    const systemPrompt = `Validate only whether the proposed state card and hooks accurately represent the current chapter and supplied factual authority. ${langInstruction}
Treat the chapter as source evidence to represent, not prose to improve. Do not judge its dramatic impact, pacing, ending, completeness of scenes, or fulfillment of a writing request. Writing standards and future outline milestones do not require an event to have happened now. Distinguish planned, started and completed actions exactly as the source does.
Do not rewrite the chapter or silently resolve contradictory sources. A hook marked superseded retains an explicitly withdrawn plan for history; its original premise is not active canon or a future promise. Verify its notes against the current withdrawal authority, rather than requiring that premise to occur in the chapter. Set reconciliationRequired=true only when changing a named state or hook entry can resolve an evidenced projection mismatch. A factual contradiction between source authorities remains an observation and does not authorize another settlement pass. Submit the Boolean decision and a concise report identifying the affected state/hook entry, its current value, the source evidence and any required correction. Use an empty report when the projection is accurate.`;

    const authorityBlock = this.buildAuthorityContextBlock(authorityContext);

    const userPrompt = `Chapter ${chapterNumber} validation:

${authorityBlock}

## Previous State Card
${oldState}

## Proposed State Card
${newState}

## Previous Hooks
${oldHooks}

## Proposed Hooks
${newHooks}

## Chapter Text (for reference)
${chapterContent}`;

    try {
      const { result } = await this.submitStructured(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        {
          name: "submit_state_validation",
          label: language === "en" ? "Submit state validation" : "提交状态对账",
          description: "Submit whether state reconciliation is required and the concrete evidence.",
          parameters: StateValidationToolSchema,
          validate: result => {
            if(result.reconciliationRequired && !result.reportMarkdown.trim()) throw Object.assign(new Error(JSON.stringify({code:"STATE_RECONCILIATION_REASON_REQUIRED",instruction:"Explain the projection mismatch that requires recalculation."})),{code:"STATE_RECONCILIATION_REASON_REQUIRED"});
            return result;
          },
        },
        {maxTokens: Math.min(8192, this.ctx.client.defaults.maxTokens),professionalGuidance:false},
      );
      return {
        observations: result.reportMarkdown.trim() ? [{code:result.reconciliationRequired ? "state-reconciliation" : "state-projection-review",category:'execution',assessment:result.reconciliationRequired?'issue':'observation',summary:result.reportMarkdown.trim(),evidence:[]}] : [],
        consistent: !result.reconciliationRequired,
        reconciliationRequired: result.reconciliationRequired,
      };
    } catch (error) {
      this.log?.warn(`State reconciliation review unavailable: ${error}`);
      throw error;
    }
  }

  private async validateProjection(chapterContent:string,language:'zh'|'en',authority:StateValidationAuthorityContext):Promise<ValidationResult> {
    const {previous,proposed}=authority.projection!;
    const targets=[
      ...proposed.currentState.facts.map((after,index)=>({
        id:`fact-${index}`,kind:'state',
        active:after.validUntilChapter===null||after.validUntilChapter>=proposed.currentState.chapter,
        before:previous.currentState.facts.find(fact=>fact.subject===after.subject&&fact.predicate===after.predicate&&fact.validFromChapter===after.validFromChapter),
        after,
      })),
      ...proposed.hooks.hooks.map((after,index)=>({id:`hook-${index}`,kind:'hook',
        before:previous.hooks.hooks.find(hook=>hook.hookId===after.hookId),after,
      })),
    ];
    // State projection represents the prose that exists. Planning documents
    // remain inputs to content review, not requirements to alter its projection.
    const sources=new Map([['chapter',chapterContent]]);
    const resolve=(result:{corrections:Array<{targetId:string;reason:string;sourceRefs:Array<{sourceId:string;startLine:number;endLine:number}>}>})=>
      result.corrections.map(correction=>{
        const target=targets.find(item=>item.id===correction.targetId);
        if(!target&&!['missing-state-fact','missing-hook'].includes(correction.targetId)){
          const details={code:'STATE_CORRECTION_TARGET_INVALID',targetId:correction.targetId,
            validTargetIds:[...targets.map(item=>item.id),'missing-state-fact','missing-hook'],
            instruction:'Use an exact proposed record ID, or a missing-entry ID for an addition.'};
          throw Object.assign(new Error(JSON.stringify(details)),details);
        }
        const observation=resolveObservationSources([{
          code:`state-reconciliation:${correction.targetId}`,category:'execution' as const,assessment:'issue' as const,
          summary:correction.reason,
          evidence:[],sourceRefs:correction.sourceRefs,
        }],sources)[0]!;
        return {...observation,sourceRefs:[
          {sourceId:`projection:${correction.targetId}`,quote:JSON.stringify(target??{id:correction.targetId})},
          ...observation.sourceRefs,
        ]};
      });
    const {result}=await this.submitStructured([
      {role:'system',content:`Validate the proposed factual projection, not story craft. Each target has an exact proposed record (after) and its corresponding baseline (before), if any. Historical state facts remain stored with validUntilChapter; their absence from the active-state display does not mean they were deleted. Baseline facts are established context and do not need to be repeated in this chapter. Check the proposed records against this chapter, including any updates it requires but the proposal omitted. A correction must name the actual affected proposed record and cite source evidence. Compatible paraphrases, internal identifier naming and desired future plot events do not require correction. Do not assume an intention has already happened or been communicated. If earlier source text is unavailable, do not claim it lacks an established fact. Source contradictions or uncertainty that cannot be repaired in the projection go in observations. Return no corrections when all proposed facts are accurate. ${language==='en'?'Respond in English.':'用中文回答。'}`},
      {role:'user',content:JSON.stringify({chapter:proposed.currentState.chapter,targets,
        sources:[...sources].map(([sourceId,text])=>({sourceId,numberedLines:numberReviewSource(text)})),
      })},
    ],{name:'submit_state_validation',label:'Validate proposed records',description:'Identify necessary factual corrections to exact proposed records.',
      parameters:StateProjectionReviewToolSchema,validate:result=>{resolve(result);return result;},
    },{maxTokens:Math.min(8192,this.ctx.client.defaults.maxTokens),professionalGuidance:false});
    const corrections=resolve(result);
    const observations:Observation[]=[...corrections,...(result.observations.trim()?[{
      code:'state-projection-review',category:'execution' as const,assessment:'observation' as const,summary:result.observations,evidence:[],
    }]:[])];
    return {observations,consistent:corrections.length===0,reconciliationRequired:corrections.length>0};
  }

  private buildAuthorityContextBlock(authorityContext?: StateValidationAuthorityContext): string {
    if (!authorityContext) return "## Authority / Cross-Truth Context\n(no authority context provided)";

    const storyFrame = (authorityContext.storyFrame ?? "").trim();
    const bookRules = (authorityContext.bookRules ?? "").trim();
    const chapterSummaries = (authorityContext.chapterSummaries ?? "").trim();

    return [
      "## Authority / Cross-Truth Context",
      "Contradictory authority must be reported for reconciliation rather than silently reordered.",
      "",
      "### story_frame",
      storyFrame || "(empty)",
      "",
      "### book_rules excerpt",
      bookRules || "(empty)",
      "",
      "### chapter_summaries",
      chapterSummaries || "(empty)",
    ].join("\n");
  }

}
