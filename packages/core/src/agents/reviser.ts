import {authorTextScopeRequest,authorTextScopeContract} from './author-edit-scope.js';
import {currentExecutionAuthorRequest,currentExecutionBaselineWork,currentExecutionWork} from '../harness/execution-evidence.js';
import { BaseAgent } from "./base.js";
import type { LengthSpec } from "../models/length-governance.js";
import type { Observation } from "../models/observation.js";
import type { ContextPackage } from "../models/input-governance.js";
import { countChapterLength, assertChapterLength } from "../utils/length-metrics.js";
import { Type } from '@sinclair/typebox';
import { numberReviewSource } from '../models/observation.js';
import {textRangeEditContract,textSelectionEditContract,TextEditRangeSchema} from '../utils/text-range-edits.js';
import { ChapterRewriteToolSchema } from "./reviser-tool.js";
import {chapterDocumentBody} from '../utils/chapter-document.js';
import { renderNarrativeSelectedContext } from "../utils/narrative-control.js";

export type ReviseMode = "polish" | "rewrite" | "rework" | "anti-detect" | "spot-fix";

export const DEFAULT_REVISE_MODE: ReviseMode = "rewrite";

export interface ReviseOutput {
  readonly revisedContent: string;
  readonly wordCount: number;
  readonly tokenUsage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

export class ReviserAgent extends BaseAgent {
  get name(): string {
    return "reviser";
  }

