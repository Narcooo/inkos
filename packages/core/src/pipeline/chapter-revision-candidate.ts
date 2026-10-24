import {createHash} from 'node:crypto';
import {readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import type {LengthSpec} from '../models/length-governance.js';
import type {ReviseOutput} from '../agents/reviser.js';
import {assertChapterLength,countChapterLength} from '../utils/length-metrics.js';
import {assertSafeBookId} from '../utils/book-id.js';
import {commitAtomicFileSet} from '../utils/atomic-file-set.js';

const SettlementInput=z.object({authorityHash:z.string(),contentHash:z.string(),editPermission:z.object({
  basis:z.literal('original_author_request'),selectedOriginalText:z.array(z.string()),surroundingText:z.literal('protected'),
}).strict().optional()}).strict();
const SavedCandidate=z.object({version:z.union([z.literal(1),z.literal(2)]),identity:z.string(),title:z.string().optional(),content:z.string().min(1),count:z.number().int().nonnegative(),distance:z.number().nonnegative(),settlementInput:SettlementInput.optional()}).strict();
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');

/** Rejected prose is recovery input, never the accepted chapter. A changed
 * source, author request or hard length bounds start a different operation.
 * A coordinator's soft length hint must not discard useful unfinished prose. */
export async function chapterRevisionCandidate(input:{projectRoot:string;bookId:string;chapterNumber:number;source:string;authorRequest:string;lengthSpec:LengthSpec}){
  const relativePath=join('.inkos','chapter-revision-candidates',assertSafeBookId(input.bookId),`${input.chapterNumber}.json`);
  const path=join(input.projectRoot,relativePath);
  const {countingMode,minChapterLength,maxChapterLength}=input.lengthSpec;
  const identity=createHash('sha256').update(JSON.stringify([
    input.source,input.authorRequest,{countingMode,minChapterLength,maxChapterLength},
  ])).digest('hex');
  let saved:z.infer<typeof SavedCandidate>|undefined;
  try{
    const previous=SavedCandidate.parse(JSON.parse(await readFile(path,'utf8')));
    if(previous.version===2&&previous.identity===identity)saved=previous;
    else if(previous.version===1){
      // Old checkpoints did not record their inputs separately. Migrate only
      // when the complete old fingerprint can still be verified exactly.
      const legacyIdentity=createHash('sha256').update(JSON.stringify([input.source,input.authorRequest,input.lengthSpec])).digest('hex');
      if(previous.identity===legacyIdentity){
        saved={...previous,version:2,identity};
        await commitAtomicFileSet({rootDir:input.projectRoot,writes:[{relativePath,content:JSON.stringify(saved,null,2)+'\n'}]});
      }
    }
  }
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const persist=async(next:z.infer<typeof SavedCandidate>)=>{
    await commitAtomicFileSet({rootDir:input.projectRoot,writes:[{relativePath,content:JSON.stringify(next,null,2)+'\n'}]});
    saved=next;
  };
  const record=async(content:string,title?:string)=>{
      if(!content.trim())return;
      const count=countChapterLength(content,input.lengthSpec.countingMode);
      const distance=Math.max(0,(input.lengthSpec.minChapterLength??0)-count,count-(input.lengthSpec.maxChapterLength??Infinity));
      if(saved&&distance>saved.distance)return;
      const next=SavedCandidate.parse({version:2,identity,...(title?{title}:{}),content,count,distance});
      await persist(next);
  };
  return{
    current:()=>saved,
    record,
    /** This prose passed edit scope and length, but still awaits story-state
     * projection, review and publication. Never regenerate it just to retry those phases. */
    readyForSettlement(authority:string):ReviseOutput|undefined{
      const ready=saved?.settlementInput;
      if(!saved||!ready||ready.authorityHash!==hash(authority)||ready.contentHash!==hash(saved.content))return undefined;
      assertChapterLength(saved.content,input.lengthSpec);
      return{revisedContent:saved.content,wordCount:countChapterLength(saved.content,input.lengthSpec.countingMode),
        ...(ready.editPermission?{editPermission:ready.editPermission}:{})};
    },
    async prepareSettlement(output:ReviseOutput,authority:string){
      assertChapterLength(output.revisedContent,input.lengthSpec);
      await record(output.revisedContent);
      await persist(SavedCandidate.parse({...saved,settlementInput:{authorityHash:hash(authority),contentHash:hash(output.revisedContent),
        ...(output.editPermission?{editPermission:output.editPermission}:{})}}));
    },
    async complete(){await rm(path,{force:true});},
  };
}
