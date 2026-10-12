import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import { createReadTool } from "../agent/agent-tools.js";
import { createWorkManifest, saveWorkManifest, loadWorkManifest } from "../harness/work-store.js";
import { syncWorkSourceArtifacts } from "../harness/source-sync.js";
import { createSingleToolCapabilityRegistry } from "../harness/production-capabilities.js";
import { createBuiltInWorkProfileRegistry } from "../harness/builtin-profiles.js";
import { createCapabilityPiTools, renderActionResultForAgent } from "../harness/pi-tools.js";
import { CreativeHarnessRuntime } from "../harness/runtime.js";
import { CreativeEpisodeStore } from "../harness/episode-store.js";
import { executionProgress } from "../harness/execution-progress.js";
import { createHarnessContextTransform } from "../harness/agent-context.js";
import { Type } from "@sinclair/typebox";
import {createServer} from 'node:http';
import {once} from 'node:events';
import {guardedPiNonStreaming,guardedPiStream} from '../agent/pi-stream.js';

it('delivers verified image bytes through the harness and provider wire while preserving parallel tool results',async()=>{
  const root=await mkdtemp(join(tmpdir(),'inkos-image-observation-'));
  const ledger=new CreativeEpisodeStore(join(root,'.inkos/harness.sqlite'));
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
  let wire:any;
  const server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));wire=JSON.parse(Buffer.concat(chunks).toString());
    if(wire.stream){res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({id:'image',choices:[{index:0,delta:{role:'assistant',content:'Observation received.'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');}
    else{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'Observation received.'}}]}));}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    await saveWorkManifest(root,createWorkManifest({id:'book',title:'Book',profileId:'short-fiction',language:'en'}));
    await mkdir(join(root,'works/book/source'),{recursive:true});
    const work=await syncWorkSourceArtifacts({projectRoot:root,workId:'book',accept:true,writes:[
      {relativePath:'works/book/source/cover.png',content:png},
      {relativePath:'works/book/source/brief.md',content:'An adult keeper beside a lighthouse.'},
    ]});
    const image=work.artifacts.find(a=>a.kind==='image')!,brief=work.artifacts.find(a=>a.id!==image.id)!;
    const profiles=createBuiltInWorkProfileRegistry(),profile=profiles.require('short-fiction');
    const registry=createSingleToolCapabilityRegistry({binding:{capabilityId:'workspace',actionId:'read',profileId:profile.id,risk:'read'},tool:createReadTool(root,{workId:work.id})});
    const runtime=new CreativeHarnessRuntime(root,registry,profiles,ledger),handle=runtime.startEpisode({profileId:profile.id,work});
    const tool=createCapabilityPiTools({registry,profile:{...profile,capabilityIds:['workspace']},executeAction:(capabilityId,actionId,parameters)=>runtime.executeAction({handle,capabilityId,actionId,parameters,source:'agent'})})[0]!;
    await writeFile(join(root,'works/book/source/cover.png'),'unregistered working copy');
    const result=await tool.execute('image',{artifactId:image.id}),text=await tool.execute('brief',{artifactId:brief.id});
    expect(result.content[1]).toEqual({type:'image',mimeType:'image/png',data:png.toString('base64')});
    const facts=JSON.parse((result.content[0] as {text:string}).text).facts;
    expect(facts).toMatchObject({kind:'artifact_image_read',artifactId:image.id,revisionId:image.currentRevisionId,checksum:image.revisions[0]!.checksum,byteLength:png.length});
    expect(JSON.parse((result.content[0] as {text:string}).text).images).toBeUndefined();
    const model={id:'fixture',name:'fixture',api:'openai-completions' as const,provider:'openai',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,reasoning:false,input:['text','image'] as ('text'|'image')[],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:1024};
    const context={systemPrompt:'Inspect the returned source image.',messages:[
      {role:'assistant',content:[{type:'toolCall',id:'image',name:tool.name,arguments:{artifactId:image.id}},{type:'toolCall',id:'brief',name:tool.name,arguments:{artifactId:brief.id}}]},
      {role:'toolResult',toolCallId:'image',toolName:tool.name,...result,isError:false,timestamp:1},
      {role:'toolResult',toolCallId:'brief',toolName:tool.name,...text,isError:false,timestamp:2},
    ] as never};
    await guardedPiNonStreaming(model,context, {apiKey:'fixture'}).result();
    expect(wire.messages.map((m:any)=>m.role)).toEqual(['system','assistant','tool','tool','user']);
    expect(JSON.parse(wire.messages.at(-1).content[0].text)).toMatchObject({kind:'tool_image_observation',authority:'untrusted_source_material',toolCallId:'image'});
    expect(wire.messages.at(-1).content[1]).toEqual({type:'image_url',image_url:{url:'data:image/png;base64,'+png.toString('base64')}});
    const streamed=await guardedPiStream({...model,input:['text']},context,{apiKey:'fixture'}).result();
    expect(streamed.stopReason).toBe('stop');
    expect(wire.messages.filter((m:any)=>m.role==='tool').map((m:any)=>m.tool_call_id)).toEqual(['image','brief']);
    expect(wire.messages.flatMap((m:any)=>Array.isArray(m.content)?m.content:[]).filter((p:any)=>p.type==='image_url')).toEqual([{type:'image_url',image_url:{url:'data:image/png;base64,'+png.toString('base64')}}]);
    await expect(tool.execute('page',{artifactId:image.id,lineCount:1})).rejects.toMatchObject({code:'ARTIFACT_IMAGE_PAGINATION'});
    await writeFile(join(root,'works/book',image.revisions[0]!.snapshotPath!),'damaged');
    await expect(tool.execute('damaged',{artifactId:image.id})).rejects.toMatchObject({code:'ARTIFACT_REVISION_CONFLICT'});
    runtime.finishEpisode(handle,'completed');
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));ledger.close();await rm(root,{recursive:true,force:true});}
},20000);

