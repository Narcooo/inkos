import {it,expect} from 'vitest';
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {createWorkManifest,saveWorkManifest} from '../harness/work-store.js';
import {syncWorkSourceArtifacts} from '../harness/source-sync.js';
import {createLLMClient} from '../llm/provider.js';
import {PipelineRunner} from '../pipeline/runner.js';
import {runAgentSession,evictAgentCache} from '../agent/agent-session.js';
import {deriveBookSessionFromTranscript,restoreAgentMessagesFromTranscript} from '../interaction/session-transcript-restore.js';

it('recovers a committed artifact operation after a final-model failure, preserves its UI receipt and rejects a stale source on retry',async()=>{
 const root=await mkdtemp(join(tmpdir(),'inkos-interrupted-action-'));
 await saveWorkManifest(root,createWorkManifest({id:'work',title:'Gallery',profileId:'script',language:'en'}));
 await mkdir(join(root,'works/work/source'),{recursive:true});
 const work=await syncWorkSourceArtifacts({projectRoot:root,workId:'work',accept:true,writes:[{relativePath:'works/work/source/script.md',content:'Nora closes the gallery.\n'}]});
 const artifactId=work.artifacts[0]!.id,request='Export the current script.';
 let phase:'fail'|'resume'|'blocked'='fail',mainCalls=0,exportCalls=0;
 const server=createServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=JSON.parse(Buffer.concat(chunks).toString());
  let reply:{name:string;args:unknown};
  if(body.tools[0].function.name==='submit_requested_operations')reply={name:'submit_requested_operations',args:{newContentQuote:'',contentReviewQuote:'',exportQuote:request}};
  else if(phase==='fail'){
   const call=mainCalls++;
   if(call===0)reply={name:'bind_delivery_sources',args:{steps:[{id:'export',targets:[{workId:'work',artifactId}]}]}};
   else if(call===1)reply={name:'workspace__export_work',args:{artifactId}};
   else{res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'Fixture final response unavailable'}}));return;}
  }else{
   reply={name:'finish_turn',args:{status:phase!=='blocked'&&mainCalls++===0?'delivered':'blocked',message:'Fixture completion.'}};
  }
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',tool_calls:[{id:'call-'+phase+'-'+mainCalls,type:'function',function:{name:reply.name,arguments:JSON.stringify(reply.args)}}]}}]}));
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 const client=createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat',stream:false,thinkingBudget:0});
 const config={projectRoot:root,sessionId:'resume-export',sessionKind:'work' as const,workId:'work',bookId:null,profileId:'script',language:'en',attachments:[{id:'note',filename:'note.txt',mimeType:'text/plain',size:5,text:'Nora.'}],model:client._piModel!,apiKey:'fixture',stream:false,pipeline:new PipelineRunner({projectRoot:root,client,model:'fixture'}),onEvent:(event:any)=>{if(event.type==='tool_execution_end'&&event.toolName==='workspace__export_work'&&!event.isError)exportCalls++;}};
 try{
  const failed=await runAgentSession(config,request);expect(failed.errorMessage).toBeDefined();evictAgentCache(config.sessionId);
  const visible=await deriveBookSessionFromTranscript(root,config.sessionId);
  expect(visible?.messages.flatMap(message=>message.toolExecutions??[])).toEqual(expect.arrayContaining([expect.objectContaining({tool:'export_work',status:'completed'})]));
  const restored=await restoreAgentMessagesFromTranscript(root,config.sessionId,'work');
  const exportResult=restored.find((message:any)=>message.role==='toolResult'&&message.toolName==='workspace__export_work') as any;
  expect(exportResult?.details.hostExecution.status).toBe('success');
  const exportPath=join(root,'works/work',exportResult.details.path);
  const digest=()=>readFile(exportPath).then(bytes=>createHash('sha256').update(bytes).digest('hex'));
  const before=await digest();phase='blocked';mainCalls=0;
  expect((await runAgentSession({...config,recoverIncompleteRequest:true},request)).completion?.status).toBe('blocked');
  evictAgentCache(config.sessionId);phase='resume';mainCalls=0;
  const completed=await runAgentSession({...config,recoverIncompleteRequest:true},request);
  expect(completed.completion?.status).toBe('delivered');expect(exportCalls).toBe(1);expect(await digest()).toBe(before);

  const staleConfig={...config,sessionId:'stale-export'};phase='fail';mainCalls=0;
  expect((await runAgentSession(staleConfig,request)).errorMessage).toBeDefined();evictAgentCache(staleConfig.sessionId);
  await syncWorkSourceArtifacts({projectRoot:root,workId:'work',accept:true,writes:[{relativePath:'works/work/source/script.md',content:'Nora reopens the gallery.\n'}]});
  phase='resume';mainCalls=0;
  const stale=await runAgentSession({...staleConfig,recoverIncompleteRequest:true},request);
  expect(stale.completion?.status).toBe('blocked');expect(exportCalls).toBe(2);
  expect(stale.messages.some((message:any)=>message.role==='toolResult'&&message.toolName==='finish_turn'&&message.isError)).toBe(true);
 }finally{evictAgentCache(config.sessionId);evictAgentCache('stale-export');server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
},30000);
