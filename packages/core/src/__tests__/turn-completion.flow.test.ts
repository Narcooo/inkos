import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { runAgentSession, abortAgentSession } from "../agent/agent-session.js";
import { loadBookSession } from "../interaction/book-session-store.js";
import { readTranscriptEvents } from "../interaction/session-transcript.js";
import { listWorkManifests } from "../harness/work-store.js";
import type { Model } from "@mariozechner/pi-ai";
import {createTurnCompletionTool,TurnArtifactDeliveries} from '../agent/turn-completion.js';
import {createWorkManifest,saveWorkManifest} from '../harness/work-store.js';
import {syncWorkSourceArtifacts} from '../harness/source-sync.js';
import {ActionResultSchema} from '../harness/contracts.js';

it('retains quality findings with completed operations while still requiring current source versions',async()=>{
  const root=await mkdtemp(join(tmpdir(),'inkos-new-content-review-'));
  try{
    const empty=createWorkManifest({id:'work',title:'Scene',profileId:'script',language:'en'});
    await saveWorkManifest(root,empty);
    await mkdir(join(root,'works/work/source'),{recursive:true});
    const work=await syncWorkSourceArtifacts({projectRoot:root,workId:'work',accept:true,writes:[{relativePath:'works/work/source/script.md',content:'Nora leaves at noon.\nEarlier that evening, she arrives.\n'}]});
    const artifact=work.artifacts[0]!,deliveries=new TurnArtifactDeliveries();
    const observe=(assessment:'issue'|'observation'|'resolved')=>deliveries.observe(ActionResultSchema.parse({status:'success',summary:'Chronology review',artifacts:[],observations:[{code:'CHRONOLOGY',category:'quality',assessment,summary:'The time references conflict.',sourceRefs:[{sourceId:artifact.id,quote:'Nora leaves at noon.\nEarlier that evening, she arrives.'}]}],data:{kind:'artifact_reviewed',workId:work.id,artifactId:artifact.id,revisionId:artifact.currentRevisionId}}));
    const finish=createTurnCompletionTool({state:()=>({activeActions:0,hasDelivery:true,deliveryFailed:false}),validateDelivery:()=>deliveries.validate(root),qualityFindings:()=>deliveries.qualityFindings(),complete:()=>{}});
    observe('issue');
    await expect(finish.execute('new',{status:'delivered',message:'The requested operations are complete; the review records a chronology concern.'})).resolves.toMatchObject({details:{status:'delivered',qualityFindings:[{
      workId:work.id,artifactId:artifact.id,revisionId:artifact.currentRevisionId,observations:[{code:'CHRONOLOGY',category:'quality',assessment:'issue'}],
    }]}});
    observe('observation');
    await expect(finish.execute('corrected-review',{status:'delivered',message:'Review corrected against the source.'})).resolves.toMatchObject({details:{status:'delivered'}});
    observe('resolved');
    await expect(deliveries.validate(root)).resolves.toBeUndefined();
    expect(deliveries.qualityFindings()).toEqual([]);
    const source={workId:work.id,artifactId:artifact.id,revisionId:artifact.currentRevisionId!};
    const pipelineReview=ActionResultSchema.parse({status:'success',summary:'Pipeline review',artifacts:[],operationReceipts:[{operation:'review',sources:[source]}],observations:[{code:'CHRONOLOGY',category:'quality',assessment:'issue',summary:'Chronology conflict in the new content.',sourceRefs:[],target:source}],data:{kind:'short_fiction_created',workId:work.id}});
    deliveries.observe(pipelineReview);
    await expect(deliveries.validate(root)).resolves.toBeUndefined();
    expect(deliveries.qualityFindings()).toMatchObject([{...source,observations:pipelineReview.observations}]);
    deliveries.observe({...pipelineReview,observations:[]});
    expect(deliveries.qualityFindings()).toEqual([]);
    await syncWorkSourceArtifacts({projectRoot:root,workId:'work',accept:true,writes:[{relativePath:'works/work/source/script.md',content:'Nora arrives at noon and leaves that evening.\n'}]});
    await expect(deliveries.validate(root)).rejects.toMatchObject({code:'TURN_DELIVERY_STALE'});
  }finally{await rm(root,{recursive:true,force:true});}
});

