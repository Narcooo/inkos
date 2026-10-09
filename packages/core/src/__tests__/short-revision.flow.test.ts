import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { ShortFictionOutlineAgent, ShortFictionWriterAgent, ShortFictionDraftReviewerAgent, ShortFictionPackagingAgent, renderShortFictionDraftMarkdown } from "../agents/short-fiction.js";
import { createInspectWorkTool, createShortFictionReviseTool } from "../agent/agent-tools.js";
import { runShortFictionProduction, runShortFictionStage, reviseShortFictionProduction } from "../pipeline/short-fiction-runner.js";
import { createInitialWorkManifestWrite, syncWorkSourceArtifacts } from "../harness/source-sync.js";
import { executeExplicitCapabilityTool } from "../harness/explicit-action.js";
import { loadWorkManifest } from "../harness/work-store.js";
import { commitAtomicFileSet } from "../utils/atomic-file-set.js";
import { createServer } from "node:http";
import { once } from "node:events";
import { createProductionCapabilityRegistry } from "../harness/production-capabilities.js";
import { createBuiltInWorkProfileRegistry } from "../harness/builtin-profiles.js";
import { actionObservation } from "../harness/action-observation.js";
import { withExecutionEvidence } from "../harness/execution-evidence.js";

const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});

it('keeps original author chapter permission across completed edits and rejects protected writes before committing',async()=>{
  const root=await mkdtemp(join(tmpdir(),'inkos-short-permission-'));roots.push(root);
  const draft={storyTitle:'Night light',openingHook:'A lamp fails.',rawContent:'',chapters:[1,2].map(number=>({number,title:`Scene ${number}`,content:Array(40).fill(`scene${number}`).join(' '),charCount:40}))};
  const writes=[
    {relativePath:'works/short/source/outline/v001.md',content:'Original outline'},
    {relativePath:'works/short/source/final/short-story.json',content:JSON.stringify(draft)},
    {relativePath:'works/short/source/final/full.md',content:renderShortFictionDraftMarkdown(draft,'en')},
    {relativePath:'works/short/source/production-state.json',content:JSON.stringify({version:2,intent:'Original intent',target:{chapterCount:2,charsPerChapter:40,language:'en'},stages:{}})},
  ];
  const initial=createInitialWorkManifestWrite({workId:'short',title:draft.storyTitle,profileId:'short-fiction',language:'en',writes});
  await commitAtomicFileSet({rootDir:root,writes:[...writes,initial.write]});
  const baseline=await syncWorkSourceArtifacts({projectRoot:root,workId:'short',accept:true});
  const scope=vi.spyOn(ShortFictionWriterAgent.prototype,'selectAuthorScope').mockResolvedValue({wholeManuscript:false,chapterNumbers:[2],opening:false,outline:false});
  const writer=vi.spyOn(ShortFictionWriterAgent.prototype,'reviseDraft').mockImplementation(async(input)=>({draft:{...input.draft,chapters:input.draft.chapters.map(chapter=>chapter.number===2?{...chapter,content:Array(40).fill('revised').join(' ')}:chapter)},outlineMarkdown:input.outlineMarkdown}));
  vi.spyOn(ShortFictionDraftReviewerAgent.prototype,'reviewDraft').mockResolvedValue({summary:'Reviewed',observations:[]});
  vi.spyOn(ShortFictionPackagingAgent.prototype,'generatePackage').mockResolvedValue({title:draft.storyTitle,intro:'A shared decision.',sellingPoints:['A lamp'],coverPrompt:'A lamp',rawContent:''});
  const runtime={projectRoot:root,model:'fixture',client:{defaults:{maxTokens:4096}}} as never;
  const authorRequest='Change only chapter 2. Preserve chapter 1, the opening and title; review the whole story.';
  const execute=(revisionChapterNumbers?:number[])=>withExecutionEvidence(()=>{},()=>reviseShortFictionProduction({projectRoot:root,storyId:'short',direction:'Apply the latest review findings.',revisionChapterNumbers,cover:false,runtimes:{planner:runtime,writer:runtime,draftReview:runtime,package:runtime}}),undefined,baseline,authorRequest,baseline);
  await execute();
  expect(writer.mock.calls[0]![0].chapterNumbers).toEqual([2]);
  const manuscriptPath=join(root,'works/short/source/final/short-story.json');
  const accepted=await readFile(manuscriptPath);
  expect(JSON.parse(accepted.toString()).chapters[0]).toEqual(draft.chapters[0]);
  await expect(execute([1])).rejects.toMatchObject({code:'SHORT_REVISION_OUT_OF_SCOPE',allowedChapterNumbers:[2]});
  expect(writer).toHaveBeenCalledTimes(1);
  expect(scope).toHaveBeenCalledTimes(1);
  expect(scope.mock.calls[0]).toEqual([draft,authorRequest]);
  expect(await readFile(manuscriptPath)).toEqual(accepted);
  writer.mockImplementationOnce(async(input)=>({draft:{...input.draft,openingHook:'An unauthorized new opening.'},outlineMarkdown:input.outlineMarkdown}));
  await expect(execute([2])).rejects.toMatchObject({code:'SHORT_REVISION_OUT_OF_SCOPE',changedParts:['opening']});
  expect(await readFile(manuscriptPath)).toEqual(accepted);
  const checkpoint=JSON.parse(await readFile(join(root,'.inkos/short-revisions/short.json'),'utf8'));
  await withExecutionEvidence(()=>{},()=>reviseShortFictionProduction({projectRoot:root,storyId:'short',direction:'',resumeOperationId:checkpoint.operationId,cover:false,runtimes:{planner:runtime,writer:runtime,draftReview:runtime,package:runtime}}),undefined,await loadWorkManifest(root,'short'),'Continue the saved revision.');
  expect(scope).toHaveBeenCalledTimes(1);
  expect(JSON.parse(writer.mock.calls.at(-1)![0].direction).authorRequest).toBe(authorRequest);
  expect(JSON.parse(await readFile(manuscriptPath,'utf8')).chapters[0]).toEqual(draft.chapters[0]);
});

