import { BaseAgent } from "./base.js";
import { ReviserAgent } from "./reviser.js";
import { z } from "zod";
import { Type, type Static } from "@sinclair/typebox";
import {
  countChapterLength,
  buildLengthSpec,
  resolveLengthCountingMode,
} from "../utils/length-metrics.js";
import {
  type ShortFictionLanguage,
  buildShortFictionDraftReviewSystemPrompt,
  buildShortFictionDraftReviewUserPrompt,
  buildShortFictionOutlineSystemPrompt,
  buildShortFictionOutlineUserPrompt,
  buildShortFictionPackageSystemPrompt,
  buildShortFictionPackageUserPrompt,
  buildShortFictionWriterSystemPrompt,
  buildShortFictionWriterUserPrompt,
} from "../prompts/short-fiction.js";
import { ShortDraftBatchToolSchema, ShortDraftChapterToolSchema, ShortRevisionChapterToolSchema, shortDraftBatchToolSchema, shortOutlineToolSchema, ShortPackageToolSchema, ShortRevisionPlanSchema, shortRevisionPlanSubmissionSchema } from "./short-fiction-tool.js";
import { numberReviewSource, type Observation } from "../models/observation.js";

export const SHORT_FICTION_DEFAULT_CHAPTERS = 12;
export const SHORT_FICTION_DEFAULT_CHARS_PER_CHAPTER = 1000;
export const SHORT_FICTION_EN_DEFAULT_WORDS_PER_CHAPTER = 650;

export type { ShortFictionLanguage } from "../prompts/short-fiction.js";

export interface ShortFictionOutline {
  readonly storyTitle: string;
  readonly rawContent: string;
}

export interface ShortFictionChapter {
  readonly number: number;
  readonly title: string;
  readonly content: string;
  readonly charCount: number;
}

export interface ShortFictionBatchDraft {
  readonly storyTitle: string;
  readonly openingHook?: string;
  readonly chapters: ReadonlyArray<ShortFictionChapter>;
  readonly rawContent: string;
}

export interface ShortFictionMeasurements {
  readonly title: string;
  readonly chapterCount: number;
  readonly totalLength: number;
  readonly unit: "words" | "non-whitespace-characters";
  readonly openingHookLength: number;
  readonly chapterLengths: Array<{number:number;length:number}>;
}

export function measureShortFictionDraft(draft: ShortFictionBatchDraft, language: ShortFictionLanguage = "zh"): ShortFictionMeasurements {
  const mode=resolveLengthCountingMode(language);
  const chapterLengths=draft.chapters.map(chapter=>({number:chapter.number,length:countChapterLength(chapter.content,mode)}));
  const openingHookLength=countChapterLength(draft.openingHook??"",mode);
  return {title:draft.storyTitle,chapterCount:draft.chapters.length,
    totalLength:chapterLengths.reduce((total,chapter)=>total+chapter.length,openingHookLength),
    unit:language==="en"?"words":"non-whitespace-characters",openingHookLength,chapterLengths};
}

export const ShortFictionBatchDraftSchema = z.object({
  storyTitle: z.string().min(1),
  openingHook: z.string().optional(),
  chapters: z.array(z.object({
    number: z.number().int().positive(),
    title: z.string(),
    content: z.string(),
    charCount: z.number().int().nonnegative(),
  }).strict()),
  rawContent: z.string(),
}).strict();

export interface ShortFictionSalesPackage {
  readonly title: string;
  readonly intro: string;
  readonly sellingPoints: ReadonlyArray<string>;
  readonly coverPrompt: string;
  readonly rawContent: string;
}

export function renderShortFictionSalesPackage(sales: ShortFictionSalesPackage, language: ShortFictionLanguage): string {
  const headings = language === "en"
    ? ["## Synopsis", "## Selling Points", "## Cover Prompt"]
    : ["## 简介", "## 卖点", "## 封面提示词"];
  return [`# ${sales.title}`, "", headings[0], "", sales.intro, "", headings[1], "",
    ...sales.sellingPoints.map(point => `- ${point}`), "", headings[2], "", sales.coverPrompt].join("\n");
}

export interface ShortFictionDraftReview {
  readonly summary: string;
  readonly observations: ReadonlyArray<Observation>;
}

export interface ShortRevisionProgress {
  readonly plan: Static<typeof ShortRevisionPlanSchema>;
  readonly draft: ShortFictionBatchDraft;
  readonly completed: ReadonlyArray<number>;
}

export interface ShortFictionReference {
  readonly path?: string;
  readonly text: string;
}

export interface ShortFictionOutlineInput {
  readonly title?: string;
  readonly direction: string;
  readonly chapterCount: number;
  readonly charsPerChapter: number;
  readonly reference?: ShortFictionReference;
  readonly language?: ShortFictionLanguage;
}

export interface ShortFictionDraftInput {
  readonly title?: string;
  readonly openingHookChars?: number;
  readonly direction: string;
  readonly outlineMarkdown: string;
  readonly chapterCount: number;
  readonly charsPerChapter: number;
  readonly minChapterLength?: number;
  readonly maxChapterLength?: number;
  readonly maxChaptersPerCall?: number;
  readonly language?: ShortFictionLanguage;
  readonly chapterNumbers?: readonly number[];
  readonly onBatchComplete?: (
    draft: ShortFictionBatchDraft,
    completedChapterNumbers: ReadonlyArray<number>,
  ) => void | Promise<void>;
}

export interface ShortFictionDraftReviewInput extends ShortFictionDraftInput {
  readonly revisionRequest?: string;
  readonly reviewScope?: string;
  readonly draft: ShortFictionBatchDraft;
  readonly comparison?: {
    readonly scope: "episode_start" | "parent_revision";
    readonly before: { readonly artifactId: string; readonly revisionId: string; readonly checksum: string };
    readonly after: { readonly artifactId: string; readonly revisionId: string; readonly checksum: string };
    readonly draft: ShortFictionBatchDraft;
  };
}

