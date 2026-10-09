import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {createLLMClient} from '../llm/provider.js';
import {ReviserAgent} from '../agents/reviser.js';
import {chapterRevisionCandidate} from '../pipeline/chapter-revision-candidate.js';
import {buildLengthSpec} from '../utils/length-metrics.js';
import {WriterAgent} from '../agents/writer.js';
import {createInitialRuntimeState,loadRuntimeStateSnapshot} from '../state/runtime-state-store.js';

it('resumes the closest rejected revision after recreation without adopting it or reusing it for changed requests or sources',async()=>{
 const root=await mkdtemp(join(tmpdir(),'inkos-revision-recovery-')),source='source '.repeat(30),sourcePath=join(root,'accepted.md');
 await writeFile(sourcePath,source);
 const spec=buildLengthSpec(10,'en',{minChapterLength:8,maxChapterLength:12});
 const input={projectRoot:root,bookId:'work',chapterNumber:2,source,authorRequest:'Revise chapter two in 8 to 12 words.',lengthSpec:spec};
 let calls=0,resuming=false;
 const server=createServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));const body=JSON.parse(Buffer.concat(chunks).toString());
  if(resuming){
   const inputs=body.messages.filter((m:any)=>m.role==='user').flatMap((m:any)=>{try{return[JSON.parse(m.content)];}catch{return[];}});
   expect(inputs.find((m:any)=>m.unfinishedCandidate)?.unfinishedCandidate).toBe('candidate '.repeat(13));
  }
  const count=resuming?11:[18,13,17][calls++]!;
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'candidate-'+calls,type:'function',function:{name:'submit_revised_chapter',arguments:JSON.stringify({revisedContent:'candidate '.repeat(count)})}}]}}]}));
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const client=createLLMClient({provider:'openai',service:'custom',configSource:'studio',apiFormat:'chat',stream:false,model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,thinkingBudget:0});
  const ctx={client,model:'fixture',projectRoot:root},options={language:'en' as const,lengthSpec:spec,contextPackage:{chapter:2,selectedContext:[]}};
  const first=await chapterRevisionCandidate(input);
  await expect(new ReviserAgent(ctx).reviseChapter(root,source,2,[],'rewrite',undefined,{...options,onCandidate:first.record})).rejects.toMatchObject({code:'CHAPTER_LENGTH_OUT_OF_RANGE'});
  expect(await readFile(sourcePath,'utf8')).toBe(source);
  const checkpoint=join(root,'.inkos/chapter-revision-candidates/work/2.json');
  const legacy={...JSON.parse(await readFile(checkpoint,'utf8')),version:1,
    identity:createHash('sha256').update(JSON.stringify([input.source,input.authorRequest,input.lengthSpec])).digest('hex')};
  await writeFile(checkpoint,JSON.stringify(legacy));
  expect((await chapterRevisionCandidate({...input,lengthSpec:{...spec,target:11}})).current()).toBeUndefined();
  const restored=await chapterRevisionCandidate(input);
  expect(restored.current()).toMatchObject({version:2,count:13,distance:1});
  expect((await chapterRevisionCandidate({...input,lengthSpec:{...spec,target:11}})).current()?.content).toBe(restored.current()!.content);
  expect((await chapterRevisionCandidate({...input,lengthSpec:{...spec,maxChapterLength:10}})).current()).toBeUndefined();
  expect((await chapterRevisionCandidate({...input,authorRequest:'A different task.'})).current()).toBeUndefined();
  expect((await chapterRevisionCandidate({...input,source:'Another source.'})).current()).toBeUndefined();
  resuming=true;
  const result=await new ReviserAgent(ctx).reviseChapter(root,source,2,[],'rewrite',undefined,{...options,candidateText:restored.current()!.content,onCandidate:restored.record});
  expect(result.wordCount).toBe(11);
  await writeFile(sourcePath,result.revisedContent);await restored.complete();
  expect((await chapterRevisionCandidate(input)).current()).toBeUndefined();
  expect(await readFile(sourcePath,'utf8')).toBe(result.revisedContent);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
},20000);