it("reuses completed production only for the same review request and preserves review provenance during packaging", async () => {
  const root = await mkdtemp(join(tmpdir(), "inkos-review-request-")); roots.push(root);
  const draft = {storyTitle:"Night light", rawContent:"", chapters:[{number:1, title:"Return", content:Array(40).fill("word").join(" "), charCount:40}]};
  vi.spyOn(ShortFictionOutlineAgent.prototype,"createOutline").mockResolvedValue({storyTitle:draft.storyTitle,rawContent:"A keeper repairs a lamp."});
  vi.spyOn(ShortFictionWriterAgent.prototype,"writeDraft").mockResolvedValue(draft);
  const continueDraft = vi.spyOn(ShortFictionWriterAgent.prototype,"continueDraft");
  const reviewer = vi.spyOn(ShortFictionDraftReviewerAgent.prototype,"reviewDraft").mockResolvedValue({summary:"Reviewed",observations:[]});
  vi.spyOn(ShortFictionPackagingAgent.prototype,"generatePackage").mockResolvedValue({title:draft.storyTitle,intro:"A keeper repairs a lamp.",sellingPoints:["A choice"],coverPrompt:"A lamp",rawContent:""});
  const runtime = {projectRoot:root,model:"fixture",client:{defaults:{maxTokens:4096}}} as never;
  const options = {projectRoot:root,storyId:"night-light",direction:"A keeper repairs a lamp.",language:"en" as const,chapterCount:1,charsPerChapter:40,cover:false,
    runtimes:{planner:runtime,writer:runtime,draftReview:runtime,package:runtime}};
  const run = (authorRequest:string, reviewScope:string) => withExecutionEvidence(()=>{},()=>runShortFictionProduction({...options,reviewScope}),undefined,undefined,authorRequest);
  await run("Review the keeper's motivation.", "motivation");
  const manuscript = await readFile(join(root,"works/night-light/source/final/short-story.json"));
  await run("Review the keeper's motivation.", "motivation");
  expect(reviewer).toHaveBeenCalledTimes(1);
  expect(continueDraft).toHaveBeenCalledTimes(1);
  await run("Review the keeper's motivation.", "chronology");
  expect(reviewer).toHaveBeenCalledTimes(2);
  await run("Review the apprentice's chronology.", "chronology");
  expect(reviewer).toHaveBeenCalledTimes(3);
  const statePath = join(root,"works/night-light/source/production-state.json");
  const reviewed = JSON.parse(await readFile(statePath,"utf8"));
  await runShortFictionStage({...options,stage:"package"});
  const packaged = JSON.parse(await readFile(statePath,"utf8"));
  expect(packaged.reviewScope).toBe("chronology");
  expect(packaged.stages.review).toEqual(reviewed.stages.review);
  expect(await readFile(join(root,"works/night-light/source/final/short-story.json"))).toEqual(manuscript);
});