export interface ShortFictionPackageInput {
  readonly reviewContext?: string;
  readonly direction: string;
  readonly outlineMarkdown: string;
  readonly draft: ShortFictionBatchDraft;
  readonly language?: ShortFictionLanguage;
}

export class ShortFictionOutlineAgent extends BaseAgent {
  get name(): string {
    return "short-fiction-outline";
  }

  async createOutline(input: ShortFictionOutlineInput): Promise<ShortFictionOutline> {
    const response = await this.submitStructured([
        { role: "system", content: buildShortFictionOutlineSystemPrompt(input.language) },
        { role: "user", content: buildShortFictionOutlineUserPrompt(input, input.language) },
      ], {
        name: "submit_short_outline",
        label: "Submit short-fiction outline",
        description: "Submit the story title and complete readable plan.",
        parameters: shortOutlineToolSchema(input.chapterCount,input.title),
      }, {  maxTokens: Math.min(8192, safeShortFictionOutputBudget(this.ctx.client.defaults.maxTokens)) });

    return {
      storyTitle: response.result.storyTitle.trim(),
      rawContent: [response.result.planMarkdown.trim(), ...Array.from({length:input.chapterCount},(_,index) => (
        `## ${input.language === "en" ? `Chapter ${index+1}` : `第${index+1}章`}\n\n${(response.result as Record<string,string>)[`chapter_${index+1}_plan`]!.trim()}`
      ))].join("\n\n"),
    };
  }
}

export class ShortFictionWriterAgent extends BaseAgent {
  get name(): string {
    return "short-fiction-writer";
  }

  async reviseDraft(input: ShortFictionDraftInput & {
    readonly draft: ShortFictionBatchDraft;
    readonly review: string;
    readonly resume?: ShortRevisionProgress;
    readonly onRevisionProgress?: (progress: ShortRevisionProgress) => Promise<void>;
  }): Promise<{draft:ShortFictionBatchDraft;outlineMarkdown:string}> {
    const submittedPlan: Static<typeof ShortRevisionPlanSchema> = input.resume?.plan ?? (input.chapterNumbers?.length === 1 ? {
      revisionBrief:input.direction,chapters:input.chapterNumbers.map(number=>({number,instruction:input.direction})),
    } : await this.planRevision(input));
    const plan={...submittedPlan,outlineMarkdown:submittedPlan.outlineMarkdown??input.outlineMarkdown};
    return this.applyRevisionPlan(input,plan);
  }

  private async planRevision(input:ShortFictionDraftInput & {readonly draft:ShortFictionBatchDraft;readonly review:string}):Promise<Static<typeof ShortRevisionPlanSchema>> {
    const normalize = (result: Record<string, unknown>): Static<typeof ShortRevisionPlanSchema> => ({
      revisionBrief:result.revisionBrief as string,
      outlineMarkdown:typeof result.outlineMarkdown==="string"?result.outlineMarkdown:undefined,
      openingHook:result.openingHook as string|undefined,
      chapters:Array.from({length:input.chapterCount},(_,index)=>{
        const number=index+1, sourceNumber=result[`chapter_${number}_sourceNumber`], instruction=result[`chapter_${number}_instruction`];
        return {number,...(typeof sourceNumber==="number"?{sourceNumber}:{}),...(typeof instruction==="string"&&instruction.trim()?{instruction:instruction.trim()}:{})};
      }).filter(chapter=>(chapter.sourceNumber!==undefined&&chapter.sourceNumber!==chapter.number)||chapter.instruction!==undefined),
    });
    const {result}=await this.submitStructured([
      {role:"system",content:"Plan only the changes required by the author's current request. Omit unchanged chapter fields, the opening scene and the outline. An opening-only edit needs no chapter edits. Chapter fields refer to FINAL slots: sourceNumber copies an original chapter unchanged, and an instruction revises that slot. Use sourceNumber 0 and a writing instruction for a new scene. When restructuring, provide the updated complete outline and map every displaced slot; each unchanged source scene can appear once. Use the supplied final chapter count, which includes the author's explicit updates. Preserve all other author constraints, chronology and scope. Reviewer suggestions are diagnosis, not permission to change the author's requirements."},
      {role:"user",content:JSON.stringify({title:input.draft.storyTitle,direction:input.direction,requiredChapterCount:input.chapterCount,allowedChapterNumbers:input.chapterNumbers,outline:input.outlineMarkdown,review:input.review,originalManuscript:input.draft.chapters,openingHook:input.draft.openingHook,...(input.openingHookChars?{openingHookTarget:openingHookLengthContract(input.openingHookChars,input.language)}:{})})},
    ],{name:"submit_short_revision_plan",label:"Plan requested revision",description:"Submit only affected chapters, opening scene or outline.",parameters:shortRevisionPlanSubmissionSchema(input.chapterCount,input.draft.chapters.length),validate:(plan)=>{
      this.validateRevisionPlan(normalize(plan),input);
      return plan;
    }},
    {maxTokens:Math.min(8192,this.ctx.client.defaults.maxTokens)});
    return normalize(result);
  }

