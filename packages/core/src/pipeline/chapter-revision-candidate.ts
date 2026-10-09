import {createHash} from 'node:crypto';
import {readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import type {LengthSpec} from '../models/length-governance.js';
import {countChapterLength} from '../utils/length-metrics.js';
import {assertSafeBookId} from '../utils/book-id.js';
import {commitAtomicFileSet} from '../utils/atomic-file-set.js';

const SavedCandidate=z.object({version:z.literal(1),identity:z.string(),title:z.string().optional(),content:z.string().min(1),count:z.number().int().nonnegative(),distance:z.number().nonnegative()}).strict();

/** Rejected prose is recovery input, never the accepted chapter. A changed
 * source, author request or length contract starts a different operation. */
export async function chapterRevisionCandidate(input:{projectRoot:string;bookId:string;chapterNumber:number;source:string;authorRequest:string;lengthSpec:LengthSpec}){
  const relativePath=join('.inkos','chapter-revision-candidates',assertSafeBookId(input.bookId),`${input.chapterNumber}.json`);
  const path=join(input.projectRoot,relativePath);
  const identity=createHash('sha256').update(JSON.stringify([input.source,input.authorRequest,input.lengthSpec])).digest('hex');
  let saved:z.infer<typeof SavedCandidate>|undefined;
  try{const previous=SavedCandidate.parse(JSON.parse(await readFile(path,'utf8')));if(previous.identity===identity)saved=previous;}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  return{
    current:()=>saved,
    async record(content:string,title?:string){
      if(!content.trim())return;
      const count=countChapterLength(content,input.lengthSpec.countingMode);
      const distance=Math.max(0,(input.lengthSpec.minChapterLength??0)-count,count-(input.lengthSpec.maxChapterLength??Infinity));
      if(saved&&distance>saved.distance)return;
      const next=SavedCandidate.parse({version:1,identity,...(title?{title}:{}),content,count,distance});
      await commitAtomicFileSet({rootDir:input.projectRoot,writes:[{relativePath,content:JSON.stringify(next,null,2)+'\n'}]});
      saved=next;
    },
    async complete(){await rm(path,{force:true});},
  };
}
