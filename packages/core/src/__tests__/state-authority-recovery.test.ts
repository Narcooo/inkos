import {expect,it,vi} from 'vitest';
import {validateChapterTruthPersistence} from '../pipeline/chapter-truth-validation.js';
import type {WriteChapterOutput} from '../agents/writer.js';
import type {ValidationResult} from '../agents/state-validator.js';
import {StateValidatorAgent} from '../agents/state-validator.js';
import {createLLMClient} from '../llm/provider.js';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {withExecutionEvidence} from '../harness/execution-evidence.js';
import {createWorkManifest} from '../harness/work-store.js';
import {prepareWorkerMessages} from '../agents/base.js';
import {applyRuntimeStateDelta, type RuntimeStateSnapshot} from '../state/state-reducer.js';
import {renderCurrentStateProjection,renderHooksProjection} from '../state/state-projections.js';

it('binds reconciliation to proposed records and rechecks the repaired snapshot against the same baseline',async()=>{
  const baseline:RuntimeStateSnapshot={manifest:{schemaVersion:2,language:'en',lastAppliedChapter:1,projectionVersion:1},
    currentState:{chapter:1,facts:[{subject:'Nina',predicate:'location',object:'gallery',validFromChapter:1,validUntilChapter:null,sourceChapter:1},
      {subject:'key',predicate:'location',object:'pocket',validFromChapter:1,validUntilChapter:null,sourceChapter:1}]},hooks:{hooks:[]},chapterSummaries:{rows:[]}};
  const chapter='Nina leaves the key on the desk and enters the hall.';
  const unchanged={...baseline,currentState:{...baseline.currentState,chapter:2},manifest:{...baseline.manifest,lastAppliedChapter:2}};
  const corrected=applyRuntimeStateDelta({snapshot:baseline,delta:{chapter:2,factOps:{upsert:[{subject:'Nina',predicate:'location',object:'hall'},{subject:'key',predicate:'location',object:'desk'}],expire:[]},hookOps:{upsert:[],mention:[],resolve:[],defer:[]},newHookCandidates:[]}});
  const output=(snapshot:RuntimeStateSnapshot)=>({chapterNumber:2,title:'Move',content:chapter,runtimeStateSnapshot:snapshot,
    updatedState:renderCurrentStateProjection(snapshot.currentState,'en'),updatedHooks:renderHooksProjection(snapshot.hooks,'en')} as WriteChapterOutput);
  const requests:any[]=[],validationInputs:any[]=[];
  const server=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body);
    const input=JSON.parse(body.messages.find((m:any)=>m.role==='user').content);
    validationInputs.push(input);
    const args=requests.length===3?{corrections:[],observations:''}:{corrections:[
      {targetId:requests.length===1?'previous-fact-0':'fact-0',reason:'Nina has moved to the hall.',sourceRefs:[{sourceId:'chapter',startLine:1,endLine:1}]},
      {targetId:'fact-1',reason:'The key is on the desk.',sourceRefs:[{sourceId:'chapter',startLine:1,endLine:1}]},
    ],observations:'The outline omits the room color; that is not a projection correction.'};
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'state-'+requests.length,type:'function',function:{name:'submit_state_validation',arguments:JSON.stringify(args)}}]}}]}));
  });server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const client=createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat',stream:false,thinkingBudget:0});
    const settleChapterState=vi.fn().mockResolvedValue(output(corrected));
    const result=await validateChapterTruthPersistence({writer:{settleChapterState},validator:new StateValidatorAgent({client,model:'fixture',projectRoot:'/tmp'}),book:{} as never,bookDir:'/unused',chapterNumber:2,title:'Move',content:chapter,persistenceOutput:output(unchanged),previousTruth:{oldState:renderCurrentStateProjection(baseline.currentState,'en'),oldHooks:renderHooksProjection(baseline.hooks,'en'),snapshot:baseline},authorityContext:{storyFrame:'A future scene will end at the garden.',bookRules:'Build dramatic scenes.'},reducedControlInput:{chapterIntent:'Record the current scene.',contextPackage:{chapter:2,selectedContext:[]}},language:'en',logWarn:()=>{}});
    expect(requests).toHaveLength(3);
    expect(validationInputs.map(input=>input.sources.map((source:any)=>source.sourceId))).toEqual([['chapter'],['chapter'],['chapter']]);
    expect(validationInputs.map(input=>Object.fromEntries(input.targets.filter((t:any)=>t.active).map((t:any)=>[t.after.subject,t.after.object])))).toEqual([
      {Nina:'gallery',key:'pocket'},{Nina:'gallery',key:'pocket'},{Nina:'hall',key:'desk'},
    ]);
    expect(JSON.parse(requests[1].messages.find((m:any)=>m.role==='tool').content)).toMatchObject({code:'STATE_CORRECTION_TARGET_INVALID'});
    expect(settleChapterState).toHaveBeenCalledTimes(1);
    const feedback=settleChapterState.mock.calls[0]![0].validationFeedback;
    expect(feedback).toContain('[state-reconciliation:fact-0]');expect(feedback).toContain('[state-reconciliation:fact-1]');expect(feedback).not.toContain('[state-projection-review]');
    expect(result.validation).toMatchObject({consistent:true,reconciliationRequired:false});expect(result.persistenceOutput.runtimeStateSnapshot).toEqual(corrected);
  }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
},15000);

