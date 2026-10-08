import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, expect, vi } from 'vitest';
import { createWorkManifest, saveWorkManifest, loadWorkManifest } from '../harness/work-store.js';
import { syncWorkSourceArtifacts } from '../harness/source-sync.js';
import { createArtifactMethodTools } from '../harness/tools/artifact-methods.js';
import { createLLMClient } from '../llm/provider.js';
import { PipelineRunner } from '../pipeline/runner.js';
import { generateShortFictionCover } from '../pipeline/short-fiction-runner.js';
import { createProductionCapabilityRegistry } from '../harness/production-capabilities.js';
import { createBuiltInWorkProfileRegistry } from '../harness/builtin-profiles.js';
import { createGenerateCoverTool, createReadTool } from '../agent/agent-tools.js';
import { actionResultFacts } from '../harness/action-observation.js';
import { splitSourceLines } from '../utils/source-text.js';
import { createAdoptWorkRevisionTool } from '../harness/tools/work-artifacts.js';
import { executeExplicitCapabilityTool } from '../harness/explicit-action.js';
import { currentExecutionAuthorRequest, withExecutionEvidence } from '../harness/execution-evidence.js';
import {StoryGraphSchema} from '../interactive-film/graph-schema.js';

it('reviews a pinned graph with deterministic structural facts and persists the same evidence',async()=>{
  const root=await mkdtemp(join(tmpdir(),'inkos-graph-review-'));const requests:any[]=[];
  const server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));requests.push(body);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'review',type:'function',function:{name:body.tools[0].function.name,arguments:JSON.stringify({summary:'Reviewed',observationCodes:[]})}}]}}]}));});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    await saveWorkManifest(root,createWorkManifest({id:'film',title:'Relay',profileId:'interactive-film',language:'en'}));
    await mkdir(join(root,'works/film/source'),{recursive:true});
    const graph=StoryGraphSchema.parse({schemaVersion:1,projectId:'film',title:'Relay',nodes:[
      {id:'s',type:'start',choices:[{id:'leave',text:'Leave',targetNodeId:'e'}]},
      {id:'e',type:'ending',choices:[]},
    ],endings:[{id:'end',nodeId:'e',title:'Outside',type:'end'}]});
    const saved=await syncWorkSourceArtifacts({projectRoot:root,workId:'film',accept:true,writes:[
      {relativePath:'works/film/source/story-graph.json',content:JSON.stringify(graph)},
      {relativePath:'works/film/source/delivery-requirements.json',content:JSON.stringify({nodeCount:3,minRouteChoices:1})},
    ]});
    const artifact=saved.artifacts.find(a=>a.revisions.some(r=>r.path==='source/story-graph.json'))!;
    const revision=artifact.revisions.find(r=>r.id===artifact.currentRevisionId)!;
    const extended=StoryGraphSchema.parse({...graph,nodes:[...graph.nodes,{id:'extra',type:'normal',choices:[]}]});
    await syncWorkSourceArtifacts({projectRoot:root,workId:'film',accept:true,writes:[{relativePath:'works/film/source/story-graph.json',content:JSON.stringify(extended)}]});
    const client=createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat',stream:false,temperature:0,thinkingBudget:0});
    const pipeline=new PipelineRunner({projectRoot:root,client,model:'fixture'});
    const reviewed=await createArtifactMethodTools(pipeline,root,'film')[0]!.execute('review',{artifactId:artifact.id,revisionId:revision.id,instruction:'Review this saved revision against the current requirements.'});
    expect(requests).toHaveLength(1);
    const input=JSON.parse(requests[0].messages.find((m:any)=>m.role==='user').content);
    expect(input.structure).toMatchObject({revisionId:revision.id,targetHash:revision.checksum,nodeCount:2,longestObservedSimpleRoute:{choices:1},delivery:{status:'needs_revision',issues:expect.arrayContaining([{code:'FILM_NODE_COUNT',expected:3,actual:2}])}});
    const report=JSON.parse(await readFile(join(root,'works/film',(reviewed.details as {path:string}).path),'utf8'));
    expect(report.structure).toEqual(input.structure);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
},20000);

