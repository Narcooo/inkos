import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {it,expect} from 'vitest';
import {RequestDeliveryLedger} from '../agent/request-delivery.js';
import {createWorkManifest,saveWorkManifest,loadWorkManifest} from '../harness/work-store.js';
import {syncWorkSourceArtifacts} from '../harness/source-sync.js';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createLLMClient} from '../llm/provider.js';
import {PipelineRunner} from '../pipeline/runner.js';
import {runAgentSession,evictAgentCache} from '../agent/agent-session.js';

it('reviews the current planning source before drafting and repeats the prerequisite after a plan version changes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'inkos-plan-before-draft-'));
  await saveWorkManifest(root,createWorkManifest({id:'short',title:'The Key',profileId:'short-fiction',language:'en'}));
  await mkdir(join(root,'works/short/source'),{recursive:true});
  const quote='Review the plan before drafting the prose.';
  const request='Create a one-chapter plan. '+quote;
  const stage={workId:'short',chapters:1,charsPerChapter:40,minChapterLength:20,maxChapterLength:60,openingHookChars:null,coverRequired:false};
  let mainCalls=0,reviews=0,drafts=0;const sourceVersions:string[]=[];
  const states:Array<ReturnType<RequestDeliveryLedger['snapshot']>>=[];
  const server=createServer(async(req,res)=>{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=JSON.parse(Buffer.concat(chunks).toString());
    const worker=body.tools[0].function.name;let name:string,args:unknown;
    if(worker==='submit_requested_operations'){name=worker;args={coverQuote:'',preDraftReviewQuote:quote,contentReviewQuote:'',exportQuote:''};}
    else if(worker==='submit_short_outline'){name=worker;args={storyTitle:'The Key',planMarkdown:'The keeper returns a key.',chapter_1_plan:'Return the borrowed key.'};}
    else if(worker==='submit_artifact_review'){reviews++;name=worker;args={summary:'Evaluated the supplied plan.',observationCodes:[]};}
    else if(worker==='submit_short_chapter'){drafts++;expect(reviews).toBe(2);name=worker;args={storyTitle:'The Key',number:1,title:'Return',content:'The keeper returns the borrowed key to its owner. They check the worn metal together beside the door. The owner thanks her, and she leaves quietly.'};}
    else{
      mainCalls++;
      if(mainCalls===1){name='short-fiction__plan_short_fiction';args={...stage,direction:'The keeper returns a borrowed key.'};}
      else if([2,4,6].includes(mainCalls)){
        const work=await loadWorkManifest(root,'short'),outline=work.artifacts.find(a=>a.revisions.some(r=>r.path==='source/outline/v001.md'))!;
        expect(outline.currentRevisionId).not.toBeNull();sourceVersions.push(outline.currentRevisionId!);
        if(mainCalls===4)await syncWorkSourceArtifacts({projectRoot:root,workId:'short',accept:true,writes:[{relativePath:'works/short/source/outline/v001.md',content:'The keeper returns the key at dawn, after checking its number.'}]});
        name='short-fiction__draft_short_fiction';args=stage;
      }else if([3,5].includes(mainCalls)){
        const work=await loadWorkManifest(root,'short'),outline=work.artifacts.find(a=>a.revisions.some(r=>r.path==='source/outline/v001.md'))!;
        name='workspace__review_work_artifact';args={artifactId:outline.id,instruction:quote};
      }else{name='finish_turn';args={status:'delivered',message:'The reviewed plan and draft are saved.'};}
    }
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',tool_calls:[{id:'preflight-'+mainCalls+'-'+reviews+'-'+drafts,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]}));
  });server.listen(0,'127.0.0.1');await once(server,'listening');
  const client=createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat',stream:false,thinkingBudget:0});
  const config={projectRoot:root,sessionId:'pre-draft-review',bookId:null,workId:'short',profileId:'short-fiction',language:'en',model:client._piModel!,apiKey:'fixture',stream:false,pipeline:new PipelineRunner({projectRoot:root,client,model:'fixture'}),onDeliveryStateChange:async(state:ReturnType<RequestDeliveryLedger['snapshot']>)=>{states.push(state);}};
  try{
    const result=await runAgentSession(config,request);
    expect(result.errorMessage).toBeUndefined();expect(result.completion?.status).toBe('delivered');
    const errors=result.messages.filter((m:any)=>m.role==='toolResult'&&m.isError).map((m:any)=>JSON.parse(m.content[0].text));
    expect(errors.map(e=>e.code)).toEqual(['PRE_DRAFT_REVIEW_REQUIRED','PRE_DRAFT_REVIEW_REQUIRED']);
    expect(reviews).toBe(2);expect(drafts).toBe(1);expect(sourceVersions[0]).toBe(sourceVersions[1]);expect(sourceVersions[2]).not.toBe(sourceVersions[1]);
    const final=states.at(-1)!;expect(final.steps.map(s=>({id:s.id,beforeDraft:s.beforeDraft}))).toEqual([{id:'pre_draft_review',beforeDraft:true}]);
    expect(final.receipts.map(receipt=>receipt.operation)).toEqual(['review','review']);
    const restored=new RequestDeliveryLedger(request,JSON.parse(JSON.stringify(final)));
    await expect(restored.requireBeforeDraft(root,'short',['source/outline/v001.md'])).resolves.toBeUndefined();
    expect(JSON.parse(await readFile(join(root,'works/short/source/final/short-story.json'),'utf8')).chapters).toHaveLength(1);
  }finally{evictAgentCache(config.sessionId);server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
},20000);

