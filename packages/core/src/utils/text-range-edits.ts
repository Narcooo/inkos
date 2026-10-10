import {Type} from '@sinclair/typebox';
import {splitSourceLines} from './source-text.js';

export const TextEditRangeSchema=Type.Object({startLine:Type.Integer({minimum:1}),endLine:Type.Integer({minimum:1})});
export type TextEditRange={startLine:number;endLine:number};
export const TextEditSelectionSchema=Type.Object({startLine:Type.Integer({minimum:1}),endLine:Type.Integer({minimum:1}),text:Type.String({minLength:1})});
export type TextEditSelection=TextEditRange&{text:string;singleLine?:boolean};

/** Line bounds disambiguate repeated phrases; exact text protects other content on the same line. */
export function textScopedSelectionEditContract(content:string,selections:readonly TextEditSelection[]){
  const lines=splitSourceLines(content);
  const spans=selections.map(selection=>{
    textRangeEditContract(content,[selection]);
    const region=lines.slice(selection.startLine-1,selection.endLine).join('');
    const local=textSelectionEditContract(region,selection.text).ranges[0]!;
    const offset=lines.slice(0,selection.startLine-1).join('').length;
    return{...selection,content:selection.text,protectedPrefix:region.slice(0,local.startOffset),protectedSuffix:region.slice(local.endOffset),startOffset:offset+local.startOffset,endOffset:offset+local.endOffset};
  }).sort((a,b)=>a.startOffset-b.startOffset);
  if(!spans.length||spans.some((s,i)=>i>0&&s.startOffset<spans[i-1]!.endOffset))throw Object.assign(new Error('Editable text selections must be non-overlapping'),{code:'ARTIFACT_EDIT_RANGE_INVALID'});
  return{
    ranges:spans.map((span,index)=>({...span,index})),
    parameters:Type.Object(Object.fromEntries(spans.map((span,index)=>[`selection_${index}_text`,Type.String({description:'Replacement characters for content only. The protectedPrefix and protectedSuffix are already retained; do not reproduce or rewrite them.'})])),{additionalProperties:false}),
    apply(replacements:Record<string,string>){let cursor=0;const output:string[]=[];for(const [index,span] of spans.entries()){
      const replacement=replacements[`selection_${index}_text`]!;
      const body=span.content.endsWith('\n')?replacement.replace(/\r?\n$/,''):replacement;
      if(span.singleLine&&/[\r\n]/.test(body))throw Object.assign(new Error(`selection_${index}_text selects one source line or an inline fragment. Return only its replacement text; do not insert other lines or surrounding document fields.`),{code:'ARTIFACT_EDIT_SHAPE_INVALID',selectionIndex:index});
      output.push(content.slice(cursor,span.startOffset),replacement);cursor=span.endOffset;
    }output.push(content.slice(cursor));return output.join('');},
  };
}

/** Bind an exact source selection before a writing worker chooses replacement prose. */
export function textSelectionEditContract(content:string,targetText:string){
  const start=content.indexOf(targetText);
  if(!targetText||start<0)throw Object.assign(new Error('The selected text is absent from the current chapter'),{code:'ARTIFACT_EDIT_TARGET_NOT_FOUND'});
  if(content.indexOf(targetText,start+1)>=0)throw Object.assign(new Error('The selected text occurs more than once; include enough surrounding text to identify it uniquely'),{code:'ARTIFACT_EDIT_TARGET_AMBIGUOUS'});
  return{
    ranges:[{index:0,content:targetText,startOffset:start,endOffset:start+targetText.length}],
    parameters:Type.Object(Object.fromEntries([['range_0_content',Type.String({description:'Replacement for the exact selected source text. Preserve all text outside this selection.'})]]),{additionalProperties:false}),
    apply(replacements:Record<string,string>):string{return content.slice(0,start)+replacements.range_0_content+content.slice(start+targetText.length);},
  };
}

/** Bind replacement fields to one immutable source and preserve all other bytes. */
export function textRangeEditContract(content:string,ranges:readonly TextEditRange[]){
  const lines=splitSourceLines(content);
  const sorted=[...ranges].sort((a,b)=>a.startLine-b.startLine);
  if(!sorted.length||sorted.some((r,i)=>!Number.isInteger(r.startLine)||!Number.isInteger(r.endLine)||r.startLine<1||r.endLine<r.startLine||r.endLine>lines.length||(i>0&&r.startLine<=sorted[i-1]!.endLine))){
    throw Object.assign(new Error(`Editable ranges must be non-overlapping source lines between 1 and ${lines.length}`),{code:'ARTIFACT_EDIT_RANGE_INVALID',recovery:{action:'workspace__read',reason:'Use the numbered source and exact revision from read; do not extend a range past totalLines.'}});
  }
  return{
    ranges:sorted.map((range,index)=>({...range,index,content:lines.slice(range.startLine-1,range.endLine).join('')})),
    parameters:Type.Object(Object.fromEntries(sorted.map((range,index)=>[`range_${index}_content`,Type.String({description:`Replacement for source lines ${range.startLine}-${range.endLine}, including the original trailing newline when present.`})])),{additionalProperties:false}),
    apply(replacements:Record<string,string>):string{
      let cursor=0;const output:string[]=[];
      for(let index=0;index<sorted.length;index++){
        const range=sorted[index]!;
        output.push(lines.slice(cursor,range.startLine-1).join(''),replacements[`range_${index}_content`]!);
        cursor=range.endLine;
      }
      output.push(lines.slice(cursor).join(''));
      return output.join('');
    },
  };
}