it('reviews an explicit candidate snapshot without adopting it or unrelated source candidates', async () => {
  const root=await mkdtemp(join(tmpdir(),'inkos-candidate-review-'));
  const requests: Array<{messages: Array<{role: string; content: string}>}> = [];
  const server=createServer(async(req,res)=>{
    const chunks: Buffer[]=[]; for await(const chunk of req) chunks.push(Buffer.from(chunk));
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    const args={summary:'Candidate inspected',observationCodes:[]};
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.write(`data: ${JSON.stringify({id:'review',object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'review-call',type:'function',function:{name:'submit_artifact_review',arguments:JSON.stringify(args)}}]},finish_reason:null}]})}\n\n`);
    res.end(`data: ${JSON.stringify({id:'review',object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    await saveWorkManifest(root,createWorkManifest({id:'candidate',title:'Candidate',profileId:'short-fiction',language:'en'}));
    const base=join(root,'works/candidate/source');await mkdir(base,{recursive:true});
    await writeFile(join(base,'draft.md'),'A complete candidate scene.');
    await writeFile(join(base,'notes.md'),'Unaccepted planning notes.');
    const before=await syncWorkSourceArtifacts({projectRoot:root,workId:'candidate',accept:false});
    const target=before.artifacts.find(a=>a.revisions[0].path==='source/draft.md')!;
    const client=createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat',stream:true,temperature:0,thinkingBudget:0});
    const pipeline=new PipelineRunner({client,model:'fixture',projectRoot:root});
    const tool=createArtifactMethodTools(pipeline,root,'candidate')[0];
    await expect(tool.execute('missing',{artifactId:target.id,instruction:'Review candidate'})).rejects.toMatchObject({code:'ARTIFACT_REVISION_REQUIRED'});
    const authorRequest='Review this candidate scene and preserve the separate notes.';
    const delegatedInstruction='Review candidate';
    const result=await executeExplicitCapabilityTool({projectRoot:root,workId:'candidate',authorRequest,
      binding:{capabilityId:'workspace',actionId:tool.name,profileId:'short-fiction',risk:'recoverable-write'},tool,
      parameters:{artifactId:target.id,revisionId:target.revisions[0].id,instruction:delegatedInstruction},
    });
    const after=await loadWorkManifest(root,'candidate');
    for(const original of before.artifacts) expect(after.artifacts.find(a=>a.id===original.id)).toEqual(original);
    const report=JSON.parse(await readFile(join(root,'works/candidate',(result.data as {path:string}).path),'utf8'));
    expect(report).toMatchObject({artifactId:target.id,revisionId:target.revisions[0].id,targetHash:target.revisions[0].checksum,scope:authorRequest,coordinatorInstruction:delegatedInstruction,reviewBasis:'author_request'});
    const request = JSON.parse([...requests[0]!.messages].reverse().find(message => message.role === 'user')!.content);
    expect(request).toMatchObject({instruction:authorRequest});
    expect(request).not.toHaveProperty('reviewFocus');
    const authorContexts=requests[0]!.messages.flatMap(message=>message.content.split('\n\n')).flatMap(block=>{try{const value=JSON.parse(block);return value.authorRequest?[value.authorRequest]:[];}catch{return[];}});
    expect(authorContexts).toEqual([authorRequest]);
    expect(currentExecutionAuthorRequest()).toBeUndefined();
    expect(request.sources[0]).toMatchObject({revisionId:target.revisions[0].id,checksum:target.revisions[0].checksum});
    expect(request.sources[0].measurements).toEqual(report.measurements);
    expect(report.measurements).toMatchObject({scope:'full_artifact',lineCount:1,hanCharacters:0,englishWords:4});
    expect(result.data).toMatchObject({artifactId:target.id,revisionId:target.revisions[0].id,measurements:report.measurements});
    expect(after.artifacts.filter(a=>a.currentRevisionId!==null)).toHaveLength(1);
    await executeExplicitCapabilityTool({projectRoot:root,workId:'candidate',
      binding:{capabilityId:'workspace',actionId:'adopt_work_revision',profileId:'short-fiction',risk:'recoverable-write'},
      tool:createAdoptWorkRevisionTool(root,'candidate'),
      parameters:{artifactId:target.id,revisionId:target.revisions[0].id,expectedCurrentRevisionId:null},
    });
    const adopted=await loadWorkManifest(root,'candidate');
    expect(adopted.artifacts.find(a=>a.id===target.id)?.currentRevisionId).toBe(target.revisions[0].id);
    const notes=before.artifacts.find(a=>a.revisions[0].path==='source/notes.md')!;
    expect(adopted.artifacts.find(a=>a.id===notes.id)?.currentRevisionId).toBeNull();
  } finally {server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await rm(root,{recursive:true,force:true});}
},15000);

it('reviews a sales package with the manuscript and outline versions used to create it', async () => {
  const root=await mkdtemp(join(tmpdir(),'inkos-package-sources-'));
  const requests:Array<{messages:Array<{role:string;content:string}>}>=[];
  const server=createServer(async(req,res)=>{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.write(`data: ${JSON.stringify({id:'review',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'review',type:'function',function:{name:'submit_artifact_review',arguments:JSON.stringify({summary:'Compared production sources',observationCodes:[]})}}]},finish_reason:null}]})}\n\n`);
    res.end(`data: ${JSON.stringify({id:'review',choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    await saveWorkManifest(root,createWorkManifest({id:'package',title:'Receipt',profileId:'short-fiction',language:'en'}));
    await mkdir(join(root,'works/package/source'),{recursive:true});
    const work=await syncWorkSourceArtifacts({projectRoot:root,workId:'package',accept:true,writes:[
      {relativePath:'works/package/source/outline/v001.md',content:'Mara is 27. The receipt proves the final amount.'},
      {relativePath:'works/package/source/final/full.md',content:'Mara produces the signed receipt.'},
      {relativePath:'works/package/source/final/sales-package.md',content:'A young clerk proves who signed the receipt.'},
    ]});
    const artifact=work.artifacts.find(a=>a.revisions.some(r=>r.path==='source/final/sales-package.md'))!;
    const client=createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat',stream:true,temperature:0,thinkingBudget:0});
    const result=await createArtifactMethodTools(new PipelineRunner({client,model:'fixture',projectRoot:root}),root,work.id)[0]!.execute('review',{artifactId:artifact.id,instruction:'Check the package against its story.'});
    const input=JSON.parse([...requests[0]!.messages].reverse().find(m=>m.role==='user')!.content);
    expect(new Set(input.sources.map((source:{path:string})=>source.path))).toEqual(new Set(['source/final/sales-package.md','source/final/full.md','source/outline/v001.md']));
    for(const source of input.sources){
      const artifact=work.artifacts.find(item=>item.id===source.sourceId)!;
      const revision=artifact.revisions.find(item=>item.id===artifact.currentRevisionId)!;
      expect(source).toMatchObject({revisionId:revision.id,checksum:revision.checksum,path:revision.path});
    }
    expect(result.details).toMatchObject({kind:'artifact_reviewed',reviewedReferences:expect.any(Array)});
    expect((result.details as {reviewedReferences:unknown[]}).reviewedReferences).toHaveLength(2);
  } finally {server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await rm(root,{recursive:true,force:true});}
},15000);

