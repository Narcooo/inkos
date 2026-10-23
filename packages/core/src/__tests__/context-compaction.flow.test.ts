import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {createHash} from 'node:crypto';
import {estimatePiContextTokens} from '../llm/provider.js';
import {adaptRestoredAgentMessagesForModel} from '../interaction/session-transcript-restore.js';
import { afterEach, describe, expect, it } from "vitest";
import {
  ContextSourceRegistry,
  ProtectedContextOverflowError,
  compileContext,
  createBuiltInWorkProfileRegistry,
  createHarnessContextTransform,
  createWorkManifest,
  loadWorkManifest,
  saveWorkManifest,
  type ContextFragment,
} from "../harness/index.js";

describe("context assembly mini-flow", () => {
  it('preserves newly returned pixels while compacting older text and budgets visual input independently of transport size',async()=>{
    const image={type:'image',mimeType:'image/png',data:Buffer.alloc(60_000,7).toString('base64')};
    const user={role:'user',content:'Inspect the current cover.',timestamp:3};
    const call={role:'assistant',content:[{type:'toolCall',id:'read-cover',name:'workspace__read',arguments:{artifactId:'cover'}}],timestamp:4};
    const result={role:'toolResult',toolCallId:'read-cover',toolName:'workspace__read',content:[{type:'text',text:JSON.stringify({artifactId:'cover',revisionId:'r1'})},image],isError:false,timestamp:5};
    const history:string[]=[];
    const transform=createHarnessContextTransform({projectRoot:'/tmp',work:null,profile:createBuiltInWorkProfileRegistry().require('workspace-default'),budgetTokens:6000,
      conversationCompactor:async request=>{history.push(request.history);return 'Earlier work completed.';}});
    const messages=[{role:'user',content:'Earlier context. '.repeat(2000),timestamp:1},{role:'assistant',content:[{type:'text',text:'Earlier response.'}],timestamp:2},user,call,result];
    const delivered=await transform(messages as never);
    expect(history).toHaveLength(1);
    expect(history[0]!.split('\n').map(line=>JSON.parse(line).role)).toEqual(['user','assistant']);
    expect(delivered.slice(-3)).toEqual([user,call,result]);
    const compactImage={...result,content:[result.content[0],{...image,data:Buffer.alloc(8,7).toString('base64')}]};
    expect(estimatePiContextTokens({messages:[result]} as never)).toBe(estimatePiContextTokens({messages:[compactImage]} as never));
  });

  it('describes historical image identity to a text compactor without serializing encoded pixels',async()=>{
    const bytes=Buffer.alloc(60_000,7),image={type:'image',mimeType:'image/png',data:bytes.toString('base64')};
    let history='';
    const transform=createHarnessContextTransform({projectRoot:'/tmp',work:null,profile:createBuiltInWorkProfileRegistry().require('workspace-default'),budgetTokens:220,
      conversationCompactor:async request=>{history=request.history;return 'The previous image was inspected.';}});
    const current={role:'user',content:'Export the approved files.',timestamp:5};
    const delivered=await transform([{role:'user',content:'Inspect this image.',timestamp:1},
      {role:'assistant',content:[{type:'toolCall',id:'read-image',name:'workspace__read',arguments:{artifactId:'cover'}}],timestamp:2},
      {role:'toolResult',toolCallId:'read-image',toolName:'workspace__read',content:[image],isError:false,timestamp:3},
      {role:'assistant',content:[{type:'text',text:'Image inspection is complete.'}],timestamp:4},current] as never);
    const records=history.split('\n').map(line=>JSON.parse(line));
    expect(records[2].content).toEqual([{type:'image_reference',mimeType:'image/png',byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),pixelsAvailable:false}]);
    expect(delivered.at(-1)).toEqual(current);
  });

  it('keeps restored execution records in chronological history and includes them in the conversation budget',async()=>{
    const model={api:'openai-completions',provider:'openai',id:'fixture'};
    const current={role:'user',content:'Export the current draft without editing it.',timestamp:5};
    const evidence={kind:'artifact_reviewed',artifactId:'draft',revisionId:'r1',observations:[{code:'EARLIER_REVIEW',assessment:'issue'}],sourceText:'A complete paragraph from an earlier version. '.repeat(300)};
    const history=adaptRestoredAgentMessagesForModel([
      {role:'user',content:'Review the earlier draft.',timestamp:1},
      {role:'assistant',api:model.api,provider:model.provider,model:model.id,stopReason:'toolUse',timestamp:2,content:[{type:'toolCall',id:'review-1',name:'review_work_artifact',arguments:{artifactId:'draft'}}]},
      {role:'toolResult',toolCallId:'review-1',toolName:'review_work_artifact',isError:false,timestamp:3,content:[{type:'text',text:JSON.stringify(evidence)}]},
      {role:'system',content:'A prior host status note.',timestamp:4},
    ] as never,model);
    expect(history.map(message=>message.role)).toEqual(['user','assistant','assistant']);
    const record=JSON.parse((history[1] as any).content[0].text);
    expect(record).toMatchObject({kind:'historical_tool_results',results:[{toolCallId:'review-1',toolName:'review_work_artifact',isError:false}]});
    expect(JSON.parse(record.results[0].text)).toEqual(evidence);
    let compactions=0;
    const transform=createHarnessContextTransform({projectRoot:'/tmp',work:null,profile:createBuiltInWorkProfileRegistry().require('workspace-default'),budgetTokens:400,
      conversationCompactor:async request=>{
        compactions++;expect(request.intent).toBe(current.content);
        const records=request.history.split('\n').map(line=>JSON.parse(line));
        expect(records.map(record=>record.role)).toEqual(['user','assistant','assistant']);
        expect(JSON.parse(records[1].content[0].text)).toEqual(record);
        return JSON.stringify({reviewed:{artifactId:'draft',revisionId:'r1'},exported:false});
      },
    });
    const result=await transform([...history,current] as never);
    expect(compactions).toBe(1);expect(result.at(-1)).toEqual(current);
    expect(result.every(message=>['user','assistant','toolResult'].includes(message.role))).toBe(true);
    expect(history[1]).toMatchObject({role:'assistant',model:'historical-execution-record',timestamp:3});
  });

  it('retains exact progress and recent failures without recompacting the same completed history',async()=>{
    let calls=0;
    const transform=createHarnessContextTransform({projectRoot:'/tmp',work:null,profile:createBuiltInWorkProfileRegistry().require('workspace-default'),budgetTokens:2000,
      conversationCompactor:async()=>{calls++;return 'All requested files were read.';}});
    const user={role:'user',content:'Read files a and b, then export.',timestamp:1};
    const history=[user,{role:'assistant',content:[{type:'toolCall',id:'a',name:'workspace__read',arguments:{path:'works/w/source/a.md'}}]},
      {role:'toolResult',toolCallId:'a',toolName:'workspace__read',isError:false,content:[{type:'text',text:'Real source paragraph. '.repeat(2000)}]}] as never[];
    await transform(history);
    const failure={role:'toolResult',toolCallId:'b',toolName:'workspace__read',isError:true,content:[{type:'text',text:'{"code":"WORK_PATH_IS_DIRECTORY"}'}]};
    const next=await transform([...history,{role:'assistant',content:[{type:'toolCall',id:'b',name:'workspace__read',arguments:{path:'works/w/source/'}}]},failure] as never[]);
    expect(calls).toBe(1);
    expect(next.at(-1)).toEqual(failure);
    const receipt=next.find(m=>m.role==='user'&&typeof m.content==='string'&&m.content.startsWith('<host_execution_progress>')) as {content:string};
    const progress=JSON.parse(receipt.content.split('\n')[1]!);
    expect(progress.totals).toEqual({successful:1,failed:1,uniqueReadPaths:1});
    expect(progress.readPaths).toEqual(['works/w/source/a.md']);
    expect(progress.recent.at(-1)).toMatchObject({status:'error',arguments:{path:'works/w/source/'}});
  });
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("reloads Work identity while leaving domain source selection to capabilities", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-context-flow-"));
    roots.push(root);
    const profile = createBuiltInWorkProfileRegistry().require("longform-novel");
    const work = createWorkManifest({
      id: "harbor",
      title: "Before",
      profileId: profile.id,
      language: "en",
    });
    await saveWorkManifest(root, work);
    const transform = createHarnessContextTransform({ projectRoot: root, work, profile, budgetTokens: 8_000 });

    const first = await transform([{ role: "user", content: "status", timestamp: 1 }] as never);
    const current = await loadWorkManifest(root, work.id);
    await saveWorkManifest(root, { ...current, title: "After", updatedAt: new Date().toISOString() });
    const second = await transform([{ role: "user", content: "status", timestamp: 2 }] as never);
    const firstContext = first[0] as { content: string };
    const secondContext = second[0] as { content: string };

    expect({
      firstHasOldTitle: firstContext.content.includes('"title":"Before"'),
      secondHasNewTitle: secondContext.content.includes('"title":"After"'),
      includesDomainSourceText: secondContext.content.includes("author_intent.md") || secondContext.content.includes("current_focus.md"),
      messageCount: second.length,
    }).toEqual({
      firstHasOldTitle: true,
      secondHasNewTitle: true,
      includesDomainSourceText: false,
      messageCount: 2,
    });

    const protectedText = "First-person canon stays fixed.".repeat(10);
    const fragments: ContextFragment[] = [
      { id: "intent", source: "intent", content: protectedText, protection: "protected", priority: 100 },
      { id: "history", source: "history", content: "Older background. ".repeat(200), protection: "compressible", priority: 10 },
    ];
    const sources = new ContextSourceRegistry();
    sources.register({ id: "flow", async load() { return fragments; } });
    let compiledIds: string[] = [];
    const compiled = await compileContext({
      recipe: { id: "chapter", sourceIds: ["flow"] },
      sources,
      request: { projectRoot: root, work, profile, actionId: "draft", intent: "continue" },
      budgetTokens: 120,
      compiler: async (request) => {
        compiledIds = request.fragments.map((fragment) => fragment.id);
        return { content: "Background summary.", sourceIds: compiledIds };
      },
    });
    expect({ compiledIds, protectedIds: compiled.trace.protectedSourceIds }).toEqual({
      compiledIds: ["history"],
      protectedIds: ["intent"],
    });
  });

  it("fails loudly when protected context alone exceeds the budget", async () => {
    const profile = createBuiltInWorkProfileRegistry().require("longform-novel");
    const sources = new ContextSourceRegistry();
    sources.register({
      id: "protected",
      async load() {
        return [{
          id: "canon",
          source: "canon",
          content: "不可压缩正史。".repeat(500),
          protection: "protected",
          priority: 100,
        } as const];
      },
    });

    await expect(compileContext({
      recipe: { id: "chapter", sourceIds: ["protected"] },
      sources,
      request: { projectRoot: "/tmp", work: null, profile, actionId: "draft", intent: "continue" },
      budgetTokens: 30,
    })).rejects.toBeInstanceOf(ProtectedContextOverflowError);
  });

  it("compacts the complete historical middle only after the session budget is exceeded", async () => {
    const profile = createBuiltInWorkProfileRegistry().require("workspace-default");
    const history = "Earlier decision and tool outcome. ".repeat(200);
    let receivedHistory = "";
    const phases: string[] = [];
    const transform = createHarnessContextTransform({
      projectRoot: "/tmp",
      work: null,
      profile,
      budgetTokens: 220,
      conversationCompactor: async (request) => {
        receivedHistory = request.history;
        return "- The user approved the earlier decision.\n- The tool completed the artifact.";
      },
      onContextCompression: (event) => phases.push(event.phase),
    });
    const result = await transform([
      { role: "user", content: history, timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: history }], timestamp: 2 },
      { role: "user", content: "Apply that decision to the next chapter.", timestamp: 3 },
    ] as never);

    expect(receivedHistory).toContain("Earlier decision and tool outcome");
    const { convertAgentMessagesForModel } = await import("../agent/agent-session.js");
    const delivered = convertAgentMessagesForModel(result);
    expect(delivered).toEqual(result);
    expect(delivered[0]).toMatchObject({role:"user",content:expect.any(String)});
    expect(JSON.stringify(result)).toContain("conversation_summary");
    expect(JSON.stringify(result)).toContain("Apply that decision to the next chapter");
    expect(phases).toEqual(["start", "end"]);
  });

  it("compacts completed reads within the active turn while preserving the user's request", async () => {
    const profile = createBuiltInWorkProfileRegistry().require("workspace-default");
    const user = {role:"user",content:"Write the next three chapters.",timestamp:1};
    let history = "";
    const transform = createHarnessContextTransform({projectRoot:"/tmp",work:null,profile,budgetTokens:220,
      conversationCompactor:async (request)=>{history=request.history;return "Read works/novel/source/outline.md; writing remains pending.";},
    });
    const result = await transform([user,
      {role:"assistant",content:[{type:"toolCall",id:"read-1",name:"workspace__read",arguments:{path:"works/novel/source/outline.md"}}]},
      {role:"toolResult",toolCallId:"read-1",toolName:"workspace__read",content:[{type:"text",text:"A complete source paragraph. ".repeat(200)}],isError:false},
    ] as never);
    const records = history.split("\n").map((line)=>JSON.parse(line));
    expect(records.map((record)=>record.role)).toEqual(["assistant","toolResult"]);
    expect(records[1].toolCallId).toBe("read-1");
    expect(result.at(-1)).toEqual(user);
    expect(result.some((message)=>message.role==="toolResult")).toBe(false);
    history = "";
    const smallResult = {role:"toolResult",toolCallId:"read-2",toolName:"workspace__read",content:[{type:"text",text:"Ready"}],isError:false,details:{preview:"UI metadata. ".repeat(5000)}};
    const uncompressed = await transform([user,
      {role:"assistant",content:[{type:"toolCall",id:"read-2",name:"workspace__read",arguments:{}}]},smallResult,
    ] as never);
    expect(history).toBe("");
    expect(uncompressed.at(-1)).toEqual(smallResult);
  });
});