  private validateRevisionPlan(plan:Static<typeof ShortRevisionPlanSchema>,input:ShortFictionDraftInput & {draft:ShortFictionBatchDraft}):void {
    const sourceCount=input.draft.chapters.length;
    if(input.chapterNumbers&&plan.chapters.some(chapter=>!input.chapterNumbers!.includes(chapter.number)))throw Object.assign(new Error("The plan changes a chapter outside the author's selected scope."),{code:"SHORT_REVISION_OUT_OF_SCOPE"});
    if(input.chapterNumbers?.length&&plan.openingHook!==undefined&&plan.openingHook.trim()!==(input.draft.openingHook??""))throw Object.assign(new Error("The opening is outside the selected chapter scope."),{code:"SHORT_REVISION_OUT_OF_SCOPE"});
    if(input.openingHookChars&&plan.openingHook!==undefined&&plan.openingHook.trim()!==(input.draft.openingHook??""))validateOpeningHook(plan.openingHook,input.openingHookChars,input.language);
    if(!plan.chapters.length&&input.chapterCount===sourceCount
      &&(plan.openingHook===undefined||plan.openingHook.trim()===(input.draft.openingHook??""))
      &&(plan.outlineMarkdown===undefined||plan.outlineMarkdown===input.outlineMarkdown))throw Object.assign(new Error("Select a changed chapter, opening scene or outline."),{code:"SHORT_REVISION_PLAN_EMPTY"});
    if(new Set(plan.chapters.map(chapter=>chapter.number)).size!==plan.chapters.length
      ||plan.chapters.some(chapter=>chapter.number<1||chapter.number>input.chapterCount
        ||(chapter.sourceNumber!==undefined&&(chapter.sourceNumber<0||chapter.sourceNumber>sourceCount))
        ||(!chapter.instruction?.trim()&&(chapter.sourceNumber===undefined||chapter.sourceNumber===0))))throw Object.assign(new Error("Each new scene requires a writing instruction; every destination and original source must be valid."),{code:"SHORT_REVISION_PLAN_INVALID"});
    const copies=new Map<number,number[]>();
    for(let number=1;number<=input.chapterCount;number++){
      const item=plan.chapters.find(chapter=>chapter.number===number);
      if(item?.instruction?.trim())continue;
      const source=item?.sourceNumber??number;
      if(source>sourceCount)throw Object.assign(new Error("A new chapter requires a writing instruction."),{code:"SHORT_REVISION_PLAN_INVALID",chapterNumber:number});
      copies.set(source,[...(copies.get(source)??[]),number]);
    }
    const duplicates=[...copies].filter(([,destinations])=>destinations.length>1).map(([sourceNumber,destinations])=>({sourceNumber,destinations}));
    if(duplicates.length)throw Object.assign(new Error(JSON.stringify({code:"SHORT_REVISION_SOURCE_REUSED",duplicates,requiredChapterCount:input.chapterCount,instruction:"Assign every affected final slot. Move each unchanged original scene once and write a distinct scene in any remaining slot."})),{code:"SHORT_REVISION_SOURCE_REUSED"});
    if((input.chapterCount!==sourceCount||plan.chapters.some(chapter=>chapter.sourceNumber!==undefined&&chapter.sourceNumber!==chapter.number))&&!plan.outlineMarkdown?.trim())throw Object.assign(new Error("Provide the outline for the restructured manuscript."),{code:"SHORT_REVISION_OUTLINE_REQUIRED"});
  }

