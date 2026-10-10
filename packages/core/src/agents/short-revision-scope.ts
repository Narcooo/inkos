import {Type, type Static} from '@sinclair/typebox';
import type {ShortFictionBatchDraft} from './short-fiction.js';

export const ShortAuthorScopeSchema = Type.Object({
  wholeManuscript: Type.Boolean({description:'True only when the author permits rewriting or restructuring the whole manuscript.'}),
  chapterNumbers: Type.Array(Type.Integer({minimum:1})),
  opening: Type.Boolean({description:'Permission to change the independent opening scene.'}),
  outline: Type.Boolean({description:'Permission to change the saved story plan.'}),
}, {additionalProperties:false});
export type ShortAuthorScope = Static<typeof ShortAuthorScopeSchema>;

export function shortAuthorScopeRequest(draft:ShortFictionBatchDraft, authorRequest:string) {
  return {
    messages:[
      {role:'system' as const,content:'Identify which existing manuscript parts the author permits changing. Select chapter numbers from the supplied manuscript. Reviewing the whole story or refreshing sales packaging does not authorize rewriting it. A desired emotional or commercial effect does not expand an explicit selected chapter range. An opening-only or outline-only edit has no selected chapters. Select wholeManuscript only for an affirmative whole-manuscript rewrite or restructuring request; otherwise preserve unselected parts. Do not write a revision or diagnose quality.'},
      {role:'user' as const,content:JSON.stringify({authorRequest,manuscript:draft})},
    ],
    tool:{name:'submit_short_author_scope',label:'Locate authorized manuscript parts',description:'Select only the manuscript parts the author permits changing.',parameters:ShortAuthorScopeSchema,
      validate:(scope:ShortAuthorScope)=>{
        if(scope.chapterNumbers.some(number=>!draft.chapters.some(chapter=>chapter.number===number))) {
          throw Object.assign(new Error('Select existing chapter numbers.'),{code:'SHORT_REVISION_OUT_OF_SCOPE'});
        }
        return scope;
      }},
  };
}

export function assertShortAuthorScope(scope:ShortAuthorScope, before:ShortFictionBatchDraft, after:ShortFictionBatchDraft, beforeOutline:string, afterOutline:string):void {
  if(scope.wholeManuscript)return;
  const preserved=before.chapters.filter(chapter=>!scope.chapterNumbers.includes(chapter.number));
  const changedChapters=preserved.filter(chapter=>{
    const next=after.chapters.find(item=>item.number===chapter.number);
    return !next||next.title!==chapter.title||next.content!==chapter.content;
  }).map(chapter=>chapter.number);
  const changedParts=[
    ...(before.storyTitle!==after.storyTitle?['title']:[]),
    ...(!scope.opening&&(before.openingHook??'')!==(after.openingHook??'')?['opening']:[]),
    ...(!scope.outline&&beforeOutline!==afterOutline?['outline']:[]),
    ...(before.chapters.length!==after.chapters.length?['chapterCount']:[]),
  ];
  if(changedChapters.length||changedParts.length)throw Object.assign(new Error('The revision changes protected manuscript parts.'),{
    code:'SHORT_REVISION_OUT_OF_SCOPE',changedChapters,changedParts,
  });
}
