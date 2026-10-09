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

it('requires a concrete report for reconciliation and preserves it through a flat HTTP tool result',async()=>{
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
    const result=await withExecutionEvidence((type,payload)=>{if(type==='skills-applied')methods.push(payload.skills);},()=>new StateValidatorAgent({client,model:'fixture',projectRoot:'/tmp'}).validate('Current chapter',1,'Prior state','Proposed state','Prior hooks','Proposed hooks','en',{storyFrame:'Current authority'}),undefined,work);
    expect(result).toMatchObject({consistent:false,reconciliationRequired:true,observations:[{code:'state-reconciliation',category:'execution',assessment:'issue'}]});
    expect(methods).toEqual([[]]);
    const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
    expect(sha(result.observations[0].summary)).toBe(sha(report));
    expect(requests).toHaveLength(2);
    expect(JSON.parse(requests[1].messages.find(m=>m.role==='tool')!.content)).toMatchObject({code:'STATE_RECONCILIATION_REASON_REQUIRED'});
  }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
},15000);
