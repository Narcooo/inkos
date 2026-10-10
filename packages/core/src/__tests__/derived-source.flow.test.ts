import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorkManifest,saveWorkManifest,loadWorkManifest} from '../harness/work-store.js';
import {syncWorkSourceArtifacts} from '../harness/source-sync.js';
import {createFanficBookTool,createImitationBookTool,createProposeActionTool} from '../agent/agent-tools.js';
import {loadCreationSource} from '../agent/creation-source.js';
import {createLLMClient} from '../llm/provider.js';
import {PipelineRunner} from '../pipeline/runner.js';
import {withExecutionEvidence} from '../harness/execution-evidence.js';
import {createTranslationCreateTool} from '../harness/tools/translation.js';

it('pins registered creation sources before producer failure and resumes the same source after the parent changes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'inkos-derived-source-'));let calls=0;
 const server=createServer((_req,res)=>{calls++;res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'Fixture unavailable'}}));});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  await saveWorkManifest(root,createWorkManifest({id:'parent',title:'Gallery',profileId:'longform-novel',language:'en'}));
  await mkdir(join(root,'works/parent/source'),{recursive:true});
  const original='Nora returns the blue notebook to Eli.\n';
  const later='Eli is the curator. She stores the notebook in her office.\n';
  const parent=await syncWorkSourceArtifacts({projectRoot:root,workId:'parent',accept:true,writes:[{relativePath:'works/parent/source/manuscript.md',content:original},{relativePath:'works/parent/source/second.md',content:later}]});
  const artifact=parent.artifacts.find(a=>a.revisions.some(r=>r.path==='source/manuscript.md'))!;
  const second=parent.artifacts.find(a=>a.revisions.some(r=>r.path==='source/second.md'))!;
  await writeFile(join(root,'works/parent/source/manuscript.md'),'Unaccepted working copy.');
  const client=createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat',stream:false,temperature:0,thinkingBudget:0});
  const pipeline=new PipelineRunner({projectRoot:root,client,model:'fixture'});
  const fanfic=createFanficBookTool(pipeline,root),imitation=createImitationBookTool(pipeline,root);
  const source={workId:'parent',artifactId:artifact.id};
  const sources=[source,{workId:'parent',artifactId:second.id}];
  const proposed=await createProposeActionTool('en',{attachmentPaths:()=>['.inkos/uploads/unrelated.txt']}).execute('proposal',{action:'fanfic_init',title:'Parallel story',summary:'Use both source chapters.',instruction:'Create the requested story.',fanficCreate:{title:'parallel',sources,language:'en'}});
  expect(proposed.details).toMatchObject({actionPayload:{fanficCreate:{sources}}});
  expect((proposed.details as {actionPayload:{fanficCreate:unknown}}).actionPayload.fanficCreate).not.toHaveProperty('sourcePath');
  await expect(fanfic.execute('fan',{title:'parallel',sources,language:'en'})).rejects.toThrow();
  await expect(imitation.execute('style',{title:'style',referencePath:'works/parent/source/manuscript.md',storyIdea:'An original workshop story.',language:'en'})).rejects.toThrow();
  for(const id of ['parallel','style']){
   const work=await loadWorkManifest(root,id);
   expect(work.status).toBe('draft');
   expect(work.lineage).toEqual((id==='parallel'?[artifact,second]:[artifact]).map(a=>({relation:'derived-from',sourceWorkId:'parent',sourceArtifactId:a.id,sourceRevisionId:a.currentRevisionId})));
   expect(await readFile(join(root,'works',id,'source/source-material.md'),'utf8')).toBe(id==='parallel'?[original,later].join('\n\n'):original);
  }
  const canon=await readFile(join(root,'works/parallel/source/story/fanfic_canon.md'),'utf8');
  expect(canon.endsWith([original,later].join('\n\n'))).toBe(true);
  const updated=await syncWorkSourceArtifacts({projectRoot:root,workId:'parent',accept:true,writes:[{relativePath:'works/parent/source/manuscript.md',content:'Eli returns the red map.\n'}]});
  await expect(fanfic.execute('resume',{title:'parallel',sources,language:'en'})).rejects.toThrow();
  expect(await readFile(join(root,'works/parallel/source/source-material.md'),'utf8')).toBe([original,later].join('\n\n'));
  const beforeConflict=calls;
  await expect(fanfic.execute('changed',{title:'parallel',sources:[{...source,revisionId:updated.artifacts.find(a=>a.id===artifact.id)!.currentRevisionId!},sources[1]!],language:'en'})).rejects.toMatchObject({code:'CREATION_SOURCE_CONFLICT'});
  await expect(fanfic.execute('missing-source',{title:'parallel',sources:[sources[0]!],language:'en'})).rejects.toMatchObject({code:'CREATION_SOURCE_CONFLICT'});
  expect(calls).toBe(beforeConflict);
  await expect(withExecutionEvidence(()=>{},()=>loadCreationSource({projectRoot:root,sourceText:'An invented summary.',purpose:'reference'}),undefined,undefined,'Create a parallel story from the registered Gallery work.')).rejects.toMatchObject({code:'SOURCE_REFERENCE_REQUIRED'});
  await expect(withExecutionEvidence(()=>{},()=>loadCreationSource({projectRoot:root,sourceText:original,purpose:'reference'}),undefined,undefined,'Use this supplied source:\n'+original)).resolves.toMatchObject({text:original.trim(),lineage:[]});
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
},30000);

