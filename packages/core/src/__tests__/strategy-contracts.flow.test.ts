import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { commitAtomicFileSet } from "../utils/atomic-file-set.js";
import { createInitialWorkManifestWrite } from "../harness/source-sync.js";
import { loadWorkManifest } from "../harness/work-store.js";
import { createReplaceWorkArtifactTool } from "../harness/tools/work-artifacts.js";
import { executeExplicitCapabilityTool } from "../harness/explicit-action.js";
import { hydrateActivatedSkillGuidance } from "../agent/skill-tool.js";
import { runShortFictionProduction } from "../pipeline/short-fiction-runner.js";
import { shortInputHash, writeShortProductionState } from "../pipeline/short-production-state.js";
import { ShortFictionBatchDraftSchema } from "../agents/short-fiction.js";
import { Type } from "@sinclair/typebox";
import { CreativeEpisodeStore } from "../harness/episode-store.js";
import { DatabaseSync } from "node:sqlite";
import { syncWorkSourceArtifacts, captureWorkSourceState, changedWorkSourcePaths } from "../harness/source-sync.js";
import { createBuiltInWorkProfileRegistry } from "../harness/builtin-profiles.js";
import { createProductionCapabilityRegistry } from "../harness/production-capabilities.js";
import { createProfileWorkTools } from "../harness/tools/work-creation.js";
import { createShortProductionStageTools } from "../harness/tools/short-production.js";
import { PipelineRunner } from "../pipeline/runner.js";
import { prepareWorkerMessages } from "../agents/base.js";
import { createLLMClient } from "../llm/provider.js";
import { withExecutionEvidence } from "../harness/execution-evidence.js";
import { buildShortFictionChapterBatches, validateShortReviewSources } from "../agents/short-fiction.js";
import{createReadTool,createLsTool,createInspectWorkTool}from'../agent/agent-tools.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const draft = { storyTitle: "Fixture", rawContent: "", chapters: [1, 2].map(number => ({ number, title: `Part ${number}`, content: "one two three", charCount: 3 })) };

it('binds the inspected manuscript collection in reading order and pins its revisions independently of the brief',async()=>{
  const root=await mkdtemp(join(tmpdir(),'inkos-manuscript-sources-'));roots.push(root);
  const content=['Mara opens the gallery.','Mara returns the borrowed key.'];
  const writes=[{relativePath:'works/parent/source/brief.md',content:'A proposed story about a gallery.'},
    {relativePath:'works/parent/source/chapters/0002.md',content:content[1]!},
    {relativePath:'works/parent/source/chapters/0001.md',content:content[0]!}];
  const initial=createInitialWorkManifestWrite({workId:'parent',profileId:'longform-novel',title:'Gallery',language:'en',writes});
  await commitAtomicFileSet({rootDir:root,writes:[initial.write,...writes]});
  const inspected=await createInspectWorkTool(root).execute('inspect',{workId:'parent'},undefined as never,undefined);
  const sources=(inspected.details as {sourceSets:Array<{id:string;sources:Array<{workId:string;artifactId:string;revisionId:string}>}>}).sourceSets.find(set=>set.id==='novel-manuscript')!.sources;
  expect(sources.map(ref=>initial.manifest.artifacts.find(a=>a.id===ref.artifactId)!.revisions.find(r=>r.id===ref.revisionId)!.path)).toEqual(['source/chapters/0001.md','source/chapters/0002.md']);
  await syncWorkSourceArtifacts({projectRoot:root,workId:'parent',accept:true,writes:[{relativePath:writes[1]!.relativePath,content:'A later chapter revision.'}]});
  const pipeline=new PipelineRunner({client:{} as never,model:'unused',projectRoot:root});
  const registry=createProductionCapabilityRegistry({pipeline,projectRoot:root,sessionId:'sources',profileId:'workspace-default',work:null,language:'en',playWorldExists:false,sameSessionProposal:false,allowSystemFileRead:false});
  const create=createProfileWorkTools(root,registry).find(tool=>tool.name==='create_work')!;
  await executeExplicitCapabilityTool({projectRoot:root,tool:create,binding:{capabilityId:'workspace',actionId:create.name,profileId:'workspace-default',risk:'recoverable-write'},parameters:{workId:'cover',profileId:'visual-asset',title:'Gallery cover',intent:'Use the selected manuscript.',language:'en',sources}});
  expect(await readFile(join(root,'works/cover/source/source-material.md'),'utf8')).toBe(content.join('\n\n'));
  expect((await loadWorkManifest(root,'cover')).lineage).toEqual(sources.map(ref=>({relation:'derived-from',sourceWorkId:ref.workId,sourceArtifactId:ref.artifactId,sourceRevisionId:ref.revisionId})));
});

