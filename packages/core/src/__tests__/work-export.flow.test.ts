import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect, vi } from "vitest";
import { createWorkManifest, saveWorkManifest, loadWorkManifest } from "../harness/work-store.js";
import { syncWorkSourceArtifacts } from "../harness/source-sync.js";
import { createExportWorkTool } from "../harness/tools/work-artifacts.js";
import {loadChapterSource} from '../agent/chapter-import-source.js';
import {createContinuationImportTool,createImportChaptersTool} from '../agent/agent-tools.js';
import {PipelineRunner} from '../pipeline/runner.js';
import {StateManager} from '../state/manager.js';
import {writeExportArtifact} from '../interaction/export-artifact.js';
import {createExportBookTool} from '../harness/tools/export-book.js';
import {createTurnCompletionTool,TurnArtifactDeliveries} from '../agent/turn-completion.js';
import {ActionResultSchema} from '../harness/contracts.js';

it('measures actual exported chapters and requires current source receipts and explicit length bounds before delivery',async()=>{
  const root=await mkdtemp(join(tmpdir(),'inkos-export-delivery-'));
  try{
    await saveWorkManifest(root,createWorkManifest({id:'gallery',title:'Gallery',profileId:'longform-novel',language:'en'}));
    const state=new StateManager(root),now=new Date().toISOString();
    const config={id:'gallery',title:'Gallery',genre:'general',platform:'other' as const,status:'active' as const,targetChapters:2,chapterWordCount:1000,language:'en' as const,createdAt:now,updatedAt:now};
    await state.saveBookConfig('gallery',{...config,minChapterLength:2,maxChapterLength:4});
    await state.saveChapterIndex('gallery',[1,2].map(number=>({number,title:'Scene '+number,wordCount:99,provenance:'imported' as const,observations:[],createdAt:now,updatedAt:now})));
    const first=join(state.bookDir('gallery'),'chapters/0001_Scene.md'),second=join(state.bookDir('gallery'),'chapters/0002_Scene.md');
    await writeFile(first,'# Chapter 1: Scene 1\n\nThe visitor arrives.\n');
    await writeFile(second,'# Chapter 2: Scene 2\n\nThe visitor leaves through the door.\n');
    const result=(data:unknown)=>ActionResultSchema.parse({status:'success',summary:'Operation completed.',artifacts:[],observations:[],data});
    const deliveries=new TurnArtifactDeliveries();
    const finish=createTurnCompletionTool({state:()=>({activeActions:0,hasDelivery:true,deliveryFailed:false}),validateDelivery:()=>deliveries.validate(root),complete:()=>{}});
    const completed=()=>finish.execute('finish',{status:'delivered',message:'Delivery complete.'});
    // A chapter-only action checks its own scope, not unrelated existing chapters.
    deliveries.observe(result({kind:'chapter_revision',workId:'gallery',chapterNumber:1,delivery:{status:'checks_passed'}}));
    await completed();
    deliveries.observe(result({kind:'chapters_written',workId:'gallery',chapters:[{chapterNumber:2}],delivery:{status:'needs_revision'}}));
    await expect(completed()).rejects.toMatchObject({code:'TURN_DELIVERY_CHECKS_FAILED'});
    const tool=createExportBookTool(state,'gallery');
    const exportCurrent=async()=>{
      await deliveries.requireOperations(root,'gallery','longform','export_book',{format:'md'});
      const exported=await tool.execute('export',{format:'md'});
      deliveries.observe(result(exported.details));
      return exported.details as Awaited<ReturnType<typeof writeExportArtifact>>;
    };
    const draft=await exportCurrent();
    expect(draft).toMatchObject({kind:'book_exported',workId:'gallery',totalWords:9,delivery:{status:'needs_revision',chapters:[{chapterNumber:1,measurements:{count:3}},{chapterNumber:2,measurements:{count:6},issues:[{code:'CHAPTER_LENGTH_OUT_OF_RANGE',actual:6,minimum:2,maximum:4}]}]}});
    expect((await readFile(draft.outputPath)).length).toBeGreaterThan(0);
    await expect(completed()).rejects.toMatchObject({code:'TURN_DELIVERY_CHECKS_FAILED'});
    await writeFile(second,'# Chapter 2: Scene 2\n\nThe visitor leaves.\n');
    await expect(completed()).rejects.toMatchObject({code:'TURN_DELIVERY_STALE'});
    expect(await exportCurrent()).toMatchObject({totalWords:6,delivery:{status:'checks_passed'}});
    await completed();
    await writeFile(first,'# Chapter 1: Scene 1\n\nA stranger arrives.\n');
    await expect(completed()).rejects.toMatchObject({code:'TURN_DELIVERY_STALE'});
    await exportCurrent();
    await completed();
    await state.saveBookConfig('gallery',config);
    const approximate=await exportCurrent();
    expect(approximate.delivery).toEqual({status:'unverified',chapters:[]});
    await completed();
    await rm(second);
    await expect(exportCurrent()).rejects.toMatchObject({code:'CHAPTER_EXPORT_SOURCE_MISMATCH'});
    await expect(completed()).rejects.toMatchObject({code:'TURN_REQUIRED_OPERATIONS_INCOMPLETE'});
    expect((await state.loadChapterIndex('gallery')).map(chapter=>chapter.wordCount)).toEqual([99,99]);
  }finally{await rm(root,{recursive:true,force:true});}
});

