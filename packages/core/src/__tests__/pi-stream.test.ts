import {fixtureToolCalls} from './tool-call-fixtures.js';
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, Model } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { guardedPiNonStreaming } from "../agent/pi-stream.js";
import { createLLMClient } from "../llm/provider.js";
import { ShortFictionOutlineAgent, ShortFictionWriterAgent, ShortFictionDraftReviewerAgent } from "../agents/short-fiction.js";
import {createShortFictionRunTool,createShortFictionReviseTool} from "../agent/agent-tools.js";
import {runShortFictionStage} from "../pipeline/short-fiction-runner.js";
import {actionResultFacts,actionFailureFacts} from "../harness/action-observation.js";
import {ArchitectAgent} from '../agents/architect.js';
import {ReviserAgent} from '../agents/reviser.js';
import {buildLengthSpec,chapterLengthDelivery} from '../utils/length-metrics.js';
import {decodeStructuredFields} from '../agent/structured-arguments.js';
import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runAgentSession,evictAgentCache} from '../agent/agent-session.js';
import {readTranscriptEvents} from '../interaction/session-transcript.js';
import { loadBookSession } from '../interaction/book-session-store.js';
import {PlayStore} from '../play/play-store.js';
import {createPlayDB} from '../play/play-db-factory.js';
import {PipelineRunner} from '../pipeline/runner.js';
import {createBuiltInWorkProfileRegistry} from '../harness/builtin-profiles.js';
import {loadWorkManifest, listWorkManifests, createWorkManifest, saveWorkManifest} from '../harness/work-store.js';
import {createBookFoundationTool} from '../harness/tools/longform-production.js';
import {WriterAgent} from '../agents/writer.js';
import {ContinuityAuditor} from '../agents/continuity.js';
import {readShortProductionState} from '../pipeline/short-production-state.js';
import {TurnArtifactDeliveries} from '../agent/turn-completion.js';
import {syncWorkSourceArtifacts} from '../harness/source-sync.js';

const fetchWithProxyMock = vi.hoisted(() => vi.fn());

vi.mock("../utils/proxy-fetch.js", () => ({
  fetchWithProxy: async(url:string,init:RequestInit)=>{
    const body=JSON.parse(String(init.body));
    if(body.tools?.[0]?.function?.name==='submit_requested_operations'){
      const request=body.messages.findLast((m:any)=>m.role==='user').content;
      const operations:Record<string,unknown>={
        'Create the script and complete its review and export.':{newContentQuote:'Create the script',contentReviewQuote:'review and export.',exportQuote:'review and export.'},
        'Create and export a script':{newContentQuote:'Create and export a script',contentReviewQuote:'',exportQuote:'export a script'},
      };
      return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'scope',type:'function',function:{name:'submit_requested_operations',arguments:JSON.stringify(operations[request]??{newContentQuote:'',contentReviewQuote:'',exportQuote:''})}}]}}]}));
    }
    return fetchWithProxyMock(url,init);
  },
}));

const model: Model<"openai-completions"> = {
  id: "test-model",
  name: "test-model",
  api: "openai-completions",
  provider: "openai",
  baseUrl: "https://example.test/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 8192,
};

function finishResponse(status: 'answered' | 'delivered' | 'needs_input' | 'blocked', message: string) {
  return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{
    id:'finish-response',type:'function',function:{name:'finish_turn',arguments:JSON.stringify({status,message})},
  }]}}]}));
}