  private async applyRevisionPlan(input:ShortFictionDraftInput & {readonly draft:ShortFictionBatchDraft;readonly review:string;readonly resume?:ShortRevisionProgress;readonly onRevisionProgress?:(progress:ShortRevisionProgress)=>Promise<void>},plan:Static<typeof ShortRevisionPlanSchema>&{outlineMarkdown:string}):Promise<{draft:ShortFictionBatchDraft;outlineMarkdown:string}> {
    this.validateRevisionPlan(plan,input);
    let draft=input.resume?.draft ?? input.draft;
    if(draft.chapters.length!==input.chapterCount)draft={...draft,chapters:Array.from({length:input.chapterCount},(_,index)=>draft.chapters.find(chapter=>chapter.number===index+1)??{number:index+1,title:"",content:"",charCount:0})};
    const completed=[...(input.resume?.completed ?? [])];
    await input.onRevisionProgress?.({plan,draft,completed});
    for(const chapterPlan of plan.chapters) {
      if(completed.includes(chapterPlan.number)) continue;
      const chapter=draft.chapters.find(item=>item.number===chapterPlan.number)!;
      const originalChapter=chapterPlan.sourceNumber===0?undefined:input.draft.chapters.find(item=>item.number===(chapterPlan.sourceNumber??chapter.number))!;
      if(!chapterPlan.instruction?.trim()) {
        draft={...draft,chapters:draft.chapters.map(item=>item.number===chapter.number?{...originalChapter!,number:chapter.number}:item)};
        completed.push(chapter.number);
        await input.onRevisionProgress?.({plan,draft,completed});
        continue;
      }
      const otherChapters=draft.chapters.filter(item=>item.number!==chapter.number);
      const revised=await this.submitStructured([
        {role:"system",content: input.language==="en"
          ? "Use the activated Skill, user request and revision plan to revise the specified chapter. Submit its title and complete prose within the supplied length range. Express the revision as in-world actions and dialogue; keep editorial chapter references and review instructions in the plan, outside the story prose."
          : "按已激活的 Skill、用户修改要求与修订方案修改指定章节，提交本章标题和完整正文，并满足给定篇幅范围。把修改落实为故事中的行动与对白；章号引用、审稿意见和修改说明留在方案中，不写进故事正文。"},
        {role:"user",content:JSON.stringify({storyTitle:input.draft.storyTitle,userRequest:input.direction,chapterNumber:chapter.number,currentLength:countChapterLength(chapterPlan.sourceNumber===0?"":chapter.content,resolveLengthCountingMode(input.language)),targetLength:input.charsPerChapter,minLength:input.minChapterLength,maxLength:input.maxChapterLength,lengthUnit:input.language==="en"?"words":"non-whitespace characters including punctuation",corrections:plan.revisionBrief,outline:plan.outlineMarkdown,instruction:chapterPlan.instruction,...(chapterPlan.sourceNumber!==undefined&&chapterPlan.sourceNumber!==chapter.number?{originalChapter}:{}),currentChapter:chapterPlan.sourceNumber===0?undefined:chapter,otherChapters})},
      ],{name:"submit_short_revision_chapter",label:"Revise one chapter",description:`Submit the title and prose for chapter ${chapter.number}.`,parameters:ShortRevisionChapterToolSchema,
        validate:async(result)=>{
          const bound = {...result,storyTitle:input.draft.storyTitle,number:chapter.number};
          validateRequestedShortChapter(bound,[chapter.number],{...input,openingHookChars:undefined});
          const candidate=mergeShortFictionBatch(draft,asShortDraftBatch(bound),input.chapterCount,input.language);
          const changed=candidate.chapters.find(item=>item.number===chapter.number)!;
          validateShortFictionDraftForFinal({...candidate,chapters:[changed]},{expectedChapters:1,minChapterLength:1,language:input.language});
          const distance=(content:string)=>{
            const length=countChapterLength(content,resolveLengthCountingMode(input.language));
            return Math.max(0,(input.minChapterLength??1)-length,length-(input.maxChapterLength??Infinity));
          };
          const current=draft.chapters.find(item=>item.number===chapter.number)!;
          const replacingValidSource = distance(current.content) === 0 && current.content === originalChapter?.content;
          if(distance(changed.content)>0&&(replacingValidSource||distance(changed.content)<distance(current.content))){
            // Keep improving candidates across interrupted corrections without
            // marking the destination complete or replacing the final manuscript.
            // An in-range source may still require a content revision: its zero
            // length error must not discard every unfinished replacement.
            draft=candidate;
            await input.onRevisionProgress?.({plan,draft,completed});
          }
          validateRequestedShortChapter(bound,[chapter.number],{...input,openingHookChars:undefined},true);
          validateShortFictionDraftForFinal({storyTitle:bound.storyTitle,rawContent:"",chapters:[{number:bound.number,title:bound.title,content:bound.content,charCount:0}]},{expectedChapters:1,minChapterLength:input.minChapterLength,language:input.language});
          return result;
        }}, {maxTokens:Math.min(8192,this.ctx.client.defaults.maxTokens)}).catch(async error=>{
          const pending=draft.chapters.find(item=>item.number===chapter.number)!;
          if((error as {code?:string}).code!=="SHORT_CHAPTER_TOO_LONG" || input.maxChapterLength===undefined
            || countChapterLength(pending.content,resolveLengthCountingMode(input.language))<=input.maxChapterLength)throw error;
          // Preserve the developed candidate. Mechanical compression uses the
          // same bounded, source-bound edits as other local chapter revisions.
          const repaired=await new ReviserAgent(this.ctx).reviseChapter("",pending.content,chapter.number,[{
            code:"CHAPTER_LENGTH_OUT_OF_RANGE",assessment:"issue",category:"quality",evidence:[],
            summary:"Compress this existing candidate to the supplied length range. Remove repeated explanation or redundant phrasing while preserving its events, facts, knowledge, chronology, decisions and complete scenes. Do not repeat the semantic rewrite or change its title.",
          }],"spot-fix",undefined,{language:input.language??"zh",contextPackage:{chapter:chapter.number,selectedContext:[{
            source:"revision-scope",reason:"Keep this revision's scope while fitting its candidate to the length contract.",excerpt:input.direction,protection:"protected",
          }]},
            onCandidate:async content=>{
              const mode=resolveLengthCountingMode(input.language),count=countChapterLength(content,mode);
              const best=draft.chapters.find(item=>item.number===chapter.number)!;
              if(count>input.maxChapterLength!&&count<countChapterLength(best.content,mode)){
                const candidate=mergeShortFictionBatch(draft,asShortDraftBatch({storyTitle:input.draft.storyTitle,number:chapter.number,title:pending.title,content}),input.chapterCount,input.language);
                validateShortFictionDraftForFinal({...candidate,chapters:[candidate.chapters.find(item=>item.number===chapter.number)!]},{expectedChapters:1,minChapterLength:1,language:input.language});
                draft=candidate;
                await input.onRevisionProgress?.({plan,draft,completed});
              }
            },
            lengthSpec:buildLengthSpec(input.charsPerChapter,input.language,{minChapterLength:input.minChapterLength??1,maxChapterLength:input.maxChapterLength})});
          const result={title:pending.title,content:repaired.revisedContent};
          validateRequestedShortChapter({...result,storyTitle:input.draft.storyTitle,number:chapter.number},[chapter.number],{...input,openingHookChars:undefined},true);
          return {result};
        });
      draft=mergeShortFictionBatch(draft,asShortDraftBatch({...revised.result,storyTitle:input.draft.storyTitle,number:chapter.number}),input.chapterCount,input.language);
      completed.push(chapter.number);
      await input.onRevisionProgress?.({plan,draft,completed});
    }
    draft={...draft,openingHook:plan.openingHook===undefined?draft.openingHook:plan.openingHook.trim()||undefined};
    return {draft:{...draft,rawContent:renderShortFictionDraftMarkdown(draft,input.language)},outlineMarkdown:plan.outlineMarkdown};
  }

