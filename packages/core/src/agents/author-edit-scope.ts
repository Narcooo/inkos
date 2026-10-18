import {Type,type Static} from '@sinclair/typebox';
import {splitSourceLines} from '../utils/source-text.js';
import {textRangeEditContract,textScopedSelectionEditContract} from '../utils/text-range-edits.js';
import type {SourceIdentity} from './source-locator.js';

export const AuthorTextScopeSchema=Type.Object({
  wholeDocument:Type.Boolean(),
  selections:Type.Array(Type.Object({
    unitId:Type.String({description:'A paragraph or line ID supplied in the document.'}),
    text:Type.String({description:'Empty selects the complete source unit. For a partial-line edit, copy only the exact editable substring.'}),
  },{additionalProperties:false})),
  reason:Type.String({description:'Identify the author-authorized units and protected boundaries.'}),
},{additionalProperties:false});
export type AuthorTextScope=Static<typeof AuthorTextScopeSchema>;

export const AUTHOR_TARGET_AUTHORITY='Treat the requested identity and position as hard boundaries, even when another character or passage better fits the requested emotional effect. Never substitute a different target based on your interpretation of the plot.';

/** Present source text once, with stable paragraph and line addresses. The
 * model selects addresses instead of reproducing whole paragraphs and bounds. */
export function sourceUnits(content:string){
  const paragraphs:Array<{id:string;lines:Array<{id:string;text:string}>}>=[];
  const byId=new Map<string,{startLine:number;endLine:number;text:string}>();
  let paragraph:typeof paragraphs[number]|undefined;
  splitSourceLines(content).forEach((text,index)=>{
    if(!text.trim()){paragraph=undefined;return;}
    if(!paragraph){
      paragraph={id:`p${paragraphs.length+1}`,lines:[]};
      paragraphs.push(paragraph);
    }
    const line={id:`${paragraph.id}.l${paragraph.lines.length+1}`,text};
    paragraph.lines.push(line);
    byId.set(line.id,{startLine:index+1,endLine:index+1,text});
    const previous=byId.get(paragraph.id);
    byId.set(paragraph.id,{startLine:previous?.startLine??index+1,endLine:index+1,text:(previous?.text??'')+text});
  });
  return{paragraphs,byId};
}

/** Scope interpretation sees original author intent and source only, never a
 * coordinator's proposed workaround or pressure to satisfy another constraint. */
export function authorTextScopeRequest(content:string,authorRequest:string,documentIdentity?:SourceIdentity){
  return{
    messages:[
      {role:'system' as const,content:`Locate the smallest exact source units authorized by the author; do not rewrite them. ${AUTHOR_TARGET_AUTHORITY} documentIdentity identifies the complete supplied document, even when its prose does not repeat a chapter heading. Other documents named in the request are not inside it. Select every occurrence of the qualified target in this document, including unambiguous references back to the same item; do not stop at its first mention. The numbered paragraphs contain individual lines, each with a supplied ID. Select paragraph IDs for entire paragraphs, line IDs for entire lines, and an exact substring within a selected line only for inline edits. An empty selection text means the complete selected unit. Preserve labels, stage directions and surrounding text when only dialogue is requested. The desired creative effect does not authorize selecting extra units. Use wholeDocument=true with no selections only when the author permits rewriting everything.`},
      {role:'system' as const,content:'Read the entire original authorRequest to identify each distinct permitted target in this document. Do not reduce a request with several corrections to the last or most salient one. When only dates, names, quantities or other words may change, copy their exact substrings and leave the rest of each sentence protected. Do not select an entire line merely because it contains an editable expression. For these reference targets, never use an empty text shortcut: a whole paragraph is selectable only if authorized as a whole, and its text must then be copied exactly. Include all qualified occurrences; title or independent-opening instructions do not select chapter prose.'},
      {role:'user' as const,content:JSON.stringify({authorRequest,...(documentIdentity?{documentIdentity}:{}),document:sourceUnits(content).paragraphs})},
    ],
  };
}

export function authorTextScopeContract(content:string,result:AuthorTextScope){
  if(result.wholeDocument){
    if(result.selections.length)throw new Error('Whole-document scope must not also select partial text');
    return textRangeEditContract(content,[{startLine:1,endLine:splitSourceLines(content).length}]);
  }
  const {byId}=sourceUnits(content);
  const selections=result.selections.map(selection=>{
    const unit=byId.get(selection.unitId);
    if(!unit)throw Object.assign(new Error('Choose an existing paragraph or line ID from the supplied document.'),{code:'ARTIFACT_EDIT_TARGET_NOT_FOUND'});
    const inlineFragment = Boolean(selection.text && selection.text !== unit.text && unit.startLine === unit.endLine);
    return{...unit,text:selection.text||unit.text,singleLine:selection.unitId.includes('.l')||inlineFragment};
  });
  return textScopedSelectionEditContract(content,selections);
}

/** Independent requested targets may overlap; their union never adds source bytes. */
export function mergeAuthorTextScopes(content:string,scopes:readonly AuthorTextScope[]):AuthorTextScope{
  const spans=scopes.flatMap(scope=>{
    if(scope.wholeDocument)throw new Error('Reference targets require source selections');
    return scope.selections.length?(authorTextScopeContract(content,scope) as ReturnType<typeof textScopedSelectionEditContract>).ranges:[];
  }).map(span=>({startOffset:span.startOffset,endOffset:span.endOffset,singleLine:span.singleLine})).sort((a,b)=>a.startOffset-b.startOffset);
  const merged:typeof spans=[];
  for(const span of spans){
    const previous=merged.at(-1);
    if(previous&&span.startOffset<previous.endOffset){previous.endOffset=Math.max(previous.endOffset,span.endOffset);previous.singleLine=Boolean(previous.singleLine&&span.singleLine);}
    else merged.push({...span});
  }
  const lines=splitSourceLines(content),offsets=[0];for(const line of lines)offsets.push(offsets.at(-1)!+line.length);
  const units=[...sourceUnits(content).byId].map(([id,unit])=>({id,start:offsets[unit.startLine-1]!,end:offsets[unit.endLine]!,line:id.includes('.l')}));
  const selections=merged.map(span=>{
    const unit=units.filter(unit=>unit.start<=span.startOffset&&unit.end>=span.endOffset)
      .sort((a,b)=>(a.line===Boolean(span.singleLine)?0:1)-(b.line===Boolean(span.singleLine)?0:1)||(a.end-a.start)-(b.end-b.start))[0]!;
    return{unitId:unit.id,text:content.slice(span.startOffset,span.endOffset)};
  });
  return{wholeDocument:false,selections,reason:scopes.map(scope=>scope.reason).join('\n')};
}

/** Report the same source selections enforced by the host to the coordinator. */
export function authorEditPermission(scope:ReturnType<typeof authorTextScopeContract>|undefined){
  if(!scope||!('startOffset' in scope.ranges[0]!))return undefined;
  return {basis:'original_author_request' as const,selectedOriginalText:scope.ranges.map(range=>range.content),surroundingText:'protected' as const};
}
