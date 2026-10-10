import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {it,expect} from 'vitest';
import {createWorkManifest,saveWorkManifest,loadWorkManifest,syncWorkSourceArtifacts,evictAgentCache} from '@actalk/inkos-core';
import {createStudioServer} from '../api/server.js';

it('keeps the original revision across a failed write, server recreation and native retry, while a new request gets a new baseline',async()=>{
 const root=await mkdtemp(join(tmpdir(),'inkos-retry-baseline-'));let phase:'first'|'retry'|'fresh'='first',mainCalls=0,artifactId='',initialRevision='';const reviews:any[]=[];
 let sessionId:string|undefined;
 const upstream=createServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const send=(name:string,args:unknown,observations:unknown[]=[])=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',tool_calls:[...observations.map((observation,index)=>({id:'observation-'+index,type:'function',function:{name:'record_review_observation',arguments:JSON.stringify(observation)}})),{id:'call-'+Date.now(),type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]}));};
  if(body.tools[0].function.name==='submit_requested_operations'){send('submit_requested_operations',{contentReviewQuote:'review the result.',exportQuote:''});return;}
  if(body.tools[0].function.name==='submit_edit_location'){
   send('submit_edit_location',{kind:'paragraphs',boundary:'last',count:1,target:''});return;
  }
  if(body.tools[0].function.name==='submit_artifact_revision'){
   send('submit_artifact_revision',{selection_0_text:'The visitor waits by the door.'});return;
  }
  if(body.tools[0].function.name==='submit_artifact_review'){
   const input=JSON.parse(body.messages.findLast((m:any)=>m.role==='user').content);
   const lastTool=body.messages.filter((m:any)=>m.role==='tool').at(-1);
   if(lastTool&&JSON.parse(lastTool.content).code==='WORKER_RESULT_READBACK_REQUIRED'){send('submit_artifact_review',{summary:'Recorded comparison.',observationCodes:['FIXTURE_REVISION']});return;}
   reviews.push(input);
   send('submit_artifact_review',{summary:'Recorded comparison.',observationCodes:['FIXTURE_REVISION']},[{category:'quality',assessment:'observation',code:'FIXTURE_REVISION',summary:'The final paragraph changed.',sourceRefs:[{sourceId:input.sources[0].sourceId,startLine:3,endLine:3},{sourceId:input.comparison.sourceId,startLine:3,endLine:3}]}]);return;
  }
  if(phase==='first'){
   if(mainCalls++===0)send('bind_delivery_sources',{steps:[{id:'review',targets:[{workId:'gallery',artifactId}]}]});
   else if(mainCalls===2)send('workspace__revise_work_artifact',{artifactId,instruction:'Change only the final paragraph.'});
   else{res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'Fixture transport failure after persisted edit.'}}));}return;
  }
  if(phase==='retry'&&mainCalls++===0){send('workspace__review_work_artifact',{artifactId,instruction:'Review the current revision against the original request.'});return;}
  send('finish_turn',{status:'blocked',message:'The fixture ends after recording the comparison.'});
 });upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
 try{
  await mkdir(join(root,'.inkos'));const baseUrl=`http://127.0.0.1:${(upstream.address() as {port:number}).port}/v1`;
  await writeFile(join(root,'inkos.json'),JSON.stringify({name:'fixture',version:'0.1.0',language:'en',llm:{defaultModel:'fixture',services:[{service:'custom',name:'fixture',baseUrl,apiFormat:'chat',stream:false,models:['fixture']}]}}));
  await writeFile(join(root,'.inkos/secrets.json'),JSON.stringify({services:{'custom:fixture':{apiKey:'fixture'}}}));
  await saveWorkManifest(root,createWorkManifest({id:'gallery',profileId:'script',title:'Gallery',language:'en'}));
  await mkdir(join(root,'works/gallery/source'),{recursive:true});
  const original=await syncWorkSourceArtifacts({projectRoot:root,workId:'gallery',accept:true,writes:[{relativePath:'works/gallery/source/script.md',content:'Nora opens the gallery.\n\nThe visitor waits.\n'}]});artifactId=original.artifacts[0]!.id;initialRevision=original.artifacts[0]!.currentRevisionId!;
  const app=createStudioServer({} as never,root),post=(body:unknown)=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const {session}=await(await app.request('/api/v1/sessions',post({sessionKind:'work',profileId:'script',workId:'gallery'}))).json();
  sessionId=session.sessionId;
  const instruction='Change only the final paragraph; preserve the first paragraph and review the result.',request={sessionId:session.sessionId,instruction,workId:'gallery',profileId:'script',model:'fixture',service:'custom:fixture'};
  const first=await app.request('/api/v1/agent',post({...request,clientRequestId:'first-request'}));expect(first.status).toBeGreaterThanOrEqual(400);
  const afterWrite=await loadWorkManifest(root,'gallery');expect(afterWrite.artifacts[0]!.currentRevisionId).not.toBe(initialRevision);
  const restarted=createStudioServer({} as never,root),detail=await(await restarted.request(`/api/v1/sessions/${session.sessionId}`)).json();
  expect(detail.chatRequest.retry.options.retryOfRequestId).toBe('first-request');expect(detail.chatRequest.baselineWork.artifacts[0].currentRevisionId).toBe(initialRevision);
  expect(detail.chatRequest.deliveryState.steps).toMatchObject([{id:'review',operation:'review',targets:[{workId:'gallery',artifactId}]}]);
  phase='retry';mainCalls=0;
  const retry=await restarted.request('/api/v1/agent',post({...request,clientRequestId:'second-request',retryOfRequestId:'first-request'}));expect(retry.status).toBe(422);
  expect(reviews).toHaveLength(1);expect(reviews[0].comparison.before.revisionId).toBe(initialRevision);expect(reviews[0].comparison.after.revisionId).toBe(afterWrite.artifacts[0]!.currentRevisionId);
  const stale=await restarted.request('/api/v1/agent',post({...request,clientRequestId:'stale-attempt',retryOfRequestId:'first-request'}));expect(stale.status).toBe(409);expect((await stale.json()).error.code).toBe('CHAT_RETRY_CONFLICT');
  const retained=await(await restarted.request(`/api/v1/sessions/${session.sessionId}`)).json();expect(retained.chatRequest.requestId).toBe('second-request');expect(retained.chatRequest.baselineWork.artifacts[0].currentRevisionId).toBe(initialRevision);
  expect(retained.chatRequest.deliveryState.steps).toEqual(detail.chatRequest.deliveryState.steps);
  expect(retained.chatRequest.deliveryState.receipts).toMatchObject([{operation:'review',sources:[{workId:'gallery',artifactId,revisionId:afterWrite.artifacts[0]!.currentRevisionId}]}]);
  phase='fresh';await restarted.request('/api/v1/agent',post({...request,instruction:'Review this current draft.',clientRequestId:'fresh-request'}));
  const fresh=await(await restarted.request(`/api/v1/sessions/${session.sessionId}`)).json();expect(fresh.chatRequest.baselineWork.artifacts[0].currentRevisionId).toBe(afterWrite.artifacts[0]!.currentRevisionId);
 }finally{if(sessionId)evictAgentCache(sessionId);upstream.closeAllConnections();await new Promise<void>(resolve=>upstream.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
},20000);
