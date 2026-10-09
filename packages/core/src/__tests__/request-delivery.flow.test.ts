import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {it,expect} from 'vitest';
import {RequestDeliveryLedger} from '../agent/request-delivery.js';
import {createWorkManifest,saveWorkManifest} from '../harness/work-store.js';
import {syncWorkSourceArtifacts} from '../harness/source-sync.js';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createLLMClient} from '../llm/provider.js';
import {PipelineRunner} from '../pipeline/runner.js';
import {runAgentSession,evictAgentCache} from '../agent/agent-session.js';

it('retains requested operations across restoration and requires every declared source version even when a review was never attempted',async()=>{
  const root=await mkdtemp(join(tmpdir(),'inkos-request-delivery-'));
  try{
    const request='Create two scenes. Review and export both.';
    const ledger=new RequestDeliveryLedger(request);
    expect(()=>ledger.requireDeclaration()).toThrow(expect.objectContaining({code:'DELIVERY_REQUIREMENTS_UNDECLARED'}));
    const steps=[{id:'review',operation:'review' as const,sourceQuote:'Review and export both.'},{id:'export',operation:'export' as const,sourceQuote:'Review and export both.'}];
    ledger.initialize({reviewQuote:'Review and export both.',exportQuote:'Review and export both.',newContentQuote:'Create two scenes.'});
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
    expect(restored.snapshot().newContentQuote).toBe('Create two scenes.');
    const legacy=restored.snapshot();delete legacy.newContentQuote;
    const upgraded=new RequestDeliveryLedger(request,legacy);
    expect(upgraded.interpretationComplete).toBe(false);
    upgraded.initialize({reviewQuote:null,exportQuote:null,newContentQuote:'Create two scenes.'});
    expect(upgraded.snapshot()).toEqual(restored.snapshot());
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
      reply={name:'submit_requested_operations',args:{newContentQuote:'',contentReviewQuote:phase==='both'?requested:'',exportQuote:phase==='both'?requested:exportOnly}};
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