it('checks explicit draft bounds before story-state settlement and resumes the saved draft before committing a chapter',async()=>{
 const root=await mkdtemp(join(tmpdir(),'inkos-draft-recovery-')),calls:string[]=[];
 const drafts=[
  'Mara quietly returns the borrowed key and waits alone beside the locked door while the owner checks it.',
  'Mara quietly returns the borrowed key and waits alone beside the locked door.',
  'Mara returns the borrowed key and waits alone beside the locked door while the owner checks it.',
  'Mara quietly returns the borrowed key and waits beside the door.',
 ];let draftIndex=0,repairIndex=0;
 const server=createServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));const body=JSON.parse(Buffer.concat(chunks).toString());const name=body.tools[0].function.name;calls.push(name);
  const args=name==='submit_chapter_draft'?{title:'Return',content:drafts[draftIndex++]}:name==='submit_revised_chapter'?{revisedContent:[drafts[0],drafts[1],drafts[2],drafts[3]][repairIndex++]}:{postSettlement:'The key is returned.',factOps:{upsert:[],expire:[]},hookOps:{upsert:[],mention:[],resolve:[],defer:[]},newHookCandidates:[],chapterSummary:{title:'Return',characters:'Mara',events:'The key is returned.',stateChanges:'',hookActivity:'',mood:'calm',chapterType:'resolution'}};
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'draft-'+calls.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]}));
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  await mkdir(join(root,'story'),{recursive:true});await writeFile(join(root,'story/book_rules.json'),JSON.stringify({version:'2',prohibitions:[],enableFullCastTracking:false,allowedDeviations:[]}));
  await writeFile(join(root,'story/book_rules.md'),'Preserve established facts.');
  await createInitialRuntimeState({bookDir:root,language:'en'});
  const client=createLLMClient({provider:'openai',service:'custom',configSource:'studio',apiFormat:'chat',stream:false,model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,thinkingBudget:0});
  const writer=new WriterAgent({client,model:'fixture',projectRoot:root}),now=new Date().toISOString(),lengthSpec=buildLengthSpec(10,'en',{minChapterLength:8,maxChapterLength:12});
  const identity={projectRoot:root,bookId:'work',chapterNumber:1,source:'Unchanged initial story state.',authorRequest:'Write the return in 8 to 12 words.',lengthSpec};
  const input={book:{id:'work',title:'Return',genre:'general',platform:'other',status:'active' as const,targetChapters:1,chapterWordCount:10,language:'en' as const,createdAt:now,updatedAt:now},bookDir:root,chapterNumber:1,chapterIntent:'Return the key.',chapterMemo:{chapter:1,goal:'Return the key.',body:'Mara returns the key.',threadRefs:[]},contextPackage:{chapter:1,selectedContext:[]},lengthSpec};
  const first=await chapterRevisionCandidate(identity);
  await expect(writer.writeChapter({...input,onCandidate:async draft=>first.record(draft.content,draft.title)})).rejects.toMatchObject({code:'CHAPTER_LENGTH_OUT_OF_RANGE'});
  expect(calls).toEqual(['submit_chapter_draft','submit_revised_chapter','submit_revised_chapter','submit_revised_chapter']);
  expect((await loadRuntimeStateSnapshot(root)).manifest.lastAppliedChapter).toBe(0);
  const adjustedSpec={...lengthSpec,target:9};
  const restored=await chapterRevisionCandidate({...identity,lengthSpec:adjustedSpec});expect(restored.current()).toMatchObject({title:'Return',count:13,distance:1});
  const output=await writer.writeChapter({...input,lengthSpec:adjustedSpec,candidateDraft:restored.current(),onCandidate:async draft=>restored.record(draft.content,draft.title)});
  expect(output.wordCount).toBe(11);expect(calls.slice(4)).toEqual(['submit_revised_chapter','submit_runtime_state_delta']);
  await writer.saveChapter(root,output,'en',[{number:1,title:output.title,wordCount:output.wordCount,createdAt:now,updatedAt:now,observations:[],provenance:'generated',lengthSpec}]);await restored.complete();
  expect((await loadRuntimeStateSnapshot(root)).manifest.lastAppliedChapter).toBe(1);
  expect((await chapterRevisionCandidate(identity)).current()).toBeUndefined();
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
},20000);