  async writeDraft(input: ShortFictionDraftInput): Promise<ShortFictionBatchDraft> {
    // Buffered requests have a total deadline. Keep their default output bounded
    // while retaining one whole-story drafting stage and explicit caller control.
    const outputBudget=this.ctx.client.stream===false && input.maxChaptersPerCall===undefined
      ? Math.min(8192,this.ctx.client.defaults.maxTokens) : this.ctx.client.defaults.maxTokens;
    const batches = buildShortFictionChapterBatches(
      input.chapterNumbers ?? allChapterNumbers(input.chapterCount),
      input.charsPerChapter,
      outputBudget,
      input.maxChaptersPerCall,
    );
    let currentDraft: ShortFictionBatchDraft | undefined;
    for (const chapterNumbers of batches) {
      const response = await this.submitStructured([
          { role: "system", content: buildShortFictionWriterSystemPrompt(input.language) },
          {
            role: "user",
            content: buildShortFictionWriterUserPrompt({
              ...input,
              chapterNumbers,
              ...(currentDraft ? { previousDraftMarkdown: renderShortFictionDraftMarkdown(currentDraft, input.language) } : {}),
            }, input.language),
          },
        ], {
          name: chapterNumbers.length === 1 ? "submit_short_chapter" : "submit_short_draft_batch",
          label: "Submit short-fiction draft batch",
          description: "Submit the requested complete chapter drafts.",
          parameters: chapterNumbers.length === 1 ? ShortDraftChapterToolSchema : shortDraftBatchToolSchema(chapterNumbers,{...input,openingHookChars:undefined}),
          // Preserve structurally complete candidates. Length and opening-scene
          // repair belong to the completion pass, before final acceptance.
          validate: result => validateRequestedShortChapter(result, chapterNumbers, {...input,openingHookChars:undefined}),
        }, {

          maxTokens: estimateShortFictionMaxTokens(
            chapterNumbers.length,
            input.charsPerChapter,
            outputBudget,
          ),
        });
      currentDraft = mergeShortFictionBatch(currentDraft, asShortDraftBatch(response.result, chapterNumbers), input.chapterCount, input.language);
      const incomplete = new Set(findIncompleteShortFictionChapters(currentDraft,input));
      const completedChapterNumbers=currentDraft.chapters.filter(chapter=>!incomplete.has(chapter.number)).map(chapter=>chapter.number);
      await input.onBatchComplete?.(currentDraft, completedChapterNumbers);
    }

    if (!currentDraft) throw new Error("Short-fiction writer returned no chapter batch");
    return currentDraft;
  }

  async continueDraft(input: ShortFictionDraftInput & { readonly draft: ShortFictionBatchDraft }): Promise<ShortFictionBatchDraft> {
    let currentDraft = mergeShortFictionBatch(input.draft, {
      storyTitle:input.draft.storyTitle,chapters:[],
    },input.chapterCount,input.language);
    if(input.title&&currentDraft.storyTitle!==input.title)throw Object.assign(new Error("The saved draft has a different story title"),{code:"SHORT_TITLE_MISMATCH",expectedTitle:input.title,actualTitle:currentDraft.storyTitle});
    if(input.openingHookChars){
      let valid=true;try{validateOpeningHook(currentDraft.openingHook,input.openingHookChars,input.language);}catch{valid=false;}
      if(!valid){
        const {result}=await this.submitStructured([
          {role:"system",content:"Write the requested independent opening scene before chapter one. Preserve the supplied title, story events and first chapter. Submit only the opening scene through the tool."},
          {role:"user",content:JSON.stringify({title:currentDraft.storyTitle,targetLength:input.openingHookChars,direction:input.direction,outline:input.outlineMarkdown,firstChapter:currentDraft.chapters.find(chapter=>chapter.number===1),currentOpeningHook:currentDraft.openingHook})},
        ],{name:"submit_short_opening_hook",label:"Complete opening scene",description:"Submit the requested independent opening scene.",parameters:Type.Object({openingHook:Type.String({minLength:1})}),validate:result=>{validateOpeningHook(result.openingHook,input.openingHookChars!,input.language);return result;}},
        {maxTokens:Math.min(2048,this.ctx.client.defaults.maxTokens)});
        currentDraft={...currentDraft,openingHook:result.openingHook.trim()};
        currentDraft={...currentDraft,rawContent:renderShortFictionDraftMarkdown(currentDraft,input.language)};
        await input.onBatchComplete?.(currentDraft,currentDraft.chapters.filter(chapter=>!findIncompleteShortFictionChapters(currentDraft,input).includes(chapter.number)).map(chapter=>chapter.number));
      }
    }
    const missingChapters = findIncompleteShortFictionChapters(currentDraft, input);
    if (missingChapters.length === 0) return currentDraft;
    // Completion and later revision share the same chapter editor. The host
    // selects invalid slots; writing a new batch is not a repair operation.
    const revised = await this.applyRevisionPlan({
      ...input, draft:currentDraft, chapterNumbers:missingChapters, review:"",
      onRevisionProgress:async progress=>{
        if(progress.draft===currentDraft)return;
        const invalid=new Set(findIncompleteShortFictionChapters(progress.draft,input));
        await input.onBatchComplete?.(progress.draft,progress.draft.chapters.filter(chapter=>!invalid.has(chapter.number)).map(chapter=>chapter.number));
      },
    }, {
      revisionBrief:"Complete only the selected invalid chapters. Preserve valid chapters, the independent opening scene, chronology and evidence. Keep each chapter within its own story boundary.",
      outlineMarkdown:input.outlineMarkdown,
      chapters:missingChapters.map(number=>{
        const chapter=currentDraft.chapters.find(chapter=>chapter.number===number)!;
        const length=countChapterLength(chapter.content,resolveLengthCountingMode(input.language));
        const operation=!chapter.content.trim()?"Write the missing complete scene"
          :input.maxChapterLength!==undefined&&length>input.maxChapterLength
            ?"Condense this existing chapter: retain the core conflict, evidence, decisions and transitions; remove repeated explanation and nonessential beats"
            :"Complete this chapter with concrete action, dialogue and evidence";
        return {number,sourceNumber:chapter.content.trim()?number:0,
          instruction:`${operation}. Current measured length: ${length}. Target: ${input.charsPerChapter}; minimum: ${input.minChapterLength??1}; maximum: ${input.maxChapterLength??"not specified"}. Do not import the following chapter's events.`};
      }),
    });
    return revised.draft;
  }
}