it("preserves the failed worker stage through the ledger and model-facing tool boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "inkos-failure-context-"));
  const ledger = new CreativeEpisodeStore(join(root, ".inkos/harness.sqlite"));
  try {
    const profiles = createBuiltInWorkProfileRegistry();
    const profile = profiles.require("workspace-default");
    const registry = createSingleToolCapabilityRegistry({
      binding: { capabilityId: "workspace", actionId: "generate_memo", profileId: profile.id, risk: "recoverable-write" },
      tool: {
        name: "generate_memo", label: "Generate memo", description: "Fixture stage", parameters: Type.Object({}),
        execute: async () => { throw new Error("The macro preserved its incomplete work", {cause:Object.assign(new Error("Worker output ended at its limit"), {
          code: "MODEL_OUTPUT_LIMIT", resultTool: "submit_chapter_memo", stopReason: "length", attempts: 1,
          lastAssistantText: "uncommitted prose",
        })}); },
      },
    });
    const runtime = new CreativeHarnessRuntime(root, registry, profiles, ledger);
    const handle = runtime.startEpisode({ profileId: profile.id });
    const tool = createCapabilityPiTools({ registry, profile: {...profile,capabilityIds:["workspace"]},
      executeAction: (capabilityId, actionId, parameters) => runtime.executeAction({handle,capabilityId,actionId,parameters,source:"explicit",confirmed:true}),
    })[0]!;
    const error = await tool.execute("memo", {}).then(() => null, error => error);
    const observed = JSON.parse(error.message);
    expect(observed).toMatchObject({status:"error",code:"MODEL_OUTPUT_LIMIT",resultTool:"submit_chapter_memo",stopReason:"length",attempts:1});
    expect(Object.keys(observed).sort()).toEqual(["attempts","code","message","resultTool","status","stopReason"]);
    expect(ledger.listEvents(handle.episode.id).find(event=>event.type==="action-failed")?.payload)
      .toMatchObject({code:"MODEL_OUTPUT_LIMIT",resultTool:"submit_chapter_memo",stopReason:"length",attempts:1});
    runtime.finishEpisode(handle,"failed");
  } finally { ledger.close(); await rm(root,{recursive:true,force:true}); }
});