  async reviseChapter(
    _bookDir: string,
    chapterContent: string,
    chapterNumber: number,
    observations: ReadonlyArray<Observation>,
    mode: ReviseMode = DEFAULT_REVISE_MODE,
    _genre?: string,
    options?: {
      readonly language: "zh" | "en";
      readonly chapterTitle?:string;
      readonly targetText?:string;
      readonly candidateText?:string;
      readonly contextPackage: ContextPackage;
      readonly lengthSpec?: LengthSpec;
      /** Observe a complete source-bound candidate without adopting it. */
      readonly onCandidate?: (content: string) => Promise<void>;
    },
  ): Promise<ReviseOutput> {
    if (!options) throw new Error("Reviser requires governed context and language.");
    const body=(content:string)=>options.chapterTitle===undefined?content:chapterDocumentBody(content,chapterNumber,options.chapterTitle,options.language);
    chapterContent=body(chapterContent);
    const isEnglish = options.language === "en";
    const observationList = observations.length > 0
      ? observations.map((issue) => [
          `- ${issue.code}: ${issue.summary}`,
          ...(issue.evidence.length > 0
            ? [`  ${isEnglish ? "Evidence" : "证据"}: ${issue.evidence.join("; ")}`]
            : []),
        ].join("\n")).join("\n")
      : (isEnglish ? "- Follow the user's explicit revision instruction in the governed context." : "- 按 governed context 中的用户明确修订要求执行。");
    const context = renderNarrativeSelectedContext(options.contextPackage.selectedContext, options.language);
    const lengthBlock = options.lengthSpec
      ? (isEnglish
          ? `\n## Length contract\n${JSON.stringify({...options.lengthSpec,currentCount:countChapterLength(chapterContent,options.lengthSpec.countingMode),unit:"words"})}`
          : `\n## 篇幅要求\n${JSON.stringify({...options.lengthSpec,currentCount:countChapterLength(chapterContent,options.lengthSpec.countingMode),unit:"正文非空白字符，含标点，不含标题"})}`)
      : "";
    const systemPrompt = buildRevisionProtocol(mode, options.language);
    const authorRequest=currentExecutionAuthorRequest();
    const baseline=currentExecutionBaselineWork();
    const work=currentExecutionWork();
    const prefix=`source/chapters/${String(chapterNumber).padStart(4,'0')}_`;
    const predatesRequest=baseline===undefined||Boolean(baseline&&baseline.id===work?.id&&baseline.artifacts.some(artifact=>artifact.revisions.some(revision=>revision.id===artifact.currentRevisionId&&revision.path.startsWith(prefix)&&revision.path.endsWith('.md'))));
    let authorized:ReturnType<typeof authorTextScopeContract>|undefined;
    if(authorRequest&&predatesRequest){
      const scope=authorTextScopeRequest(chapterContent,authorRequest);
      const selected=await this.submitStructured(scope.messages,scope.tool,{maxTokens:Math.min(8192,this.ctx.client.defaults.maxTokens),professionalGuidance:false});
      authorized=authorTextScopeContract(chapterContent,selected.result);
    }
    const source=mode==='spot-fix'||authorized?numberReviewSource(chapterContent):chapterContent;
    const userPrompt = isEnglish
      ? `Revise chapter ${chapterNumber}.\n\n## Observations or instruction\n${observationList}\n\n## Governed context\n${context}${lengthBlock}\n\n## Current chapter\n${source}`
      : `修订第${chapterNumber}章。\n\n## 观察或用户指令\n${observationList}\n\n## 权威上下文\n${context}${lengthBlock}\n\n## 当前章节\n${source}`;
    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userPrompt },
    ];
    if(options.candidateText)messages.push({role:'user',content:JSON.stringify({unfinishedCandidate:body(options.candidateText),instruction:'Continue improving this unfinished candidate toward the original request. The original chapter remains authoritative for facts and protected text. Return only the requested replacement fields or complete revision; do not restart from the original when this candidate already addresses part of the task.'})});
    const outputBudget = Math.min(this.ctx.client.defaults.maxTokens, Math.max(8192, Math.ceil((options.lengthSpec?.target ?? chapterContent.length) * 4) + 8192));
    const output = authorized || mode === "spot-fix" || options.targetText!==undefined
      ? await this.submitSpotFix(messages, chapterContent, outputBudget, options.lengthSpec,options.targetText,options.onCandidate,authorized)
      : await this.submitRewrite(messages, outputBudget, options.lengthSpec,body,options.onCandidate);
    const wordCount = options.lengthSpec
      ? countChapterLength(output.revisedContent, options.lengthSpec.countingMode)
      : output.wordCount;
    return { ...output, wordCount };
  }

  private async submitSpotFix(
    messages: ReadonlyArray<{ readonly role: "system" | "user"; readonly content: string }>,
    originalChapter: string,
    maxTokens: number,
    lengthSpec?: LengthSpec,
    targetText?:string,
    onCandidate?: (content: string) => Promise<void>,
    authorized?:ReturnType<typeof authorTextScopeContract>,
  ): Promise<ReviseOutput> {
    let planUsage={promptTokens:0,completionTokens:0,totalTokens:0};
    let contract:ReturnType<typeof textRangeEditContract>|ReturnType<typeof textSelectionEditContract>|ReturnType<typeof authorTextScopeContract>;
    if(authorized)contract=authorized;
    else if(targetText!==undefined)contract=textSelectionEditContract(originalChapter,targetText);
    else{
    const plan=await this.submitStructured(messages,{
      name:'submit_chapter_edit_ranges',label:'Select chapter edit ranges',
      description:'Select the smallest non-overlapping inclusive source line ranges needed for the requested local changes. Do not submit prose or select unrelated passages.',
      parameters:Type.Object({ranges:Type.Array(TextEditRangeSchema,{minItems:1})},{additionalProperties:false}),
      validate:result=>{textRangeEditContract(originalChapter,result.ranges);return result;},
    },{maxTokens:Math.min(maxTokens,4096)});
    planUsage=plan.usage;
    contract=textRangeEditContract(originalChapter,plan.result.ranges);
    }
    const fixedContent=contract.apply(Object.fromEntries(Object.keys(contract.parameters.properties).map(field=>[field, ''])));
    const fixedLength=lengthSpec?countChapterLength(fixedContent,lengthSpec.countingMode):undefined;
    const replacementBudget=lengthSpec&&fixedLength!==undefined?{
      countingMode:lengthSpec.countingMode,fixedContentLength:fixedLength,
      minimum:Math.max(0,(lengthSpec.minChapterLength??0)-fixedLength),
      ...(lengthSpec.maxChapterLength===undefined?{}:{maximum:lengthSpec.maxChapterLength-fixedLength}),
    }:undefined;
    if(replacementBudget?.maximum!==undefined&&replacementBudget.maximum<0)throw Object.assign(new Error('The protected text alone exceeds the chapter maximum. These edit ranges cannot satisfy both scope and length constraints.'),{code:'CHAPTER_EDIT_SCOPE_CONFLICT',replacementBudget});
    const { result, usage } = await this.submitStructured([...messages,{role:'user',content:JSON.stringify({editableRanges:contract.ranges,replacementBudget,instruction:'Submit only replacement text in each named field. The replacement budget is shared by all fields, not per field. Keep the original trailing newline when present. The host preserves all source bytes outside the selected ranges.'})}], {
      name: "submit_chapter_range_replacements",
      label: "Submit chapter range replacements",
      description: "Submit replacement prose only within the author-authorized source selections, using their named fields.",
      parameters: contract.parameters,
      validate: async result => {
        const candidate=contract.apply(result);
        await onCandidate?.(candidate);
        try{assertChapterLength(candidate,lengthSpec);}
        catch(error){
          const failure=error as Error&{code?:string;delivery?:object};
          if(failure.code!=='CHAPTER_LENGTH_OUT_OF_RANGE')throw error;
          const sourceLength=lengthSpec?countChapterLength(originalChapter,lengthSpec.countingMode):undefined;
          throw Object.assign(new Error(JSON.stringify({code:failure.code,...failure.delivery,scope:'selected_ranges',replacementBudget,source:{length:sourceLength,unchangedByThisAttempt:true},candidateCommitted:false,instruction:'The rejected replacement has not changed the source chapter. Adjust only the selected replacement fields to their combined budget. Do not include or rewrite protected surrounding text.'})),{code:failure.code,delivery:failure.delivery,replacementBudget});
        }
        return result;
      },
    }, {  maxTokens });
    const revisedContent = contract.apply(result);
    return {
      revisedContent,
      wordCount: revisedContent.length,
      tokenUsage:{promptTokens:planUsage.promptTokens+usage.promptTokens,completionTokens:planUsage.completionTokens+usage.completionTokens,totalTokens:planUsage.totalTokens+usage.totalTokens},
    };
  }

  private async submitRewrite(
    messages: ReadonlyArray<{ readonly role: "system" | "user"; readonly content: string }>,
    maxTokens: number,
    lengthSpec?: LengthSpec,
    normalizeContent:(content:string)=>string=content=>content,
    onCandidate?:(content:string)=>Promise<void>,
  ): Promise<ReviseOutput> {
    const { result, usage } = await this.submitStructured(messages, {
      name: "submit_revised_chapter",
      label: "Submit revised chapter",
      description: "Submit the complete revised chapter and addressed observations.",
      parameters: ChapterRewriteToolSchema,
      validate: async result => {
        const revisedContent=normalizeContent(result.revisedContent);
        if(!revisedContent.trim())throw Object.assign(new Error('Submit chapter prose in addition to its title'),{code:'CHAPTER_BODY_EMPTY'});
        await onCandidate?.(revisedContent);
        assertChapterLength(revisedContent,lengthSpec);
        return{...result,revisedContent};
      },
    }, {  maxTokens });
    return {
      revisedContent: result.revisedContent,
      wordCount: result.revisedContent.length,
      tokenUsage: usage,
    };
  }
}

function buildRevisionProtocol(mode: ReviseMode, language: "zh" | "en"): string {
  const modes: Record<ReviseMode, { readonly en: string; readonly zh: string }> = {
    polish: { en: "Edit wording only; keep facts, events, characters, and causality.", zh: "只改文字表面，保持事实、事件、人物和因果。" },
    rewrite: { en: "Rewrite the affected passages; rewrite the whole chapter only when the instruction spans it.", zh: "重写受影响段落；只有要求跨越整章时才重写整章。" },
    rework: { en: "Scenes and conflict may be restructured within the supplied authority.", zh: "可在输入权威范围内重构场景与冲突。" },
    "anti-detect": { en: "Change wording only while preserving story facts and causality.", zh: "只调整文字表面，保持剧情事实和因果。" },
    "spot-fix": { en: "Select only the source line ranges needed for the local request, then replace those ranges while preserving surrounding text.", zh: "先选择局部请求涉及的原文行范围，再替换这些范围，保留范围外正文。" },
  };
  return language === "en"
    ? `Revise with the activated professional Skill and governed context. ${modes[mode].en} Submit the result through the required tool.`
    : `按已激活的专业 Skill 和 governed context 修订。${modes[mode].zh}通过指定结果工具提交。`;
}