type ShortDraftSubmission = Static<typeof ShortDraftBatchToolSchema | typeof ShortDraftChapterToolSchema | ReturnType<typeof shortDraftBatchToolSchema>>;
function validateRequestedShortChapter<T extends ShortDraftSubmission>(result: T, numbers: readonly number[], input: ShortFictionDraftInput, enforceLength = false): T {
  if(input.title&&result.storyTitle.trim()!==input.title.trim())throw Object.assign(new Error("Submit the requested story title exactly"),{code:"SHORT_TITLE_MISMATCH",expectedTitle:input.title});
  if(input.openingHookChars&&numbers.includes(1))validateOpeningHook(result.openingHook,input.openingHookChars,input.language);
  if ("number" in result && (numbers.length !== 1 || result.number !== numbers[0])) {
    throw Object.assign(new Error(`Submit only chapter ${numbers.join(", ")}`), {code:"SHORT_REVISION_OUT_OF_SCOPE"});
  }
  const chapters = asShortDraftBatch(result, numbers).chapters;
  if (chapters.length !== numbers.length || chapters.some(chapter => !numbers.includes(chapter.number)) || new Set(chapters.map(chapter=>chapter.number)).size !== numbers.length) {
    throw Object.assign(new Error(`Submit only chapters ${numbers.join(", ")}`), {code:"SHORT_REVISION_OUT_OF_SCOPE"});
  }
  // Accepted draft checkpoints satisfy the same explicit length bounds as delivery.
  if (enforceLength && input.minChapterLength !== undefined) {
    const short = chapters.map(chapter => ({number:chapter.number,length:countChapterLength(chapter.content,resolveLengthCountingMode(input.language ?? "zh"))})).filter(chapter=>chapter.length<input.minChapterLength!);
    if (short.length) {
      const details={code:"SHORT_CHAPTER_TOO_SHORT",minChapterLength:input.minChapterLength,chapters:short,instruction:"Expand the requested scene within its chapter boundary. Preserve the events assigned to neighboring chapters."};
      throw Object.assign(new Error(JSON.stringify(details)),details);
    }
  }
  if (enforceLength && input.maxChapterLength !== undefined) {
    const overlong = chapters.map(chapter => ({number:chapter.number,length:countChapterLength(chapter.content,resolveLengthCountingMode(input.language ?? "zh"))})).filter(chapter=>chapter.length>input.maxChapterLength!);
    if (overlong.length) {
      const details={code:"SHORT_CHAPTER_TOO_LONG",maxChapterLength:input.maxChapterLength,chapters:overlong,instruction:"Submit complete scenes within their own chapter plan and length limit."};
      throw Object.assign(new Error(JSON.stringify(details)),details);
    }
  }
  return result;
}
function asShortDraftBatch(result: ShortDraftSubmission, numbers?: readonly number[]): Static<typeof ShortDraftBatchToolSchema> {
  if ("chapters" in result && Array.isArray(result.chapters)) return result as Static<typeof ShortDraftBatchToolSchema>;
  if ("number" in result) {
    const {number,title,content,...story}=result as Static<typeof ShortDraftChapterToolSchema>;
    return {...story,chapters:[{number,title,content}]};
  }
  if (!numbers) throw new Error("Flat batch submission requires its requested chapter numbers");
  const fields=result as Record<string,string>;
  return {storyTitle:result.storyTitle,openingHook:result.openingHook,chapters:numbers.map(number=>({
    number,title:fields[`chapter_${number}_title`]!,content:fields[`chapter_${number}_content`]!,
  }))};
}

export class ShortFictionDraftReviewerAgent extends BaseAgent {
  get name(): string {
    return "short-fiction-draft-reviewer";
  }

  async reviewDraft(input: ShortFictionDraftReviewInput): Promise<ShortFictionDraftReview> {
    const sources = shortReviewSources(input);
    const prior = input.comparison?.draft;
    const beforeChapters = new Map(prior?.chapters.map(chapter => [chapter.number, chapter]) ?? []);
    const afterChapters = new Map(input.draft.chapters.map(chapter => [chapter.number, chapter]));
    const comparison = input.comparison ? {
      scope: input.comparison.scope, before: input.comparison.before, after: input.comparison.after,
      titleChanged: prior!.storyTitle !== input.draft.storyTitle,
      openingChanged: (prior!.openingHook ?? "") !== (input.draft.openingHook ?? ""),
      chapters: [...new Set([...beforeChapters.keys(), ...afterChapters.keys()])].sort((a,b) => a-b).map(number => {
        const before = beforeChapters.get(number), after = afterChapters.get(number);
        return { number, titleChanged: before?.title !== after?.title, contentChanged: before?.content !== after?.content,
          beforeSourceId: sources.has(`baseline-manuscript-chapter-${number}`) ? `baseline-manuscript-chapter-${number}` : undefined,
          afterSourceId: after ? `manuscript-chapter-${number}` : undefined };
      }),
    } : undefined;
    const response = await this.submitSourcedReview([
        { role: "system", content: buildShortFictionDraftReviewSystemPrompt(input.language) },
        { role: "user", content: buildShortFictionDraftReviewUserPrompt({
          ...input,
          comparison,
          measurements: measureShortFictionDraft(input.draft,input.language),
          outlineMarkdown: numberReviewSource(input.outlineMarkdown),
          draftMarkdown: [...sources].filter(([id]) => id !== "outline").map(([id, text]) => `## Source: ${id}\n${numberReviewSource(text)}`).join("\n\n"),
        }, input.language) },
      ], sources, {
        name: "submit_short_fiction_review",
        label: "Submit short-fiction review",
        description: "Submit evidence-backed observations for the persisted short-fiction draft.",
      }, {  maxTokens: Math.min(4096, safeShortFictionOutputBudget(this.ctx.client.defaults.maxTokens)) });
    return response.result;
  }
}

export class ShortFictionPackagingAgent extends BaseAgent {
  get name(): string {
    return "short-fiction-packaging";
  }