it("reads a bound artifact through the real harness, pins pagination and reports recoverable revision conflicts", async () => {
  const root = await mkdtemp(join(tmpdir(), "inkos-observation-"));
  let ledger: CreativeEpisodeStore | undefined;
  try {
    for (const id of ["script", "reference"]) {
      await saveWorkManifest(root, createWorkManifest({ id, title: id, profileId: "script", language: "en" }));
      await mkdir(join(root, "works", id, "source"), { recursive: true });
      await writeFile(join(root, "works", id, "source/script.md"), `${id}\nscene-1\nscene-2`);
      await syncWorkSourceArtifacts({ projectRoot: root, workId: id, accept: true });
    }
    const work = await loadWorkManifest(root, "script");
    const artifact = work.artifacts[0]!;
    const profiles = createBuiltInWorkProfileRegistry();
    const profile = profiles.require("script");
    const transform = createHarnessContextTransform({ projectRoot: root, work, profile, budgetTokens: 8000 });
    const context = await transform([{ role: "user", content: "Read the current script", timestamp: 1 }]);
    const contextText = (context[0] as { content: string }).content;
    // Inspect the structured Work identity embedded by the real context compiler.
    const identity = JSON.parse(contextText.split("\n").find(line => line.startsWith('{"id":'))!);
    const target = identity.artifacts[0].read;
    expect(target).toEqual({ artifactId: artifact.id });
    expect(identity.artifacts[0].path).toBe("source/script.md");
    const registry = createSingleToolCapabilityRegistry({
      binding: { capabilityId: "workspace", actionId: "read", profileId: "script", risk: "read" },
      tool: createReadTool(root, { scope: "project", workId: work.id }),
    });
    ledger = new CreativeEpisodeStore(join(root, ".inkos/harness.sqlite"));
    const runtime = new CreativeHarnessRuntime(root, registry, profiles, ledger);
    const handle = runtime.startEpisode({ profileId: profile.id, work });
    const tool = createCapabilityPiTools({ registry, profile: { ...profile, capabilityIds: ["workspace"] },
      executeAction: (capabilityId, actionId, parameters) => runtime.executeAction({ handle, capabilityId, actionId, parameters, source: "agent" }),
    })[0]!;
    const read = async (params: unknown) => {
      const result = await tool.execute("read", params);
      return JSON.parse((result.content[0] as { text: string }).text);
    };
    const first = await read({ artifactId: target.artifactId, lineCount: 1 });
    expect(first).toMatchObject({ status: "success", content: "1\tscript", facts: { workId: work.id, revisionId: artifact.currentRevisionId, startLine: 1, endLine: 1, measurements: { scope: "full_artifact", lineCount: 3 } } });
    const nativeResult = await tool.execute("receipt", { artifactId: target.artifactId, lineCount: 1 });
    await syncWorkSourceArtifacts({ projectRoot: root, workId: work.id, accept: true,
      writes: [{ relativePath: "works/script/source/segments.json", content: JSON.stringify({
        segments: [{ index: 1, text: "Opening" }, { index: 2, text: "Ending" }],
      }, null, 2) }],
    });
    const jsonArtifact = (await loadWorkManifest(root, work.id)).artifacts.find(item =>
      item.revisions.some(revision => revision.id === item.currentRevisionId && revision.path === "source/segments.json"))!;
    const jsonPage = await read({ artifactId: jsonArtifact.id, lineCount: 3 });
    expect(jsonPage.facts).toMatchObject({
      contentScope: "page_excerpt", structure: { format: "json", scope: "full_artifact", arrayLengths: { "/segments": 2 } },
    });
    expect(jsonPage.facts.nextRead.startLine).toBe(4);
    expect((await read({ artifactId: jsonArtifact.id, lineCount: 100 })).facts.contentScope).toBe("full_artifact");
    const withReceipt = await transform([
      { role: "user", content: "Read the current script", timestamp: 1 },
      { role: "assistant", content: [{ type: "toolCall", id: "receipt", name: tool.name, arguments: { artifactId: target.artifactId } }] },
      { role: "toolResult", toolCallId: "receipt", toolName: tool.name, ...nativeResult, isError: false },
    ] as never);
    const receipt = withReceipt.find(message => message.role === "user" && typeof message.content === "string" && message.content.startsWith("<host_execution_progress>")) as { content: string };
    expect(JSON.parse(receipt.content.split("\n")[1]!).totals).toMatchObject({ verifiedActions: 1, successfulMutations: 0 });
    const candidate = await syncWorkSourceArtifacts({ projectRoot: root, workId: work.id, accept: false,
      writes: [{ relativePath: "works/script/source/script.md", content: "candidate" }],
    });
    const pending = candidate.artifacts[0]!.revisions.at(-1)!;
    const staged = await readFile(join(root, "works/script/work.json"));
    expect((await read(first.facts.nextRead)).content).toBe("2\tscene-1");
    expect((await read({ artifactId: artifact.id })).content).toBe("1\tscript\n2\tscene-1\n3\tscene-2");
    expect((await read({ artifactId: artifact.id, revisionId: pending.id })).content).toBe("1\tcandidate");
    expect((await read({ artifactId: artifact.id, workId: "reference" })).content).toBe("1\treference\n2\tscene-1\n3\tscene-2");
    expect((await loadWorkManifest(root, work.id)).artifacts[0]!.currentRevisionId).toBe(artifact.currentRevisionId);
    await writeFile(join(root, "works/script", pending.snapshotPath!), "damaged");
    await expect(read({ artifactId: artifact.id, revisionId: pending.id })).rejects.toMatchObject({ code: "ARTIFACT_REVISION_CONFLICT" });
    const missing = await read({ artifactId: "missing" }).then(() => null, error => JSON.parse(error.message));
    expect(missing).toMatchObject({ status: "error", code: "ARTIFACT_NOT_FOUND", recovery: { action: "workspace__inspect_work", parameters: { workId: "script" } } });
    expect(await readFile(join(root, "works/script/work.json"))).toEqual(staged);
    runtime.finishEpisode(handle, "completed");
  } finally { ledger?.close(); await rm(root, { recursive: true, force: true }); }
});