it('imports translation chapters from pinned references and rejects agent-retyped substitutes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'inkos-translation-source-'));
 try{
  await saveWorkManifest(root,createWorkManifest({id:'parent',title:'Gallery',profileId:'longform-novel',language:'en'}));
  await mkdir(join(root,'works/parent/source'),{recursive:true});
  const prose=['# Chapter 1\n\nNora returns the blue notebook.\n','# Chapter 2\n\nEli stores it in her office.\n'];
  const parent=await syncWorkSourceArtifacts({projectRoot:root,workId:'parent',accept:true,writes:prose.map((content,i)=>({relativePath:`works/parent/source/chapter-${i+1}.md`,content}))});
  const sources=parent.artifacts.map(a=>({workId:parent.id,artifactId:a.id,revisionId:a.currentRevisionId!}));
  await writeFile(join(root,'works/parent/source/chapter-1.md'),'Unaccepted working copy.');
  const params={sources,sourceLanguage:'English',targetLanguage:'Chinese',title:'Translated gallery'};
  const proposal=await createProposeActionTool('en',{attachmentPaths:()=>['.inkos/uploads/unrelated.txt']}).execute('proposal',{action:'translation_create',title:'Translation',summary:'Translate the two registered chapters.',instruction:'Translate the source.',translationCreate:params});
  expect(proposal.details).toMatchObject({actionPayload:{translationCreate:params}});
  expect((proposal.details as {actionPayload:{translationCreate:unknown}}).actionPayload.translationCreate).not.toHaveProperty('filePath');
  const tool=createTranslationCreateTool(root),authorRequest='Translate the two registered Gallery chapters.';
  await expect(withExecutionEvidence(()=>{},()=>tool.execute('substitute',{...params,sources:undefined,sourceText:prose.join('\n\n')}),undefined,undefined,authorRequest)).rejects.toMatchObject({code:'SOURCE_REFERENCE_REQUIRED'});
  const result=await withExecutionEvidence(()=>{},()=>tool.execute('create',params),undefined,undefined,authorRequest);
  const id=(result.details as {workId:string}).workId,work=await loadWorkManifest(root,id);
  expect(work.lineage).toEqual(sources.map(s=>({relation:'derived-from',sourceWorkId:s.workId,sourceArtifactId:s.artifactId,sourceRevisionId:s.revisionId})));
  expect(work.metadata?.sourceOrigin).toBe('work');
  expect(await readFile(join(root,'works',id,'source/source-input.md'),'utf8')).toBe(prose.join('\n\n'));
  const sourceChapters=await Promise.all([1,2].map(n=>readFile(join(root,'works',id,`source/source/chapter-${String(n).padStart(4,'0')}.json`),'utf8').then(JSON.parse)));
  expect(sourceChapters.map(c=>c.segments.map((s:{source:string})=>s.source).join('\n'))).toEqual(['Nora returns the blue notebook.','Eli stores it in her office.']);
  const pathResult=await tool.execute('path',{filePath:'works/parent/source/chapter-1.md',sourceLanguage:'English',targetLanguage:'Chinese',title:'Path translation'});
  expect((await loadWorkManifest(root,(pathResult.details as {workId:string}).workId)).lineage).toEqual(work.lineage.slice(0,1));
  await syncWorkSourceArtifacts({projectRoot:root,workId:'parent',accept:true,writes:[{relativePath:'works/parent/source/chapter-1.md',content:'Nora keeps the notebook.'}]});
  expect(await readFile(join(root,'works',id,'source/source-input.md'),'utf8')).toBe(prose.join('\n\n'));
  expect((await loadWorkManifest(root,id)).lineage).toEqual(work.lineage);
 }finally{await rm(root,{recursive:true,force:true});}
});

