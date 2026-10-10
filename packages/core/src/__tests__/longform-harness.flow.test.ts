import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import {readFileSync} from 'node:fs';
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {createServer} from 'node:http';
import {once} from 'node:events';
import {ComposerAgent} from '../agents/composer.js';
import {PipelineRunner} from '../pipeline/runner.js';
import {createLLMClient} from '../llm/provider.js';
import {loadRuntimeStateSnapshot} from '../state/runtime-state-store.js';
import { WriterAgent, type WriteChapterOutput } from "../agents/writer.js";
import { persistChapterArtifacts } from "../pipeline/chapter-persistence.js";
import { reviewChapterDraft } from "../pipeline/chapter-review.js";
import { validateChapterTruthPersistence } from "../pipeline/chapter-truth-validation.js";
import { StateManager } from "../state/manager.js";
import { createWorkManifest, loadWorkManifest, saveWorkManifest } from "../harness/work-store.js";
import { syncWorkSourceArtifacts } from "../harness/source-sync.js";
import { buildLengthSpec } from "../utils/length-metrics.js";
import { createInitialRuntimeState } from "../state/runtime-state-store.js";
import {loadChaptersFromPath} from '../agent/chapter-import-source.js';
import {createWriteChaptersTool} from '../harness/tools/longform-production.js';
import {actionFailureFacts} from '../harness/action-observation.js';
import {buildExportArtifact} from '../interaction/export-artifact.js';
import {ContinuityAuditor} from '../agents/continuity.js';
import {ReviserAgent} from '../agents/reviser.js';
import {StateValidatorAgent} from '../agents/state-validator.js';
import {withExecutionEvidence} from '../harness/execution-evidence.js';
import {fixtureToolCalls} from './tool-call-fixtures.js';
import {createHash} from 'node:crypto';
import {savePersistedPlan} from '../pipeline/persisted-governed-plan.js';

