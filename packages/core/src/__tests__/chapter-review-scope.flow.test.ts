import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorkManifest,saveWorkManifest} from '../harness/work-store.js';
import {syncWorkSourceArtifacts} from '../harness/source-sync.js';
import {withExecutionEvidence} from '../harness/execution-evidence.js';
import {ContinuityAuditor} from '../agents/continuity.js';
import {createLLMClient} from '../llm/provider.js';
import {TurnArtifactDeliveries} from '../agent/turn-completion.js';
import {ActionResultSchema} from '../harness/contracts.js';
import {fixtureToolCalls,isReviewReadback} from './tool-call-fixtures.js';
import {resolveOperationEvidence} from '../harness/operation-receipts.js';
import {chapterReviewContentHash} from '../utils/chapter-review-hash.js';

it('reviews a native chapter against its episode baseline and prevents delivery while its scope finding is unresolved',async()=>{
 const root=await mkdtemp(join(tmpdir(),'inkos-chapter-scope-'));const inputs:any[]=[];
 const server=createServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const input=JSON.parse(body.messages.findLast((m:any)=>m.role==='user').content);if(!isReviewReadback(body.messages))inputs.push(input);
  const observation={code:'FIXTURE_EDIT_SCOPE',category:'scope',assessment:inputs.length===1?'issue':'resolved',summary:'Fixture scope assessment against before/current source.',sourceRefs:[{sourceId:'chapter-1',startLine:1,endLine:1},{sourceId:input.comparison.sourceId,startLine:1,endLine:1}]};
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:fixtureToolCalls(body.tools[0].function.name,{summary:'Scoped chapter review.',observations:[observation]},'review-'+inputs.length,body.messages)}}]}));
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  await saveWorkManifest(root,createWorkManifest({id:'book',title:'Gallery',profileId:'longform-novel',language:'en'}));await mkdir(join(root,'works/book/source/chapters'),{recursive:true});
  const path='works/book/source/chapters/0001_Closing.md';
  const initialBody='Nora opens the gallery.\n\nShe checks the clock.\n';
  const before=await syncWorkSourceArtifacts({projectRoot:root,workId:'book',accept:true,writes:[{relativePath:path,content:'# Chapter 1: Closing\n\n'+initialBody}]});
  const client=createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat',stream:false,temperature:0,thinkingBudget:0});
  const auditor=new ContinuityAuditor({client,model:'fixture',projectRoot:root,bookId:'book'}),deliveries=new TurnArtifactDeliveries();
  for(const [index,body] of ['Eli closes the gallery.\n\nShe checks the time on her watch.\n','Nora opens the gallery.\n\nShe checks the time on her watch.\n'].entries()){
   const current=await syncWorkSourceArtifacts({projectRoot:root,workId:'book',accept:true,writes:[{relativePath:path,content:'# Chapter 1: Closing\n\n'+body}]});
   const review=await withExecutionEvidence(()=>{},()=>auditor.auditChapter('',body,1,undefined,{language:'en',contextPackage:{chapter:1,selectedContext:[]}}),undefined,before,'Change only the final paragraph, preserving the first paragraph; review the result.');
   expect(review.reviewedArtifact).toEqual({workId:'book',artifactId:current.artifacts[0]!.id,revisionId:current.artifacts[0]!.currentRevisionId});
   expect(inputs[index].comparison).toMatchObject({scope:'episode_start',before:{revisionId:before.artifacts[0]!.currentRevisionId},after:{revisionId:current.artifacts[0]!.currentRevisionId}});
   deliveries.observe(ActionResultSchema.parse({status:'success',summary:review.summary,artifacts:[],observations:review.observations,data:{kind:'chapter_review',workId:'book',reviewedArtifact:review.reviewedArtifact,observations:review.observations}}));
   if(index===0)await expect(deliveries.validate(root)).rejects.toMatchObject({code:'TURN_REVISION_SCOPE_UNRESOLVED'});
   else await expect(deliveries.validate(root)).resolves.toBeUndefined();
  }
  expect(inputs).toHaveLength(2);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
},20000);

it('keeps batch review findings on their own chapter and clears them after that chapter is repaired and reviewed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'inkos-batch-review-'));
 try{
  await saveWorkManifest(root,createWorkManifest({id:'book',title:'Gallery',profileId:'longform-novel',language:'en'}));
  await mkdir(join(root,'works/book/source/chapters'),{recursive:true});
  const bodies=['Nora keeps the gallery key.','Eli keeps the same gallery key.'];
  const paths=['works/book/source/chapters/0001_Opening.md','works/book/source/chapters/0002_Closing.md'];
  const persist=()=>syncWorkSourceArtifacts({projectRoot:root,workId:'book',accept:true,writes:bodies.map((body,index)=>({relativePath:paths[index]!,content:`# Chapter ${index+1}\n\n${body}\n`}))});
  const before=await persist(),deliveries=new TurnArtifactDeliveries();
  const target=before.artifacts.find(a=>a.revisions.some(r=>r.path==='source/chapters/0002_Closing.md'))!;
  const issue={code:'FIXTURE_POSSESSION',summary:'Two chapters assign the same key to different people without a handover.',assessment:'issue' as const,category:'quality' as const,evidence:[],targetHash:chapterReviewContentHash(bodies[1]!,2)};
  const details={kind:'chapters_written',workId:'book',chapters:[{chapterNumber:1,observations:[]},{chapterNumber:2,observations:[issue]}],reviewedChapters:bodies.map((body,index)=>({chapterNumber:index+1,contentHash:chapterReviewContentHash(body,index+1)})),observations:[issue]};
  const observe=async(data:typeof details|{kind:string;workId:string;reviewedChapters:Array<{chapterNumber:number;contentHash:string}>;observations:[]})=>{
   const evidence=await resolveOperationEvidence(root,data,data.observations);
   deliveries.observe(ActionResultSchema.parse({status:'success',summary:'Chapter review completed.',artifacts:[],...evidence,data:{...data,observations:evidence.observations}}));
  };
  await observe(details);
  const restored=new TurnArtifactDeliveries();
  const recordedSources=before.artifacts.map(artifact=>{const revision=artifact.revisions.find(r=>r.id===artifact.currentRevisionId)!;return{workId:'book',artifactId:artifact.id,revisionId:revision.id,path:revision.path};});
  const recordedReceipts=(await resolveOperationEvidence(root,details,details.observations)).operationReceipts;
  restored.observe(ActionResultSchema.parse({status:'success',summary:'Recorded batch before source binding.',artifacts:recordedSources,operationReceipts:recordedReceipts,observations:details.observations,data:details}));
  expect(restored.qualityFindings()).toEqual(deliveries.qualityFindings());
  await expect(deliveries.validate(root)).resolves.toBeUndefined();
  expect(deliveries.qualityFindings().map(finding=>({artifactId:finding.artifactId,codes:finding.observations.map(item=>item.code)})))
    .toEqual([{artifactId:target.id,codes:[issue.code]}]);
  bodies[1]='Nora hands the gallery key to Eli.';await persist();
  await observe({kind:'chapter_revision',workId:'book',reviewedChapters:[{chapterNumber:2,contentHash:chapterReviewContentHash(bodies[1],2)}],observations:[]});
  await expect(deliveries.validate(root)).resolves.toBeUndefined();
  expect(deliveries.qualityFindings()).toEqual([]);
 }finally{await rm(root,{recursive:true,force:true});}
});
