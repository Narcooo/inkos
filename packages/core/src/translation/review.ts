import {Type} from '@sinclair/typebox';
import {BaseAgent} from '../agents/base.js';
import {numberReviewSource} from '../models/observation.js';
import type {TranslationModelPort} from './types.js';

type ReviewRequest=Parameters<NonNullable<TranslationModelPort['reviewChapter']>>[0];

/** Read the source before exposing the existing target, then resolve every
 * finding against the original pair. Reference prose is never published. */
export class TranslationReviewAgent extends BaseAgent {
  get name():string { return 'translation-review'; }

  async review(request:ReviewRequest) {
    const originals=request.segments.map(({index,source})=>({index,source}));
    const references:Array<{index:number;target:string}>=[];
    for(let offset=0;offset<originals.length;offset+=16){
      const batch=originals.slice(offset,offset+16);
      const parameters=Type.Object(Object.fromEntries(batch.map(segment=>[
        `segment_${segment.index}_target`,Type.String({minLength:1,description:`Translate original segment ${segment.index} completely.`}),
      ])),{additionalProperties:false});
      const {result}=await this.submitStructured([
        {role:'system',content:'Read and translate the original segments with the activated translation Skill. Preserve meaning, quantities, negation, attribution, chronology and uncertainty. Use the full original passage for context and return only the requested segments in the named fields.'},
        {role:'user',content:JSON.stringify({sourceLanguage:request.sourceLanguage,targetLanguage:request.targetLanguage,
          ...(request.sourceChapterTitle?{chapterTitle:request.sourceChapterTitle}:{}),
          glossary:request.glossary,originals,requestedIndices:batch.map(segment=>segment.index)})},
      ],{
        name:'submit_translation_source_reading',label:'Read original translation source',
        description:'Submit an independent translation of each requested original segment.',parameters,
        validate:result=>{
          const empty=batch.filter(segment=>!result[`segment_${segment.index}_target`]!.trim()).map(segment=>segment.index);
          if(empty.length)throw Object.assign(new Error(JSON.stringify({code:'TRANSLATION_TARGET_EMPTY',segmentIndices:empty})),{code:'TRANSLATION_TARGET_EMPTY'});
          return result;
        },
      },{maxTokens:8192});
      references.push(...batch.map(segment=>({index:segment.index,target:result[`segment_${segment.index}_target`]!})));
    }

    const sources=new Map(request.segments.flatMap(segment=>[
      [`original-${segment.index}`,segment.source],
      [`target-${segment.index}`,segment.target??''],
    ]));
    if(request.sourceChapterTitle)sources.set('original-title',request.sourceChapterTitle);
    sources.set('target-title',request.chapterTitle);
    if(request.glossary.length)sources.set('glossary',JSON.stringify(request.glossary,null,2));
    const referenceByIndex=new Map(references.map(reference=>[reference.index,reference.target]));
    const {result}=await this.submitSourcedReview([
      {role:'system',content:'Review the translation with the activated translation Skill. Compare the target against the original meaning, including quantities, negation, attribution, chronology, omissions and terminology. Valid idiomatic or stylistic differences are not errors. The original source is authoritative; retain substantive ambiguity when the context does not resolve it. Cite original and target passages for each translation issue. Do not rewrite.'},
      {role:'system',content:'Each segment includes an independent source-only reading as a fallible comparison aid, not authority or a replacement target. Differences alone do not establish an error. When the two readings differ in meaning, check which agrees with the original; record a substantive unresolved ambiguity as an observation. Cite the original and current target, never the independent reading.'},
      {role:'user',content:JSON.stringify({sourceLanguage:request.sourceLanguage,targetLanguage:request.targetLanguage,chapterTitle:request.chapterTitle})},
      {role:'user',content:request.segments.map(segment=>[
        `## Segment ${segment.index}`,
        `### Source: original-${segment.index}\n${numberReviewSource(segment.source)}`,
        `### Source: target-${segment.index}\n${numberReviewSource(segment.target??'')}`,
        `### Independent reading (comparison aid)\n${referenceByIndex.get(segment.index)}`,
      ].join('\n\n')).join('\n\n')},
      {role:'user',content:[...sources].filter(([id])=>id==='glossary'||id.endsWith('-title'))
        .map(([id,text])=>`## Source: ${id}\n${numberReviewSource(text)}`).join('\n\n')},
    ],sources,{
      name:'submit_translation_review',label:'Submit translation review',
      description:'Finish the translation review with its recorded findings.',
    },{maxTokens:4096,categoryRequired:true,validateObservations:observations=>{
      const unpaired=observations.filter(observation=>observation.assessment==='issue'&&(
        !observation.sourceRefs.some(reference=>reference.sourceId.startsWith('original-'))||
        !observation.sourceRefs.some(reference=>reference.sourceId.startsWith('target-'))
      )).map(observation=>observation.code);
      if(unpaired.length)throw Object.assign(new Error(JSON.stringify({
        code:'TRANSLATION_REVIEW_PAIR_REQUIRED',observationCodes:unpaired,
        instruction:'Cite both the original and current target passages establishing each issue, or withdraw it. The independent reading is not source evidence.',
      })),{code:'TRANSLATION_REVIEW_PAIR_REQUIRED'});
    }});
    return result;
  }
}