it("answers a question, rejects an unevidenced delivery, creates a Work and restores its explicit completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "inkos-turn-completion-"));
  const replies = [
    { name: "finish_turn", args: { status: "answered", message: "A scene is a unit of dramatic action." } },
    { name: "finish_turn", args: { status: "delivered", message: "Created." } },
    { name: "workspace__create_work", args: { workId: "gallery", profileId: "script", title: "Gallery", language: "en", intent: "Create an empty script Work." } },
    { name: "finish_turn", args: { status: "delivered", message: "The Gallery Work is ready." } },
  ];
  const requests: Array<any> = [];
  const upstream = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if(body.tools[0].function.name==='submit_requested_operations'){
      response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'scope',type:'function',function:{name:'submit_requested_operations',arguments:JSON.stringify({contentReviewQuote:'',exportQuote:''})}}]}}]}));return;
    }
    requests.push(body);
    const reply = replies[requests.length - 1];
    if (!reply) { response.writeHead(500); response.end(); return; }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ finish_reason: "tool_calls", message: { role: "assistant", tool_calls: [{
      id: `completion-${requests.length}`, type: "function", function: { name: reply.name, arguments: JSON.stringify(reply.args) },
    }] } }] }));
  });
  upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
  const model: Model<"openai-completions"> = { id: "fixture", name: "Fixture", provider: "openai", api: "openai-completions",
    baseUrl: `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`, input: ["text"], reasoning: false,
    contextWindow: 128000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const config = { projectRoot: root, sessionId: "completion", bookId: null, workId: null, profileId: "workspace-default",
    sessionKind: "chat" as const, language: "en" as const, model, apiKey: "fixture", stream: false, pipeline: {} as never };
  try {
    const answer = await runAgentSession(config, "Explain a scene in one sentence.");
    expect(answer.completion?.status).toBe("answered");
    expect(answer.errorMessage).toBeUndefined();
    expect(await listWorkManifests(root)).toHaveLength(0);
    expect((await loadBookSession(root, config.sessionId))?.messages.filter(m => m.role === "assistant").map(m => m.content)).toEqual([answer.responseText]);
    const delivery = await runAgentSession(config, "Create an empty script Work called Gallery.");
    expect(delivery).toMatchObject({ workId: "gallery", profileId: "script", completion: { status: "delivered" } });
    expect(delivery.errorMessage).toBeUndefined();
    expect(await listWorkManifests(root)).toHaveLength(1);
    expect(requests).toHaveLength(4);
    expect(requests.every(request => request.tool_choice === undefined)).toBe(true);
    const events = await readTranscriptEvents(root, config.sessionId);
    const rejected = events.filter(e => e.type === "message" && e.role === "toolResult").map(e => e.type === "message" ? e.message as any : null);
    expect(rejected.some(message => message.toolName === "finish_turn" && message.isError === true)).toBe(true);
    const restored = await loadBookSession(root, config.sessionId);
    expect(restored?.messages.filter(m => m.role === "assistant" && m.content).map(m => m.content)).toEqual([answer.responseText, delivery.responseText]);
    expect(restored?.messages.flatMap(m => m.toolExecutions ?? []).filter(t => t.tool === "create_work")).toHaveLength(1);
  } finally {
    abortAgentSession(root, config.sessionId);
    upstream.closeAllConnections(); await new Promise<void>((resolve, reject) => upstream.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
}, 20000);

it("keeps a nonterminal provider response out of the completed answer after the bounded protocol retry", async () => {
  const root = await mkdtemp(join(tmpdir(), "inkos-missing-completion-"));
  let calls = 0;
  const upstream = createServer(async (request, response) => {
    for await (const _chunk of request) {}
    calls++;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "I will do the work." } }] }));
  });
  upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
  try {
    const result = await runAgentSession({ projectRoot: root, sessionId: "missing", bookId: null, language: "en", apiKey: "fixture", stream: false, pipeline: {} as never,
      model: { id: "fixture", name: "Fixture", provider: "openai", api: "openai-completions", baseUrl: `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`, reasoning: false,
        input: ["text"], contextWindow: 128000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    }, "Create an empty script Work.");
    expect(calls).toBe(2);
    expect(result.errorMessage).toBeTruthy();
    expect(result.responseText).toBe("");
    expect(result.completion).toBeUndefined();
    expect((await readTranscriptEvents(root, "missing")).at(-1)?.type).toBe("request_failed");
    expect(await listWorkManifests(root)).toHaveLength(0);
  } finally {
    abortAgentSession(root, "missing");
    upstream.closeAllConnections(); await new Promise<void>((resolve, reject) => upstream.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
}, 15000);

it("retries an interrupted model message once without executing its provisional tool or duplicating conversation history", async () => {
  const root=await mkdtemp(join(tmpdir(),'inkos-interrupted-message-'));
  const priorTimeout=process.env.INKOS_LLM_STREAM_IDLE_TIMEOUT_MS;
  process.env.INKOS_LLM_STREAM_IDLE_TIMEOUT_MS='100';
  const requests:any[]=[];
  const upstream=createServer(async(request,response)=>{
    const chunks=[];for await(const chunk of request)chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const scope=body.tools[0].function.name==='submit_requested_operations';
    if(!scope)requests.push(body);
    const attempt=requests.length;
    const name=scope?'submit_requested_operations':attempt<=2?'workspace__create_work':'finish_turn';
    const args=scope?{contentReviewQuote:'',exportQuote:''}:attempt<=2?{workId:attempt===1?'provisional':'gallery',profileId:'script',title:'Gallery',language:'en',intent:'Create an empty script Work.'}:{status:'delivered',message:'The Work is ready.'};
    response.writeHead(200,{'Content-Type':'text/event-stream'});
    response.write(`data: ${JSON.stringify({id:'reply-'+attempt,object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:!scope&&attempt===1?'provisional-call':'complete-'+attempt,type:'function',function:{name,arguments:JSON.stringify(args)}}]},finish_reason:null}]})}\n\n`);
    if(!scope&&attempt===1)return; // Complete arguments alone are not a terminal result.
    response.end(`data: ${JSON.stringify({id:'reply-'+attempt,object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`);
  });
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  try{
    const result=await runAgentSession({projectRoot:root,sessionId:'interrupted',bookId:null,profileId:'workspace-default',sessionKind:'chat',language:'en',apiKey:'fixture',stream:true,pipeline:{} as never,
      model:{id:'fixture',name:'Fixture',provider:'openai',api:'openai-completions',baseUrl:`http://127.0.0.1:${(upstream.address() as {port:number}).port}/v1`,reasoning:false,input:['text'],contextWindow:128000,maxTokens:8192,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}},
    },'Create an empty script Work called Gallery.');
    expect(result).toMatchObject({workId:'gallery',completion:{status:'delivered'}});
    expect(result.errorMessage).toBeUndefined();
    expect((await listWorkManifests(root)).map(work=>work.id)).toEqual(['gallery']);
    expect(requests).toHaveLength(3);
    expect(requests[1].messages).toEqual(requests[0].messages);
    expect(requests[1].tools).toEqual(requests[0].tools);
    expect(result.messages.filter(m=>m.role==='assistant').flatMap(m=>(m as any).content).some(part=>part.type==='toolCall'&&part.id==='provisional-call')).toBe(false);
    const restored=await loadBookSession(root,'interrupted');
    expect(restored?.messages.flatMap(m=>m.toolExecutions??[]).filter(t=>t.tool==='create_work')).toHaveLength(1);
  }finally{
    if(priorTimeout===undefined)delete process.env.INKOS_LLM_STREAM_IDLE_TIMEOUT_MS;else process.env.INKOS_LLM_STREAM_IDLE_TIMEOUT_MS=priorTimeout;
    abortAgentSession(root,'interrupted');upstream.closeAllConnections();await new Promise<void>((resolve,reject)=>upstream.close(error=>error?reject(error):resolve()));await rm(root,{recursive:true,force:true});
  }
},20000);