it('retains the same authority context through initial validation and settlement reconciliation',async()=>{
  const authority={storyFrame:'Current author-approved setting',bookRules:'Current professional boundary',chapterSummaries:'Earlier chapters only'};
  const initial={updatedState:'Initial projection',updatedHooks:'Prior hooks'} as WriteChapterOutput;
  const corrected={...initial,updatedState:'Reconciled projection'};
  const validate=vi.fn<(...args:unknown[])=>Promise<ValidationResult>>()
    .mockResolvedValueOnce({consistent:false,reconciliationRequired:true,observations:[]})
    .mockResolvedValueOnce({consistent:true,reconciliationRequired:false,observations:[]});
  const settleChapterState=vi.fn().mockResolvedValue(corrected);
  const result=await validateChapterTruthPersistence({writer:{settleChapterState},validator:{validate},book:{} as never,bookDir:'/unused',chapterNumber:1,title:'Chapter',content:'Current chapter',persistenceOutput:initial,previousTruth:{oldState:'Baseline',oldHooks:'Prior hooks'},authorityContext:authority,reducedControlInput:{chapterIntent:'Current intent',contextPackage:{} as never},language:'en',logWarn:()=>{}});
  expect(validate).toHaveBeenCalledTimes(2);
  expect(validate.mock.calls.map(args=>args[7])).toEqual([authority,authority]);
  expect(settleChapterState).toHaveBeenCalledTimes(1);
  expect(result.persistenceOutput).toBe(corrected);
  expect(result.validation).toMatchObject({consistent:true,reconciliationRequired:false});
});

it('checks an unchanged projection against new chapter facts and requires a concrete reconciliation report',async()=>{
  const requests:Array<{messages:Array<{role:string,content:string}>}>=[];
  const report='## Projection mismatch\nThe declared workshop location must remain attached to the character.';
  const server=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    const args={reconciliationRequired:true,reportMarkdown:requests.length===1?'':report};
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.write(`data: ${JSON.stringify({id:'state',object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'state-'+requests.length,type:'function',function:{name:'submit_state_validation',arguments:JSON.stringify(args)}}]},finish_reason:null}]})}\n\n`);
    res.end(`data: ${JSON.stringify({id:'state',object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const client=createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat',stream:true,temperature:0,thinkingBudget:0});
    const methods:unknown[]=[];
    const work=createWorkManifest({id:'work',title:'Work',profileId:'longform-novel',language:'en'});
    const inputs=[{role:'user' as const,content:JSON.stringify({previous:{location:'hall'},proposed:{location:'gallery'}})}];
    const prepared=await withExecutionEvidence(()=>{},()=>prepareWorkerMessages({client,projectRoot:'/tmp'},inputs,8192,'state-validator',false),undefined,work,'Revise the chapter ending.');
    expect(prepared).toEqual(inputs);
    const state='Mara is in the gallery.';
    const result=await withExecutionEvidence((type,payload)=>{if(type==='skills-applied')methods.push(payload.skills);},()=>new StateValidatorAgent({client,model:'fixture',projectRoot:'/tmp'}).validate('Mara leaves the gallery and enters the workshop.',1,state,state,'No pending hooks','No pending hooks','en',{storyFrame:'Mara is the curator.'}),undefined,work);
    expect(result).toMatchObject({consistent:false,reconciliationRequired:true,observations:[{code:'state-reconciliation',category:'execution',assessment:'issue'}]});
    expect(methods).toEqual([[]]);
    const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
    expect(sha(result.observations[0].summary)).toBe(sha(report));
    expect(requests).toHaveLength(2);
    expect(JSON.parse(requests[1].messages.find(m=>m.role==='tool')!.content)).toMatchObject({code:'STATE_RECONCILIATION_REASON_REQUIRED'});
  }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
},15000);