it('assigns the same artifact roles at creation and later registration using storage namespaces',async()=>{
  const root=await mkdtemp(join(tmpdir(),'inkos-artifact-roles-'));roots.push(root);
  const paths=[
    ['source/book.json','file'],['source/chapters/0001.md','chapter'],
    ['source/source/0001.json','source-chapter'],['source/translated/0001.json','translation-chapter'],
    ['source/notes/source-ideas.md','file'],['source/notes/translated-sample.md','file'],
    ['source/script.md','script'],['source/notes/prescript.md','file'],
    ['source/constructor','file'],
    ['source/notes/plain.md','file'],
  ];
  const writes=paths.map(([path])=>({relativePath:`works/roles/${path}`,content:path!.endsWith('.json')?'{}':'A complete recorded scene.'}));
  const initial=createInitialWorkManifestWrite({workId:'roles',title:'Artifact roles',profileId:'workspace-default',language:'en',writes});
  const empty=createInitialWorkManifestWrite({workId:'roles',title:'Artifact roles',profileId:'workspace-default',language:'en',writes:[]});
  await commitAtomicFileSet({rootDir:root,writes:[empty.write]});
  await mkdir(join(root,'works/roles/source'),{recursive:true});
  const synced=await syncWorkSourceArtifacts({projectRoot:root,workId:'roles',accept:true,writes});
  for(const [path,kind] of paths){
    const role=(work:typeof synced)=>work.artifacts.find(artifact=>artifact.revisions.some(revision=>revision.path===path))?.kind;
    expect(role(initial.manifest)).toBe(kind);
    expect(role(synced)).toBe(kind);
  }
  const legacy={...initial.manifest,artifacts:initial.manifest.artifacts.map(artifact=>{
    const path=artifact.revisions[0]!.path;
    const custom=path==='source/notes/translated-sample.md';
    const explicitlyOwned=path==='source/notes/prescript.md';
    return {...artifact,...(custom?{id:'custom-reference'}:{}),kind:custom?'reference':path==='source/notes/plain.md'||explicitlyOwned?'script':
      ['source/book.json','source/chapters/0001.md','source/notes/source-ideas.md'].includes(path)?'source-chapter':artifact.kind,
      metadata:{sourcePath:artifact.metadata.sourcePath,...(explicitlyOwned?{kindSource:'external-editor-v1'}:{})}};
  })};
  await writeFile(join(root,'works/roles/work.json'),JSON.stringify(legacy));
  const repaired=await syncWorkSourceArtifacts({projectRoot:root,workId:'roles',accept:false});
  for(const before of legacy.artifacts){
    const after=repaired.artifacts.find(artifact=>artifact.id===before.id)!;
    const path=before.revisions[0]!.path;
    expect(after.kind).toBe(before.id==='custom-reference'?'reference':['source/notes/plain.md','source/notes/prescript.md'].includes(path)?'script':paths.find(([value])=>value===path)![1]);
    if(before.metadata.kindSource)expect(after.metadata.kindSource).toBe(before.metadata.kindSource);
    expect(after.currentRevisionId).toBe(before.currentRevisionId);
    expect(after.revisions.map(revision=>revision.checksum)).toEqual(before.revisions.map(revision=>revision.checksum));
  }
  for(const write of writes)expect(await readFile(join(root,write.relativePath),'utf8')).toBe(write.content);
});