  async generatePackage(input: ShortFictionPackageInput): Promise<ShortFictionSalesPackage> {
    const response = await this.submitStructured([
        { role: "system", content: buildShortFictionPackageSystemPrompt(input.language) },
        { role: "user", content: buildShortFictionPackageUserPrompt({
          direction: input.direction,
          outlineMarkdown: input.outlineMarkdown,
          draftMarkdown: renderShortFictionDraftMarkdown(input.draft, input.language),
          draftTitle: input.draft.storyTitle,
          reviewContext:input.reviewContext,
        }, input.language) },
      ], {
        name: "submit_short_package",
        label: "Submit short-fiction package",
        description: "Submit title, synopsis, selling points, and cover prompt.",
        parameters: ShortPackageToolSchema,
      }, {  maxTokens: Math.min(4096, safeShortFictionOutputBudget(this.ctx.client.defaults.maxTokens)) });

    const result = response.result;
    const title = result.title.trim();
    const intro = result.intro.trim();
    const sellingPoints = result.sellingPoints.map((point) => point.trim());
    if (!title || !intro || sellingPoints.some((point) => !point)) {
      throw new Error("Short-fiction packaging returned incomplete structured fields.");
    }
    return {
      title,
      intro,
      sellingPoints,
      coverPrompt: result.coverPrompt.trim(),
      rawContent: [
        `# ${title}`,
        `## Intro\n${intro}`,
        `## Selling Points\n${sellingPoints.map((point) => `- ${point}`).join("\n")}`,
        `## Cover Prompt\n${result.coverPrompt.trim()}`,
      ].join("\n\n"),
    };
  }
}

function mergeShortFictionBatch(
  current: ShortFictionBatchDraft | undefined,
  batch: {
    readonly storyTitle: string;
    readonly openingHook?: string;
    readonly chapters: ReadonlyArray<{ readonly number: number; readonly title: string; readonly content: string }>;
  },
  expectedChapters: number,
  language: ShortFictionLanguage = "zh",
): ShortFictionBatchDraft {
  const countingMode = resolveLengthCountingMode(language);
  const byNumber = new Map(current?.chapters.map((chapter) => [chapter.number, chapter]) ?? []);
  const seen = new Set<number>();
  for (const chapter of batch.chapters) {
    if (!Number.isInteger(chapter.number) || chapter.number < 1 || chapter.number > expectedChapters) {
      throw new Error(`Short-fiction batch returned invalid chapter number ${chapter.number}.`);
    }
    if (seen.has(chapter.number)) throw new Error(`Short-fiction batch returned duplicate chapter ${chapter.number}.`);
    seen.add(chapter.number);
    const content = chapter.content.trim();
    const title = chapter.title.trim();
    if (!content || !title) throw new Error(`Short-fiction batch returned empty chapter ${chapter.number}.`);
    byNumber.set(chapter.number, {
      number: chapter.number,
      title,
      content,
      charCount: countChapterLength(content, countingMode),
    });
  }
  const storyTitle = current?.storyTitle || batch.storyTitle.trim();
  if (!storyTitle) throw new Error("Short-fiction batch returned an empty story title.");
  // Chapter batches own chapter text, not the existing story's metadata.
  // Global opening changes belong to the explicit whole-story revision plan.
  const openingHook = current ? current.openingHook : batch.openingHook?.trim();
  const chapters = Array.from({ length: expectedChapters }, (_, index) => {
    const number = index + 1;
    return byNumber.get(number) ?? {
      number,
      title: "",
      content: "",
      charCount: 0,
    };
  });
  const draft: ShortFictionBatchDraft = {
    storyTitle,
    ...(openingHook ? { openingHook } : {}),
    chapters,
    rawContent: "",
  };
  return { ...draft, rawContent: renderShortFictionDraftMarkdown(draft, language) };
}
export function validateShortFictionDraftForFinal(
  draft: ShortFictionBatchDraft,
  options?: { readonly title?:string; readonly openingHookChars?:number; readonly expectedChapters?: number; readonly minChapterLength?: number; readonly maxChapterLength?: number; readonly language?: ShortFictionLanguage },
): void {
  if(options?.title&&draft.storyTitle!==options.title)throw Object.assign(new Error("The manuscript title differs from the requested title"),{code:"SHORT_TITLE_MISMATCH",expectedTitle:options.title,actualTitle:draft.storyTitle});
  if(options?.openingHookChars)validateOpeningHook(draft.openingHook,options.openingHookChars,options.language);
  const corrupted = draft.chapters.filter((chapter) => chapter.content.includes("\uFFFD")).map((chapter) => chapter.number);
  if (corrupted.length > 0) {
    throw Object.assign(new Error(`Chapter text contains Unicode replacement characters: ${corrupted.join(", ")}`), {
      code: "SHORT_CHAPTER_TEXT_CORRUPTED", chapters: corrupted,
    });
  }
  if (options?.expectedChapters !== undefined && draft.chapters.length !== options.expectedChapters) {
    throw new Error(`Short-hit draft is incomplete; expected ${options.expectedChapters} chapters, got ${draft.chapters.length}.`);
  }

  const invalidChapters = findIncompleteShortFictionChapters(draft, options);
  if (invalidChapters.length > 0) {
    const details = invalidChapters
      .map((number) => {
        const chapter = draft.chapters.find((item) => item.number === number);
        return `${number} (${chapter?.charCount ?? 0})`;
      })
      .join(", ");
    throw Object.assign(new Error(`Short-fiction draft is incomplete; insufficient chapters: ${details}.`), {
      code: "SHORT_CHAPTER_INCOMPLETE", chapters: invalidChapters,
    });
  }
}

function openingHookLengthContract(target:number,language:ShortFictionLanguage="zh") {
  return {target,minimum:Math.max(1,Math.floor(target*0.75)),maximum:Math.ceil(target*1.25),unit:language==="en"?"words":"non-whitespace-characters"};
}