it('regenerates a cover into the active canonical Work and preserves its earlier image revision', async () => {
  const root=await mkdtemp(join(tmpdir(),'inkos-cover-target-'));
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
  const priorPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
  const requests:Array<{prompt:string;reference?:Buffer;route?:string}>=[];
  const server=createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);if(req.headers['content-type']?.startsWith('multipart/form-data')){const form=await new Request('http://localhost'+req.url,{method:'POST',headers:{'Content-Type':String(req.headers['content-type'])},body:new Uint8Array(bytes)}).formData();requests.push({prompt:String(form.get('prompt')).replaceAll('\r\n','\n'),reference:Buffer.from(await(form.get('image') as File).arrayBuffer()),route:req.url});}else requests.push({...JSON.parse(bytes.toString('utf8')),route:req.url});res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:[{b64_json:png.toString('base64')}]}));});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    vi.stubEnv('INKOS_COVER_ENDPOINT',`http://127.0.0.1:${(server.address() as {port:number}).port}/v1/images/generations`);
    vi.stubEnv('INKOS_COVER_BASE_URL','');vi.stubEnv('INKOS_COVER_API_KEY','fixture');vi.stubEnv('INKOS_COVER_MODEL','image-fixture');
    await saveWorkManifest(root,createWorkManifest({id:'cover-test',title:'Fixture',profileId:'visual-asset',language:'en'}));
    const base=join(root,'works/cover-test/source');await mkdir(base,{recursive:true});await writeFile(join(base,'cover.png'),priorPng);
    const storySource='Mira repairs a costume for a community performance at East Quay Hall.\n\n```json\n{"setting":"East Quay Hall"}\n```';
    await writeFile(join(base,'source-material.md'),storySource);
    const before=await syncWorkSourceArtifacts({projectRoot:root,workId:'cover-test',accept:true});
    const source=before.artifacts.find(a=>a.revisions.some(r=>r.path==='source/source-material.md'))!;
    const sourceRevision=source.revisions.find(r=>r.id===source.currentRevisionId)!;
    const sourceReference={artifactId:source.id,revisionId:sourceRevision.id,checksum:sourceRevision.checksum,content:storySource};
    const initialContext={intro:'A tailor prepares a community performance.',sellingPoints:['A repaired costume brings old friends together.']};
    const generated=await createGenerateCoverTool(root,{activeWorkId:'cover-test'}).execute('cover',{
      title:'Fixture',...initialContext,coverPrompt:'Revised visual direction',outputDir:'works/cover-test/source',
      coverEndpoint:'https://wrong.invalid/images/generations',coverBaseUrl:'https://wrong.invalid/v1',
    } as never);
    const result=generated.details;
    expect(requests[0].route).toBe('/v1/images/edits');
    expect(requests[0].reference).toEqual(priorPng);
    expect(result).toMatchObject({workId:'cover-test',coverImagePath:'works/cover-test/source/cover.png'});
    expect(await readdir(join(root,'works'))).toEqual(['cover-test']);
    expect(await readFile(join(base,'cover.png'))).toEqual(png);
    const after=await loadWorkManifest(root,'cover-test');
    expect(after.artifacts.find(a=>a.kind==='image')?.revisions).toHaveLength(2);
    await createGenerateCoverTool(root,{activeWorkId:'cover-test'}).execute('regenerate',{title:'Fixture',coverPrompt:'Use a warmer palette.'});
    const regenerated=JSON.parse(requests.at(-1)!.prompt.split('```json\n').at(-1)!.split('\n```')[0]!);
    expect(regenerated).toMatchObject({visualBrief:'Use a warmer palette.',storyReference:{title:'Fixture',synopsis:initialContext.intro,sellingPoints:initialContext.sellingPoints,sources:[sourceReference]}});
    expect(await readFile(join(base,'source-material.md'),'utf8')).toBe(storySource);
    const updatedSource='Mira prepares a new performance at North Quay Hall.';
    const updated=await syncWorkSourceArtifacts({projectRoot:root,workId:'cover-test',accept:true,writes:[{relativePath:'works/cover-test/source/source-material.md',content:updatedSource}]});
    const updatedArtifact=updated.artifacts.find(a=>a.id===source.id)!;
    const updatedRevision=updatedArtifact.revisions.find(r=>r.id===updatedArtifact.currentRevisionId)!;
    const currentReference={artifactId:source.id,revisionId:updatedRevision.id,checksum:updatedRevision.checksum,content:updatedSource};
    await createGenerateCoverTool(root,{activeWorkId:'cover-test'}).execute('updated-source',{title:'Fixture',coverPrompt:'Use a quieter composition.'});
    const currentRequest=JSON.parse(requests.at(-1)!.prompt.split('```json\n').at(-1)!.split('\n```')[0]!);
    expect(currentRequest.storyReference).toEqual({title:'Fixture',synopsis:'',sellingPoints:[],sources:[currentReference]});
    await expect(generateShortFictionCover({projectRoot:root,workId:'cover-test',title:'Fixture',outputDir:'works/other/source'})).rejects.toMatchObject({code:'COVER_WORK_MISMATCH'});
    await expect(generateShortFictionCover({projectRoot:root,title:'Fixture',outputDir:'works/../source'})).rejects.toMatchObject({code:'COVER_OUTPUT_INVALID'});
    const sales={title:'Fixture',intro:'A tailor prepares a community performance.',sellingPoints:['A repaired costume brings old friends together.'],coverPrompt:'A tailor holding an embroidered costume.'};
    await syncWorkSourceArtifacts({projectRoot:root,workId:'cover-test',accept:true,writes:[{relativePath:'works/cover-test/source/final/sales-package.json',content:JSON.stringify(sales)}]});
    const authorRequest='Use the current story and add the subtitle "Together again" below the title.';
    const grounded=await withExecutionEvidence(()=>{},()=>createGenerateCoverTool(root,{activeWorkId:'cover-test'}).execute('grounded',{title:'Fixture'}),undefined,undefined,authorRequest);
    expect(grounded.details).toMatchObject({coverImagePath:'works/cover-test/source/final/cover.png'});
    const renderingInput=JSON.parse(requests.at(-1)!.prompt.split('```json\n').at(-1)!.split('\n```')[0]!);
    expect(renderingInput).toEqual({version:1,authorRequest,printedTitle:'Fixture',visualBrief:sales.coverPrompt,storyReference:{title:sales.title,synopsis:sales.intro,sellingPoints:sales.sellingPoints,sources:[currentReference]}});
    expect(await readFile(join(base,'final/cover-request.md'),'utf8')).toBe(requests.at(-1)!.prompt+'\n');
    expect(await readFile(join(base,'final/sales-package.json'),'utf8')).toBe(JSON.stringify(sales));
    expect(requests).toHaveLength(4);
  } finally {vi.unstubAllEnvs();server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await rm(root,{recursive:true,force:true});}
},15000);