it('projects side-story canon from accepted snapshots and keeps its reference set stable on resume',async()=>{
 const root=await mkdtemp(join(tmpdir(),'inkos-parent-canon-'));
 try{
  await saveWorkManifest(root,createWorkManifest({id:'parent',title:'Gallery',profileId:'longform-novel',language:'en'}));
  await saveWorkManifest(root,createWorkManifest({id:'child',title:'After closing',profileId:'longform-novel',language:'en'}));
  await mkdir(join(root,'works/parent/source'),{recursive:true});
  await mkdir(join(root,'works/child/source'),{recursive:true});
  const files={'story/outline/story_frame.md':'The gallery closes.','story/outline/volume_map.md':'One evening.','story/book_rules.md':'Nora runs the gallery.','story/roles/major/nora.md':'Nora keeps her own notebook.','story/current_state.md':'The borrowed blue map is with Eli.','story/pending_hooks.md':'Eli may return.','story/chapter_summaries.md':'Nora returned the map.','story/style_guide.md':'Use direct dialogue.'};
  const parent=await syncWorkSourceArtifacts({projectRoot:root,workId:'parent',accept:true,writes:Object.entries(files).map(([path,content])=>({relativePath:'works/parent/source/'+path,content}))});
  await syncWorkSourceArtifacts({projectRoot:root,workId:'parent',accept:false,writes:[{relativePath:'works/parent/source/story/current_state.md',content:'Unaccepted reversal.'}]});
  const pipeline=new PipelineRunner({projectRoot:root,client:{} as never,model:'unused'});
  const canon=await pipeline.importCanon('child','parent');
  const child=await loadWorkManifest(root,'child');
  expect(child.status).toBe('draft');
  expect(child.lineage).toEqual(parent.artifacts.map(a=>({relation:'derived-from',sourceWorkId:'parent',sourceArtifactId:a.id,sourceRevisionId:a.currentRevisionId})));
  expect(canon).toContain(files['story/current_state.md']);
  expect(canon).not.toContain('Unaccepted reversal.');
  expect(await readFile(join(root,'works/child/source/story/style_guide.md'),'utf8')).toBe(files['story/style_guide.md']);
  await syncWorkSourceArtifacts({projectRoot:root,workId:'parent',accept:true,writes:[{relativePath:'works/parent/source/story/current_state.md',content:'The map has now returned to Nora.'}]});
  expect(await pipeline.importCanon('child','parent')).toBe(canon);
  expect((await loadWorkManifest(root,'child')).lineage).toEqual(child.lineage);
 }finally{await rm(root,{recursive:true,force:true});}
});