it('refuses an incomplete or ambiguous chapter export before replacing an existing delivery',async()=>{
  const root=await mkdtemp(join(tmpdir(),'inkos-export-sources-'));
  try{
    await saveWorkManifest(root,createWorkManifest({id:'gallery',title:'Gallery',profileId:'longform-novel',language:'en'}));
    const state=new StateManager(root),bookDir=state.bookDir('gallery'),now=new Date().toISOString();
    await state.saveBookConfig('gallery',{id:'gallery',title:'Gallery',genre:'general',platform:'other',status:'active',targetChapters:2,chapterWordCount:1000,language:'en',createdAt:now,updatedAt:now});
    const chapter=(number:number)=>({number,title:'Scene '+number,wordCount:3,provenance:'imported' as const,observations:[],createdAt:now,updatedAt:now});
    await state.saveChapterIndex('gallery',[chapter(1)]);
    await writeFile(join(bookDir,'chapters/0001_Arrival.md'),'# Arrival\n\nA visitor arrives.\n');
    const delivered=await writeExportArtifact(state,'gallery',{format:'md'});
    const prior=await readFile(delivered.outputPath);
    expect(delivered.chaptersExported).toBe(1);
    await state.saveChapterIndex('gallery',[chapter(1),chapter(2)]);
    await writeFile(join(bookDir,'chapters/0000_Prologue.md'),'# Prologue\n\nThe door opens.\n');
    await writeFile(join(bookDir,'chapters/0001_Duplicate.md'),'# Another arrival\n');
    const before=await readFile(join(bookDir,'chapters/index.json'));
    await expect(writeExportArtifact(state,'gallery',{format:'md'})).rejects.toMatchObject({code:'CHAPTER_EXPORT_SOURCE_MISMATCH',details:{missingChapterNumbers:[2],duplicateChapterNumbers:[1],duplicateIndexNumbers:[],unindexedFiles:['0000_Prologue.md']}});
    expect(await readFile(delivered.outputPath)).toEqual(prior);
    expect(await readFile(join(bookDir,'chapters/index.json'))).toEqual(before);
    await rm(join(bookDir,'chapters/0000_Prologue.md'));
    await rm(join(bookDir,'chapters/0001_Duplicate.md'));
    await writeFile(join(bookDir,'chapters/0002_Departure.md'),'# Departure\n\nThe visitor leaves.\n');
    const complete=await writeExportArtifact(state,'gallery',{format:'md'});
    expect(complete).toMatchObject({chaptersExported:2,totalWords:6});
    expect(await readFile(complete.outputPath)).not.toEqual(prior);
  }finally{await rm(root,{recursive:true,force:true});}
});