it('exposes source directory discovery outside longform and recovers a directory read',async()=>{
  const {root}=await fixture();
  const registry=createProductionCapabilityRegistry({pipeline:new PipelineRunner({client:{} as never,model:'unused',projectRoot:root}),projectRoot:root,sessionId:'directory',profileId:'interactive-film',work:null,language:'en',playWorldExists:false,sameSessionProposal:false,allowSystemFileRead:false});
  expect(registry.resolve('workspace','ls').action.risk).toBe('read');
  await expect(createReadTool(root,{scope:'project'}).execute('read',{path:'works/fixture/source'},undefined as never,undefined)).rejects.toMatchObject({code:'WORK_PATH_IS_DIRECTORY'});
  const listed=await createLsTool(root).execute('ls',{bookId:'fixture'},undefined as never,undefined);
  const prefixed=await createLsTool(root).execute('ls',{bookId:'fixture',subdir:'source'},undefined as never,undefined);
  expect(prefixed).toEqual(listed);
  expect(listed.content.length).toBeGreaterThan(0);
});

it("retains committed output but never completes a cancelled action", async () => {
  const { root } = await fixture();
  const cancellation = new AbortController();
  await expect(executeExplicitCapabilityTool({projectRoot:root,workId:"fixture",episodeId:"cancelled-action",
    binding:{capabilityId:"workspace",actionId:"checkpoint",profileId:"short-fiction",risk:"recoverable-write"},
    parameters:{},signal:cancellation.signal,
    tool:{name:"checkpoint",label:"checkpoint",description:"fixture",parameters:Type.Object({}),execute:async()=>{
      await writeFile(join(root,"checkpoint.txt"),"retained"); cancellation.abort();
      return {content:[{type:"text",text:"checkpoint saved"}],details:{workId:"fixture"}};
    }},
  })).rejects.toMatchObject({name:"AbortError"});
  expect(await readFile(join(root,"checkpoint.txt"),"utf8")).toBe("retained");
  const store = new CreativeEpisodeStore(join(root,".inkos/harness.sqlite"));
  try { expect(store.listEpisodes()[0]?.status).toBe("cancelled"); }
  finally { store.close(); }
});

it("snapshots committed SQLite state while its WAL connection remains open", async () => {
  const { root, base } = await fixture();
  const db = new DatabaseSync(join(root,base,"play.db"));
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE state(value TEXT); INSERT INTO state VALUES ('committed');");
  try {
    const work = await syncWorkSourceArtifacts({projectRoot:root,workId:"fixture",accept:true});
    const current = work.artifacts.flatMap(a=>a.revisions.filter(r=>r.id===a.currentRevisionId));
    expect(current.some(r=>r.path.endsWith("-wal")||r.path.endsWith("-shm"))).toBe(false);
    const revision = current.find(r=>r.path==='source/play.db')!;
    const snapshot = new DatabaseSync(join(root,'works/fixture',revision.snapshotPath!),{readOnly:true});
    try { expect(snapshot.prepare("SELECT value FROM state").get()?.value).toBe("committed"); }
    finally { snapshot.close(); }
    const unchanged = await syncWorkSourceArtifacts({projectRoot:root,workId:"fixture",accept:true});
    expect(unchanged.artifacts.find(a=>a.revisions.some(r=>r.path==='source/play.db'))?.currentRevisionId).toBe(revision.id);
    const baseline=await captureWorkSourceState(root,"fixture");
    expect(await changedWorkSourcePaths(root,"fixture",baseline)).toEqual([]);
    db.exec("INSERT INTO state VALUES ('later');");
    const changed=await changedWorkSourcePaths(root,"fixture",baseline);
    expect(changed).toEqual(["source/play.db"]);
    const committed=await syncWorkSourceArtifacts({projectRoot:root,workId:"fixture",accept:true,acceptPaths:changed});
    const next=committed.artifacts.find(a=>a.revisions.some(r=>r.path==='source/play.db'))!;
    expect(next.currentRevisionId).not.toBe(revision.id);
  } finally { db.close(); }
});