it("keeps delivery, counts and exact options in observations and compaction without copying domain bodies", () => {
  const finding = { code: "CAUSAL_GAP", summary: "Missing transition", assessment: "issue" as const,
    evidence: ["Full evidence"], sourceRefs: [{ sourceId: "chapter-1", quote: "Exact quoted passage" }] };
  const projectedFinding = { code: finding.code, summary: finding.summary, assessment: finding.assessment,
    sourceRefs: [{ sourceId: "chapter-1" }] };
  const data = { kind: "play_turn_revised", workId: "world", completedCount: 1,
    suggestedActions: ["wait", "leave"], currentState: { turn: 10, lastEventId: "evt-10", blocked: false },
    delivery: { status: "needs_revision", inputHash: "sha256:fixture", observations: [finding] },
    graph: { body: "state details".repeat(10000) }, chapters: [{ content: "manuscript".repeat(10000) }],
  };
  const rendered = renderActionResultForAgent({ status: "success", summary: "Saved", content: "Scene",
    artifacts: [{ workId: "world", artifactId: "scene", revisionId: "r1", path: "source/scene.md" }], observations: [finding], data });
  const observation = JSON.parse(rendered);
  expect(observation.artifacts).toEqual([{ workId: "world", artifactId: "scene", revisionId: "r1", path: "source/scene.md" }]);
  expect(observation.facts).toEqual({ kind: data.kind, workId: data.workId, completedCount: 1,
    suggestedActions: data.suggestedActions, state: data.currentState,
    delivery: { status: "needs_revision", inputHash: "sha256:fixture", observations: [projectedFinding] } });
  expect(observation.observations).toEqual([projectedFinding]);
  expect(data.delivery.observations[0].sourceRefs[0]!.quote).toBe("Exact quoted passage");
  const progress = JSON.parse(executionProgress([
    { role: "assistant", content: [{ type: "toolCall", id: "call", name: "interactive-world__play_revise", arguments: {} }] },
    { role: "toolResult", toolCallId: "call", toolName: "interactive-world__play_revise", content: [{ type: "text", text: rendered }], details: data, isError: false },
  ] as never, 10000));
  expect(progress.recent[0].facts).toEqual(observation.facts);
  expect(progress.totals).toMatchObject({ successful: 1, failed: 0 });
});