describe("long-form harness mini-flow", () => {
  const roots: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('publishes each completed chapter before a later chapter in the same batch fails',async()=>{
    const root=await tempRoot(),id='batch',state=new StateManager(root);
    await saveWorkManifest(root,createWorkManifest({id,title:'Batch',profileId:'longform-novel',language:'en'}));
    const bookDir=state.bookDir(id),now=new Date().toISOString();
    await state.saveBookConfig(id,{id,title:'Batch',genre:'general',platform:'other',status:'active',targetChapters:2,chapterWordCount:10,language:'en',createdAt:now,updatedAt:now});
    await mkdir(join(bookDir,'story/outline'),{recursive:true});
    for(const [name,content] of Object.entries({'outline/story_frame.md':'The witness leaves.','outline/volume_map.md':'Two scenes.','book_rules.md':'# Rules\nPreserve facts.','book_rules.json':JSON.stringify({version:'2',prohibitions:[],enableFullCastTracking:false,allowedDeviations:[]})}))await writeFile(join(bookDir,'story',name),content);
    await createInitialRuntimeState({bookDir,language:'en'});
    await state.saveChapterIndex(id,[]);
    await mkdir(join(bookDir,'story/runtime'),{recursive:true});
    for(const chapter of [1,2])await savePersistedPlan(bookDir,{intent:{chapter,goal:'Continue the departure.'},memo:{chapter,goal:'Continue the departure.',body:'Continue the departure.',threadRefs:[]},intentMarkdown:'Continue the departure.',runtimePath:`runtime/chapter-${chapter}.intent.md`,plannerInputs:[]});
    const staged=await syncWorkSourceArtifacts({projectRoot:root,workId:id,accept:false,writes:[{relativePath:`works/${id}/source/notes.md`,content:'An unrelated candidate.'}]});
    const note=staged.artifacts.find(a=>a.revisions.some(r=>r.path==='source/notes.md'))!;
    // Only model decisions are fixtures; chapter persistence, state, batch
    // execution, the Work registry and its reader remain real modules.
    vi.spyOn(WriterAgent.prototype,'writeChapter').mockResolvedValueOnce(chapterOutput(1))
      .mockRejectedValueOnce(Object.assign(new Error('Second chapter provider unavailable'),{code:'MODEL_UNAVAILABLE'}));
    vi.spyOn(ContinuityAuditor.prototype,'auditChapter').mockResolvedValue({summary:'',observations:[]});
    vi.spyOn(StateValidatorAgent.prototype,'validate').mockResolvedValue({consistent:true,reconciliationRequired:false,observations:[]});
    const client=createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'fixture',apiKey:'fixture',baseUrl:'http://127.0.0.1:1/v1',apiFormat:'chat',stream:false,thinkingBudget:0,temperature:0});
    const pipeline=new PipelineRunner({projectRoot:root,client,model:'fixture'});
    const visibleAtCompletion:number[]=[];
    await expect(pipeline.writeChapters(id,2,{startChapterNumber:1,onChapterComplete:()=>{
      const work: Awaited<ReturnType<typeof loadWorkManifest>>=JSON.parse(readFileSync(join(root,'works',id,'work.json'),'utf8'));
      visibleAtCompletion.push(work.artifacts.filter(a=>a.kind==='chapter'&&a.currentRevisionId).length);
    }})).rejects.toMatchObject({code:'MODEL_UNAVAILABLE'});
    const work=await loadWorkManifest(root,id);
    expect(visibleAtCompletion).toEqual([1]);
    expect(work.artifacts.filter(a=>a.kind==='chapter'&&a.currentRevisionId)).toHaveLength(1);
    expect(work.artifacts.find(a=>a.id===note.id)?.currentRevisionId).toBeNull();
    expect((await state.loadChapterIndex(id)).map(c=>c.number)).toEqual([1]);
    expect((await loadRuntimeStateSnapshot(bookDir)).manifest.lastAppliedChapter).toBe(1);
    expect(await state.getNextChapterNumber(id)).toBe(2);
  },20000);

  it('resumes state projection after restart without regenerating a completed scoped revision',async()=>{
    const root=await tempRoot(),id='resume',state=new StateManager(root),bookDir=state.bookDir(id),now=new Date().toISOString();
    const original='The witness closes the ledger.\n\nThe witness leaves the room.';
    const replacement='The witness takes the key and leaves the room.';
    const authorRequest='Change only the final paragraph to clarify the departure; preserve the first paragraph.';
    await saveWorkManifest(root,createWorkManifest({id,title:'Return',profileId:'longform-novel',language:'en'}));
    await state.saveBookConfig(id,{id,title:'Return',genre:'general',platform:'other',status:'active',targetChapters:1,chapterWordCount:20,minChapterLength:1,maxChapterLength:30,language:'en',createdAt:now,updatedAt:now});
    await mkdir(join(bookDir,'story/outline'),{recursive:true});
    for(const [name,content] of Object.entries({'outline/story_frame.md':'The witness leaves with the key.','outline/volume_map.md':'One departure scene.','book_rules.md':'Preserve the ledger closing.','book_rules.json':JSON.stringify({version:'2',prohibitions:[],enableFullCastTracking:false,allowedDeviations:[]})}))await writeFile(join(bookDir,'story',name),content);
    await createInitialRuntimeState({bookDir,language:'en'});await state.saveChapterIndex(id,[]);await state.snapshotState(id,0);
    vi.spyOn(ComposerAgent.prototype,'selectTaskContext').mockResolvedValue({chapter:1,selectedContext:[]});
    vi.spyOn(ContinuityAuditor.prototype,'auditChapter').mockResolvedValue({summary:'',observations:[]});
    vi.spyOn(StateValidatorAgent.prototype,'validate').mockResolvedValue({consistent:true,reconciliationRequired:false,observations:[]});
    const revise=vi.spyOn(ReviserAgent.prototype,'reviseChapter');
    const calls:string[]=[];let failProjection=false;
    const server=createServer(async(req,res)=>{
      const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=JSON.parse(Buffer.concat(chunks).toString());const name=body.tools[0].function.name;calls.push(name);
      const delta=chapterOutput(1).runtimeStateDelta!;const {chapter:_chapter,...summary}=delta.chapterSummary!;
      const args=name==='submit_chapter_length_bounds'?{target:0,minimum:0,maximum:0,sourceQuote:''}
        :name==='submit_edit_location'?{kind:'paragraphs',boundary:'last',count:1,target:''}
        :name==='submit_chapter_range_replacements'?{selection_0_text:replacement}
        :{postSettlement:'The witness is outside.',factOps:failProjection?'{malformed}':delta.factOps,hookOps:delta.hookOps,newHookCandidates:[],chapterSummary:{...summary,title:'Return'}};
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'resume-'+calls.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]}));
    });server.listen(0,'127.0.0.1');await once(server,'listening');
    try{
      const client=createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat',stream:false,thinkingBudget:0});
      const runner=()=>new PipelineRunner({projectRoot:root,client,model:'fixture'});
      await runner().importChapters({bookId:id,chapters:[{title:'Return',content:original}],resumeFrom:1});
      const before=await loadWorkManifest(root,id),sourcePath=join(bookDir,'chapters/0001_Return.md'),bytes=await readFile(sourcePath),snapshot=await loadRuntimeStateSnapshot(bookDir);
      failProjection=true;
      await expect(withExecutionEvidence(()=>{},()=>runner().reviseDraft(id,1,'spot-fix','Clarify the final departure.'),undefined,before,authorRequest,before)).rejects.toMatchObject({code:'WORKER_SCHEMA_INVALID',recovery:{action:'longform__revise_chapter',workId:id}});
      expect(await readFile(sourcePath)).toEqual(bytes);expect(await loadRuntimeStateSnapshot(bookDir)).toEqual(snapshot);
      expect(revise).toHaveBeenCalledTimes(1);
      failProjection=false;
      const result=await withExecutionEvidence(()=>{},()=>runner().reviseDraft(id,1,'polish','Retry the failed state projection.'),undefined,before,authorRequest,before);
      expect(revise).toHaveBeenCalledTimes(1);
      expect(calls.filter(name=>name==='submit_chapter_range_replacements')).toHaveLength(1);
      expect(result).toMatchObject({changed:true,editPermission:{basis:'original_author_request',selectedOriginalText:['The witness leaves the room.'],surroundingText:'protected'}});
      const {chapterDocumentBody}=await import('../utils/chapter-document.js');
      expect(chapterDocumentBody(await readFile(sourcePath,'utf8'),1,'Return','en')).toBe(original.replace('The witness leaves the room.',replacement));
      expect((await loadRuntimeStateSnapshot(bookDir)).manifest.lastAppliedChapter).toBe(1);
      await expect(readFile(join(root,'.inkos/chapter-revision-candidates',id,'1.json'))).rejects.toMatchObject({code:'ENOENT'});
    }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  },20000);

  it('reviews and replays an imported chapter without replanning its story or advancing its state twice',async()=>{
    const root=await tempRoot();
    const state=new StateManager(root),bookDir=state.bookDir('replay');
    const now=new Date().toISOString();
    await saveWorkManifest(root,createWorkManifest({id:'replay',title:'Replay',profileId:'longform-novel',language:'en'}));
    await state.saveBookConfig('replay',{id:'replay',title:'Replay',genre:'general',platform:'other',status:'active',targetChapters:3,chapterWordCount:1000,language:'en',createdAt:now,updatedAt:now});
    await mkdir(join(bookDir,'story/outline'),{recursive:true});
    await writeFile(join(bookDir,'story/outline/story_frame.md'),'A witness leaves.');
    await writeFile(join(bookDir,'story/outline/volume_map.md'),'One scene.');
    await writeFile(join(bookDir,'story/book_rules.md'),'# Rules\n');
    await writeFile(join(bookDir,'story/book_rules.json'),JSON.stringify({version:'2',prohibitions:[],enableFullCastTracking:false,allowedDeviations:[]}));
    await createInitialRuntimeState({bookDir,language:'en'});
    await state.saveChapterIndex('replay',[]);
    await state.snapshotState('replay',0);
    const planPath=join(bookDir,'story/runtime/chapter-0001.intent.md');
    const plan=Buffer.from('Original scene plan.');
    await mkdir(join(bookDir,'story/runtime'),{recursive:true});await writeFile(planPath,plan);
    const composer=vi.spyOn(ComposerAgent.prototype,'selectTaskContext').mockResolvedValue({chapter:1,selectedContext:[{
      source:'runtime/chapter_memo',reason:'Coordinator suggestion',excerpt:'Require a different departure scene.',protection:'protected',
    }]});
    const auditor=vi.spyOn(ContinuityAuditor.prototype,'auditChapter');
    let calls=0;
    const server=createServer(async(req,res)=>{
      const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const name=body.tools[0].function.name;
      const delta=chapterOutput(1).runtimeStateDelta!;
      const {chapter:_chapter,...summary}=delta.chapterSummary!;
      const result=name==='submit_chapter_review'?{summary:'Reviewed the chapter.',observations:[{code:'DEPARTURE',assessment:'issue',category:'quality',summary:'Clarify the departure.',sourceRefs:[{sourceId:'chapter-1',startLine:1,endLine:1}]}]}:{postSettlement:'The witness leaves.',factOps:delta.factOps,hookOps:delta.hookOps,newHookCandidates:[],chapterSummary:summary};
      calls++;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:fixtureToolCalls(name,result,'settle-'+calls,body.messages)}}]}));
    });
    server.listen(0,'127.0.0.1');await once(server,'listening');
    try{
      const client=createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat',stream:false,temperature:0,thinkingBudget:0});
      const pipeline=new PipelineRunner({projectRoot:root,client,model:'fixture'});
      const input={bookId:'replay',chapters:[{title:'Departure',content:chapterOutput(1).content}],resumeFrom:1};
      await expect(pipeline.importChapters({...input,chapters:[{title:'Empty boundary',content:' \n'}]}))
        .rejects.toMatchObject({code:'CHAPTER_IMPORT_EMPTY_CONTENT',emptyChapterNumbers:[1]});
      expect(calls).toBe(0);
      expect(await state.loadChapterIndex('replay')).toEqual([]);
      const staged=await syncWorkSourceArtifacts({projectRoot:root,workId:'replay',accept:false,writes:[{relativePath:'works/replay/source/notes.md',content:'An unrelated candidate.'}]});
      const notes=staged.artifacts.find(a=>a.revisions.some(r=>r.path==='source/notes.md'))!;
      await pipeline.importChapters(input);
      const imported=await loadWorkManifest(root,'replay');
      expect(imported.artifacts.find(a=>a.revisions.some(r=>r.path==='source/chapters/0001_Departure.md'))?.currentRevisionId).toBeTruthy();
      expect(imported.artifacts.find(a=>a.id===notes.id)?.currentRevisionId).toBeNull();
      const first=await loadRuntimeStateSnapshot(bookDir);
      const source=await readFile(join(bookDir,'chapters/0001_Departure.md'));
      // Replaying the original requested range must not silently append later
      // chapters. Exercise the actual tool, lock, and persisted progress boundary.
      const rangeFailure=await createWriteChaptersTool(pipeline,'replay').execute('retry-range',{
        startChapterNumber:1,chapterCount:2,instruction:'Complete the first two chapters.',
      }).catch(error=>actionFailureFacts(error));
      expect(rangeFailure).toMatchObject({
        code:'CHAPTER_WRITE_RANGE_CONFLICT',
        recovery:{action:'workspace__inspect_work',parameters:{workId:'replay'},nextChapterNumber:2,
          requestedRange:{startChapterNumber:1,endChapterNumber:2}},
      });
      expect(calls).toBe(1);
      expect(await readFile(join(bookDir,'chapters/0001_Departure.md'))).toEqual(source);
      expect((await state.loadChapterIndex('replay')).map(c=>c.number)).toEqual([1]);
      const authorRequest='Review this existing chapter and preserve its prose.';
      await withExecutionEvidence(()=>{},()=>pipeline.reviewChapter('replay',1),undefined,undefined,authorRequest);
      const context=auditor.mock.calls.at(-1)![4].contextPackage.selectedContext;
      expect(context.map(entry=>entry.source)).toEqual(['author_request','story/book_rules.md']);
      expect(context[0]).toMatchObject({excerpt:authorRequest,protection:'protected'});
      const reviewHash='sha256:'+createHash('sha256').update(chapterOutput(1).content.trim()).digest('hex');
      expect((await state.loadChapterIndex('replay'))[0]!.observations[0]).toMatchObject({code:'DEPARTURE',targetHash:reviewHash});
      const reviser=vi.spyOn(ReviserAgent.prototype,'reviseChapter').mockRejectedValue(Object.assign(new Error('Fixture writer unavailable'),{code:'FIXTURE_WRITER_UNAVAILABLE'}));
      await expect(pipeline.reviseDraft('replay',1,'spot-fix','Clarify the departure.')).rejects.toMatchObject({code:'FIXTURE_WRITER_UNAVAILABLE'});
      const reviewedIndex=await state.loadChapterIndex('replay');
      await state.saveChapterIndex('replay',reviewedIndex.map(chapter=>({...chapter,observations:chapter.observations.map(observation=>({...observation,targetHash:'sha256:stale'}))})));
      await expect(pipeline.reviseDraft('replay',1,'spot-fix','Clarify the departure.')).rejects.toMatchObject({code:'FIXTURE_WRITER_UNAVAILABLE'});
      expect(reviser.mock.calls.map(call=>call[3].map(observation=>observation.code))).toEqual([['DEPARTURE'],[]]);
      expect(await readFile(planPath)).toEqual(plan);
      await pipeline.importChapters(input);
      expect((await loadWorkManifest(root,'replay')).artifacts.find(a=>a.id===notes.id)?.currentRevisionId).toBeNull();
      expect(await loadRuntimeStateSnapshot(bookDir)).toEqual(first);
      expect(await readFile(join(bookDir,'chapters/0001_Departure.md'))).toEqual(source);
      expect((await state.loadChapterIndex('replay')).map(c=>c.number)).toEqual([1]);
      expect(await readFile(planPath)).toEqual(plan);
      expect(composer.mock.calls.map(([request])=>request.chapterNumber)).toEqual([1,1,1,1,1]);
      expect(calls).toBe(4);
    }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  },20000);

  it.each([
    {language:'en' as const, wrappers:'# Chapter 1: Chapter 1\n\nCHAPTER I. Working title\n\n'},
    {language:'zh' as const, wrappers:'# 第1章 Chapter 1\n\n## 第一章 初稿标题\n\n'},
  ])("persists and round-trips a chapter with review observations and $language heading variants", async ({language,wrappers}) => {
    const root = await tempRoot();
    const bookDir = join(root, "works", "novel", "source");
    await mkdir(join(bookDir, "story"), { recursive: true });
    const state = new StateManager(root);
    const output = chapterOutput(1);
    const prose=output.content;
    const submitted={...output,content:wrappers+prose};
    const writer = new WriterAgent({ client: {} as never, model: "test", projectRoot: root });

    await persistChapterArtifacts({
      chapterNumber: 1,
      chapterTitle: output.title,
      auditResult: {
        summary: "One continuity observation.",
        observations: [{
          code: "canon-consistency",
          summary: "A supporting detail conflicts with the current canon.",
          evidence: ["The chapter and current canon disagree."],
        }],
      },
      finalWordCount: output.wordCount,
      loadChapterIndex: () => state.loadChapterIndex("novel"),
      saveChapter: (index) => writer.saveChapter(bookDir, submitted, language, index),
      markBookActiveIfNeeded: async () => undefined,
    });

    const [chapter] = await state.loadChapterIndex("novel");
    const persisted = JSON.parse(await readFile(join(bookDir, "chapters", "index.json"), "utf-8")) as Array<Record<string, unknown>>;
    expect({
      observation: chapter?.observations[0]?.code,
      provenance: chapter?.provenance,
      hasLegacyStatus: "status" in (persisted[0] ?? {}),
      chapterFiles: (await readdir(join(bookDir, "chapters"))).filter((file) => file.endsWith(".md")).length,
    }).toEqual({
      observation: "canon-consistency",
      provenance: "generated",
      hasLegacyStatus: false,
      chapterFiles: 1,
    });
    const chapterFile=(await readdir(join(bookDir,'chapters'))).find(file=>file.endsWith('.md'))!;
    expect(await loadChaptersFromPath(join(bookDir,'chapters',chapterFile))).toEqual([{title:output.title,content:prose}]);
    // Export also handles already persisted documents from older writers. It
    // normalizes the delivery copy while preserving the source bytes.
    const legacy=wrappers+prose;
    await writeFile(join(bookDir,'chapters',chapterFile),legacy);
    expect(await loadChaptersFromPath(join(bookDir,'chapters',chapterFile))).toEqual([{title:output.title,content:prose}]);
    const exported=await buildExportArtifact({bookDir:()=>bookDir,loadBookConfig:async()=>({title:'Novel',language}),loadChapterIndex:()=>state.loadChapterIndex('novel')},'novel',{format:'md'});
    const exportPath=join(root,'roundtrip.md');await writeFile(exportPath,exported.payload);
    expect(await loadChaptersFromPath(exportPath)).toEqual([{title:output.title,content:prose}]);
    expect(await readFile(join(bookDir,'chapters',chapterFile),'utf8')).toBe(legacy);
  });

  it("keeps the chapter persistable when state review is unavailable", async () => {
    const root = await tempRoot();
    const bookDir = join(root, "works", "novel", "source");
    await mkdir(join(bookDir, "story"), { recursive: true });
    await createInitialRuntimeState({ bookDir, language: "en" });
    const output = chapterOutput(2);

    const result = await validateChapterTruthPersistence({
      writer: { settleChapterState: async () => output },
      validator: { validate: async () => { throw new Error("validator unavailable"); } },
      book: {
        id: "novel",
        title: "Novel",
        genre: "general",
        platform: "other",
        status: "active",
        targetChapters: 10,
        chapterWordCount: 1000,
        language: "en",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      bookDir,
      chapterNumber: 2,
      title: output.title,
      content: output.content,
      persistenceOutput: output,
      previousTruth: { oldState: "state-v1", oldHooks: "hooks-v1" },
      reducedControlInput: {
        chapterIntent: "Review chapter 2 state.",
        contextPackage: { chapter: 2, selectedContext: [] },
      },
      language: "en",
      logWarn: () => undefined,
    });

    expect({
      content: result.persistenceOutput.content,
      code: result.validation.observations[0]?.code,
      needsReconciliation: result.validation.reconciliationRequired,
      stateApplied: result.persistenceOutput.runtimeStateApplied,
    }).toEqual({
      content: output.content,
      code: "state-validation-unavailable",
      needsReconciliation: true,
      stateApplied: false,
    });
  });

  it("keeps the chapter persistable when review observation is unavailable", async () => {
    const output = chapterOutput(3);
    const result = await reviewChapterDraft({
      book: { genre: "other" },
      bookDir: "/tmp/unused",
      chapterNumber: 3,
      output,
      controlInput: { contextPackage: { chapter: 3, selectedContext: [] } },
      lengthSpec: buildLengthSpec(9, "en"),
      initialUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      auditor: { auditChapter: async () => { throw new Error("review stream idle"); } },
      assertNotEmpty: () => undefined,
      addUsage: (left) => left,
    });
    expect({
      content: result.content,
      observation: result.review.observations[0]?.code,
      unavailable: result.review.unavailable,
    }).toEqual({
      content: output.content,
      observation: "review-unavailable",
      unavailable: true,
    });
  });

  it("keeps failed output as a candidate until an authorized action accepts it", async () => {
    const root = await tempRoot();
    const work = createWorkManifest({ id: "novel", title: "Novel", profileId: "longform-novel", language: "en" });
    await saveWorkManifest(root, work);
    const sourceDir = join(root, "works", "novel", "source");
    await mkdir(join(sourceDir, "chapters"), { recursive: true });
    await writeFile(join(sourceDir, "chapters", "0001_opening.md"), "# Chapter 1\n\nDraft one.\n");

    await syncWorkSourceArtifacts({ projectRoot: root, workId: "novel", episodeId: "episode-failed", accept: false });
    const candidate = await loadWorkManifest(root, "novel");
    const artifact = candidate.artifacts[0]!;
    expect({ current: artifact.currentRevisionId, statuses: artifact.revisions.map((revision) => revision.status) }).toEqual({
      current: null,
      statuses: ["candidate"],
    });

    await syncWorkSourceArtifacts({ projectRoot: root, workId: "novel", episodeId: "episode-success", accept: true });
    const accepted = await loadWorkManifest(root, "novel");
    const acceptedArtifact = accepted.artifacts.find((item) => item.id === artifact.id)!;
    expect({
      current: acceptedArtifact.currentRevisionId,
      status: acceptedArtifact.revisions.find((revision) => revision.id === acceptedArtifact.currentRevisionId)?.status,
    }).toEqual({ current: acceptedArtifact.revisions[0]?.id, status: "current" });
  });

  async function tempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "inkos-longform-harness-"));
    roots.push(root);
    return root;
  }
});