it('retains requested operations across restoration and requires every declared source version even when a review was never attempted',async()=>{
  const root=await mkdtemp(join(tmpdir(),'inkos-request-delivery-'));
  try{
    const request='Create two scenes. Review and export both.';
    const ledger=new RequestDeliveryLedger(request);
    expect(()=>ledger.requireDeclaration()).toThrow(expect.objectContaining({code:'DELIVERY_REQUIREMENTS_UNDECLARED'}));
    const steps=[{id:'review',operation:'review' as const,sourceQuote:'Review and export both.'},{id:'export',operation:'export' as const,sourceQuote:'Review and export both.'}];
    ledger.initialize({reviewQuote:'Review and export both.',exportQuote:'Review and export both.'});
    await expect(ledger.validate(root)).rejects.toMatchObject({code:'REQUEST_DELIVERY_INCOMPLETE'});
    await saveWorkManifest(root,createWorkManifest({id:'work',title:'Scenes',profileId:'script',language:'en'}));
    await mkdir(join(root,'works/work/source'),{recursive:true});
    const work=await syncWorkSourceArtifacts({projectRoot:root,workId:'work',accept:true,writes:[{relativePath:'works/work/source/one.md',content:'A visitor arrives.'},{relativePath:'works/work/source/two.md',content:'The visitor leaves.'}]});
    const targets=work.artifacts.map(a=>({workId:work.id,artifactId:a.id}));
    const sources=work.artifacts.map(a=>({workId:work.id,artifactId:a.id,revisionId:a.currentRevisionId!}));
    await ledger.bind(root,{steps:steps.map(step=>({...step,targets}))});
    await ledger.bind(root,{steps:steps.map(step=>({...step,targets:sources}))});
    expect(ledger.snapshot().steps.flatMap(step=>step.targets).every(target=>target.version==='current'&&target.revisionId===undefined)).toBe(true);
    await ledger.record(root,[{operation:'export',sources}]);
    const restored=new RequestDeliveryLedger(request,JSON.parse(JSON.stringify(ledger.snapshot())));
    const legacy={...restored.snapshot(),newContentQuote:'Create two scenes.'};
    const upgraded=new RequestDeliveryLedger(request,legacy);
    expect(upgraded.interpretationComplete).toBe(true);
    expect(upgraded.snapshot().steps).toEqual(restored.snapshot().steps);
    expect(upgraded.snapshot().receipts).toEqual(restored.snapshot().receipts);
    const {coverQuote: _oldCover, ...beforeCoverScope}=restored.snapshot();
    const oldRequest=new RequestDeliveryLedger(request,beforeCoverScope);
    expect(oldRequest.interpretationComplete).toBe(false);
    oldRequest.initialize({reviewQuote:null,exportQuote:null,coverQuote:null});
    expect(oldRequest.interpretationComplete).toBe(true);
    expect(oldRequest.requiresCover).toBe(false);
    expect(oldRequest.snapshot().steps).toEqual(restored.snapshot().steps);
    expect(oldRequest.snapshot().receipts).toEqual(restored.snapshot().receipts);
    const coverOnly=new RequestDeliveryLedger('Deliver the saved cover.');
    coverOnly.initialize({coverQuote:'Deliver the saved cover.',reviewQuote:null,exportQuote:null});
    const restoredCover=new RequestDeliveryLedger('Deliver the saved cover.',JSON.parse(JSON.stringify(coverOnly.snapshot())));
    expect(restoredCover.hasRequirements).toBe(true);
    expect(restoredCover.requiresCover).toBe(true);
    await expect(restored.validate(root)).rejects.toMatchObject({code:'REQUEST_DELIVERY_INCOMPLETE'});
    await restored.bind(root,{steps:[{id:'export',targets}]});
    expect(restored.snapshot().steps.map(step=>step.operation)).toEqual(['review','export']);
    await expect(restored.bind(root,{steps:[{id:'unknown',targets}]})).rejects.toMatchObject({code:'DELIVERY_STEP_UNKNOWN'});
    await restored.record(root,[{operation:'review',sources:[sources[0]!]}]);
    await expect(restored.validate(root)).rejects.toMatchObject({code:'REQUEST_DELIVERY_INCOMPLETE'});
    await restored.record(root,[{operation:'review',sources:[sources[1]!]}]);
    await expect(restored.validate(root)).resolves.toBeUndefined();
    const changed=await syncWorkSourceArtifacts({projectRoot:root,workId:'work',accept:true,writes:[{relativePath:'works/work/source/two.md',content:'The visitor returns.'}]});
    await expect(restored.validate(root)).rejects.toMatchObject({code:'REQUEST_DELIVERY_INCOMPLETE'});
    const current=changed.artifacts.find(a=>a.id===targets[1]!.artifactId)!;
    const revised=[{...targets[1]!,revisionId:current.currentRevisionId!}];
    await restored.record(root,[{operation:'review',sources:revised},{operation:'export',sources:revised}]);
    await expect(restored.validate(root)).resolves.toBeUndefined();
    const exportOnly=new RequestDeliveryLedger('Export the first scene.');
    exportOnly.initialize({reviewQuote:null,exportQuote:'Export the first scene.'});
    await exportOnly.bind(root,{steps:[{id:'export',targets:[targets[0]!]}]});
    await exportOnly.record(root,[{operation:'export',sources:[sources[0]!]}]);
    await expect(exportOnly.validate(root)).resolves.toBeUndefined();
    const historical=new RequestDeliveryLedger('Review the earlier second scene.');
    historical.initialize({reviewQuote:'Review the earlier second scene.',exportQuote:null});
    await historical.bind(root,{steps:[{id:'review',targets:[{...sources[1]!,version:'fixed'}]}]});
    await historical.record(root,[{operation:'review',sources:[sources[1]!]}]);
    await expect(historical.validate(root)).resolves.toBeUndefined();
    expect(()=>new RequestDeliveryLedger('A new unrelated request.',restored.snapshot())).toThrow(expect.objectContaining({code:'DELIVERY_REQUEST_CONFLICT'}));
  }finally{await rm(root,{recursive:true,force:true});}
});