it("composes a new Profile, creates its Work and resumes an independent outline stage", async () => {
  const { root } = await fixture();
  const builtIn = createBuiltInWorkProfileRegistry().require("short-fiction");
  const custom = {...builtIn,id:"mini-fiction",title:"Mini fiction",artifactSchemas:{...builtIn.artifactSchemas,'source/metadata.json':'translation-glossary' as const}};
  await mkdir(join(root,'.inkos/profiles'),{recursive:true});
  await writeFile(join(root,'.inkos/profiles/mini-fiction.json'),JSON.stringify(custom));
  const pipeline = new PipelineRunner({client:{} as never,model:"unused",projectRoot:root});
  const environment = {pipeline,projectRoot:root,sessionId:"composed",profileId:custom.id,work:null,language:"en",playWorldExists:false,sameSessionProposal:false,allowSystemFileRead:false};
  const registry = createProductionCapabilityRegistry(environment);
  const create = createProfileWorkTools(root,registry).find(tool=>tool.name==='create_work')!;
  await executeExplicitCapabilityTool({projectRoot:root,tool:create,binding:{capabilityId:'workspace',actionId:create.name,profileId:'workspace-default',risk:'recoverable-write'},
    parameters:{workId:'composed',profileId:custom.id,title:'Author title',intent:'Fixture direction',language:'en'}});
  await mkdir(join(root,'works/composed/source/outline'),{recursive:true});
  await writeFile(join(root,'works/composed/source/outline/v001.md'),'Existing outline fixture');
  const stage = createShortProductionStageTools(pipeline,root,'composed')[0]!;
  const result = await executeExplicitCapabilityTool({projectRoot:root,workId:'composed',tool:stage,binding:{capabilityId:'short-fiction',actionId:stage.name,profileId:custom.id,risk:'recoverable-write'},
    parameters:{workId:'composed',direction:'Fixture direction',chapters:2,charsPerChapter:10}});
  expect(result.status).toBe('success');
  const work = await loadWorkManifest(root,'composed');
  expect({profile:work.profileId,title:work.title,language:work.language}).toEqual({profile:custom.id,title:'Author title',language:'en'});
  expect(JSON.parse(await readFile(join(root,'works/composed/source/production-state.json'),'utf8')).target.language).toBe('en');
  const bound = createProductionCapabilityRegistry({...environment,work});
  const replaced = await bound.invoke('workspace','replace_work_artifact',{projectRoot:root,episodeId:'composed-edit',work,profile:custom},
    {path:'source/brief.md',content:'Updated fixture direction'});
  expect(replaced.artifacts.some(ref=>ref.workId==='composed')).toBe(true);
  await syncWorkSourceArtifacts({projectRoot:root,workId:'composed',accept:true,writes:[{relativePath:'works/composed/source/metadata.json',content:JSON.stringify({terms:[]})}]});
  await expect(bound.invoke('workspace','replace_work_artifact',{projectRoot:root,episodeId:'schema-check',work,profile:custom},
    {path:'source/metadata.json',content:JSON.stringify({terms:[{source:2}]})})).rejects.toMatchObject({code:'ARTIFACT_INVALID'});
});

