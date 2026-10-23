import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Value} from '@sinclair/typebox/value';
import {AuthorTextScopeSchema, authorTextScopeContract, type AuthorTextScope, type AuthorTextEditContract} from '../agents/author-edit-scope.js';
import {commitAtomicFileSet} from '../utils/atomic-file-set.js';
import {recordExecutionEvidence} from './execution-evidence.js';
import {textOffsetSelectionEditContract,textRangeEditContract,type TextEditRange} from '../utils/text-range-edits.js';
import {splitSourceLines} from '../utils/source-text.js';

/** A tool operation may narrow author permission, never widen it. Build only
 * the intersecting slots so a writer cannot reset earlier permitted changes. */
export function narrowAuthorTextPermission(content:string,permission:AuthorTextEditContract,ranges:readonly TextEditRange[]):AuthorTextEditContract{
  const operation=textRangeEditContract(content,ranges);
  const offsets=[0];for(const line of splitSourceLines(content))offsets.push(offsets.at(-1)!+line.length);
  const spans=permission.ranges.flatMap(range=>{
    const start='startOffset' in range?range.startOffset:offsets[range.startLine-1]!;
    const end='endOffset' in range?range.endOffset:offsets[range.endLine]!;
    return operation.ranges.flatMap(limit=>{
      const limitStart=offsets[limit.startLine-1]!,limitEnd=offsets[limit.endLine]!;
      // A deleted slot at a shared line boundary belongs to the following
      // range; EOF belongs to the last range. Never emit it twice.
      if(start===end&&(start<limitStart||start>limitEnd||(start===limitEnd&&limitEnd<content.length)))return [];
      const startOffset=Math.max(start,limitStart),endOffset=Math.min(end,limitEnd);
      if(startOffset>endOffset||(startOffset===endOffset&&start!==end))return [];
      return [{startOffset,endOffset,singleLine:'singleLine' in range&&range.singleLine===true}];
    });
  });
  if(!spans.length)throw Object.assign(new Error('The current operation ranges do not contain any author-authorized text. Read the current revision and select ranges within the original permission.'),{code:'ARTIFACT_EDIT_OPERATION_BOUNDARY'});
  return{...textOffsetSelectionEditContract(content,spans),focus:permission.focus,originalSelectionTexts:permission.originalSelectionTexts??permission.ranges.map(range=>range.content)};
}

/** Match immutable fragments around arbitrary replacements without regex
 * backtracking. Earliest ordered matches leave maximal room for later pieces. */
export function matchesProtectedFragments(content:string,parts:readonly string[]):boolean{
  const prefix=parts[0]??'',suffix=parts.at(-1)??'';
  if(!content.startsWith(prefix)||!content.endsWith(suffix))return false;
  let cursor=prefix.length;
  const end=content.length-suffix.length;
  if(cursor>end)return false;
  for(const part of parts.slice(1,-1)){
    const index=content.indexOf(part,cursor);
    if(index<0||index+part.length>end)return false;
    cursor=index+part.length;
  }
  return true;
}

/** Resolve permission once against the request's immutable source. Later prose
 * can change paragraph counts, but cannot redefine what the author selected. */
export async function resolveAuthorTextPermission(input:{
  projectRoot:string; workId:string; artifactId:string; revisionId:string;
  originalContent:string; currentContent:string; authorRequest:string;
  selectorVersion?:number;
  select:(source:string,authorRequest:string)=>Promise<AuthorTextScope>;
}) {
  const {projectRoot,workId,artifactId,revisionId,originalContent,currentContent,authorRequest}=input;
  const key=createHash('sha256').update(JSON.stringify({version:input.selectorVersion??1,workId,artifactId,revisionId,originalContent,authorRequest})).digest('hex');
  const relativePath=join('.inkos','author-text-permissions',`${key}.json`);
  let selected:AuthorTextScope;
  try { selected=Value.Parse(AuthorTextScopeSchema,JSON.parse(await readFile(join(projectRoot,relativePath),'utf8'))); }
  catch(error) {
    if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
    selected=await input.select(originalContent,authorRequest);
    authorTextScopeContract(originalContent,selected);
    await commitAtomicFileSet({rootDir:projectRoot,writes:[{relativePath,content:JSON.stringify(selected,null,2)}]});
  }
  const originalContract=authorTextScopeContract(originalContent,selected);
  let contract=originalContract;
  if(!selected.wholeDocument&&currentContent!==originalContent){
    const ranges=originalContract.ranges.map(range=>{
      if(!('startOffset' in range)||!('endOffset' in range)||typeof range.startOffset!=='number'||typeof range.endOffset!=='number')throw new Error('Partial author selections require source offsets.');
      return {startOffset:range.startOffset,endOffset:range.endOffset,singleLine:'singleLine' in range&&range.singleLine===true};
    });
    const merged:typeof ranges=[];
    for(const range of ranges){
      const previous=merged.at(-1);
      if(previous&&previous.endOffset===range.startOffset){previous.endOffset=range.endOffset;previous.singleLine=previous.singleLine&&range.singleLine&&!/[\r\n]/u.test(originalContent.slice(previous.startOffset,previous.endOffset));}
      else merged.push({...range});
    }
    let cursor=0;
    const protectedParts=merged.map(range=>{const text=originalContent.slice(cursor,range.startOffset);cursor=range.endOffset;return text;});
    protectedParts.push(originalContent.slice(cursor));
    if(!matchesProtectedFragments(currentContent,protectedParts))throw Object.assign(new Error('Protected source changed after this request began. Start a new request against the current revision.'),{code:'ARTIFACT_EDIT_BASELINE_CONFLICT',workId,artifactId,revisionId});
    const left:number[]=[],right:number[]=[];
    cursor=protectedParts[0]!.length;
    for(const part of protectedParts.slice(1,-1)){const index=currentContent.indexOf(part,cursor);left.push(index);cursor=index+part.length;}
    cursor=currentContent.length-protectedParts.at(-1)!.length;
    for(let i=protectedParts.length-2;i>=1;i--){const part=protectedParts[i]!;const index=currentContent.lastIndexOf(part,cursor-part.length);right.unshift(index);cursor=index;}
    if(left.some((position,index)=>position!==right[index]))throw Object.assign(new Error('The current text has multiple possible mappings to the original edit selections. Do not guess or widen the edit.'),{code:'ARTIFACT_EDIT_BASELINE_AMBIGUOUS',workId,artifactId,revisionId});
    cursor=protectedParts[0]!.length;
    const projected=merged.map((range,index)=>{
      const endOffset=index<left.length?left[index]!:currentContent.length-protectedParts.at(-1)!.length;
      const span={startOffset:cursor,endOffset,singleLine:range.singleLine};cursor=endOffset+protectedParts[index+1]!.length;return span;
    });
    contract={...textOffsetSelectionEditContract(currentContent,projected),focus:originalContract.focus};
  }else if(selected.wholeDocument&&currentContent!==originalContent){
    contract=authorTextScopeContract(currentContent,selected);
  }
  const originalSelectionTexts=originalContract.ranges.map(range=>range.content);
  recordExecutionEvidence('edit-scope-selected',{workId,artifactId,revisionId,authority:'author_request',sourceRanges:originalContract.ranges,ranges:contract.ranges,currentContentHash:createHash('sha256').update(currentContent).digest('hex')});
  return {...contract,originalSelectionTexts};
}
