import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { runAgentSession, abortAgentSession } from "../agent/agent-session.js";
import { loadBookSession } from "../interaction/book-session-store.js";
import { readTranscriptEvents } from "../interaction/session-transcript.js";
import { listWorkManifests } from "../harness/work-store.js";
import type { Model } from "@mariozechner/pi-ai";

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
    requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
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
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    const attempt=requests.length;
    const name=attempt<=2?'workspace__create_work':'finish_turn';
    const args=attempt<=2?{workId:attempt===1?'provisional':'gallery',profileId:'script',title:'Gallery',language:'en',intent:'Create an empty script Work.'}:{status:'delivered',message:'The Work is ready.'};
    response.writeHead(200,{'Content-Type':'text/event-stream'});
    response.write(`data: ${JSON.stringify({id:'reply-'+attempt,object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:attempt===1?'provisional-call':'complete-'+attempt,type:'function',function:{name,arguments:JSON.stringify(args)}}]},finish_reason:null}]})}\n\n`);
    if(attempt===1)return; // Complete arguments alone are not a terminal result.
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