it("defers the cover when packaging fails and resumes it from the completed visual brief", async () => {
  const root=await mkdtemp(join(tmpdir(),"inkos-cover-dependency-"));roots.push(root);
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=","base64");
  const requests:Array<{prompt:string}>=[];
  const server=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({data:[{b64_json:png.toString("base64")}]}));
  });
  server.listen(0,"127.0.0.1");await once(server,"listening");
  try{
    vi.stubEnv("INKOS_TEST_COVER_KEY","fixture");
    const draft={storyTitle:"Night light",rawContent:"",chapters:[{number:1,title:"Return",content:Array(40).fill("word").join(" "),charCount:40}]};
    vi.spyOn(ShortFictionOutlineAgent.prototype,"createOutline").mockResolvedValue({storyTitle:draft.storyTitle,rawContent:"A lighthouse keeper repairs the lamp."});
    vi.spyOn(ShortFictionWriterAgent.prototype,"writeDraft").mockResolvedValue(draft);
    vi.spyOn(ShortFictionWriterAgent.prototype,"continueDraft").mockResolvedValue(draft);
    vi.spyOn(ShortFictionDraftReviewerAgent.prototype,"reviewDraft").mockResolvedValue({summary:"Reviewed",observations:[]});
    const sales={title:draft.storyTitle,intro:"A keeper repairs the lamp.",sellingPoints:["A return to the lighthouse"],coverPrompt:"An adult lighthouse keeper holds a repaired lamp.",rawContent:""};
    vi.spyOn(ShortFictionPackagingAgent.prototype,"generatePackage").mockRejectedValueOnce(new Error("Packaging unavailable")).mockResolvedValue(sales);
    const runtime={projectRoot:root,model:"fixture",client:{defaults:{maxTokens:4096}}} as never;
    const options={projectRoot:root,storyId:"night-light",direction:"A keeper repairs a lamp.",language:"en" as const,chapterCount:1,charsPerChapter:40,cover:true,
      coverEndpoint:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1/images/generations`,coverApiKeyEnv:"INKOS_TEST_COVER_KEY",coverModel:"image-fixture",
      runtimes:{planner:runtime,writer:runtime,draftReview:runtime,package:runtime}};
    const first=await runShortFictionProduction(options);
    expect(first.observations).toEqual(expect.arrayContaining([expect.objectContaining({code:"SHORT_COVER_PACKAGE_REQUIRED",assessment:"unavailable"})]));
    expect(requests).toEqual([]);
    await expect(readFile(join(root,"works/night-light/source/final/sales-package.json"))).rejects.toMatchObject({code:"ENOENT"});
    const manuscript=await readFile(join(root,"works/night-light/source/final/short-story.json"));
    const staged=await syncWorkSourceArtifacts({projectRoot:root,workId:"night-light",accept:false,writes:[{relativePath:"works/night-light/source/notes.md",content:"An unrelated candidate."}]});
    const notes=staged.artifacts.find(a=>a.revisions.some(r=>r.path==="source/notes.md"))!;
    const second=await runShortFictionProduction({...options,retryStages:["package","cover"]});
    expect(second.coverError).toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.prompt).toContain(sales.coverPrompt);
    expect(await readFile(join(root,"works/night-light/source/final/cover.png"))).toEqual(png);
    expect(await readFile(join(root,"works/night-light/source/final/short-story.json"))).toEqual(manuscript);
    expect((await loadWorkManifest(root,"night-light")).artifacts.find(a=>a.id===notes.id)?.currentRevisionId).toBeNull();
  }finally{
    vi.unstubAllEnvs();server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
},15000);

it('reviews and packages an undersized persisted manuscript without rewriting it and carries delivery issues to packaging',async()=>{
  const root=await mkdtemp(join(tmpdir(),'inkos-review-only-'));roots.push(root);
  const draft={storyTitle:'Short',rawContent:'',chapters:[{number:1,title:'First',content:'One small scene.',charCount:3}]};
  const initial=createInitialWorkManifestWrite({workId:'short',title:'Short',profileId:'short-fiction',language:'en',writes:[]});
  await commitAtomicFileSet({rootDir:root,writes:[initial.write,
    {relativePath:'works/short/source/outline/v001.md',content:'A complete plan'},
    {relativePath:'works/short/source/final/short-story.json',content:JSON.stringify(draft)},
    {relativePath:'works/short/source/final/full.md',content:renderShortFictionDraftMarkdown(draft,'en')},
    {relativePath:'works/short/source/production-state.json',content:JSON.stringify({version:2,intent:'Original story',target:{chapterCount:1,charsPerChapter:40,language:'en'},stages:{}})},
  ]});
  const before=await readFile(join(root,'works/short/source/final/short-story.json'));
  const writer=vi.spyOn(ShortFictionWriterAgent.prototype,'continueDraft');
  const reviewSpy=vi.spyOn(ShortFictionDraftReviewerAgent.prototype,'reviewDraft').mockResolvedValue({summary:'Reviewed',observations:[]});
  const packageSpy=vi.spyOn(ShortFictionPackagingAgent.prototype,'generatePackage').mockResolvedValue({title:'Short',intro:'A small scene',sellingPoints:['A choice'],coverPrompt:'A scene',rawContent:''});
  const runtime={client:{} as never,model:'fixture',projectRoot:root};
  const options={projectRoot:root,storyId:'short',direction:'',minChapterLengthRatio:0.9,runtimes:{planner:runtime,writer:runtime,draftReview:runtime,package:runtime}};
  const review=await runShortFictionStage({...options,stage:'review'});
  expect(reviewSpy.mock.calls[0]![0]).toMatchObject({chapterCount:1,charsPerChapter:40,minChapterLength:36,language:'en'});
  expect(review.observations).toEqual(expect.arrayContaining([expect.objectContaining({code:'SHORT_CHAPTER_CONTRACT',assessment:'issue',scope:'chapter:1'})]));
  const packagingRequest="Emphasize the shared decision in the synopsis.";
  await runShortFictionStage({...options,stage:'package',direction:packagingRequest});
  expect(writer).not.toHaveBeenCalled();
  expect(await readFile(join(root,'works/short/source/final/short-story.json'))).toEqual(before);
  expect(JSON.parse(packageSpy.mock.calls[0]![0].reviewContext!)).toMatchObject({status:'needs_revision'});
  expect(packageSpy.mock.calls[0]![0].direction).toContain(packagingRequest);
  expect(packageSpy.mock.calls[0]![0].direction).toContain("Original story");
  const state=JSON.parse(await readFile(join(root,'works/short/source/production-state.json'),'utf8'));
  expect(state.delivery.status).toBe('needs_revision');
  expect(state.intent).toBe("Original story");
  const preservedPaths=["source/reviews/draft-v001.md","source/final/sales-package.json","source/final/sales-package.md","source/final/cover-prompt.md"];
  const preservedBytes=await Promise.all(preservedPaths.map(path=>readFile(join(root,"works/short",path))));
  const acceptedBefore=await loadWorkManifest(root,"short");
  reviewSpy.mockRejectedValueOnce(Object.assign(new Error("Review unavailable"),{code:"MODEL_EMPTY_RESPONSE"}));
  packageSpy.mockRejectedValueOnce(Object.assign(new Error("Packaging unavailable"),{code:"MODEL_EMPTY_RESPONSE"}));
  for(const stage of ["review","package"] as const){
    const failed=await runShortFictionStage({...options,stage});
    expect(failed.stageStatus).toBe("failed");
    expect(failed.artifactPaths).toContain(`works/short/source/reviews/${stage==="review"?"draft":"package"}-warning.md`);
    expect(failed.observations).toEqual(expect.arrayContaining([expect.objectContaining({category:"execution",assessment:"unavailable"})]));
  }
  expect(await Promise.all(preservedPaths.map(path=>readFile(join(root,"works/short",path))))).toEqual(preservedBytes);
  const acceptedAfter=await loadWorkManifest(root,"short");
  for(const path of preservedPaths){
    const original=acceptedBefore.artifacts.find(a=>a.revisions.some(r=>r.path===path))!;
    expect(acceptedAfter.artifacts.find(a=>a.id===original.id)?.currentRevisionId).toBe(original.currentRevisionId);
  }
  for(const stage of ["review","package"] as const){
    const resumed=await runShortFictionStage({...options,stage});
    expect(resumed.stageStatus).toBe("completed");
    await expect(readFile(join(root,`works/short/source/reviews/${stage==="review"?"draft":"package"}-warning.md`))).rejects.toMatchObject({code:"ENOENT"});
  }
  expect(await readFile(join(root,'works/short/source/final/short-story.json'))).toEqual(before);
  const withCandidate=await syncWorkSourceArtifacts({projectRoot:root,workId:"short",accept:false,writes:[
    {relativePath:"works/short/source/notes.md",content:"An unrelated candidate awaiting a separate decision."},
  ]});
  const candidate=withCandidate.artifacts.find(a=>a.revisions.some(r=>r.path==="source/notes.md"))!;
  const pipeline={createAgentContext:()=>runtime,runWithAgentContext:async(_context:unknown,task:()=>Promise<unknown>)=>task()};
  const registry=createProductionCapabilityRegistry({pipeline:pipeline as never,projectRoot:root,sessionId:"stage-scope",profileId:"short-fiction",work:withCandidate,language:"en",playWorldExists:false,sameSessionProposal:false,allowSystemFileRead:false});
  await registry.invoke("short-fiction","review_short_fiction",{projectRoot:root,episodeId:"stage-scope",work:withCandidate,profile:createBuiltInWorkProfileRegistry(root).require("short-fiction")},{workId:"short"});
  expect((await loadWorkManifest(root,"short")).artifacts.find(a=>a.id===candidate.id)?.currentRevisionId).toBeNull();
});

it("exposes the outline and partial draft during generation without marking them final", async () => {
  const root = await mkdtemp(join(tmpdir(), "inkos-short-discovery-")); roots.push(root);
  const complete = { storyTitle: "Story", rawContent: "", chapters: [1, 2].map(number => ({
    number, title: `Chapter ${number}`, content: Array(40).fill("word").join(" "), charCount: 40,
  })) };
  const inspect = async () => (await executeExplicitCapabilityTool({
    projectRoot: root, workId: "short", tool: createInspectWorkTool(root), parameters: { workId: "short" },
    binding: { capabilityId: "workspace", actionId: "inspect_work", profileId: "short-fiction", risk: "read" },
  })).data as {
    artifacts: Array<{ path: string; status: string; revisionId: string }>;
  };
  vi.spyOn(ShortFictionOutlineAgent.prototype, "createOutline").mockResolvedValue({ storyTitle: "Story", rawContent: "Complete outline" });
  vi.spyOn(ShortFictionWriterAgent.prototype, "writeDraft").mockImplementationOnce(async input => {
    expect((await inspect()).artifacts).toContainEqual(expect.objectContaining({
      path: "works/short/source/outline/v001.md", status: "candidate",
    }));
    await input.onBatchComplete?.({ ...complete, chapters: [complete.chapters[0]!, { number: 2, title: "", content: "", charCount: 0 }] }, [1]);
    const partial = (await inspect()).artifacts;
    expect(partial).toContainEqual(expect.objectContaining({ path: "works/short/source/drafts/v001-partial/draft.json", status: "candidate" }));
    expect(partial.every(artifact => artifact.status === "candidate")).toBe(true);
    throw Object.assign(new Error("model interrupted"), { code: "MODEL_STREAM_IDLE" });
  });
  vi.spyOn(ShortFictionWriterAgent.prototype, "continueDraft").mockResolvedValue(complete);
  vi.spyOn(ShortFictionDraftReviewerAgent.prototype, "reviewDraft").mockResolvedValue({ summary: "Reviewed", observations: [] });
  vi.spyOn(ShortFictionPackagingAgent.prototype, "generatePackage").mockResolvedValue({ title: "Story", intro: "Synopsis", sellingPoints: ["Point"], coverPrompt: "Cover", rawContent: "" });
  const context = { projectRoot: root, model: "test", client: { defaults: { maxTokens: 4096 } } } as never;
  const options = { projectRoot: root, storyId: "short", direction: "Write a story", language: "en" as const, chapterCount: 2, charsPerChapter: 40, cover: false, runtimes: { planner: context, writer: context, draftReview: context, package: context } };
  await runShortFictionStage({...options,stage:"outline"});
  await expect(runShortFictionStage({...options,stage:"draft"})).rejects.toMatchObject({ code: "MODEL_STREAM_IDLE", recovery:{workId:"short",path:"works/short/source/drafts/v001-partial/draft.json",persistedChapterNumbers:[1],validChapterNumbers:[1],incompleteChapterNumbers:[2],requestedChapterCount:2} });
  await expect(reviseShortFictionProduction(options)).rejects.toMatchObject({
    code:"SHORT_MANUSCRIPT_NOT_READY",recovery:{action:"short-fiction__draft_short_fiction",parameters:{workId:"short"}},
  });
  await runShortFictionProduction({...options,retryStages:["review","package"]});
  expect(ShortFictionWriterAgent.prototype.continueDraft).toHaveBeenCalledOnce();
  expect((await inspect()).artifacts).toContainEqual(expect.objectContaining({ path: "works/short/source/final/short-story.json", status: "current" }));
  const revisions = (await loadWorkManifest(root,"short")).artifacts.flatMap(artifact=>artifact.revisions);
  for (const artifact of (await inspect()).artifacts) {
    const bytes=await readFile(join(root,artifact.path));
    expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(revisions.find(revision=>revision.id===artifact.revisionId)?.checksum);
  }
});

it.each(["resume", "restart", "finalize"] as const)("%s preserves revision ownership through changed retry wording and retains the prior manuscript",async(mode)=>{
  const root=await mkdtemp(join(tmpdir(),"inkos-short-revision-"));roots.push(root);
  const draft={storyTitle:"Story",chapters:[1,2].map(number=>({number,title:`Chapter ${number}`,content:Array(40).fill("word").join(" "),charCount:40})),rawContent:""};
  const changed={...draft,chapters:draft.chapters.map(chapter=>({...chapter,content:Array(40).fill("revised").join(" ")}))};
  const initial=createInitialWorkManifestWrite({workId:"short",title:"Story",profileId:"short-fiction",language:"en",writes:[
    {relativePath:"works/short/source/outline/v001.md",content:"Original outline"},
    {relativePath:"works/short/source/final/short-story.json",content:JSON.stringify(draft)},
    {relativePath:"works/short/source/final/full.md",content:renderShortFictionDraftMarkdown(draft,"en")},
  ]});
  await commitAtomicFileSet({rootDir:root,writes:[
    {relativePath:"works/short/source/production-state.json",content:JSON.stringify({version:2,intent:"Original intent",target:{chapterCount:2,charsPerChapter:40,maxChapterLength:60,language:"en"},stages:{}})},
    {relativePath:"works/short/source/outline/v001.md",content:"Original outline"},
    {relativePath:"works/short/source/final/short-story.json",content:JSON.stringify(draft)},
    {relativePath:"works/short/source/final/full.md",content:renderShortFictionDraftMarkdown(draft,"en")},initial.write,
  ]});
  const before=await syncWorkSourceArtifacts({projectRoot:root,workId:"short",accept:true});
  const original=before.artifacts.find(a=>a.revisions.some(r=>r.path==="source/final/full.md"))!;
  const previous=original.revisions.find(r=>r.id===original.currentRevisionId)!;
  vi.spyOn(ShortFictionWriterAgent.prototype,"reviseDraft")
    .mockImplementationOnce(async(input)=>{
      expect(input.chapterNumbers).toEqual([1,2]);
      expect(input).toMatchObject({charsPerChapter:40,maxChapterLength:60});
      await input.onRevisionProgress?.({
        plan:{revisionBrief:"Correct shared facts",outlineMarkdown:"Updated outline",chapters:[{number:1,instruction:"Revise one"},{number:2,instruction:"Revise two"}]},
        draft:{...draft,chapters:[changed.chapters[0]!,draft.chapters[1]!]},completed:[1],
      });
      throw Object.assign(new Error("model interrupted"),{code:"MODEL_STREAM_IDLE"});
    })
    .mockImplementationOnce(async(input)=>{
      expect(input).toMatchObject({direction:mode!=="restart"?"Resolve the review":"Resolve the newly reviewed issue",review:mode!=="restart"?"":"A later review",chapterNumbers:[1,2],charsPerChapter:40,maxChapterLength:60});
      if(mode!=="restart") {
        expect(input.resume?.completed).toEqual([1]);
        expect(input.resume?.draft.chapters[0]).toEqual(changed.chapters[0]);
      } else {
        expect(input.resume).toBeUndefined();
        expect(input.draft).toEqual(draft);
      }
      return {draft:changed,outlineMarkdown:"Updated outline"};
    });
  vi.spyOn(ShortFictionDraftReviewerAgent.prototype,"reviewDraft").mockResolvedValue({summary:"Reviewed",observations:[]});
  const pack=vi.spyOn(ShortFictionPackagingAgent.prototype,"generatePackage").mockResolvedValue({title:"Story",intro:"Synopsis",sellingPoints:["Point"],coverPrompt:"Cover",rawContent:""});
  const context={projectRoot:root,model:"test",client:{defaults:{maxTokens:4096}}};
  const pipeline={createAgentContext:()=>context,runWithAgentContext:async(_context:unknown,task:()=>Promise<unknown>)=>task()};
  let controller=new AbortController();
  const execute=(parameters:Record<string,unknown>)=>executeExplicitCapabilityTool({signal:controller.signal,projectRoot:root,workId:"short",binding:{capabilityId:"short-fiction",actionId:"revise_short_fiction",profileId:"short-fiction",risk:"recoverable-write"},tool:createShortFictionReviseTool(pipeline as never,root,"short"),parameters});
  const instruction={instruction:"Resolve the review",chapterNumbers:[1,2]};
  await expect(execute(instruction)).rejects.toMatchObject({code:"MODEL_STREAM_IDLE", recovery: {
    action:"short-fiction__revise_short_fiction",parameters:{resumeOperationId:expect.any(String)},
    completedChapterNumbers:[1],pendingChapterNumbers:[2],
  }});
  const checkpointPath=join(root,".inkos/short-revisions/short.json");
  const checkpointBytes=await readFile(checkpointPath);
  const checkpoint=JSON.parse(checkpointBytes.toString());
  const resume={resumeOperationId:checkpoint.operationId};
  await expect(execute({...instruction,instruction:"Resolve the review. Keep each chapter within the existing maximum."})).rejects.toMatchObject({code:"SHORT_REVISION_PENDING",recovery:{parameters:resume,completedChapterNumbers:[1],pendingChapterNumbers:[2]}});
  await expect(execute({...resume,maxChapterLength:50})).rejects.toMatchObject({code:"SHORT_REVISION_RESUME_CONFLICT"});
  await expect(execute({resumeOperationId:"another-operation"})).rejects.toMatchObject({code:"SHORT_REVISION_NOT_FOUND"});
  const outlinePath=join(root,"works/short/source/outline/v001.md");
  await writeFile(outlinePath,"A different source outline");
  await expect(execute(resume)).rejects.toMatchObject({code:"SHORT_REVISION_SOURCE_CHANGED"});
  await writeFile(outlinePath,"Original outline");
  expect(await readFile(checkpointPath)).toEqual(checkpointBytes);
  expect(ShortFictionWriterAgent.prototype.reviseDraft).toHaveBeenCalledTimes(1);
  expect((await loadWorkManifest(root,"short")).artifacts.find(a=>a.id===original.id)?.currentRevisionId).toBe(previous.id);
  // A newer review must not silently change the saved job's original inputs.
  await commitAtomicFileSet({rootDir:root,writes:[{relativePath:"works/short/source/reviews/draft-v001.md",content:"A later review"}]});
  if(mode==="finalize") {
    vi.mocked(ShortFictionDraftReviewerAgent.prototype.reviewDraft).mockImplementationOnce(async()=>{
      controller.abort();
      throw controller.signal.reason;
    });
    await expect(execute(resume)).rejects.toMatchObject({name:"AbortError"});
    expect(ShortFictionWriterAgent.prototype.reviseDraft).toHaveBeenCalledTimes(2);
    controller=new AbortController();
  }
  const result=await execute(mode!=="restart"?resume:{...instruction,instruction:"Resolve the newly reviewed issue",restartPendingRevision:true});
  expect(ShortFictionWriterAgent.prototype.reviseDraft).toHaveBeenCalledTimes(2);
  await expect(readFile(checkpointPath)).rejects.toMatchObject({code:"ENOENT"});
  if(mode==="restart") {
    const archiveDir=join(root,".inkos/short-revisions/archive");
    const archives=await readdir(archiveDir);
    expect(archives).toHaveLength(1);
    expect(await readFile(join(archiveDir,archives[0]!))).toEqual(checkpointBytes);
  }
  expect(result.status).toBe("success");
  const reviewInput=vi.mocked(ShortFictionDraftReviewerAgent.prototype.reviewDraft).mock.calls.at(-1)![0];
  const baselineArtifact=before.artifacts.find(a=>a.revisions.some(r=>r.id===a.currentRevisionId&&r.path==='source/final/short-story.json'))!;
  expect(reviewInput.comparison).toMatchObject({scope:'episode_start',before:{artifactId:baselineArtifact.id,revisionId:baselineArtifact.currentRevisionId},draft});
  expect(reviewInput).toMatchObject({charsPerChapter:40,maxChapterLength:60});
  const reviewState=JSON.parse(await readFile(join(root,'works/short/source/production-state.json'),'utf8')).stages.review;
  expect(reviewState.comparison).toEqual({scope:reviewInput.comparison!.scope,before:reviewInput.comparison!.before,after:reviewInput.comparison!.after});
  expect((result.data as {kind:string}).kind).toBe("short_fiction_revised");
  expect(actionObservation(result).facts.revisionChanges).toEqual({chapterNumbers:[1,2],openingChanged:false,titleChanged:false,outlineChanged:true});
  expect(pack.mock.calls[0]?.[0].draft.chapters).toEqual(changed.chapters);
  const after=await loadWorkManifest(root,"short");
  const artifact=after.artifacts.find(a=>a.id===original.id)!;
  expect(artifact.currentRevisionId).not.toBe(original.currentRevisionId);
  expect(artifact.revisions.find(r=>r.id===artifact.currentRevisionId)?.parentRevisionId).toBe(previous.id);
  const bytes=await readFile(join(root,"works/short/source/final/full.md"));
  expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(artifact.revisions.find(r=>r.id===artifact.currentRevisionId)?.checksum);
  expect(`sha256:${createHash("sha256").update(await readFile(join(root,"works/short",previous.snapshotPath!))).digest("hex")}`).toBe(previous.checksum);
  expect(result.artifacts.some(a=>a.path==="source/final/sales-package.json")).toBe(true);
});