it("exports the accepted Markdown revision and preserves unrelated candidates", async () => {
  const root = await mkdtemp(join(tmpdir(), "inkos-export-"));
  try {
    await saveWorkManifest(root, createWorkManifest({ id: "script", title: "Script", profileId: "script", language: "en" }));
    const base = join(root, "works/script/source");
    await mkdir(base, { recursive: true });
    const original = Buffer.from("# Script\n\nA complete scene.\n");
    await writeFile(join(base, "script.md"), original);
    const before = await syncWorkSourceArtifacts({ projectRoot: root, workId: "script", accept: true });
    await writeFile(join(base, "notes.md"), "Unaccepted notes");
    await syncWorkSourceArtifacts({ projectRoot: root, workId: "script", accept: false });
    const artifact = before.artifacts[0]!;
    const result = await createExportWorkTool(root, "script").execute("export", { artifactId: artifact.id });
    const details = result.details as { path: string; sourceRevisionId: string };
    expect(details.sourceRevisionId).toBe(artifact.currentRevisionId);
    expect(await readFile(join(root, "works/script", details.path))).toEqual(original);
    const sourcePath=join(root,'works/script',details.path);
    const imported=await loadChapterSource(root,sourcePath);
    expect(imported.chapters).toEqual([{title:'Script',content:'A complete scene.'}]);
    expect(imported.lineage).toMatchObject([{sourceWorkId:'script',sourceArtifactId:expect.any(String),sourceRevisionId:expect.any(String)}]);
    const after = await loadWorkManifest(root, "script");
    expect(after.artifacts.find(item => item.revisions.some(revision => revision.path === "source/notes.md"))?.currentRevisionId).toBeNull();
    expect(after.artifacts.find(item => item.id === artifact.id)).toEqual(artifact);
    await syncWorkSourceArtifacts({ projectRoot: root, workId: 'script', accept: true, acceptPaths: ['source/script.md'],
      writes: [{relativePath: 'works/script/source/script.md', content: '# Script\n\nA later scene.\n'}] });
    await expect(createExportWorkTool(root, 'script').execute('stale-review', {artifactId: artifact.id, expectedRevisionId: artifact.currentRevisionId!})).rejects.toMatchObject({code:'ARTIFACT_REVISION_CONFLICT'});
    expect(await readFile(join(root, 'works/script', details.path))).toEqual(original);
    await createExportWorkTool(root,'script').execute('new-export',{artifactId:artifact.id});
    expect((await loadChapterSource(root,sourcePath)).chapters).toEqual([{title:'Script',content:'A later scene.'}]);
    const resumed=await loadChapterSource(root,sourcePath,undefined,imported.lineage);
    expect(resumed).toEqual(imported);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('resumes a failed continuation import from persisted progress and the pinned source revision',async()=>{
  const root=await mkdtemp(join(tmpdir(),'inkos-import-recovery-'));
  try{
    await saveWorkManifest(root,createWorkManifest({id:'source',title:'Source',profileId:'script',language:'en'}));
    await mkdir(join(root,'works/source/source'),{recursive:true});
    const sourcePath='works/source/source/full.md';
    await syncWorkSourceArtifacts({projectRoot:root,workId:'source',accept:true,writes:[{relativePath:sourcePath,content:'# Chapter 1: Arrival\n\nMira arrived.\n\n# Chapter 2: Departure\n\nMira left.\n'}]});
    const pipeline=new PipelineRunner({projectRoot:root,model:'fixture',client:{} as never});
    const state=new StateManager(root);
    const imported=vi.spyOn(pipeline,'importChapters').mockImplementation(async input=>{
      const number=input.resumeFrom??1;
      const chapter=input.chapters[number-1]!;
      const index=await state.loadChapterIndex(input.bookId);
      await mkdir(join(state.bookDir(input.bookId),'chapters'),{recursive:true});
      await writeFile(join(state.bookDir(input.bookId),'chapters',String(number).padStart(4,'0')+'_'+chapter.title+'.md'),`# Chapter ${number}: ${chapter.title}\n\n${chapter.content}\n`);
      const now=new Date().toISOString();
      await state.saveChapterIndex(input.bookId,[...index,{number,title:chapter.title,wordCount:2,provenance:'imported',observations:[],createdAt:now,updatedAt:now}]);
      if(number===1)throw Object.assign(new Error('Invalid selection'),{code:'WORKER_RESULT_INVALID',resultTool:'submit_selected_sources'});
      return{bookId:input.bookId,importedCount:1,totalWords:2,nextChapter:3};
    });
    const tool=createContinuationImportTool(pipeline,null,root);
    const failure=await tool.execute('initial',{sourcePath,title:'Continuation',language:'en'}).catch(error=>error);
    if(failure.code!=='WORKER_RESULT_INVALID')throw failure.cause??failure;
    expect(failure).toMatchObject({code:'WORKER_RESULT_INVALID',resultTool:'submit_selected_sources',recovery:{action:'adaptation__continuation_import',completedChapterCount:1,sourceChapterCount:2,parameters:{resumeFrom:2}}});
    const workId=failure.recovery.workId;
    const before=await loadWorkManifest(root,workId);
    await syncWorkSourceArtifacts({projectRoot:root,workId:'source',accept:true,writes:[{relativePath:sourcePath,content:'# Chapter 1: Changed\n\nA new manuscript.\n'}]});
    const pinned=before.lineage[0]!;
    await createImportChaptersTool(pipeline,workId,root).execute('resume',{resumeFrom:2,source:{workId:pinned.sourceWorkId,artifactId:pinned.sourceArtifactId!}});
    expect(imported.mock.calls[1]![0]).toMatchObject({resumeFrom:2,chapters:[{title:'Arrival',content:'Mira arrived.'},{title:'Departure',content:'Mira left.'}]});
    expect((await state.loadChapterIndex(workId)).map(c=>c.number)).toEqual([1,2]);
    expect((await loadWorkManifest(root,workId)).lineage).toEqual(before.lineage);
    expect(await readFile(join(state.bookDir(workId),'chapters/0001_Arrival.md'),'utf8')).toBe('# Chapter 1: Arrival\n\nMira arrived.\n');
  }finally{await rm(root,{recursive:true,force:true});}
});