it("feeds the selected Profile context sources into the actual worker messages", async () => {
  const {root}=await fixture(),work=await loadWorkManifest(root,'fixture');
  const client=createLLMClient({service:'custom',configSource:'studio',provider:'openai',model:'test-model',baseUrl:'https://example.invalid/v1',apiKey:'fixture',apiFormat:'chat',stream:true,temperature:0,thinkingBudget:0});
  const messages=[{role:'user' as const,content:'Review the supplied document.'}];
  const profile={...createBuiltInWorkProfileRegistry().require('short-fiction'),requiredSkillIds:[]};
  const traces:Array<Record<string,unknown>>=[];
  const prepare=(sourceIds:string[])=>withExecutionEvidence((type,payload)=>{if(type==='context-compiled')traces.push(payload);},
    ()=>prepareWorkerMessages({client,projectRoot:root},messages,128),{...profile,contextRecipe:{id:'fixture-recipe',sourceIds}},work);
  const selected=await prepare(['task','work']);
  expect(JSON.parse(selected.find(message=>message.role==='system')!.content).workId).toBe(work.id);
  expect(await prepare(['task'])).toEqual(messages);
  expect(traces[0]).toMatchObject({trace:{protectedSourceIds:['message-0','current-work']}});
  expect(traces[1]).toMatchObject({trace:{protectedSourceIds:['message-0']}});
  const methods:Array<Record<string,unknown>>=[];
  const derived={...work,profileId:'longform-novel',metadata:{...work.metadata,creationKind:'continuation'}};
  await withExecutionEvidence((type,payload)=>{if(type==='skills-applied')methods.push(payload);},
    ()=>prepareWorkerMessages({client,projectRoot:root},messages,128),createBuiltInWorkProfileRegistry().require('workspace-default'),derived);
  expect((methods[0]?.skills as Array<{id:string}>).map(skill=>skill.id)).toEqual(expect.arrayContaining(['inkos-long-writing','inkos-continuation-writing']));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "inkos-strategy-")); roots.push(root);
  const base = "works/fixture/source";
  const documents: Record<string, string> = {
    "outline/v001.md": "Fixture outline", "drafts/v001/draft.json": JSON.stringify(draft),
    "final/short-story.json": JSON.stringify(draft), "final/full.md": "Fixture projection",
    "final/sales-package.json": JSON.stringify({ title: draft.storyTitle, intro: "Fixture", sellingPoints: ["Fixture"], coverPrompt: "Fixture", rawContent: "" }),
    "final/sales-package.md": "Fixture package", "final/cover-prompt.md": "Fixture cover",
  };
  const writes = Object.entries(documents).map(([path, content]) => ({ relativePath: `${base}/${path}`, content }));
  const initial = createInitialWorkManifestWrite({ workId: "fixture", title: draft.storyTitle, profileId: "short-fiction", language: "en", writes });
  await commitAtomicFileSet({ rootDir: root, writes: [...writes, initial.write] });
  return { root, base };
}

it("retains failed stage evidence across cache reads and reports unavailable history for older manuscripts", async () => {
  const { root, base } = await fixture();
  const options = { projectRoot: root, storyId: "fixture", direction: "Original intent", language: "en" as const, chapterCount: 2, charsPerChapter: 3, cover: false, runtimes: {} as never };
  expect((await runShortFictionProduction(options)).observations[0]).toMatchObject({ code: "production-history-unavailable", assessment: "unavailable" });
  const hash = shortInputHash({ draft, outline: "Fixture outline", intent: options.direction });
  const observation = { code: "draft-review", category: "execution" as const, assessment: "unavailable" as const, summary: "Service failure", evidence: [], targetHash: hash };
  await writeShortProductionState(root, base, { version: 2, intent: options.direction, stages: {
    review: { status: "failed", inputHash: hash, updatedAt: new Date().toISOString(), error: "HTTP_504", observations: [observation] },
    package: { status: "completed", inputHash: hash, updatedAt: new Date().toISOString(), observations: [] },
  } });
  const result = await runShortFictionProduction(options);
  expect(result.observations).toEqual([observation]);
  expect((await runShortFictionProduction(options)).observations).toEqual(result.observations);
});

