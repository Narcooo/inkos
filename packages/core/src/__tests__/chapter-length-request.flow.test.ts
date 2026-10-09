import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {it,expect} from 'vitest';
import {createLLMClient} from '../llm/provider.js';
import {resolveChapterLengthRequest} from '../agents/chapter-length-request.js';
import {ReviserAgent} from '../agents/reviser.js';
import {persistChapterArtifacts} from '../pipeline/chapter-persistence.js';
import {ChapterMetaSchema} from '../models/chapter.js';
import {buildLengthSpec} from '../utils/length-metrics.js';
import {readBookExportSource} from '../interaction/export-artifact.js';

it('carries an original new-chapter range through repair, persisted metadata and export while preserving longer imported text',async()=>{
 const root=await mkdtemp(join(tmpdir(),'inkos-chapter-contract-'));
 const authorRequest='Preserve chapter one. Write chapter two in 8 to 12 words.';
 let bound=true,soft=false,replacements=0;const requests:any[]=[];
 const server=createServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body);
  const name=body.tools[0].function.name;
  const args=name==='submit_chapter_length_bounds'?(bound?{target:0,minimum:8,maximum:12,sourceQuote:'Write chapter two in 8 to 12 words.'}:soft?{target:20,minimum:0,maximum:0,sourceQuote:'Write about twenty words.'}:{target:0,minimum:0,maximum:0,sourceQuote:''}):{revisedContent:replacements++===0?'word '.repeat(18):'Mara quietly returns the key and waits beside the door.'};
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'length-'+requests.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]}));
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const client=createLLMClient({provider:'openai',service:'custom',configSource:'studio',apiFormat:'chat',stream:false,model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,thinkingBudget:0});
  const ctx={client,model:'fixture',projectRoot:root};
  const spec=await resolveChapterLengthRequest(ctx,{authorRequest,workTitle:'After Closing',chapterNumber:2,fallback:buildLengthSpec(20,'en')});
  expect(spec).toMatchObject({target:12,minChapterLength:8,maxChapterLength:12});
  expect(JSON.parse(requests[0].messages.findLast((m:any)=>m.role==='user').content)).toMatchObject({authorRequest,chapterNumber:2});
  expect(requests[0].temperature).toBeUndefined();expect(requests[0].tool_choice).toBeUndefined();
  const revised=await new ReviserAgent(ctx).reviseChapter(root,'word '.repeat(18),2,[],'rewrite',undefined,{language:'en',lengthSpec:spec,contextPackage:{chapter:2,selectedContext:[]}});
  expect(replacements).toBe(2);
  const dir=join(root,'chapters'),indexPath=join(dir,'index.json');await mkdir(dir);
  const original='# Chapter 1: Closing\n\n'+'source '.repeat(30)+'\n';await writeFile(join(dir,'0001_Closing.md'),original);
  const now=new Date().toISOString();await writeFile(indexPath,JSON.stringify([{number:1,title:'Closing',wordCount:30,createdAt:now,updatedAt:now,observations:[],provenance:'imported',lengthSpec:buildLengthSpec(30,'en')}]));
  const loadIndex=async()=>ChapterMetaSchema.array().parse(JSON.parse(await readFile(indexPath,'utf8')));
  await persistChapterArtifacts({chapterNumber:2,chapterTitle:'Return',auditResult:{summary:'Reviewed.',observations:[]},finalWordCount:revised.wordCount,lengthSpec:spec,loadChapterIndex:loadIndex,saveChapter:async index=>{await writeFile(join(dir,'0002_Return.md'),'# Chapter 2: Return\n\n'+revised.revisedContent);await writeFile(indexPath,JSON.stringify(index));},markBookActiveIfNeeded:async()=>{}});
  const state={bookDir:()=>root,loadBookConfig:async()=>({title:'After Closing',language:'en',chapterWordCount:10,minChapterLength:8,maxChapterLength:12}),loadChapterIndex:loadIndex};
  const exported=await readBookExportSource(state,'work');
  expect(exported.delivery.status).toBe('checks_passed');expect(exported.delivery.chapters.map(c=>c.chapterNumber)).toEqual([2]);
  expect(await readFile(join(dir,'0001_Closing.md'),'utf8')).toBe(original);
  bound=false;
  const saved=(await loadIndex()).find(c=>c.number===2)!;
  expect(await resolveChapterLengthRequest(ctx,{authorRequest:'Make the final action quieter.',workTitle:'After Closing',chapterNumber:2,fallback:saved.lengthSpec!})).toEqual(spec);
  soft=true;
  expect(await resolveChapterLengthRequest(ctx,{authorRequest:'Write about twenty words.',workTitle:'After Closing',chapterNumber:2,fallback:saved.lengthSpec!})).toEqual(buildLengthSpec(20,'en'));
  await writeFile(join(dir,'0002_Return.md'),'# Chapter 2: Return\n\n'+'word '.repeat(18));
  expect((await readBookExportSource(state,'work')).delivery.chapters).toMatchObject([{chapterNumber:2,status:'needs_revision',measurements:{count:18}}]);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
},20000);