function validateOpeningHook(hook:string|undefined,target:number,language:ShortFictionLanguage="zh"):void {
  const length=countChapterLength(hook??"",resolveLengthCountingMode(language));
  const {minimum,maximum}=openingHookLengthContract(target,language);
  if(length<minimum||length>maximum)throw Object.assign(new Error(JSON.stringify({code:"SHORT_OPENING_HOOK_CONTRACT",length,minimum,maximum,instruction:"Submit an independent opening scene within the requested length, keeping chapter one complete."})),{code:"SHORT_OPENING_HOOK_CONTRACT",length,minimum,maximum});
}

export function findEmptyShortFictionChapters(draft: ShortFictionBatchDraft): number[] {
  return findIncompleteShortFictionChapters(draft);
}

export function findIncompleteShortFictionChapters(
  draft: ShortFictionBatchDraft,
  options?: { readonly minChapterLength?: number; readonly maxChapterLength?: number; readonly language?: ShortFictionLanguage },
): number[] {
  return draft.chapters
    .filter((chapter) => {
      const length=countChapterLength(chapter.content, resolveLengthCountingMode(options?.language ?? "zh"));
      return !chapter.title.trim() || chapter.content.includes("\uFFFD") || length < (options?.minChapterLength ?? 1) || (options?.maxChapterLength !== undefined && length > options.maxChapterLength);
    })
    .map((chapter) => chapter.number);
}

export function renderShortFictionDraftMarkdown(
  draft: ShortFictionBatchDraft,
  language: ShortFictionLanguage = "zh",
): string {
  const hookHeading = language === "en" ? "## Opening Hook" : "## 开篇钩子";
  const completedChapters = draft.chapters.filter((chapter) => chapter.title.trim() && chapter.content.trim());
  return [
    `# ${draft.storyTitle}`,
    draft.openingHook ? `${hookHeading}\n\n${draft.openingHook}` : "",
    ...completedChapters.map((chapter) => [
      `## ${formatShortFictionChapterHeading(chapter.number, chapter.title, language)}`,
      "",
      chapter.content,
    ].join("\n")),
  ].filter(Boolean).join("\n\n");
}

export function formatShortFictionChapterHeading(
  number: number,
  title: string,
  language: ShortFictionLanguage = "zh",
): string {
  const trimmed = title.trim();
  if (!trimmed) throw new Error(`Short-fiction chapter ${number} has no title.`);
  return language === "en" ? `Chapter ${number}: ${trimmed}` : `第${number}章 ${trimmed}`;
}

// charsPerChapter is the language's native unit (zh chars / en words). The 2.2
// multiplier is calibrated for zh chars (~1-1.5 tokens each); for en words
// (~1.3-1.5 tokens each) it simply leaves extra headroom, which is safe for a cap.
function estimateShortFictionMaxTokens(
  chapterCount: number,
  charsPerChapter: number,
  modelMaxOutput = 24_576,
): number {
  const requested = Math.max(4096, Math.ceil(chapterCount * charsPerChapter * 2.2) + 2048);
  return Math.min(requested, safeShortFictionOutputBudget(modelMaxOutput));
}

export function buildShortFictionChapterBatches(
  chapterNumbers: readonly number[],
  charsPerChapter: number,
  modelMaxOutput: number,
  maxChaptersPerCall?: number,
): number[][] {
  const budget = safeShortFictionOutputBudget(modelMaxOutput);
  const perChapter = Math.max(1, Math.ceil(charsPerChapter * 2.2));
  const batchSize = Math.max(1, Math.min(
    maxChaptersPerCall ?? chapterNumbers.length,
    Math.floor((budget - 2048) / perChapter),
  ));
  const normalized = [...new Set(chapterNumbers)]
    .filter((chapter) => Number.isInteger(chapter) && chapter > 0)
    .sort((a, b) => a - b);
  const batches: number[][] = [];
  for (let index = 0; index < normalized.length; index += batchSize) {
    batches.push(normalized.slice(index, index + batchSize));
  }
  return batches;
}

function safeShortFictionOutputBudget(modelMaxOutput: number): number {
  const usableModelLimit = Number.isFinite(modelMaxOutput) && modelMaxOutput > 0
    ? Math.floor(modelMaxOutput)
    : 12_288;
  return Math.max(1, Math.min(usableModelLimit, 24_576));
}

function allChapterNumbers(chapterCount: number): number[] {
  return Array.from({ length: chapterCount }, (_, index) => index + 1);
}

function selectShortFictionChapters(
  draft: ShortFictionBatchDraft,
  chapterNumbers: readonly number[],
): ShortFictionBatchDraft {
  const selected = new Set(chapterNumbers);
  return {
    ...draft,
    chapters: draft.chapters.filter((chapter) => selected.has(chapter.number)),
  };
}

export function shortReviewSources(input: ShortFictionDraftReviewInput): Map<string, string> {
  const sources = new Map([["outline", input.outlineMarkdown], ["manuscript-title", input.draft.storyTitle],
    ...(input.draft.openingHook ? [["manuscript-opening", input.draft.openingHook] as [string, string]] : []),
    ...input.draft.chapters.map(chapter => [`manuscript-chapter-${chapter.number}`, chapter.title + "\n" + chapter.content] as [string, string]),
  ]);
  if (input.comparison) {
    const before = input.comparison.draft;
    sources.set("baseline-manuscript-title", before.storyTitle);
    if (before.openingHook) sources.set("baseline-manuscript-opening", before.openingHook);
    for (const chapter of before.chapters) {
      const current = input.draft.chapters.find(item => item.number === chapter.number);
      if (chapter.title !== current?.title || chapter.content !== current?.content) {
        sources.set(`baseline-manuscript-chapter-${chapter.number}`, chapter.title + "\n" + chapter.content);
      }
    }
  }
  return sources;
}
export { validateObservationSources as validateShortReviewSources } from "../models/observation.js";