it("rejects invalid authority edits and atomically records valid manuscript projections and revisions", async () => {
  const { root } = await fixture();
  const before = await loadWorkManifest(root, "fixture");
  const path = "source/final/short-story.json";
  const artifact = before.artifacts.find(item => item.revisions.some(revision => revision.path === path))!;
  const execute = (content: string) => executeExplicitCapabilityTool({ projectRoot: root, workId: "fixture",
    tool: createReplaceWorkArtifactTool(root, "fixture"), parameters: { path: `works/fixture/${path}`, content, expectedRevisionId: artifact.currentRevisionId },
    binding: { capabilityId: "workspace", actionId: "replace_work_artifact", profileId: "short-fiction", risk: "recoverable-write" },
  });
  await expect(execute("invalid JSON")).rejects.toMatchObject({ code: "ARTIFACT_INVALID" });
  expect((await loadWorkManifest(root, "fixture")).artifacts).toEqual(before.artifacts);
  await expect(createReplaceWorkArtifactTool(root,"fixture").execute("draft-copy",{path:"source/drafts/v001/draft.json",content:JSON.stringify({...draft,storyTitle:"Changed copy"})})).rejects.toMatchObject({code:"ARTIFACT_DERIVED",authorityPath:"source/final/short-story.json",recovery:{action:"short-fiction__revise_short_fiction"}});
  expect((await loadWorkManifest(root,"fixture")).artifacts).toEqual(before.artifacts);
  const updated = { ...draft, chapters: draft.chapters.map(chapter => ({ ...chapter, content: "four five six seven" })) };
  expect((await execute(JSON.stringify(updated))).status).toBe("success");
  const current = ShortFictionBatchDraftSchema.parse(JSON.parse(await readFile(join(root, "works/fixture", path), "utf8")));
  expect(current.chapters.map(chapter => chapter.charCount)).toEqual([4, 4]);
  expect(await readFile(join(root, "works/fixture/source/final/full.md"), "utf8")).toBe(current.rawContent);
  const after = await loadWorkManifest(root, "fixture");
  for (const item of after.artifacts) {
    const revision = item.revisions.find(revision => revision.id === item.currentRevisionId);
    if (!revision) continue;
    const bytes = await readFile(join(root, "works/fixture", revision.path));
    expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(revision.checksum);
  }
  await expect(execute(JSON.stringify(draft))).rejects.toThrow();
  const packagePath = 'source/final/sales-package.json';
  const packageArtifact = after.artifacts.find(a=>a.revisions.some(r=>r.id===a.currentRevisionId&&r.path===packagePath))!;
  const replacePackage = (content:string) => executeExplicitCapabilityTool({projectRoot:root,workId:'fixture',
    binding:{capabilityId:'workspace',actionId:'replace_work_artifact',profileId:'short-fiction',risk:'recoverable-write'},
    tool:createReplaceWorkArtifactTool(root,'fixture'),parameters:{artifactId:packageArtifact.id,expectedRevisionId:packageArtifact.currentRevisionId,content}});
  await expect(replacePackage('{}')).rejects.toMatchObject({code:'ARTIFACT_INVALID'});
  await replacePackage(JSON.stringify({title:draft.storyTitle,intro:'Revised fixture',sellingPoints:['Fixture point'],coverPrompt:'Fixture visual'}));
  const packaged = JSON.parse(await readFile(join(root,'works/fixture',packagePath),'utf8'));
  expect(await readFile(join(root,'works/fixture/source/final/sales-package.md'),'utf8')).toBe(packaged.rawContent);
  expect(await readFile(join(root,'works/fixture/source/final/cover-prompt.md'),'utf8')).toBe(packaged.coverPrompt);
});