it('revises selected Markdown lines with registered source material while preserving surrounding bytes and prior revisions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'inkos-scoped-revision-'));let calls=0;
 const requests:Array<{messages:Array<{role:string,content:string}>}>=[];
 const server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));calls++;
  const args={range_0_content:'Changed action.\nLast scene remains.\n'};res.writeHead(200,{'Content-Type':'text/event-stream'});
  res.write(`data: ${JSON.stringify({id:'edit',object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'edit-call',type:'function',function:{name:'submit_artifact_revision',arguments:JSON.stringify(args)}}]},finish_reason:null}]})}\n\n`);
  res.end(`data: ${JSON.stringify({id:'edit',object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`);
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  await saveWorkManifest(root,createWorkManifest({id:'script',title:'Script',profileId:'script',language:'en'}));
  await mkdir(join(root,'works/script/source'),{recursive:true});
  const source='First scene: "Keep this."\r\n\r\nOld action.\nLast scene remains.\n';
  const material='The witness waited for the neighbour. The neighbour arrived after the shop closed.';
  const before=await syncWorkSourceArtifacts({projectRoot:root,workId:'script',accept:true,writes:[{relativePath:'works/script/source/script.md',content:source},{relativePath:'works/script/source/source-material.md',content:material}]});
  const artifact=before.artifacts.find(a=>a.revisions[0].path==='source/script.md')!;
  const reference=before.artifacts.find(a=>a.revisions[0].path==='source/source-material.md')!;
  const client=createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat',stream:true,temperature:0,thinkingBudget:0});
  const tool=createArtifactMethodTools(new PipelineRunner({client,model:'fixture',projectRoot:root}),root,'script')[1];
  await expect(tool.execute('invalid',{artifactId:artifact.id,instruction:'Change action',editRanges:[{startLine:3,endLine:8}]})).rejects.toMatchObject({code:'ARTIFACT_EDIT_RANGE_INVALID'});
  expect(calls).toBe(0);
  const page = (await createReadTool(root,{workId:'script'}).execute('read',{artifactId:artifact.id,startLine:3})).details as {startLine:number;endLine:number;totalLines:number};
  expect(page).toMatchObject({startLine:3,endLine:4,totalLines:4});
  const changed = await tool.execute('edit',{artifactId:artifact.id,instruction:'Change action only',editRanges:[{startLine:page.startLine,endLine:page.endLine}]});
  const request=JSON.parse(requests[0]!.messages.find(message=>message.role==='user')!.content);
  expect(request.references).toEqual([{sourceId:reference.id,content:material}]);
  expect(await readFile(join(root,'works/script/source/script.md'),'utf8')).toBe('First scene: "Keep this."\r\n\r\nChanged action.\nLast scene remains.\n');
  expect(await readFile(join(root,'works/script',artifact.revisions[0].snapshotPath!),'utf8')).toBe(source);
  expect((await loadWorkManifest(root,'script')).artifacts.find(a=>a.id===artifact.id)!.revisions).toHaveLength(2);
  const facts=actionResultFacts(changed.details);
  const after=await loadWorkManifest(root,'script');
  expect(after.artifacts.find(a=>a.id===reference.id)).toEqual(reference);
  expect(facts.revisionId).toBe(after.artifacts.find(a=>a.id===artifact.id)!.currentRevisionId);
  const region=facts.changedRegion as {before:{startLine:number;lineCount:number;content:string;truncated:boolean};after:{startLine:number;lineCount:number;content:string;truncated:boolean}};
  expect(region.before.truncated || region.after.truncated).toBe(false);
  const originalLines=splitSourceLines(source);
  expect(region.before.content).toBe(originalLines.slice(region.before.startLine-1,region.before.startLine-1+region.before.lineCount).join(''));
  const reconstructed=originalLines.slice(0,region.before.startLine-1).join('')+region.after.content+originalLines.slice(region.before.startLine-1+region.before.lineCount).join('');
  expect(reconstructed).toBe(await readFile(join(root,'works/script/source/script.md'),'utf8'));
 }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await rm(root,{recursive:true,force:true});}
},15000);