describe("guardedPiNonStreaming", () => {
  it('binds a recovered production Work, restores its visual tools and checks its persisted cover requirement',async()=>{
    const root=await mkdtemp(join(tmpdir(),'inkos-recovered-work-'));
    let recover=false,mainCalls=0;const transitions:string[]=[];
    const client=createLLMClient({provider:'openai',service:'custom',configSource:'studio',baseUrl:model.baseUrl,model:model.id,apiKey:'fixture',apiFormat:'chat',stream:false,thinkingBudget:0});
    const pipeline=new PipelineRunner({client,model:model.id,projectRoot:root});
    const reply=(name:string,args:unknown)=>new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:name+'-'+mainCalls,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]}));
    fetchWithProxyMock.mockImplementation(async(_url:string,init:RequestInit)=>{
      const body=JSON.parse(String(init.body));const names=body.tools.map((t:any)=>t.function.name);
      if(names.includes('finish_turn')){
        mainCalls++;
        if(mainCalls===1)return reply('workspace__inspect_work',{workId:'recovery'});
        if(mainCalls===2){expect(transitions).toEqual([]);return reply('short-fiction__draft_short_fiction',{workId:'recovery'});}
        expect(names).toContain('visual__generate_cover');
        return reply('finish_turn',{status:mainCalls===3?'delivered':'blocked',message:'The requested cover is still missing.'});
      }
      const name=names[0];
      if(name==='submit_short_chapter'&&!recover)return new Response(JSON.stringify({error:{message:'Fixture interruption'}}),{status:403});
      const args=name==='submit_short_outline'?{storyTitle:'Recovery',planMarkdown:'Return a receipt.',chapter_1_plan:'Return the receipt.'}
        :name==='submit_short_draft_batch'?{storyTitle:'Recovery',chapter_1_title:'Return',chapter_1_content:Array(25).fill('word').join(' ')}
        :name==='submit_short_chapter'?{storyTitle:'Recovery',number:1,title:'Return',content:Array(25).fill('word').join(' ')}
        :name==='submit_short_opening_hook'?{openingHook:Array(10).fill('word').join(' ')}:undefined;
      if(!args)throw Error('Unexpected fixture tool '+name);
      return reply(name,args);
    });
    try{
      const entry=createShortFictionRunTool(pipeline,root,{language:'en'});
      await expect(entry.execute('initial',{storyId:'recovery',title:'Recovery',direction:'Return a receipt.',chapters:1,charsPerChapter:25,minChapterLength:20,maxChapterLength:30,openingHookChars:10,cover:true})).rejects.toMatchObject({code:'WORKER_MODEL_ERROR'});
      expect((await readShortProductionState(root,'works/recovery/source'))?.target?.coverRequired).toBe(true);
      recover=true;
      const result=await runAgentSession({projectRoot:root,sessionId:'recovery-session',bookId:null,workId:null,profileId:'short-fiction',sessionKind:'short',language:'en',model,apiKey:'fixture',stream:false,pipeline,
        onWorkTransition:session=>{transitions.push(session.workId!);},
      },'Resume the saved draft and deliver its requested cover.');
      expect(result.errorMessage).toBeUndefined();
      expect(result).toMatchObject({workId:'recovery',profileId:'short-fiction',completion:{status:'blocked'}});
      expect(transitions).toEqual(['recovery']);
      expect((await loadBookSession(root,'recovery-session'))?.workId).toBe('recovery');
      const state=(await readShortProductionState(root,'works/recovery/source'))!;
      expect(state.target?.coverRequired).toBe(true);
      const deliveries=new TurnArtifactDeliveries();
      deliveries.observe({status:'success',summary:'Recovered',artifacts:[],observations:[],data:{workId:'recovery',delivery:state.delivery}});
      await expect(deliveries.validate(root)).rejects.toMatchObject({code:'TURN_REQUIRED_ARTIFACT_MISSING',workId:'recovery',artifactRole:'cover'});
      // A synthetic registered image tests the delivery receipt boundary, not image quality.
      await writeFile(join(root,'works/recovery/source/final/cover.png'),Buffer.from('fixture-image'));
      await syncWorkSourceArtifacts({projectRoot:root,workId:'recovery',accept:true});
      await expect(deliveries.validate(root)).resolves.toBeUndefined();
    }finally{evictAgentCache('recovery-session');await rm(root,{recursive:true,force:true});}
  });
  it('keeps a native creation entry focused on its selected producer without executing it automatically',async()=>{
    const root=await mkdtemp(join(tmpdir(),'inkos-creation-entry-'));let tools:string[]=[];
    fetchWithProxyMock.mockImplementation(async(_url:string,init:RequestInit)=>{const body=JSON.parse(String(init.body));tools=body.tools.map((t:any)=>t.function.name);return finishResponse('needs_input','Select a source.');});
    try{
      await runAgentSession({projectRoot:root,sessionId:'entry',bookId:null,workId:null,profileId:'workspace-default',sessionKind:'chat',proposalAction:'fanfic_init',language:'en',model,apiKey:'fixture',stream:false,pipeline:{} as never},'Create fanfiction from my source.');
      expect(tools).toContain('adaptation__fanfic_create');
      expect(tools).not.toContain('adaptation__spinoff_create');
      expect(tools).not.toContain('adaptation__imitation_create');
      expect(tools).not.toContain('workspace__create_work');
      expect(await listWorkManifests(root)).toHaveLength(0);
    }finally{evictAgentCache('entry');await rm(root,{recursive:true,force:true});}
  });
  it('initializes a generic long-form Work in place and preserves a composed profile without overwriting an initialized book',async()=>{
    const root=await mkdtemp(join(tmpdir(),'inkos-bound-initialization-'));
    const profile={...createBuiltInWorkProfileRegistry().require('longform-novel'),id:'custom-long',title:'Custom long'};
    const client=createLLMClient({provider:'openai',service:'custom',configSource:'studio',baseUrl:model.baseUrl,model:model.id,apiKey:'fixture',apiFormat:'chat',stream:false,temperature:0,thinkingBudget:0});
    const pipeline=new PipelineRunner({client,model:model.id,projectRoot:root});let mainCalls=0;
    try{
      await mkdir(join(root,'.inkos/profiles'),{recursive:true});await writeFile(join(root,'.inkos/profiles/custom-long.json'),JSON.stringify(profile));
      fetchWithProxyMock.mockImplementation(async(_url:string,init:RequestInit)=>{
        const body=JSON.parse(String(init.body)),worker=body.tools?.[0]?.function?.name;
        let name:string,args:unknown;
        if(worker==='submit_foundation_outline'){name=worker;args={storyFrame:'One receipt, one unresolved signature.',volumeMap:'Two chapters: arrival and return.'};}
        else if(worker==='submit_foundation_details'){name=worker;args={bookRules:'Receipts are physical objects.',bookRulesData:{prohibitions:[],enableFullCastTracking:false,allowedDeviations:[]},pendingHooks:[]};}
        else if(worker==='submit_foundation_cast_index'){name=worker;args={roles:[{tier:'major',name:'Mara'}]};}
        else if(worker==='submit_foundation_cast_documents'){name=worker;args={role_1_content:'Mara returns a borrowed receipt.'};}
        else{
          mainCalls++;if(mainCalls===4){
            const tools=body.tools.map((tool:any)=>tool.function.name);
            expect(tools).toContain('longform__revise_chapter');
            for(const raw of ['workspace__replace_work_artifact','longform__patch_chapter_text','longform__replace_chapter_text'])expect(tools).not.toContain(raw);
            return finishResponse('delivered','Initialized');
          }
          if(mainCalls>4)throw Error('Unexpected extra call');
          name=mainCalls===1?'workspace__create_work':'longform__create_book';
          args=mainCalls===1?{workId:'generic',profileId:'custom-long',title:'Receipt',intent:'Two short chapters about returning a receipt.',language:'en'}:{instruction:'Initialize the existing story.',targetChapters:2,chapterWordCount:50,minChapterLength:10,maxChapterLength:60,...(mainCalls===2?{bookId:'escaped'}:{})};
        }
        return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:name+'-'+mainCalls,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]}));
      });
      const result=await runAgentSession({projectRoot:root,sessionId:'initialization',bookId:null,workId:null,profileId:'workspace-default',sessionKind:'chat',language:'en',model,apiKey:'fixture',stream:false,pipeline},'Create and initialize a custom long-form Work.');
      expect(result.errorMessage).toBeUndefined();expect(result.workId).toBe('generic');
      const work=await loadWorkManifest(root,'generic');expect(work.profileId).toBe('custom-long');
      const path=join(root,'works/generic/source/book.json'),original=await readFile(path,'utf8');
      expect(JSON.parse(original)).toMatchObject({id:'generic',title:'Receipt',targetChapters:2,chapterWordCount:50,minChapterLength:10,maxChapterLength:60});
      await expect(loadWorkManifest(root,'escaped')).rejects.toMatchObject({code:'ENOENT'});
      await expect(createBookFoundationTool(pipeline,{activeWork:{work,projectRoot:root}}).execute('again',{instruction:'Initialize again',targetChapters:999})).rejects.toMatchObject({code:'BOOK_ALREADY_INITIALIZED'});
      expect(await readFile(path,'utf8')).toBe(original);
      const canon="Mara retains the sealed receipt and returns it to its owner. ".repeat(1100);
      const boundedClient={...client,defaults:{...client.defaults,maxTokens:4096},_piModel:{...client._piModel!,contextWindow:30000,maxTokens:4096}};
      const calls:string[]=[];
      fetchWithProxyMock.mockImplementation(async(_url:string,init:RequestInit)=>{
        const body=JSON.parse(String(init.body)),name=body.tools[0].function.name;calls.push(name);
        const args=name==="submit_chapter_draft"?{title:"Return",content:"Mara returns the sealed receipt. The owner checks the seal and accepts it."}:{postSettlement:"Receipt returned.",factOps:{upsert:[],expire:[]},hookOps:{upsert:[],mention:[],resolve:[],defer:[]},newHookCandidates:[],chapterSummary:{title:"Return",characters:"Mara",events:"Receipt returned",stateChanges:"",hookActivity:"",mood:"calm",chapterType:"resolution"}};
        return new Response(JSON.stringify({choices:[{finish_reason:"tool_calls",message:{tool_calls:[{id:name,type:"function",function:{name,arguments:JSON.stringify(args)}}]}}]}));
      });
      const chapter=await new WriterAgent({client:boundedClient,model:model.id,projectRoot:root,bookId:"generic"}).writeChapter({book:JSON.parse(original),bookDir:join(root,"works/generic/source"),chapterNumber:1,chapterIntent:"Return the receipt",chapterMemo:{chapter:1,goal:"Return the receipt",body:"The owner accepts the sealed receipt.",threadRefs:[]},contextPackage:{chapter:1,selectedContext:[{source:"story/parent_canon.md",reason:"Original ownership",excerpt:canon,protection:"protected"}]}});
      expect(chapter.chapterNumber).toBe(1);
      expect(calls).toEqual(["submit_chapter_draft","submit_runtime_state_delta"]);
    }finally{evictAgentCache('initialization');await rm(root,{recursive:true,force:true});}
  });
  it('repairs an invalid world proposal before one commit and delivers without another main-model call',async()=>{
    const root=await mkdtemp(join(tmpdir(),'inkos-play-terminal-'));
    const client=createLLMClient({provider:'openai',service:'custom',configSource:'studio',baseUrl:model.baseUrl,model:model.id,apiKey:'fixture',apiFormat:'chat',stream:false,temperature:0,thinkingBudget:0});
    const pipeline=new PipelineRunner({client,model:model.id,projectRoot:root}),store=new PlayStore(root);
    try{
      await store.createWorld({id:'world',title:'Clock room',premise:'An adult waits inside',worldContract:'One action per turn',visualContract:'',mode:'open',language:'en'});
      await store.ensureRun('world','main');await store.saveCurrentState('world','main',{turn:0});
      const db=createPlayDB(store.runDir('world','main'));db.upsertEntity({id:'actor_player',type:'actor',label:'Player',summary:'Waiting',status:'inside',createdEventId:'evt-0',updatedEventId:'evt-0'});db.upsertEntity({id:'item_key',type:'item',label:'Key',summary:'A brass key',status:'inside',createdEventId:'evt-0',updatedEventId:'evt-0'});db.close?.();
      const playerInputs=['Wait here. Do not take the key.','Wait one more minute; leave the key where it is.'];
      for(let turn=1;turn<=2;turn++){
        let calls=0;
        fetchWithProxyMock.mockImplementation(async(_url:string,init:RequestInit)=>{
          const body=JSON.parse(String(init.body));calls++;
          if(calls>(turn===1?3:2))return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'Unexpected extra model response'}}]}));
          const worker=body.tools.some((t:any)=>t.function.name==='submit_play_turn');
          const name=worker?'submit_play_turn':'interactive-world__play_step';
          const edges=turn===1&&calls===2?[{id:"self-hold",fromId:"item_key",type:"holding",toId:"item_key",value:{role:"holding"}}]:[];
          const args=worker?{action:{actionKind:'wait',intent:'Wait'},mutation:{summary:'Waited',timeAdvance:{elapsed:'one minute',anchor:'21:'+String(40+turn),rationale:'Waiting',synchronized:[]},entities:[],edges,expiredEdges:[],stateSlots:[],evidenceTransitions:[],blocked:false,blockedReason:'',notes:[]},sceneText:'The player waits under the clock.',suggestedActions:[]}:{input:'Take the key and wait'};
          return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:name+'-'+turn+'-'+calls,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]}));
        });
        const result=await runAgentSession({projectRoot:root,sessionId:'world-session',bookId:null,workId:'world',profileId:'interactive-world',sessionKind:'play',language:'en',model,apiKey:'fixture',stream:false,pipeline},playerInputs[turn-1]!);
        expect(result.errorMessage).toBeUndefined();expect(calls).toBe(turn===1?3:2);
        expect((await store.loadCurrentState('world','main'))?.turn).toBe(turn);
        expect(result.responseText).toBe((await store.readPresentation('world','main'))?.sceneText);
      }
      expect((await store.readEvents('world','main')).map(event=>event.rawInput)).toEqual(playerInputs);
      const finalDB=createPlayDB(store.runDir('world','main'));
      expect(finalDB.snapshot?.().edges.some(edge=>edge.id==="self-hold")).toBe(false);
      finalDB.close?.();
      expect((await readTranscriptEvents(root,'world-session')).filter(e=>e.type==='request_committed')).toHaveLength(2);
    }finally{evictAgentCache('world-session');await rm(root,{recursive:true,force:true});}
  });
  it('preserves candidate chapters and repairs only failing components before measured delivery',async()=>{
    const root=await mkdtemp(join(tmpdir(),'inkos-short-contract-')),calls:Record<string,number>={};
    let allowRepair=false;
    let allowOpeningRepair=false;
    const revisionInputs: Array<Record<string,unknown>>=[];
    const words=(count:number)=>Array(count).fill("word").join(" ");
    fetchWithProxyMock.mockImplementation(async(_url:string,init:RequestInit)=>{
      const body=JSON.parse(String(init.body)),name=body.tools[0].function.name,attempt=calls[name]=(calls[name]??0)+1;
      const args=name==="submit_short_outline"
        ? {storyTitle:attempt===1?"Unrequested title":"Borrowed Receipt",planMarkdown:"Return a borrowed receipt.",chapter_1_plan:"Mara arrives.",chapter_2_plan:"The witness takes the receipt."}
        : name==="submit_short_draft_batch"
        ? {storyTitle:"Borrowed Receipt",chapter_1_title:"Arrival",chapter_1_content:words(25),chapter_2_title:"Handover",chapter_2_content:words(45)}
        : name==="submit_short_opening_hook"?{openingHook:words(10)}
        : name==="submit_short_revision_chapter"?{title:"Handover",content:words(allowRepair?25:45)}
        : name==="submit_short_revision_plan"?{revisionBrief:"Clarify the independent opening",openingHook:Array(allowOpeningRepair?10:30).fill("revised").join(" ")}
        : name==="submit_short_fiction_review"?{summary:"Reviewed",observations:[]}
        : name==="submit_short_package"?{title:"Borrowed Receipt",intro:"A receipt is returned.",sellingPoints:["A witnessed handover"],coverPrompt:"A receipt on a desk"}
        : undefined;
      if(name==='submit_chapter_edit_ranges')return new Response(JSON.stringify({error:{message:'Fixture compression service unavailable'}}),{status:403});
      if(!args)throw Error("Unexpected tool: "+name);
      if(name==="submit_short_revision_plan")revisionInputs.push(JSON.parse(body.messages.filter((m:any)=>m.role==="user").at(-1).content));
      return new Response(JSON.stringify({choices:[{finish_reason:"tool_calls",message:{tool_calls:fixtureToolCalls(name,args,name+'-'+attempt,body.messages)}}]}));
    });
    const client=createLLMClient({provider:"openai",service:"custom",configSource:"studio",baseUrl:model.baseUrl,model:model.id,apiKey:"fixture",apiFormat:"chat",stream:false,temperature:0,thinkingBudget:0});
    const pipeline=new PipelineRunner({client,model:model.id,projectRoot:root});
    try{
      await saveWorkManifest(root, createWorkManifest({ id: "receipt", title: "Borrowed Receipt", profileId: "short-fiction", language: "en" }));
      const tool = createShortFictionRunTool(pipeline, root, { activeWorkId: "receipt", language: "en" });
      const parameters = { title:"Borrowed Receipt", direction:"Return a borrowed receipt", chapters:2, charsPerChapter:25, minChapterLength:20, maxChapterLength:30, openingHookChars:10, cover:false };
      await expect(tool.execute("wrong-target", { ...parameters, storyId: "another-receipt" })).rejects.toMatchObject({ code: "WORK_SCOPE_MISMATCH" });
      expect(calls).toEqual({});
      const interrupted=await tool.execute("create",parameters).catch(actionFailureFacts);
      expect(interrupted).toMatchObject({code:"WORKER_MODEL_ERROR",resultTool:"submit_chapter_edit_ranges"});
      const partial=JSON.parse(await readFile(join(root,"works/receipt/source/drafts/v001-partial/draft.json"),"utf8"));
      expect(partial.chapters.map((chapter:{charCount:number})=>chapter.charCount)).toEqual([25,45]);
      await expect(readFile(join(root,"works/receipt/source/final/short-story.json"))).rejects.toMatchObject({code:"ENOENT"});
      allowRepair=true;
      const result=await tool.execute("resume",parameters);
      expect((await listWorkManifests(root)).map(work => work.id)).toEqual(["receipt"]);
      const facts=actionResultFacts(result.details);
      const expected={title:"Borrowed Receipt",chapterCount:2,totalLength:60,unit:"words",openingHookLength:10,chapterLengths:[{number:1,length:25},{number:2,length:25}]};
      expect(facts.delivery).toMatchObject({status:"checks_passed",measurements:expected,target:{title:"Borrowed Receipt",minChapterLength:20,maxChapterLength:30,openingHookChars:10}});
      expect(calls.submit_short_outline).toBe(2);expect(calls.submit_short_draft_batch).toBe(1);
      expect(calls.submit_short_opening_hook).toBe(1);expect(calls.submit_short_revision_chapter).toBe(4);
      const final=await readFile(join(root,"works/receipt/source/final/short-story.json"),"utf8");
      expect(JSON.parse(final).chapters[0]).toEqual(partial.chapters[0]);
      const context=pipeline.createAgentContext("short-draft-review");
      const resumed=await runShortFictionStage({projectRoot:root,storyId:"receipt",direction:"",stage:"review",language:"en",cover:false,runtimes:{planner:context,writer:context,draftReview:context,package:context}});
      expect(resumed.delivery).toMatchObject({measurements:expected,target:{title:"Borrowed Receipt",minChapterLength:20,maxChapterLength:30,openingHookChars:10}});
      expect(await readFile(join(root,"works/receipt/source/final/short-story.json"),"utf8")).toBe(final);
      expect(calls.submit_short_draft_batch).toBe(1);
      const revise=createShortFictionReviseTool(pipeline,root,"receipt");
      const revisionRequest={instruction:"Rewrite only the independent opening; preserve both chapters and the outline."};
      await expect(revise.execute("invalid-opening",revisionRequest)).rejects.toMatchObject({code:"SHORT_OPENING_HOOK_CONTRACT"});
      expect(await readFile(join(root,"works/receipt/source/final/short-story.json"),"utf8")).toBe(final);
      allowOpeningRepair=true;
      const edited=await revise.execute("valid-opening",revisionRequest);
      const after=JSON.parse(await readFile(join(root,"works/receipt/source/final/short-story.json"),"utf8"));
      expect(revisionInputs.at(-1)).toMatchObject({openingHookTarget:{target:10,minimum:7,maximum:13,unit:"words"}});
      expect(after.chapters).toEqual(JSON.parse(final).chapters);
      expect(after.openingHook).toBe(Array(10).fill("revised").join(" "));
      expect(actionResultFacts(edited.details).delivery).toMatchObject({status:"checks_passed",measurements:expected});
      expect(calls.submit_short_revision_chapter).toBe(4);
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it('validates source addresses and retains the submitted judgement and explanation together',async()=>{
    const names:string[]=[];let indexCalls=0;
    const source='Mara says "I signed it."\nThe receipt remains on the desk.';
    fetchWithProxyMock.mockImplementation(async(_url:string,init:RequestInit)=>{
      const body=JSON.parse(String(init.body)),name=body.tools[0].function.name;names.push(name);
      if(names.length===2){
        const feedback=body.messages.filter((message:{role:string})=>message.role==='tool').flatMap((message:{content:string})=>{try{return [JSON.parse(message.content)];}catch{return [];}});
        expect(feedback).toEqual(expect.arrayContaining([expect.objectContaining({code:'REVIEW_OBSERVATIONS_UNRECORDED',unknownCodes:['SIGNED_RECEIPT'],acceptedCodes:[]})]));
      }
      if(names.length===3){
        const feedback=body.messages.filter((message:{role:string})=>message.role==='tool').flatMap((message:{content:string})=>{try{return [JSON.parse(message.content)];}catch{return [];}});
        expect(feedback).toEqual(expect.arrayContaining([
          expect.objectContaining({code:'WORKER_RESULT_READBACK_REQUIRED'}),
          expect.objectContaining({code:'SIGNED_RECEIPT',status:'source_resolved',sourceRefs:[
            {sourceId:'manuscript-chapter-1',quote:source.split('\n')[0]},
            {sourceId:'baseline-manuscript-chapter-1',quote:'Mara examines the unsigned receipt.'},
          ]}),
        ]));
      }
      const metadata=body.messages.flatMap((message:{content?:string})=>String(message.content??"").split("\n")).flatMap((line:string)=>{
        try{return [JSON.parse(line)];}catch{return [];}
      });
      const measurements=metadata.find((value:any)=>value.contentScope==='complete_manuscript');
      expect(measurements).toMatchObject({chapterCount:1,chapterLengths:[{number:1,length:11}],chapterLengthScope:"prose_excluding_chapter_headings"});
      expect(metadata.find((value:any)=>value.targetChapterLength===20)).toMatchObject({chapterCount:1,minChapterLength:10,maxChapterLength:25,unit:'words'});
      expect(metadata.find((value:any)=>value.scope==='episode_start')).toMatchObject({titleChanged:false,openingChanged:false,chapters:[{number:1,titleChanged:false,contentChanged:true,beforeSourceId:'baseline-manuscript-chapter-1',afterSourceId:'manuscript-chapter-1'}]});
      const args={summary:"A signed receipt is present.",observations:[{
        code:"SIGNED_RECEIPT",assessment:"observation",summary:'Mara states "I signed it." The receipt provides a concrete object for the following handover.',
        sourceRefs:[{sourceId:"manuscript-chapter-1",startLine:++indexCalls===1?999:2,endLine:indexCalls===1?999:2},{sourceId:'baseline-manuscript-chapter-1',startLine:2,endLine:2}],
      }]};
      const toolCalls=fixtureToolCalls(name,args,name+'-'+names.length,body.messages);
      if(names.length===3)toolCalls.push({index:1,id:'late-finding',type:'function',function:{name:'record_review_observation',arguments:JSON.stringify({...args.observations[0],summary:'An unobserved late proposal.'})}});
      return new Response(JSON.stringify({usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15},choices:[{finish_reason:"tool_calls",message:{tool_calls:toolCalls}}]}));
    });
    const client=createLLMClient({provider:"openai",service:"custom",configSource:"studio",baseUrl:model.baseUrl,model:model.id,apiKey:"fixture",apiFormat:"chat",stream:false,temperature:0,thinkingBudget:0});
    const result=await new ShortFictionDraftReviewerAgent({client,model:model.id,projectRoot:"/tmp"}).reviewDraft({direction:"Review the receipt scene",outlineMarkdown:"A receipt is handed over.",chapterCount:1,charsPerChapter:20,minChapterLength:10,maxChapterLength:25,language:"en",draft:{storyTitle:"Receipt",rawContent:"",chapters:[{number:1,title:"Signature",content:source,charCount:15}]},comparison:{scope:'episode_start',before:{artifactId:'draft',revisionId:'before',checksum:'sha256:before'},after:{artifactId:'draft',revisionId:'after',checksum:'sha256:after'},draft:{storyTitle:'Receipt',rawContent:'',chapters:[{number:1,title:'Signature',content:'Mara examines the unsigned receipt.',charCount:5}]}}});
    expect(names).toEqual(["submit_short_fiction_review","submit_short_fiction_review","submit_short_fiction_review"]);
    expect(result.observations).toEqual([{code:"SIGNED_RECEIPT",assessment:"observation",summary:'Mara states "I signed it." The receipt provides a concrete object for the following handover.',evidence:[],sourceRefs:[{sourceId:"manuscript-chapter-1",quote:'Mara says "I signed it."'},{sourceId:'baseline-manuscript-chapter-1',quote:'Mara examines the unsigned receipt.'}]}]);
  });
  it('reviews a chapter with governed evidence in one complete model result',async()=>{
    const names:string[]=[];
    const chapter='Mara enters without the key.', canon='Mara holds the key.';
    let suppliedContextLine='';
    fetchWithProxyMock.mockImplementation(async(_url:string,init:RequestInit)=>{
      const body=JSON.parse(String(init.body)),name=body.tools[0].function.name;names.push(name);
      let args;
      if(name==='submit_chapter_review'){
        const input=JSON.parse(body.messages.findLast((message:{role:string})=>message.role==='user').content);
        expect(input.chapterNumber).toBe(3);
        const context=input.sources.find((source:{sourceId:string})=>source.sourceId==='governed-context');
        const numberedLine=context.numberedLines.split('\n').find((line:string)=>line.endsWith(canon));
        const line=Number(numberedLine.split('\t')[0]);
        suppliedContextLine=numberedLine.slice(numberedLine.indexOf('\t')+1);
        args={summary:'Ownership needs reconciliation.',observations:[{code:'OWNERSHIP_CONFLICT',assessment:'issue',summary:'The chapter removes the key without showing a transfer.',sourceRefs:[{sourceId:'chapter-3',startLine:1,endLine:1},{sourceId:'governed-context',startLine:line,endLine:line}]}]};
      }else{
        throw new Error('Unexpected additional review call');
      }
      return new Response(JSON.stringify({usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15},choices:[{finish_reason:'tool_calls',message:{tool_calls:fixtureToolCalls(name,args,name,body.messages)}}]}));
    });
    const client=createLLMClient({provider:'openai',service:'custom',configSource:'studio',baseUrl:model.baseUrl,model:model.id,apiKey:'fixture',apiFormat:'chat',stream:false,temperature:0,thinkingBudget:0});
    const review=await new ContinuityAuditor({client,model:model.id,projectRoot:'/tmp'}).auditChapter('/tmp',chapter,3,undefined,{language:'en',contextPackage:{chapter:3,selectedContext:[{source:'story/current_state.md',reason:'Current ownership',excerpt:canon,protection:'protected'}]}});
    expect(names).toEqual(['submit_chapter_review','submit_chapter_review']);
    expect(review.observations).toEqual([{code:'OWNERSHIP_CONFLICT',assessment:'issue',summary:'The chapter removes the key without showing a transfer.',evidence:[],sourceRefs:[{sourceId:'chapter-3',quote:chapter},{sourceId:'governed-context',quote:suppliedContextLine}]}]);
    expect(review.tokenUsage).toEqual({promptTokens:20,completionTokens:10,totalTokens:30});
  });
  it('rebinds a newly created Work before the next model call and exposes its review/export tools',async()=>{
    const root=await mkdtemp(join(tmpdir(),'inkos-work-transition-'));
    const request='Create the script and complete its review and export.';
    const calls:Array<{messages:Array<{role:string;content?:string}>;tools:Array<{function:{name:string}}> }>=[];
    fetchWithProxyMock.mockImplementation(async(_url:string,init:RequestInit)=>{
      const body=JSON.parse(String(init.body));calls.push(body);
      if(calls.length>1)return finishResponse('blocked','This fixture ends after binding the Work.');
      const message={tool_calls:[{id:'create-script',type:'function',function:{name:'workspace__create_work',arguments:JSON.stringify({workId:'script',profileId:'script',title:'Script',language:'en',intent:request})}}]};
      return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message}]}));
    });
    try {
      const result=await runAgentSession({projectRoot:root,sessionId:'create-fixture',bookId:null,workId:null,profileId:'workspace-default',sessionKind:'chat',language:'en',model,apiKey:'fixture',stream:false,pipeline:{} as never},request);
      expect(result.errorMessage).toBeUndefined();
      expect(result).toMatchObject({workId:'script',profileId:'script'});
      expect(await loadBookSession(root,'create-fixture')).toMatchObject({workId:'script',profileId:'script',sessionKind:'work',bookId:null});
      expect((await loadBookSession(root,'create-fixture'))?.messages.filter(message=>message.role==='user')).toHaveLength(1);
      expect(calls).toHaveLength(2);
      expect(calls[0]!.tools.map(t=>t.function.name)).not.toContain('workspace__review_and_export_work_artifact');
      expect(calls[1]!.tools.map(t=>t.function.name)).toEqual(expect.arrayContaining(['workspace__review_and_export_work_artifact','workspace__revise_work_artifact']));
      expect(calls[1]!.tools.map(t=>t.function.name)).not.toContain('workspace__replace_work_artifact');
      expect(calls[1]!.messages.some(message=>message.role==='user'&&message.content===request)).toBe(true);
      expect((await readTranscriptEvents(root,'create-fixture')).filter(event=>event.type==='request_delivery').at(-1)).toMatchObject({state:{declared:true,steps:[{operation:'review'},{operation:'export'}]}});
      expect((await readTranscriptEvents(root,'create-fixture')).filter(e=>e.type==='request_committed')).toHaveLength(2);
    } finally {evictAgentCache('create-fixture');await rm(root,{recursive:true,force:true});}
  });
  it('persists the created Work before a failed continuation and resumes with its capabilities',async()=>{
    const root=await mkdtemp(join(tmpdir(),'inkos-target-failure-'));let calls=0;let targetAtContinuation:unknown;
    fetchWithProxyMock.mockImplementation(async()=>{
      calls++;
      if(calls===1)return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'create',type:'function',function:{name:'workspace__create_work',arguments:JSON.stringify({workId:'script',profileId:'script',title:'Script',language:'en',intent:'Create and export a script'})}}]}}]}));
      targetAtContinuation=await loadBookSession(root,'target-fixture');
      throw new Error('Fixture provider failure after creation');
    });
    try {
      const config={projectRoot:root,sessionId:'target-fixture',bookId:null,workId:null,profileId:'workspace-default',sessionKind:'chat' as const,language:'en' as const,model,apiKey:'fixture',stream:false,pipeline:{} as never};
      const failed=await runAgentSession(config,'Create and export a script');
      expect(failed.errorMessage).toBeTruthy();
      expect(targetAtContinuation).toMatchObject({workId:'script',profileId:'script',bookId:null});
      const saved=(await loadBookSession(root,'target-fixture'))!;
      const resumedBodies:Array<{tools:Array<{function:{name:string}}>}> = [];
      fetchWithProxyMock.mockImplementation(async(_url:string,init:RequestInit)=>{
        resumedBodies.push(JSON.parse(String(init.body)));
        return finishResponse('needs_input','The saved Work is available; choose the next operation.');
      });
      const resumed=await runAgentSession({...config,workId:saved.workId,profileId:saved.profileId,sessionKind:saved.sessionKind},'Continue');
      expect(resumed).toMatchObject({workId:'script',profileId:'script'});
      expect(resumed.errorMessage).toBeUndefined();
      expect(resumedBodies[0]!.tools.map(tool=>tool.function.name)).toContain('workspace__review_and_export_work_artifact');
    } finally {evictAgentCache('target-fixture');await rm(root,{recursive:true,force:true});}
  });
  it('accepts a complete multi-chapter batch as flat prose and preserves quotes and line breaks',async()=>{
    const prose=['Mara said, "Keep it locked."\nThe receipt listed a name.','The owner signed: "Received."\nMara handed over the key.'];
    fetchWithProxyMock.mockImplementation(async(_url:string,init:RequestInit)=>{
      const body=JSON.parse(String(init.body));
      expect(Object.keys(body.tools[0].function.parameters.properties)).toEqual(['storyTitle','openingHook','chapter_1_title','chapter_1_content','chapter_2_title','chapter_2_content']);
      return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'batch',type:'function',function:{name:'submit_short_draft_batch',arguments:JSON.stringify({storyTitle:'Receipt',chapter_1_title:'The name',chapter_1_content:prose[0],chapter_2_title:'Handover',chapter_2_content:prose[1]})}}]}}]}));
    });
    const client=createLLMClient({provider:'openai',service:'custom',configSource:'studio',baseUrl:model.baseUrl,model:model.id,apiKey:'fixture',apiFormat:'chat',stream:false,temperature:0,thinkingBudget:0});
    const result=await new ShortFictionWriterAgent({client,model:model.id,projectRoot:'/tmp'}).writeDraft({direction:'Fixture',outlineMarkdown:'Two complete scenes',chapterCount:2,charsPerChapter:20,language:'en'});
    expect(fetchWithProxyMock).toHaveBeenCalledTimes(1);
    expect(result.chapters.map(c=>({number:c.number,content:c.content}))).toEqual(prose.map((content,index)=>({number:index+1,content})));
  });
  it('carries the full confirmed request into a fresh resumed agent and its persisted transcript',async()=>{
    const root=await mkdtemp(join(tmpdir(),'inkos-confirm-resume-'));
    const request='Import the source, write chapter 2, review and export.';
    const calls:Array<{messages:Array<{role:string;content?:string}>}>=[];
    fetchWithProxyMock.mockImplementation(async(_url:string,init:RequestInit)=>{
      calls.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:'Ready'}}]}));
    });
    try {
      await runAgentSession({projectRoot:root,sessionId:'resume-fixture',bookId:null,workId:null,profileId:'workspace-default',sessionKind:'chat',language:'en',model,apiKey:'fixture',stream:false,pipeline:{} as never,resumeAction:{toolCallId:'import-1',capabilityId:'adaptation',actionId:'continuation_import',parameters:{sourcePath:'source.txt'},result:{status:'success',summary:'Imported',content:'Imported',artifacts:[],observations:[],data:{kind:'book_created',workId:'book'}}}},request);
      expect(calls[0]?.messages.slice(-3).map(m=>m.role)).toEqual(['user','assistant','tool']);
      expect(calls[0]?.messages.at(-3)?.content).toBe(request);
      expect((await readTranscriptEvents(root,'resume-fixture')).filter(e=>e.type==='request_started').map(e=>e.input)).toEqual([request]);
    } finally {evictAgentCache('resume-fixture');await rm(root,{recursive:true,force:true});}
  });
  it('decodes only schema-valid JSON fields and leaves malformed or wrong-shaped content rejected',()=>{
    const schema=Type.Object({items:Type.Array(Type.Object({name:Type.String()})),text:Type.String()});
    const original={items:'[{"name":"Mara"}]',text:'["Keep prose"]'};const paths:string[]=[];
    expect(decodeStructuredFields(schema,original,paths)).toEqual({items:[{name:'Mara'}],text:original.text});
    expect(paths).toEqual(['/items']);
    for(const items of ['[{"name":"bad " quote"}]','{"name":"Mara"}','[{"name":7}]'])expect(decodeStructuredFields(schema,{items,text:''})).toEqual({items,text:''});
    expect(typeof original.items).toBe('string');
  });
  it('assembles indexed character documents while preserving quoted character prose',async()=>{
    const card='An adult clerk says "Wait."\nThe witness keeps the original receipt.';
    const called:string[]=[];
    fetchWithProxyMock.mockImplementation(async(_url:string,init:RequestInit)=>{
      const body=JSON.parse(String(init.body)),name=body.tools[0].function.name;called.push(name);
      const args=name==='submit_foundation_outline'?{storyFrame:'Evidence conflict',volumeMap:'One resolved chapter'}:
        name==='submit_foundation_details'?{bookRules:'Keep the receipt',bookRulesData:{prohibitions:[],enableFullCastTracking:false,allowedDeviations:[]},pendingHooks:[]}:
        name==='submit_foundation_cast_index'?{roles:[{tier:'major',name:'Mara'},{tier:'minor',name:'Witness'}]}:
        {role_1_content:card,role_2_content:'Knows who signed the receipt.'};
      return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:fixtureToolCalls(name,args,name,body.messages)}}]}));
    });
    const client=createLLMClient({provider:'openai',service:'custom',configSource:'studio',baseUrl:model.baseUrl,model:model.id,apiKey:'fixture',apiFormat:'chat',stream:false,temperature:0,thinkingBudget:0});
    const result=await new ArchitectAgent({client,model:model.id,projectRoot:'/tmp'}).generateFoundation({id:'fixture',title:'Receipt',genre:'other',platform:'other',language:'en',status:'outlining',targetChapters:1,chapterWordCount:300,createdAt:'2026-01-01',updatedAt:'2026-01-01'});
    expect(called).toEqual(['submit_foundation_outline','submit_foundation_details','submit_foundation_cast_index','submit_foundation_cast_documents']);
    expect(result.roles).toEqual([{tier:'major',name:'Mara',content:card},{tier:'minor',name:'Witness',content:'Knows who signed the receipt.'}]);
  });
  it('preserves improving candidates without accepting them and completes only the invalid chapter',async()=>{
    const words=(n:number)=>Array(n).fill('word').join(' ');
    const drafts=[words(5),words(40),words(25)],errors:string[]=[];
    fetchWithProxyMock.mockImplementation(async(_url:string,init:RequestInit)=>{
      const body=JSON.parse(String(init.body));
      const last=body.messages.at(-1);if(last.role==='tool')errors.push(JSON.parse(last.content).code);
      const content=drafts.shift();if(content===undefined)throw Error('Unexpected model retry');
      return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'repair-'+drafts.length,type:'function',function:{name:'submit_short_revision_chapter',arguments:JSON.stringify({title:'Arrival',content})}}]}}]}));
    });
    const client=createLLMClient({provider:'openai',service:'custom',configSource:'studio',baseUrl:model.baseUrl,model:model.id,apiKey:'fixture',apiFormat:'chat',stream:false,temperature:0,thinkingBudget:0});
    const neighbor={number:2,title:'Handover',content:words(25),charCount:25};
    const checkpoints:Array<{length:number;valid:number[]}>=[];
    const result=await new ShortFictionWriterAgent({client,model:model.id,projectRoot:'/tmp'}).continueDraft({direction:'Return the receipt',outlineMarkdown:'Arrival, then handover',chapterCount:2,charsPerChapter:25,minChapterLength:20,maxChapterLength:30,language:'en',draft:{storyTitle:'Receipt',rawContent:'',chapters:[neighbor]},onBatchComplete:async(draft,valid)=>{checkpoints.push({length:draft.chapters[0]!.charCount,valid:[...valid]});}});
    expect(errors).toEqual(['SHORT_CHAPTER_TOO_SHORT','SHORT_CHAPTER_TOO_LONG']);
    expect(checkpoints).toEqual([{length:5,valid:[2]},{length:40,valid:[2]},{length:25,valid:[1,2]}]);
    expect(result.chapters[0]?.charCount).toBe(25);
    expect(result.chapters[1]).toEqual(neighbor);
  });
  it('bounds buffered drafting requests while producing every requested chapter',async()=>{
    const budgets:number[]=[];
    fetchWithProxyMock.mockImplementation(async(_url:string,init:RequestInit)=>{
      const body=JSON.parse(String(init.body)),tool=body.tools[0].function;budgets.push(body.max_tokens);
      const numbers=Object.keys(tool.parameters.properties).filter(key=>key.startsWith('chapter_')&&key.endsWith('_content')).map(key=>Number(key.split('_')[1]));
      const args={storyTitle:'Receipt',...Object.fromEntries(numbers.flatMap(number=>[[`chapter_${number}_title`,`Part ${number}`],[`chapter_${number}_content`,'Mara delivers the receipt and the owner accepts it.']]))};
      return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'batch-'+budgets.length,type:'function',function:{name:tool.name,arguments:JSON.stringify(args)}}]}}]}));
    });
    const client=createLLMClient({provider:'openai',service:'custom',configSource:'studio',baseUrl:model.baseUrl,model:model.id,apiKey:'fixture',apiFormat:'chat',stream:false,temperature:0,thinkingBudget:0});
    const result=await new ShortFictionWriterAgent({client,model:model.id,projectRoot:'/tmp'}).writeDraft({direction:'Complete the story',outlineMarkdown:'Six chapters',chapterCount:6,charsPerChapter:1000,language:'zh'});
    expect(result.chapters.map(c=>c.number)).toEqual([1,2,3,4,5,6]);
    expect(budgets.length).toBeGreaterThan(1);
    expect(budgets.every(budget=>budget<=8192)).toBe(true);
  });
  beforeEach(() => {
    fetchWithProxyMock.mockReset();
    delete process.env.INKOS_LLM_FIRST_EVENT_TIMEOUT_MS;
    delete process.env.INKOS_LLM_REQUEST_TIMEOUT_MS;
  });
  afterEach(() => { delete process.env.INKOS_LLM_FIRST_EVENT_TIMEOUT_MS; delete process.env.INKOS_LLM_REQUEST_TIMEOUT_MS; });

  it("ends a stalled non-stream request at the configured deadline without restarting the timeout", async () => {
    process.env.INKOS_LLM_REQUEST_TIMEOUT_MS = "10";
    fetchWithProxyMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      await new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
      throw new Error("unreachable");
    });
    const stream = guardedPiNonStreaming(model, { messages: [{ role: "user", content: "Wait", timestamp: 1 }] });
    const result = await stream.result();
    expect(fetchWithProxyMock).toHaveBeenCalledTimes(1);
    expect(result.stopReason).toBe("error");
    expect(result.content).toEqual([]);
  });

  it("allows a buffered result beyond the stream first-event deadline", async () => {
    process.env.INKOS_LLM_FIRST_EVENT_TIMEOUT_MS = "10";
    process.env.INKOS_LLM_REQUEST_TIMEOUT_MS = "500";
    fetchWithProxyMock.mockImplementation(async (_url: string, init: RequestInit) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 30);
        init.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(init.signal?.reason); }, {once:true});
      });
      return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:"Ready"}}]}));
    });
    const result = await guardedPiNonStreaming(model, {messages:[{role:"user",content:"Wait",timestamp:1}]}).result();
    expect(result.stopReason).toBe("stop");
    expect(fetchWithProxyMock).toHaveBeenCalledTimes(1);
  });

  it("binds revised prose to the selected chapter without regenerating the outline or other chapters", async () => {
    const draft = { storyTitle: "Story", openingHook: "An unanswered knock.", rawContent: "", chapters: [1, 2].map(number => ({ number, title: `Chapter ${number}`, content: "An original complete scene.", charCount: 5 })) };
    const reply = (name: string, args: unknown) => new Response(JSON.stringify({ choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ id: `call-${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }] }), { status: 200 });
    fetchWithProxyMock.mockResolvedValueOnce(reply("submit_short_revision_chapter", { title: "Chapter 1", content: "The revised scene resolves the missing handoff." }));
    const client = createLLMClient({ provider: "openai", service: "custom", configSource: "studio", baseUrl: model.baseUrl, model: model.id, apiKey: "test", apiFormat: "chat", stream: false, temperature: 0.7, thinkingBudget: 0 });
    const result = await new ShortFictionWriterAgent({ client, model: model.id, projectRoot: "/tmp" }).reviseDraft({ direction: "Fix chapter one", chapterCount: 2, chapterNumbers: [1], charsPerChapter: 10, minChapterLength: 1, openingHookChars:20, language: "en", draft, outlineMarkdown: "Original outline", review: "Missing handoff in chapter one" });
    expect(fetchWithProxyMock).toHaveBeenCalledTimes(1);
    expect(result.draft.chapters.map(chapter => chapter.number)).toEqual([1, 2]);
    expect(result.draft.storyTitle).toBe(draft.storyTitle);
    expect(result.outlineMarkdown).toBe("Original outline");
    expect(result.draft.chapters[1]).toEqual(draft.chapters[1]);
    expect(result.draft.openingHook).toBe(draft.openingHook);
    expect(result.draft.chapters[0]?.content).toBe("The revised scene resolves the missing handoff.");
  });

  it("validates final chapter destinations, moves original prose once, and writes only the new scene", async () => {
    const draft={storyTitle:"Receipt",openingHook:"An unanswered knock.",rawContent:"",chapters:[1,2,3,4].map(number=>({number,title:`Chapter ${number}`,content:`Original scene number ${number}.`,charCount:4}))};
    const names:string[]=[];
    const revised='Mara asks "Who signed?" The witness returns the original receipt.';
    fetchWithProxyMock.mockImplementation(async(_url:string,init:RequestInit)=>{
      const body=JSON.parse(String(init.body)),name=body.tools[0].function.name;names.push(name);
      const args=name==="submit_short_revision_plan"
        ? names.length===1
          ? {revisionBrief:"Move the receipt scene.",outlineMarkdown:"Updated outline",chapter_2_sourceNumber:3}
          : {revisionBrief:"Move original scenes three and four to final slots two and three, then close the handover.",
            outlineMarkdown:"Updated outline",chapter_2_sourceNumber:3,chapter_3_sourceNumber:4,
            chapter_4_sourceNumber:0,
            chapter_4_instruction:'Have Mara ask "Who signed?" and receive the receipt.'}
        : {title:"Chapter 4",content:revised};
      return new Response(JSON.stringify({choices:[{finish_reason:"tool_calls",message:{tool_calls:[{id:name,type:"function",function:{name,arguments:JSON.stringify(args)}}]}}]}));
    });
    const client=createLLMClient({provider:"openai",service:"custom",configSource:"studio",baseUrl:model.baseUrl,model:model.id,apiKey:"fixture",apiFormat:"chat",stream:false,temperature:0,thinkingBudget:0});
    const progress:Array<{plan:{chapters:ReadonlyArray<{number:number;instruction?:string;sourceNumber?:number}>};completed:readonly number[]}>=[];
    const result=await new ShortFictionWriterAgent({client,model:model.id,projectRoot:"/tmp"}).reviseDraft({direction:"Resolve the incomplete handover in four chapters",chapterCount:4,charsPerChapter:20,minChapterLength:1,language:"en",draft,outlineMarkdown:"Original outline",review:"Handover is incomplete.",onRevisionProgress:async value=>{progress.push(value);}});
    expect(names).toEqual(["submit_short_revision_plan","submit_short_revision_plan","submit_short_revision_chapter"]);
    expect(result.draft.openingHook).toBe(draft.openingHook);
    expect(result.draft.chapters[0]).toEqual(draft.chapters[0]);
    expect(result.draft.chapters[1]).toEqual({...draft.chapters[2],number:2});
    expect(result.draft.chapters[2]).toEqual({...draft.chapters[3],number:3});
    expect(result.draft.chapters[3]?.content).toBe(revised);
    expect(progress.at(-1)?.completed).toEqual([2,3,4]);
  });

  it("coordinates selected nonadjacent revisions and passes the evolving manuscript without changing unselected prose", async () => {
    const draft={storyTitle:"Parcel",openingHook:"The parcel arrives.",rawContent:"",chapters:[1,2,3].map(number=>({
      number,title:`Chapter ${number}`,content:`Original scene number ${number}.`,charCount:4,
    }))};
    const requests:Array<{name:string;input:Record<string,any>}>=[];
    const replacement=new Map([[1,"Mara leaves the parcel with the porter."],[3,"The porter returns the parcel to Mara."]]);
    fetchWithProxyMock.mockImplementation(async(_url:string,init:RequestInit)=>{
      const body=JSON.parse(String(init.body)),name=body.tools[0].function.name;
      const input=JSON.parse(body.messages.findLast((message:{role:string})=>message.role==="user").content);
      requests.push({name,input});
      const args=name==="submit_short_revision_plan"
        ? {revisionBrief:"The porter holds the parcel between chapters one and three.",outlineMarkdown:"The parcel stays with the porter until its return.",
          chapter_1_instruction:"Establish the handover.",chapter_3_instruction:"Complete the return from the same holder."}
        : {title:`Chapter ${input.chapterNumber}`,content:replacement.get(input.chapterNumber)};
      return new Response(JSON.stringify({choices:[{finish_reason:"tool_calls",message:{tool_calls:[{id:name,type:"function",function:{name,arguments:JSON.stringify(args)}}]}}]}));
    });
    const client=createLLMClient({provider:"openai",service:"custom",configSource:"studio",baseUrl:model.baseUrl,model:model.id,apiKey:"fixture",apiFormat:"chat",stream:false,temperature:0,thinkingBudget:0});
    const result=await new ShortFictionWriterAgent({client,model:model.id,projectRoot:"/tmp"}).reviseDraft({
      direction:"Make the handover consistent in chapters one and three.",chapterCount:3,chapterNumbers:[1,3],
      charsPerChapter:20,minChapterLength:1,language:"en",draft,outlineMarkdown:"Original outline",review:"The holder changes between scenes.",
    });
    expect(requests.map(request=>request.name)).toEqual(["submit_short_revision_plan","submit_short_revision_chapter","submit_short_revision_chapter"]);
    expect(requests[0]!.input.allowedChapterNumbers).toEqual([1,3]);
    expect(requests[0]!.input.originalManuscript).toEqual(draft.chapters);
    expect(requests[1]!.input.otherChapters.map((chapter:{number:number})=>chapter.number)).toEqual([2,3]);
    expect(requests[2]!.input.otherChapters.find((chapter:{number:number})=>chapter.number===1).content).toBe(replacement.get(1));
    expect(result.draft.chapters[1]).toEqual(draft.chapters[1]);
    expect(result.draft.openingHook).toBe(draft.openingHook);
    expect(result.outlineMarkdown).toBe("The parcel stays with the porter until its return.");
  });

  it("preserves the final length error when bounded compression is exhausted",async()=>{
    fetchWithProxyMock.mockImplementation(async(_url:string,init:RequestInit)=>{
      const name=JSON.parse(String(init.body)).tools[0].function.name;
      const args=name==='submit_short_revision_chapter'?{title:"Return",content:Array(50).fill("word").join(" ")}:name==='submit_chapter_edit_ranges'?{ranges:[{startLine:1,endLine:1}]}:{range_0_content:Array(40).fill("word").join(" ")};
      return new Response(JSON.stringify({choices:[{finish_reason:"tool_calls",message:{tool_calls:[{id:"too-long",type:"function",function:{name,arguments:JSON.stringify(args)}}]}}]}));
    });
    const client=createLLMClient({provider:"openai",service:"custom",configSource:"studio",baseUrl:model.baseUrl,model:model.id,apiKey:"fixture",apiFormat:"chat",stream:false,temperature:0,thinkingBudget:0});
    const checkpoint=vi.fn();
    await expect(new ShortFictionWriterAgent({client,model:model.id,projectRoot:"/tmp"}).continueDraft({direction:"Return a receipt",chapterCount:1,charsPerChapter:25,minChapterLength:20,maxChapterLength:30,language:"en",draft:{storyTitle:"Receipt",rawContent:"",chapters:[{number:1,title:"Return",content:"word",charCount:1}]},outlineMarkdown:"Return a receipt.",onBatchComplete:checkpoint})).rejects.toMatchObject({code:"CHAPTER_LENGTH_OUT_OF_RANGE",attempts:3});
    expect(fetchWithProxyMock).toHaveBeenCalledTimes(7);
    expect(checkpoint.mock.calls.at(-1)?.[1]).toEqual([]);
    expect(checkpoint.mock.calls.at(-1)?.[0].chapters[0].charCount).toBe(40);
  });

  it("resumes an unfinished content revision from its closest candidate without replacing the accepted source", async () => {
    const lengths=[6,5,7], inputs: any[]=[], compressionInputs:any[]=[];let resuming=false;
    fetchWithProxyMock.mockImplementation(async(_url:string,init:RequestInit)=>{
      const body=JSON.parse(String(init.body));
      const name=body.tools[0].function.name;
      if(name==='submit_chapter_edit_ranges'){if(!resuming)return new Response(JSON.stringify({error:{message:'Fixture compression service unavailable'}}),{status:403});return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'range',type:'function',function:{name,arguments:JSON.stringify({ranges:[{startLine:1,endLine:1}]})}}]}}]}));}
      if(name==='submit_chapter_range_replacements'){compressionInputs.push(JSON.parse(body.messages.findLast((m:any)=>m.role==='user').content));return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'replace',type:'function',function:{name,arguments:JSON.stringify({range_0_content:'revised revised revised revised'})}}]}}]}));}
      inputs.push(JSON.parse(body.messages.findLast((m:{role:string})=>m.role==='user').content));
      const args={title:'Revised',content:Array(lengths[inputs.length-1]).fill('revised').join(' ')};
      return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'revision-'+inputs.length,type:'function',function:{name:'submit_short_revision_chapter',arguments:JSON.stringify(args)}}]}}]}));
    });
    const client=createLLMClient({provider:'openai',service:'custom',configSource:'studio',baseUrl:model.baseUrl,model:model.id,apiKey:'fixture',apiFormat:'chat',stream:false,temperature:0,thinkingBudget:0});
    const writer=new ShortFictionWriterAgent({client,model:model.id,projectRoot:'/tmp'});
    const draft={storyTitle:'Return',rawContent:'',chapters:[{number:1,title:'Original',content:'one two three',charCount:3}]};
    const before=structuredClone(draft);
    let checkpoint: import('../agents/short-fiction.js').ShortRevisionProgress | undefined;
    const input={direction:'Clarify the final choice.',chapterCount:1,chapterNumbers:[1],charsPerChapter:3,minChapterLength:2,maxChapterLength:4,language:'en' as const,draft,outlineMarkdown:'One scene.',review:'Clarify the choice.',onRevisionProgress:async(progress:import('../agents/short-fiction.js').ShortRevisionProgress)=>{checkpoint=structuredClone(progress);}};
    await expect(writer.reviseDraft(input)).rejects.toMatchObject({resultTool:'submit_chapter_edit_ranges'});
    expect(checkpoint?.completed).toEqual([]);
    expect(checkpoint?.draft.chapters[0]!.content.split(' ')).toHaveLength(5);
    const retained=structuredClone(checkpoint!.draft.chapters[0]);
    resuming=true;const result=await writer.reviseDraft({...input,resume:checkpoint});
    expect(inputs).toHaveLength(3);expect(compressionInputs[0].editableRanges[0].content).toBe(retained.content);
    expect(result.draft.chapters[0]!.content.split(' ')).toHaveLength(4);
    expect(checkpoint?.completed).toEqual([1]);
    expect(draft).toEqual(before);
  });

  it('preserves and compresses a new replacement scene after full replacements remain over the limit',async()=>{
    const original='Nora enters.\nShe closes it.\nThe room quiets.';
    const candidate='Nora enters.\nShe closes the window slowly and carefully.\nThe room quiets.';
    const calls:string[]=[];
    fetchWithProxyMock.mockImplementation(async(_url:string,init:RequestInit)=>{
      const body=JSON.parse(String(init.body)),name=body.tools[0].function.name;calls.push(name);
      const args=name==='submit_short_revision_chapter'?{title:'Entry',content:candidate}
        :name==='submit_chapter_edit_ranges'?{ranges:[{startLine:2,endLine:2}]}
        :{range_0_content:'She closes the window.\n'};
      return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'compression-'+calls.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]}));
    });
    const client=createLLMClient({provider:'openai',service:'custom',configSource:'studio',baseUrl:model.baseUrl,model:model.id,apiKey:'fixture',apiFormat:'chat',stream:false,temperature:0,thinkingBudget:0});
    const draft={storyTitle:'Window',rawContent:'',chapters:[{number:1,title:'Entry',content:original,charCount:8}]};
    const result=await new ShortFictionWriterAgent({client,model:model.id,projectRoot:'/tmp'}).reviseDraft({direction:'Clarify what Nora closes.',chapterCount:1,chapterNumbers:[1],charsPerChapter:9,minChapterLength:8,maxChapterLength:10,language:'en',draft,outlineMarkdown:'One complete scene.',review:'Clarify the object.',resume:{plan:{revisionBrief:'Replace the scene with a clear window closing.',outlineMarkdown:'Nora closes the window.',chapters:[{number:1,sourceNumber:0,instruction:'Write the replacement scene.'}]},draft,completed:[]}});
    expect(calls).toEqual(['submit_short_revision_chapter','submit_short_revision_chapter','submit_short_revision_chapter','submit_chapter_edit_ranges','submit_chapter_range_replacements']);
    expect(result.draft.chapters[0]!.content.split('\n')).toEqual([candidate.split('\n')[0],'She closes the window.',candidate.split('\n')[2]]);
    expect(result.draft.chapters[0]!.charCount).toBe(9);
    expect(draft.chapters[0]!.content).toBe(original);
  });

  it('retains improving compression candidates across failure and resumes them without adopting the accepted manuscript',async()=>{
    const original='Nora enters.\nShe closes it.\nThe room quiets.';
    const full='Nora enters.\nShe closes the window very slowly and carefully.\nThe room quiets.';
    const compressed='Nora enters.\nShe closes the window slowly and gently.\nThe room quiets.';
    let resumed=false,wholeCalls=0;const resumedInputs:any[]=[];
    fetchWithProxyMock.mockImplementation(async(_url:string,init:RequestInit)=>{
      const body=JSON.parse(String(init.body)),name=body.tools[0].function.name;
      if(name==='submit_chapter_range_replacements'&&resumed)resumedInputs.push(JSON.parse(body.messages.findLast((m:{role:string})=>m.role==='user').content));
      const args=name==='submit_short_revision_chapter'?{title:'Entry',content:resumed?'Nora enters.\nShe closes the window.\nThe room quiets.':full}
        :name==='submit_chapter_edit_ranges'?{ranges:[{startLine:2,endLine:2}]}
        :{range_0_content:resumed?'She closes the window.\n':'She closes the window slowly and gently.\n'};
      return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'retain-'+(++wholeCalls),type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]}));
    });
    const client=createLLMClient({provider:'openai',service:'custom',configSource:'studio',baseUrl:model.baseUrl,model:model.id,apiKey:'fixture',apiFormat:'chat',stream:false,temperature:0,thinkingBudget:0});
    const writer=new ShortFictionWriterAgent({client,model:model.id,projectRoot:'/tmp'}),draft={storyTitle:'Window',rawContent:'',chapters:[{number:1,title:'Entry',content:original,charCount:8}]};
    let checkpoint:import('../agents/short-fiction.js').ShortRevisionProgress|undefined;
    const input={direction:'Clarify what Nora closes.',chapterCount:1,chapterNumbers:[1],charsPerChapter:9,minChapterLength:8,maxChapterLength:10,language:'en' as const,draft,outlineMarkdown:'One complete scene.',review:'Clarify the object.',onRevisionProgress:async(p:import('../agents/short-fiction.js').ShortRevisionProgress)=>{checkpoint=structuredClone(p);}};
    await expect(writer.reviseDraft(input)).rejects.toMatchObject({code:'CHAPTER_LENGTH_OUT_OF_RANGE'});
    expect(checkpoint?.completed).toEqual([]);expect(checkpoint?.draft.chapters[0]!.content).toBe(compressed);expect(draft.chapters[0]!.content).toBe(original);
    resumed=true;const result=await writer.reviseDraft({...input,resume:checkpoint});
    expect(resumedInputs[0].editableRanges[0].content).toBe(compressed.split('\n')[1]+'\n');expect(result.draft.chapters[0]!.charCount).toBe(9);expect(checkpoint?.completed).toEqual([1]);expect(draft.chapters[0]!.content).toBe(original);
  });

  it("retries an HTTP gateway failure before emitting a buffered result", async () => {
    fetchWithProxyMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "openai_error" }), { status: 504 }));
    fetchWithProxyMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "Ready" } }] }), { status: 200 }));
    const stream = guardedPiNonStreaming(model, { messages: [{ role: "user", content: "Start", timestamp: 1 }] });
    const events = []; for await (const event of stream) events.push(event.type);
    expect(fetchWithProxyMock).toHaveBeenCalledTimes(2);
    expect(events).not.toContain("error");
    expect((await stream.result()).stopReason).toBe("stop");
  });

  it("corrects invalid source ranges and length violations while preserving surrounding source bytes",async()=>{
    const submissions=[
      {ranges:[{startLine:9,endLine:9}]},
      {ranges:[{startLine:2,endLine:2}]},
      {range_0_content:'one two three four five\n'},
      {range_0_content:'"new beta"\n'},
    ];
    const requests: Array<{messages:Array<{role:string;content:string}>}>=[];
    fetchWithProxyMock.mockImplementation(async(_url:string,init:RequestInit)=>{
      const body=JSON.parse(String(init.body));requests.push(body);
      return new Response(JSON.stringify({choices:[{finish_reason:"tool_calls",message:{tool_calls:[{
        id:"range-"+requests.length,type:"function",function:{name:requests.length<=2?'submit_chapter_edit_ranges':'submit_chapter_range_replacements',arguments:JSON.stringify(submissions[requests.length-1])},
      }]}}]}));
    });
    const client=createLLMClient({provider:"openai",service:"custom",configSource:"studio",baseUrl:model.baseUrl,model:model.id,apiKey:"fixture",apiFormat:"chat",stream:false,temperature:0,thinkingBudget:0});
    const spec=buildLengthSpec(4,"en",{minChapterLength:3,maxChapterLength:4});
    const result=await new ReviserAgent({client,model:model.id,projectRoot:"/tmp"}).reviseChapter(
      "/tmp",'alpha\r\n"beta"\ngamma',1,[],"spot-fix",undefined,{language:"en",contextPackage:{chapter:1,selectedContext:[]},lengthSpec:spec});
    expect(requests).toHaveLength(4);
    expect(result.revisedContent).toBe('alpha\r\n"new beta"\ngamma');
    expect(result.wordCount).toBe(4);
    expect(chapterLengthDelivery(result.wordCount,spec)?.status).toBe("checks_passed");
    expect(chapterLengthDelivery(7,spec)).toMatchObject({status:"needs_revision",issues:[{code:"CHAPTER_LENGTH_OUT_OF_RANGE",actual:7,minimum:3,maximum:4}]});
    const feedback=JSON.parse(requests[3].messages.filter(message=>message.role==="tool").at(-1)!.content);
    expect(feedback.code).toBe("CHAPTER_LENGTH_OUT_OF_RANGE");
    expect(feedback).toMatchObject({scope:'selected_ranges',source:{length:3,unchangedByThisAttempt:true},candidateCommitted:false,replacementBudget:{fixedContentLength:2,minimum:1,maximum:2,countingMode:'en_words'}});
    const selected='She said "wait".';
    const original='Prefix stays.\n'+selected+'\nSuffix stays.';
    fetchWithProxyMock.mockImplementation(async()=>new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'selected',type:'function',function:{name:'submit_chapter_range_replacements',arguments:JSON.stringify({range_0_content:'She opens the door.'})}}]}}]})));
    const options={language:'en' as const,contextPackage:{chapter:1,selectedContext:[]},targetText:selected};
    const selectedResult=await new ReviserAgent({client,model:model.id,projectRoot:'/tmp'}).reviseChapter('/tmp',original,1,[],'spot-fix',undefined,options);
    expect(selectedResult.revisedContent).toBe('Prefix stays.\nShe opens the door.\nSuffix stays.');
    const calls=fetchWithProxyMock.mock.calls.length;
    await expect(new ReviserAgent({client,model:model.id,projectRoot:'/tmp'}).reviseChapter('/tmp',original+'\n'+selected,1,[],'spot-fix',undefined,options)).rejects.toMatchObject({code:'ARTIFACT_EDIT_TARGET_AMBIGUOUS'});
    expect(fetchWithProxyMock).toHaveBeenCalledTimes(calls);
  });

  it("preserves output-limit termination and never executes truncated tool arguments", async () => {
    fetchWithProxyMock.mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ finish_reason: "length", message: { tool_calls: [{
        id: "partial", type: "function", function: { name: "submit_short_outline", arguments: JSON.stringify({ storyTitle: "Draft", planMarkdown: "Partial" }) },
      }] } }],
    }), { status: 200 }));
    const stream = guardedPiNonStreaming(model, { messages: [{ role: "user", content: "Plan the story", timestamp: 1 }] });
    const events = []; for await (const event of stream) events.push(event.type);
    const result = await stream.result();
    expect(result.stopReason).toBe("length");
    expect(result.content.some(part => part.type === "toolCall")).toBe(false);
    expect(events).not.toContain("toolcall_end");
    const client = createLLMClient({provider:"openai",service:"custom",configSource:"studio",baseUrl:model.baseUrl,model:model.id,apiKey:"fixture",apiFormat:"chat",stream:false,temperature:0,thinkingBudget:0});
    await expect(new ShortFictionOutlineAgent({client,model:model.id,projectRoot:"/tmp"}).createOutline({direction:"Fixture",chapterCount:2,charsPerChapter:20,language:"en"})).rejects.toMatchObject({code:"MODEL_OUTPUT_LIMIT"});
    expect(fetchWithProxyMock).toHaveBeenCalledTimes(2);
  });

  it("requires a complete ordered chapter plan before accepting an outline", async () => {
    const chapterOne='The courier asks "Whose receipt?" and keeps the original.';
    const chapterTwo='The witness signs the handover.';
    for (const fields of [{chapter_1_plan:chapterOne}, {chapter_2_plan:chapterTwo,chapter_1_plan:chapterOne}]) {
      fetchWithProxyMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{
        id: `plan-${Object.keys(fields).length}`, type: "function", function: { name: "submit_short_outline", arguments: JSON.stringify({
          storyTitle: "Story", planMarkdown: "Story premise and ending", ...fields,
        }) },
      }] } }] }), { status: 200 }));
    }
    const modelId = "deepseek-v4-flash";
    const client = createLLMClient({ provider: "openai", service: "custom", configSource: "studio", baseUrl: model.baseUrl, model: modelId, apiKey: "test", apiFormat: "chat", stream: false, temperature: 0.7, thinkingBudget: 0 });
    const result = await new ShortFictionOutlineAgent({ client, model: modelId, projectRoot: "/tmp" }).createOutline({ direction: "Write a story", chapterCount: 2, charsPerChapter: 900, language: "en" });
    expect(fetchWithProxyMock).toHaveBeenCalledTimes(2);
    expect(result.storyTitle).toBe("Story");
    expect(result.rawContent).toBe(`Story premise and ending\n\n## Chapter 1\n\n${chapterOne}\n\n## Chapter 2\n\n${chapterTwo}`);
    expect(JSON.parse(fetchWithProxyMock.mock.calls[0]![1].body).thinking).toEqual({ type: "disabled" });
  });

  it("adapts a non-streaming tool call back into Pi events", async () => {
    fetchWithProxyMock.mockResolvedValue(new Response(JSON.stringify({
      id: "response-1",
      choices: [{
        finish_reason: "tool_calls",
        message: {
          reasoning_content: "Provider planning state",
          content: "I will create the work.",
          tool_calls: [{
            id: "call-1",
            type: "function",
            function: {
              name: "workspace__propose_action",
              arguments: JSON.stringify({ action: "short_run", title: "Demo" }),
            },
          }],
        },
      }],
      usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const context: Context = {
      systemPrompt: "Use the tool.",
      messages: [
        {role:'user',content:[{type:'text',text:'Reference image.'},{type:'image',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='}],timestamp:1},
        {role:'user',content:[{type:'text',text:'Create a short.'},{type:'text',text:'Use the reference.'}],timestamp:2},
      ],
      tools: [{ name: "workspace__propose_action", description: "Propose", parameters: Type.Object({}) }],
    };

    const thinkingModel = { ...model, id: "deepseek-v4-pro", reasoning: true };
    const stream = guardedPiNonStreaming(thinkingModel, context, { apiKey: "test-key", maxTokens: 1024 });
    const eventTypes: string[] = [];
    for await (const event of stream) eventTypes.push(event.type);
    const result = await stream.result();

    expect(eventTypes).toEqual(expect.arrayContaining(["start", "text_delta", "toolcall_end", "done"]));
    expect(result.stopReason).toBe("toolUse");
    expect(result.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "text", text: "I will create the work." }),
      expect.objectContaining({
        type: "toolCall",
        name: "workspace__propose_action",
        arguments: { action: "short_run", title: "Demo" },
      }),
    ]));
    const [, init] = fetchWithProxyMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({ model: "deepseek-v4-pro", stream: false, max_tokens: 1024, thinking: { type: "enabled" } });
    const wireUsers=(payload.messages as Array<{role:string;content:unknown}>).filter(message=>message.role==='user');
    expect(wireUsers[1].content).toBe('Create a short.\nUse the reference.');
    expect(wireUsers[0].content).toEqual([{type:'text',text:'Reference image.'},{type:'image_url',image_url:{url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='}}]);
    expect(payload.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ function: expect.objectContaining({ name: "workspace__propose_action" }) }),
    ]));
    await guardedPiNonStreaming(thinkingModel, { ...context, messages: [...context.messages, result, {
      role: "toolResult", toolCallId: "call-1", toolName: "workspace__propose_action", content: [{ type: "text", text: "Accepted" }], isError: false, timestamp: 2,
    }] }).result();
    const continuation = JSON.parse(fetchWithProxyMock.mock.calls[1]![1].body);
    expect(continuation.messages.find((message: {role: string}) => message.role === "assistant").reasoning_content).toBe("Provider planning state");
  });
});