it('keeps an unattempted requested review pending in the main agent and isolates a later export-only request',async()=>{
  const root=await mkdtemp(join(tmpdir(),'inkos-required-review-'));
  await saveWorkManifest(root,createWorkManifest({id:'work',title:'Scene',profileId:'script',language:'en'}));
  await mkdir(join(root,'works/work/source'),{recursive:true});
  const work=await syncWorkSourceArtifacts({projectRoot:root,workId:'work',accept:true,writes:[{relativePath:'works/work/source/script.md',content:'The visitor returns the key.\n'}]});
  const artifactId=work.artifacts[0]!.id,target={workId:'work',artifactId};
  const requested='Review and export the current script.',exportOnly='Export the current script.';
  let phase:'both'|'export'='both',mainCalls=0,reviews=0;
  const server=createServer(async(req,res)=>{
    const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));const body=JSON.parse(Buffer.concat(chunks).toString());
    let reply:{name:string;args:unknown};
    if(body.tools[0].function.name==='submit_requested_operations'){
      expect(body.messages.filter((m:any)=>m.role==='user').map((m:any)=>m.content)).toEqual([phase==='both'?requested:exportOnly]);
      expect(body.temperature).toBeUndefined();expect(body.tool_choice).toBeUndefined();
      reply={name:'submit_requested_operations',args:{coverQuote:'',preDraftReviewQuote:'',contentReviewQuote:phase==='both'?requested:'',exportQuote:phase==='both'?requested:exportOnly}};
    }else if(body.tools[0].function.name==='submit_artifact_review'){
      reviews++;reply={name:'submit_artifact_review',args:{summary:'The scene is coherent.',observationCodes:[]}};
    }else{
      const plan={name:'bind_delivery_sources',args:{steps:[{id:'export',targets:[target]}]}};
      const bindReview={name:'bind_delivery_sources',args:{steps:[{id:'review',targets:[target]}]}};
      const exportAction={name:'workspace__export_work',args:{artifactId}};
      const finish={name:'finish_turn',args:{status:'delivered',message:'Completed.'}};
      const replies=phase==='both'?[exportAction,plan,finish,bindReview,{name:'workspace__review_work_artifact',args:{artifactId,instruction:'Review this source.'}},finish]:[exportAction,plan,finish];
      reply=replies[mainCalls++]!;
      if(!reply){res.writeHead(500);res.end();return;}
    }
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',tool_calls:[{id:'call-'+phase+'-'+mainCalls+'-'+reviews,type:'function',function:{name:reply.name,arguments:JSON.stringify(reply.args)}}]}}]}));
  });server.listen(0,'127.0.0.1');await once(server,'listening');
  const client=createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat',stream:false,thinkingBudget:0});
  const states:Array<ReturnType<RequestDeliveryLedger['snapshot']>>=[];
  const config={projectRoot:root,sessionId:'required-review',bookId:null,workId:'work',profileId:'script',language:'en',model:client._piModel!,apiKey:'fixture',stream:false,pipeline:new PipelineRunner({projectRoot:root,client,model:'fixture'}),onDeliveryStateChange:async(state:ReturnType<RequestDeliveryLedger['snapshot']>)=>{states.push(state);}};
  try{
    const result=await runAgentSession(config,requested);
    expect(result.errorMessage).toBeUndefined();expect(result.completion?.status).toBe('delivered');
    expect(result.messages.some((m:any)=>m.role==='toolResult'&&m.toolName==='finish_turn'&&m.isError)).toBe(true);
    expect(states.some(state=>state.steps.length===2&&state.receipts.some(r=>r.operation==='export')&&!state.receipts.some(r=>r.operation==='review'))).toBe(true);
    expect(reviews).toBe(1);
    phase='export';mainCalls=0;
    const exported=await runAgentSession(config,exportOnly);
    expect(exported.errorMessage).toBeUndefined();expect(exported.completion?.status).toBe('delivered');
    expect(reviews).toBe(1);expect(states.at(-1)?.steps.map(step=>step.operation)).toEqual(['export']);
  }finally{evictAgentCache(config.sessionId);server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
},20000);