it("loads linked Skill references for Chinese tasks and respects explicit output batching", async () => {
  const root = await mkdtemp(join(tmpdir(), "inkos-skill-contract-")); roots.push(root);
  await mkdir(join(root, "references"));
  const reference = "# Evidence\n\nTrack ownership through visible actions.";
  await writeFile(join(root, "references/method.md"), reference);
  const activations = await hydrateActivatedSkillGuidance([{ skill: {
    id: "fixture", name: "fixture", description: "fixture", source: "project", baseDir: root,
    body: "Load `references/method.md` before writing.",
  }, resources: [] }], "写一个完整中文短篇故事");
  expect(activations?.[0]?.resources.map(resource => resource.path)).toContain("references/method.md");
  expect(activations?.[0]?.resources.find(resource => resource.path === "references/method.md")?.body).toBe(reference);
  const updatedReference = reference + "\nAdditional method evidence.";
  await writeFile(join(root, "references/method.md"), updatedReference);
  const updated = await hydrateActivatedSkillGuidance(activations, "继续修改");
  expect(updated?.[0]?.resources.filter(resource => resource.path === "references/method.md")).toEqual([
    { path: "references/method.md", body: updatedReference, charStart: 0, charEnd: updatedReference.length },
  ]);
  expect(buildShortFictionChapterBatches([1, 2, 3], 1000, 16384)).toEqual([[1, 2, 3]]);
  expect(buildShortFictionChapterBatches([1, 2, 3], 1000, 16384, 1)).toEqual([[1], [2], [3]]);
});

it("validates review citations against the named manuscript source", () => {
  const sources = new Map([["outline", "Source A"], ["manuscript-chapter-1", "Source B"]]);
  const observation = { code: "source-check", summary: "Fixture claim", evidence: [], sourceRefs: [{ sourceId: "manuscript-chapter-1", quote: sources.get("outline")! }] };
  expect(() => validateShortReviewSources([observation], sources)).toThrow(expect.objectContaining({
    code: "REVIEW_SOURCE_MISMATCH",
    issues: [expect.objectContaining({path:"/observations/0/sourceRefs/0",observationCode:"source-check",sourceId:"manuscript-chapter-1"})],
  }));
  validateShortReviewSources([{ ...observation, sourceRefs: [{ sourceId: "manuscript-chapter-1", quote: sources.get("manuscript-chapter-1")! }] }], sources);
});

it("persists pasted translation input, chapter boundaries and author glossary", async () => {
  const root = await mkdtemp(join(tmpdir(), "inkos-inline-translation-")); roots.push(root);
  const { createTranslationProjectFromFile } = await import("../translation/project.js");
  const sourceText = "# First\nFirst source paragraph.\n\n# Second\nSecond source paragraph.";
  const glossary = [{ source: "Nora", target: "诺拉" }];
  const result = await createTranslationProjectFromFile(root, { sourceText, sourceLanguage: "en", targetLanguage: "zh", glossary });
  expect(result.manifest.chapters).toHaveLength(2);
  expect(await readFile(join(root, result.manifest.source.path), "utf8")).toBe(sourceText);
  expect(JSON.parse(await readFile(join(root, result.projectDir, "glossary.json"), "utf8")).terms).toEqual(glossary);
  expect((await loadWorkManifest(root, result.manifest.id)).metadata.sourceOrigin).toBe("inline");
  const manifestPath=join(root,result.projectDir,'manifest.json'),original=await readFile(manifestPath,'utf8');
  const invalid={...result.manifest,chapters:result.manifest.chapters.map((chapter,index)=>index===0?{...chapter,translatedPath:'works/another/source/translated/1.json'}:chapter)};
  await expect(createReplaceWorkArtifactTool(root,result.manifest.id).execute('invalid-manifest',{path:'source/manifest.json',content:JSON.stringify(invalid)})).rejects.toMatchObject({code:'ARTIFACT_INVALID'});
  expect(await readFile(manifestPath,'utf8')).toBe(original);
  await writeFile(manifestPath,JSON.stringify(invalid));
  const {loadTranslationManifest}=await import('../translation/run-store.js');
  await expect(loadTranslationManifest(root,result.manifest.id)).rejects.toMatchObject({code:'TRANSLATION_MANIFEST_INVALID'});
});
