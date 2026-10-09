import { createServer } from "node:http";
import { once } from "node:events";
import { Type } from "@sinclair/typebox";
import { expect, it } from "vitest";
import { createLLMClient } from "../llm/provider.js";
import { BaseAgent } from "../agents/base.js";
import type { StreamProgress } from "../llm/provider.js";
import { guardedPiStream, guardedPiNonStreaming } from "../agent/pi-stream.js";
import { withExecutionEvidence } from "../harness/execution-evidence.js";
import { compileHarnessContextText } from "../agent/agent-session.js";
import { runWorkerAgent, runWorkerAgentTool } from "../agent/worker-agent.js";

it.each([
  { streaming: true, modelId: 'fixture', samplingAllowed: true },
  { streaming: false, modelId: 'fixture', samplingAllowed: true },
  { streaming: true, modelId: 'claude-sonnet-5-5', samplingAllowed: false },
  { streaming: false, modelId: 'claude-sonnet-5-5', samplingAllowed: false },
])('enforces required tool selection without rejecting an ordinary answer ($modelId, stream=$streaming)', async ({ streaming, modelId, samplingAllowed }) => {
  const received: Array<{ messages: Array<{role:string}>; stream?: boolean; tool_choice?: unknown; temperature?: number; top_p?: number; top_k?: number }> = [];
  const preparedKeys:unknown[]=[];
  let completeTool = false;
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    received.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    const call = completeTool && received.length === 3
      ? { id: 'result-1', type: 'function', function: { name: 'submit_value', arguments: '{"value":7}' } } : undefined;
    if (received.at(-1)?.stream) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(`data: ${JSON.stringify({ id: 'selection', object: 'chat.completion.chunk', choices: [{ index: 0,
        delta: call ? { role: 'assistant', tool_calls: [{ ...call, index: 0 }] } : { role: 'assistant', content: 'A response.' },
        finish_reason: null }] })}\n\n`);
      response.end(`data: ${JSON.stringify({ id: 'selection', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: call ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
    } else {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', ...(call ? { tool_calls: [call] } : { content: 'A response.' }) }, finish_reason: call ? 'tool_calls' : 'stop' }] }));
    }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const client = createLLMClient({ service: 'custom', provider: 'openai', configSource: 'studio', model: modelId, apiKey: 'fixture',
      baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, apiFormat: 'chat', stream: streaming, thinkingBudget: 0 });
    const context = { messages: [{ role: 'user' as const, content: 'Submit a value.', timestamp: 1 }],
      tools: [{ name: 'submit_value', description: 'Submit', parameters: Type.Object({ value: Type.Number() }) }] };
    const run = async (toolChoice?: unknown) => withExecutionEvidence((type,payload)=>{if(type==='model-request-prepared')preparedKeys.push(payload.parameterKeys);},async()=>{
      const options = { apiKey: 'fixture', maxTokens: 128, toolChoice, temperature: 0.7,
        onPayload: (payload: unknown) => ({ ...(payload as Record<string, unknown>), top_p: 0.8, top_k: 10 }) };
      const events = streaming ? guardedPiStream(client._piModel!, context, options) : guardedPiNonStreaming(client._piModel!, context, options);
      for await (const _event of events) {}
      return events.result();
    });
    expect((await run()).stopReason).toBe('stop');
    expect(received[0]).not.toHaveProperty('store');
    if(streaming)expect(preparedKeys[0]).toEqual(Object.keys(received[0]!).sort());
    completeTool = true;
    const completed = await run('required');
    expect(completed).toMatchObject({ stopReason: 'toolUse', content: [{ type: 'toolCall', name: 'submit_value', arguments: { value: 7 } }] });
    expect(received).toHaveLength(3);
    expect(received.slice(1).map(request => request.tool_choice)).toEqual([undefined, undefined]);
    expect(received[2].messages.slice(0, -1)).toEqual(received[1].messages);
    expect(received[2].messages.at(-1)?.role).toBe('user');
    expect(context.messages).toHaveLength(1);
    if (!samplingAllowed) {
      expect(received.every(request => request.temperature === undefined && request.top_p === undefined && request.top_k === undefined)).toBe(true);
    } else {
      expect(received[0]).toMatchObject({ temperature: 0.7, top_p: 0.8, top_k: 10 });
    }
    const failed = await run({ type: 'function', function: { name: 'submit_value' } });
    expect(failed).toMatchObject({ stopReason: 'error', errorCode: 'MODEL_REQUIRED_TOOL_MISSING' });
    expect(received).toHaveLength(5);
    expect((await run('none')).stopReason).toBe('stop');
    expect(received.at(-1)?.tool_choice).toBe('none');
    // Text-producing workers exercise both the custom HTTP and Pi SDK paths.
    for (const textClient of [client, { ...client, service: 'openai' }]) {
      const result = await runWorkerAgent(textClient, modelId, [{ role: 'user', content: 'Reply briefly.' }], { temperature: 0.3, maxTokens: 128 });
      expect(result.content.length).toBeGreaterThan(0);
      expect(received.at(-1)?.temperature).toBe(!samplingAllowed ? undefined : 0.3);
    }
    for (const textClient of [client, { ...client, service: 'openai' }]) {
      const defaultText = await runWorkerAgent(textClient, modelId, [{role:'user',content:'Reply briefly.'}], {maxTokens:128});
      expect(defaultText.content.length).toBeGreaterThan(0);
      for (const option of ['temperature', 'top_p', 'top_k', 'seed', 'reasoning_effort', 'thinking', 'response_format', 'tool_choice', 'store', 'professionalGuidance']) {
        expect(received.at(-1)).not.toHaveProperty(option);
      }
    }
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}, 15000);

it.each([true, false])('ends exhausted empty responses at the transport boundary without a schema-repair loop (stream=%s)', async (stream) => {
  let requests = 0;
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* consume the request */ }
    requests++;
    const finishReason = requests === 1 ? 'length' : 'stop';
    if (stream) {
      response.writeHead(200, {'Content-Type':'text/event-stream'});
      response.write(`data: ${JSON.stringify({id:'blank',object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content:requests===1?'':' \n\t'},finish_reason:finishReason}]})}\n\n`);
      response.end('data: [DONE]\n\n');
    } else {
      response.writeHead(200, {'Content-Type':'application/json'});
      response.end(JSON.stringify({choices:[{message:{role:'assistant',content:requests===1?'':' \n\t'},finish_reason:finishReason}]}));
    }
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  try {
    const client = createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat',stream,temperature:0,thinkingBudget:0});
    await expect(runWorkerAgentTool(client,'fixture',[{role:'user',content:'Submit the value.'}],{
      name:'submit_value',label:'Submit',description:'Submit the result',parameters:Type.Object({value:Type.Number()}),
    },{maxTokens:128})).rejects.toMatchObject({code:'MODEL_EMPTY_RESPONSE',attempts:1});
    expect(requests).toBe(2);
  } finally {server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
},15000);
it.each(["chat", "responses", "anthropic"] as const)("carries the required result tool through the real Pi %s streaming HTTP boundary", async (apiFormat) => {
  const submitted = { value: 2, flags: [true, false, 1, 0, "1", "0"] };
  const requests: Array<{tool_choice: unknown; max_tokens?: number; max_completion_tokens?: number; max_output_tokens?: number; input?: unknown; thinking?: unknown; messages: unknown}> = [];
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (payload: unknown) => response.write(`${apiFormat !== "chat" ? `event: ${(payload as {type:string}).type}\n` : ""}data: ${JSON.stringify(payload)}\n\n`);
    if (requests.length === 1) {
      if (apiFormat === "responses") send({ type: "response.completed", response: { id: "resp_empty", status: "completed" } });
      if (apiFormat === "anthropic") {
        send({ type: "message_start", message: { id: "msg_empty", type: "message", role: "assistant", content: [], model: "fixture", usage: { input_tokens: 2, output_tokens: 0 } } });
        send({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 0 } });
        send({ type: "message_stop" }); response.end(); return;
      }
      response.end("data: [DONE]\n\n"); return;
    }
    if (apiFormat === "responses") {
      const item = { type: "function_call", id: "fc_1", call_id: "call_1", name: "submit_value", arguments: JSON.stringify(submitted) };
      send({ type: "response.created", response: { id: "resp_1" } });
      send({ type: "response.output_item.added", output_index: 0, item: {...item, arguments: ""} });
      send({ type: "response.function_call_arguments.delta", item_id: item.id, output_index: 0, delta: item.arguments });
      send({ type: "response.output_item.done", output_index: 0, item });
      send({ type: "response.completed", response: { id: "resp_1", status: "completed", usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 } } });
      response.end("data: [DONE]\n\n"); return;
    }
    if (apiFormat === "anthropic") {
      send({ type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", content: [], model: "fixture", usage: { input_tokens: 2, output_tokens: 0 } } });
      send({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool_1", name: "submit_value", input: {} } });
      send({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(submitted) } });
      send({ type: "content_block_stop", index: 0 });
      send({ type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 2 } });
      send({ type: "message_stop" });
      response.end(); return;
    }
    send({ id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: "submit_value", arguments: JSON.stringify(submitted) } }] }, finish_reason: null }] });
    send({ id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } });
    response.end("data: [DONE]\n\n");
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const address = server.address() as { port: number };
    const client = createLLMClient({ service: "custom", configSource: "studio", provider: "openai", model: "deepseek-v4-flash", baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: "fixture-key", apiFormat, stream: true, temperature: 0, thinkingBudget: 0 });
    const progress: StreamProgress[] = [];
    class FixtureAgent extends BaseAgent {
      get name() { return "fixture"; }
      async submit() {
        return (await this.submitStructured([{role:"user",content:"Submit the requested integer."}], {
          name:"submit_value",label:"Submit",description:"Submit values",parameters:Type.Object({
            value:Type.Integer(), flags:Type.Array(Type.Union([Type.Number(),Type.String(),Type.Boolean()])),
          }),
        }, {maxTokens:128})).result;
      }
    }
    const result = await new FixtureAgent({client:{...client,defaults:{...client.defaults,maxTokens:client._piModel!.contextWindow-1}},
      model:"deepseek-v4-flash",projectRoot:"/tmp",onStreamProgress:value=>progress.push(value),
    }).submit();
    expect(result).toEqual(submitted);
    expect(progress.at(-1)?.status).toBe("done");
    expect(progress.at(-1)?.totalChars).toBeGreaterThan(0);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.messages).toEqual(requests[1]?.messages);
    if (apiFormat === "anthropic") {
      expect(requests[0]?.tool_choice).toBeUndefined();
      expect(requests[0]?.max_tokens).toBe(128);
      return;
    }
    if (apiFormat === "responses") {
      expect(requests[0]?.input).toEqual(requests[1]?.input);
      expect(requests[0]?.max_output_tokens).toBe(128);
      expect(requests[0]?.tool_choice).toBeUndefined();
      return;
    }
    expect(requests[0]?.max_tokens).toBe(128);
    expect(requests[0]?.max_completion_tokens).toBeUndefined();
    expect(requests[0]?.thinking).toEqual({ type: "disabled" });
    expect(requests[0]?.tool_choice).toBeUndefined();
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}, 15000);

it("records received partial tool output when a live stream is cancelled", async () => {
  let calls=0;
  const server = createServer(async (request,response) => {
    calls++;
    for await (const _ of request) { /* Drain the request before responding. */ }
    response.writeHead(200, {"Content-Type":"text/event-stream"});
    response.write(`data: ${JSON.stringify({id:'partial',object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'call-partial',type:'function',function:{name:'submit_value',arguments:'{"value":2}'}}]},finish_reason:null}]})}\n\n`);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    const client = createLLMClient({service:'custom',configSource:'studio',provider:'openai',model:'test-model',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiKey:'fixture',apiFormat:'chat',stream:true,temperature:0,thinkingBudget:0});
    const cancellation = new AbortController();
    const evidence: Array<Record<string,unknown>> = [];
    await withExecutionEvidence((type,payload)=>{if(type==='model-call-completed')evidence.push(payload);},async()=>{
      const stream=guardedPiStream(client._piModel!,{messages:[{role:'user',content:'Submit the integer',timestamp:1}],tools:[{name:'submit_value',description:'Submit',parameters:Type.Object({value:Type.Integer()})}]},{apiKey:'fixture',maxTokens:128,signal:cancellation.signal});
      for await(const event of stream)if(event.type==='toolcall_delta')cancellation.abort();
      expect((await stream.result()).stopReason).toBe('aborted');
    });
    expect(evidence.at(-1)).toMatchObject({status:'error',partialOutput:{content:[{type:'toolCall',id:'call-partial'}]}});
    expect(calls).toBe(1);
  } finally { server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())); }
},15000);

it('bounds invalid structured submissions and returns schema paths instead of echoing the entire manuscript',async()=>{
  const requests:Array<{messages:Array<{role:string;content:string}>}>=[];
  const server=createServer(async(request,response)=>{
    const chunks=[];for await(const chunk of request)chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    response.writeHead(200,{'Content-Type':'text/event-stream'});
    const send=(choices:unknown)=>response.write(`data: ${JSON.stringify({id:'invalid',object:'chat.completion.chunk',choices})}\n\n`);
    send([{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'call-'+requests.length,type:'function',function:{name:'submit_chapters',arguments:JSON.stringify({chapters:'[{malformed JSON}]',state:'other'})}}]},finish_reason:null}]);
    send([{index:0,delta:{},finish_reason:'tool_calls'}]);response.end('data: [DONE]\n\n');
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const client=createLLMClient({service:'custom',configSource:'studio',provider:'openai',model:'test-model',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiKey:'fixture',apiFormat:'chat',stream:true,temperature:0,thinkingBudget:0});
    await expect(runWorkerAgentTool(client,'test-model',[{role:'user',content:'Submit chapters.'}],{
      name:'submit_chapters',label:'Submit',description:'Submit chapter records',parameters:Type.Object({chapters:Type.Array(Type.Object({number:Type.Integer()})),state:Type.Union([Type.Literal('draft'),Type.Literal('ready')])}),
    },{maxTokens:128})).rejects.toMatchObject({code:'WORKER_RESULT_INVALID',attempts:3});
    expect(requests).toHaveLength(3);
    const feedback=JSON.parse(requests[1].messages.find(message=>message.role==='tool')!.content);
    expect(feedback).toMatchObject({code:'WORKER_SCHEMA_INVALID',issues:[{path:'/chapters',expectedType:'array',actualType:'string'},{path:'/state',actualType:'string',allowedValues:['draft','ready']}]});
    expect(Object.keys(feedback.issues[0]).sort()).toEqual(['actualType','expectedType','instruction','message','path','type']);
  }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
},15000);

it('bounds context compilation to one text response even if the model returns a tool from quoted history',async()=>{
  const requests:Array<{tool_choice:unknown}>=[];
  const server=createServer(async(request,response)=>{
    const chunks=[];for await(const chunk of request)chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    response.writeHead(200,{'Content-Type':'text/event-stream'});
    const delta=requests.length===1?{role:'assistant',tool_calls:[{index:0,id:'stale-call',type:'function',function:{name:'file_search',arguments:'{}'}}]}:{role:'assistant',content:'Saved the prior result; the next request remains pending.'};
    response.write(`data: ${JSON.stringify({id:'compile',object:'chat.completion.chunk',choices:[{index:0,delta,finish_reason:null}]})}\n\n`);
    response.write(`data: ${JSON.stringify({id:'compile',object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:requests.length===1?'tool_calls':'stop'}]})}\n\n`);
    response.end('data: [DONE]\n\n');
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const client=createLLMClient({service:'custom',configSource:'studio',provider:'openai',model:'test-model',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiKey:'fixture',apiFormat:'chat',stream:true,temperature:0,thinkingBudget:0});
    const input={model:client._piModel!,apiKey:'fixture',stream:true,systemPrompt:'Summarize supplied history.',userPrompt:'Earlier tool: file_search. Its result was saved.',maxTokens:128};
    await expect(compileHarnessContextText(input)).rejects.toMatchObject({code:'CONTEXT_UNEXPECTED_TOOL_CALL'});
    expect(requests).toHaveLength(1);
    expect(requests[0].tool_choice).toBe('none');
    // Zero means missing catalog metadata, not a 256-token input window.
    expect(await compileHarnessContextText({...input,model:{...input.model,contextWindow:0},userPrompt:input.userPrompt.repeat(200)})).toBeTruthy();
    expect(requests).toHaveLength(2);
  }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
},15000);

it('recovers an empty source selection with its address and materializes exact source punctuation', async () => {
  const { SourcedReviewToolSchema } = await import('../agents/review-tool.js');
  const { numberReviewSource, resolveObservationSources } = await import('../models/observation.js');
  const source = '# Source\n\n他说：“等一下。”\n下一段。';
  const sources = new Map([['source-a', source]]);
  expect(resolveObservationSources([{code:'comparison',summary:'Missing baseline',assessment:'unavailable',evidence:[],sourceRefs:[]}],sources)).toMatchObject([{assessment:'unavailable',sourceRefs:[]}]);
  expect(()=>resolveObservationSources([{code:'finding',summary:'Unsupported issue',assessment:'issue',evidence:[],sourceRefs:[]}],sources)).toThrow();
  const requests: Array<{messages:Array<{role:string;content:string}>}> = [];
  const server = createServer(async (request, response) => {
    const chunks=[]; for await(const chunk of request)chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    response.writeHead(200, {'Content-Type':'text/event-stream'});
    const argumentsValue = {summary:'Scoped result',observations:[{code:'finding',summary:'Source-backed finding',assessment:'observation',evidence:[],sourceRefs:[{sourceId:'source-a',startLine:requests.length===1?2:3,endLine:requests.length===1?2:3}]}]};
    const call={id:'call-'+requests.length,type:'function',index:0,function:{name:'submit_review',arguments:JSON.stringify(argumentsValue)}};
    response.write(`data: ${JSON.stringify({id:'review',object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',tool_calls:[call]},finish_reason:null}]})}\n\n`);
    response.end(`data: ${JSON.stringify({id:'review',object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`);
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  try {
    const client=createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat',stream:true,temperature:0,thinkingBudget:0});
    const result=await runWorkerAgentTool(client,'fixture',[{role:'user',content:numberReviewSource(source)}],{
      name:'submit_review',label:'Submit',description:'Submit addressed findings',parameters:SourcedReviewToolSchema,
      validate:result=>({...result,observations:resolveObservationSources(result.observations,sources)}),
    },{maxTokens:1024});
    expect(result.observations[0].sourceRefs).toEqual([{sourceId:'source-a',quote:source.split('\n')[2]}]);
    expect(requests).toHaveLength(2);
    const error=JSON.parse(requests[1].messages.find(message=>message.role==='tool')!.content);
    expect(error).toMatchObject({code:'REVIEW_SOURCE_REQUIRED',path:'/observations/0/sourceRefs/0',sourceId:'source-a',startLine:2,endLine:2,lineCount:4,nearbyLines:expect.arrayContaining([{line:3,text:source.split('\n')[2]}])});
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
},15000);

it('repairs an oversized checkpoint through bounded flat chapter submissions before completing the draft', async () => {
  const { ShortFictionWriterAgent } = await import('../agents/short-fiction.js');
  const requests: Array<{tools:Array<{function:{name:string}}>;messages:Array<{role:string;content:string}>}> = [];
  const checkpoints: number[][]=[];
  const server=createServer(async (request,response)=>{
    const chunks=[];for await(const chunk of request)chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    const number=requests.length===1?1:requests.length-1;
    response.writeHead(200,{'Content-Type':'text/event-stream'});
    const args={title:`Chapter ${number}`,content:requests.length===1?Array(20).fill('word').join(' '):`A complete scene for chapter ${number}.`};
    response.write(`data: ${JSON.stringify({id:'chapter',object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',tool_calls:[{id:'chapter-'+number,index:0,type:'function',function:{name:'submit_short_revision_chapter',arguments:JSON.stringify(args)}}]},finish_reason:null}]})}\n\n`);
    response.end(`data: ${JSON.stringify({id:'chapter',object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    const client=createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat',stream:true,temperature:0,thinkingBudget:0});
    const draft=await new ShortFictionWriterAgent({client,model:'fixture',projectRoot:'/tmp'}).continueDraft({direction:'Fixture',outlineMarkdown:'Two connected scenes.',chapterCount:2,charsPerChapter:10,maxChapterLength:10,maxChaptersPerCall:2,language:'en',draft:{storyTitle:'Fixture',rawContent:'',chapters:[{number:1,title:'Prior candidate',content:Array(30).fill('word').join(' '),charCount:1},{number:2,title:'',content:'',charCount:0}]},onBatchComplete:async(_draft,numbers)=>{checkpoints.push([...numbers]);}});
    expect(draft.chapters.map(chapter=>chapter.number)).toEqual([1,2]);
    expect(checkpoints).toEqual([[],[1],[1,2]]);
    expect(requests.map(request=>request.tools[0].function.name)).toEqual(['submit_short_revision_chapter','submit_short_revision_chapter','submit_short_revision_chapter']);
    expect(JSON.parse(requests[1].messages.find(message=>message.role==='tool')!.content)).toMatchObject({code:'SHORT_CHAPTER_TOO_LONG',maxChapterLength:10,chapters:[{number:1,length:20}]});
    expect(draft.chapters.map(chapter=>chapter.charCount)).toEqual([6,6]);
  } finally {server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
},15000);

it('requests only prose when keeping choices and retains option regeneration as a separate operation',async()=>{
 const {PlayTurnAgent}=await import('../play/play-agents.js');
 const requests:Array<{tools:Array<{function:{parameters:{properties:Record<string,unknown>}}}>}>=[];
 const server=createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));requests.push(body);
  const args={sceneText:'The player waits by the gate.',...(body.tools[0].function.parameters.properties.suggestedActions?{suggestedActions:['Advance','Watch']}: {})};
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  res.write(`data: ${JSON.stringify({id:'render',object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'render-call',type:'function',function:{name:'submit_play_scene',arguments:JSON.stringify(args)}}]},finish_reason:null}]})}\n\n`);
  res.end(`data: ${JSON.stringify({id:'render',object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`);
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const client=createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat',stream:true,temperature:0,thinkingBudget:0});
  const agent=new PlayTurnAgent({client,model:'fixture',projectRoot:'/tmp'}),input={turn:1,input:'Wait',context:'A player at a gate.',mode:'guided' as const,language:'en' as const,choiceCount:2};
  const original=['Keep waiting','Leave'];
  expect((await agent.renderExisting({...input,currentSuggestedActions:original})).suggestedActions).toEqual(original);
  expect((await agent.renderExisting(input)).suggestedActions).toEqual(['Advance','Watch']);
  expect(requests.map(r=>Object.keys(r.tools[0].function.parameters.properties).sort())).toEqual([['sceneText'],['sceneText','suggestedActions']]);
 }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
},15000);