function chapterOutput(chapterNumber: number): WriteChapterOutput {
  const chapterSummary = {
    chapter: chapterNumber,
    title: `Chapter ${chapterNumber}`,
    characters: "witness",
    events: "The witness leaves.",
    stateChanges: "The witness is outside.",
    hookActivity: "",
    mood: "tense",
    chapterType: "investigation",
  };
  return {
    chapterNumber,
    title: `Chapter ${chapterNumber}`,
    content: "The witness closes the ledger and leaves the room.",
    wordCount: 9,
    postSettlement: "",
    runtimeStateDelta: {
      chapter: chapterNumber,
      factOps: {
        upsert: [{ subject: "witness", predicate: "location", object: "outside" }],
        expire: [],
      },
      hookOps: { upsert: [], mention: [], resolve: [], defer: [] },
      newHookCandidates: [],
      chapterSummary,
    },
    runtimeStateSnapshot: {
      manifest: {
        schemaVersion: 2,
        language: "en",
        lastAppliedChapter: chapterNumber,
        projectionVersion: 1,
      },
      currentState: {
        chapter: chapterNumber,
        facts: [{
          subject: "witness",
          predicate: "location",
          object: "outside",
          validFromChapter: chapterNumber,
          validUntilChapter: null,
          sourceChapter: chapterNumber,
        }],
      },
      hooks: { hooks: [] },
      chapterSummaries: { rows: [chapterSummary] },
    },
    updatedState: "# Current State\n\nThe witness has left.\n",
    updatedHooks: "# Pending Hooks\n",
    updatedChapterSummaries: `| ${chapterNumber} | witness leaves |`,
    runtimeStateApplied: true,
  };
}
