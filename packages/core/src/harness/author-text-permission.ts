import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Value} from '@sinclair/typebox/value';
import {AuthorTextScopeSchema, authorTextScopeContract, type AuthorTextScope} from '../agents/author-edit-scope.js';
import {commitAtomicFileSet} from '../utils/atomic-file-set.js';
import {recordExecutionEvidence} from './execution-evidence.js';

/** Resolve permission once against the request's immutable source. Later prose
 * can change paragraph counts, but cannot redefine what the author selected. */
export async function resolveAuthorTextPermission(input:{
  projectRoot:string; workId:string; artifactId:string; revisionId:string;
  originalContent:string; currentContent:string; authorRequest:string;
  select:(source:string,authorRequest:string)=>Promise<AuthorTextScope>;
}) {
  const {projectRoot,workId,artifactId,revisionId,originalContent,currentContent,authorRequest}=input;
  const key=createHash('sha256').update(JSON.stringify({version:1,workId,artifactId,revisionId,originalContent,authorRequest})).digest('hex');
  const relativePath=join('.inkos','author-text-permissions',`${key}.json`);
  let selected:AuthorTextScope;
  try { selected=Value.Parse(AuthorTextScopeSchema,JSON.parse(await readFile(join(projectRoot,relativePath),'utf8'))); }
  catch(error) {
    if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
    selected=await input.select(originalContent,authorRequest);
    authorTextScopeContract(originalContent,selected);
    await commitAtomicFileSet({rootDir:projectRoot,writes:[{relativePath,content:JSON.stringify(selected,null,2)}]});
  }
  const contract=authorTextScopeContract(originalContent,selected);
  if(!selected.wholeDocument&&currentContent!==originalContent){
    const ranges=contract.ranges.map(range=>{
      if(!('startOffset' in range)||!('endOffset' in range)||typeof range.startOffset!=='number'||typeof range.endOffset!=='number')throw new Error('Partial author selections require source offsets.');
      return {startOffset:range.startOffset,endOffset:range.endOffset};
    });
    let cursor=0;
    const protectedParts=ranges.map(range=>{const text=originalContent.slice(cursor,range.startOffset);cursor=range.endOffset;return text;});
    protectedParts.push(originalContent.slice(cursor));
    const escape=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const pattern=new RegExp('^'+protectedParts.map(escape).join('[\\s\\S]*')+'$(?![\\s\\S])');
    if(!pattern.test(currentContent))throw Object.assign(new Error('Protected source changed after this request began. Start a new request against the current revision.'),{code:'ARTIFACT_EDIT_BASELINE_CONFLICT',workId,artifactId,revisionId});
  }
  recordExecutionEvidence('edit-scope-selected',{workId,artifactId,revisionId,authority:'author_request',ranges:contract.ranges});
  return contract;
}
