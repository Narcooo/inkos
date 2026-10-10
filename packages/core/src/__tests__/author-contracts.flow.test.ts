import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createLLMClient} from '../llm/provider.js';
import {createWorkManifest,saveWorkManifest,loadWorkManifest} from '../harness/work-store.js';
import {syncWorkSourceArtifacts} from '../harness/source-sync.js';
import {createBuiltInWorkProfileRegistry} from '../harness/builtin-profiles.js';
import {createReplaceWorkArtifactTool,createExportWorkTool,createAdoptWorkRevisionTool} from '../harness/tools/work-artifacts.js';
import {reviseShortFictionProduction} from '../pipeline/short-fiction-runner.js';
import {withExecutionEvidence} from '../harness/execution-evidence.js';

it('revises an opening and selected chapter, then applies an author-requested chapter reduction while retaining historical prose',async()=>{
  const root=await mkdtemp(join(tmpdir(),'inkos-author-contract-'));
  let planNumber=0;
  let stage:'opening'|'mixed'|'structure'='opening';
  const calls:string[]=[];
  const server=createServer(async(request,response)=>{
    const chunks:Buffer[]=[];for await(const chunk of request)chunks.push(Buffer.from(chunk));
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const name=body.tools[0].function.name;calls.push(name);
    const result=name==='submit_short_revision_plan'
      ? (++planNumber,stage==='opening'
        ? {revisionBrief:'Change the independent opening only.',openingHook:'A pair of cups waited by the door.',...(planNumber===1?{chapter_1_instruction:'Change the first scene too.'}:{})}
        :stage==='mixed'?{revisionBrief:'Change the opening and second scene.',openingHook:'Two cups stood beside a folded letter.',chapter_2_instruction:'Let the customer leave the letter.'}
        :{revisionBrief:'Retain the first and last scenes.',outlineMarkdown:'The stall opens, then closes.',chapter_2_sourceNumber:3})
      :name==='submit_short_author_scope'?{wholeManuscript:false,chapterNumbers:[2],opening:true,outline:false}
      :name==='submit_short_revision_chapter'?{title:'Scene 2',content:Array(34).fill('revised').join(' ')}
      :name==='submit_short_fiction_review'||name==='submit_short_package_review'?{summary:'Reviewed the supplied scope.',observationCodes:[]}
        :name==='submit_short_package'?{title:'The Tea Stall',intro:'A day at the stall.',sellingPoints:['A small act of care'],coverPrompt:'Two cups at a neighborhood stall.'}:undefined;
    response.writeHead(result?200:400,{'Content-Type':'application/json'});
    response.end(JSON.stringify(result?{choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:name+calls.length,type:'function',function:{name,arguments:JSON.stringify(result)}}]}}]}:{error:{message:'Unexpected worker operation'}}));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const base=join(root,'works/tea/source');await mkdir(base,{recursive:true});
    await saveWorkManifest(root,createWorkManifest({id:'tea',title:'The Tea Stall',profileId:'short-fiction',language:'en'}));
    const draft={storyTitle:'The Tea Stall',openingHook:'The stall opened early.',rawContent:'',chapters:[1,2,3].map(number=>({number,title:'Scene '+number,content:Array(34).fill('word').join(' '),charCount:34}))};
    await syncWorkSourceArtifacts({projectRoot:root,workId:'tea',accept:true,writes:[
      {relativePath:'works/tea/source/outline/v001.md',content:'The stall opens, serves customers, then closes.'},
      {relativePath:'works/tea/source/final/short-story.json',content:JSON.stringify(draft)},
      ...draft.chapters.map(chapter=>({relativePath:`works/tea/source/final/chapters/${String(chapter.number).padStart(4,'0')}.md`,content:chapter.content})),
      {relativePath:'works/tea/source/production-state.json',content:JSON.stringify({version:2,intent:'A quiet day at a tea stall.',target:{chapterCount:3,charsPerChapter:40,language:'en'},stages:{}})},
    ]});
    const original=await loadWorkManifest(root,'tea');
    const client=createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat',stream:false,temperature:0,thinkingBudget:0});
    const runtime={client,model:'fixture',projectRoot:root};
    const options={projectRoot:root,storyId:'tea',direction:'Change only the independent opening.',revisionChapterNumbers:[] as number[],cover:false,runtimes:{planner:runtime,writer:runtime,draftReview:runtime,package:runtime}};
    const first=await reviseShortFictionProduction(options);
    const openingRevision=JSON.parse(await readFile(join(base,'final/short-story.json'),'utf8'));
    expect(openingRevision.chapters).toEqual(draft.chapters);
    expect(openingRevision.openingHook).not.toBe(draft.openingHook);
    expect(first.delivery?.status).toBe('checks_passed');
    expect(createBuiltInWorkProfileRegistry().require('short-fiction').production.minChapterLengthRatio).toBeUndefined();
    stage='mixed';
    const mixedRequest='Revise only the independent opening and chapter 2. Preserve all other chapters and the outline.';
    await withExecutionEvidence(()=>{},()=>reviseShortFictionProduction({...options,revisionChapterNumbers:undefined,direction:mixedRequest}),undefined,await loadWorkManifest(root,'tea'),mixedRequest);
    const mixed=JSON.parse(await readFile(join(base,'final/short-story.json'),'utf8'));
    expect(mixed.openingHook).not.toBe(openingRevision.openingHook);
    expect(mixed.chapters[1]).not.toEqual(draft.chapters[1]);
    expect([mixed.chapters[0],mixed.chapters[2]]).toEqual([draft.chapters[0],draft.chapters[2]]);
    stage='structure';
    await reviseShortFictionProduction({...options,revisionChapterNumbers:undefined,chapterCount:2,direction:'Remove the middle scene. Keep original scenes one and three unchanged.'});
    const reduced=JSON.parse(await readFile(join(base,'final/short-story.json'),'utf8'));
    expect(reduced.chapters).toEqual([draft.chapters[0],{...draft.chapters[2],number:2}]);
    expect(reduced.openingHook).toBe(mixed.openingHook);
    expect(await readdir(join(base,'final/chapters'))).toEqual(['0001.md','0002.md']);
    expect(JSON.parse(await readFile(join(base,'production-state.json'),'utf8')).target.chapterCount).toBe(2);
    const after=await loadWorkManifest(root,'tea');
    const removed=after.artifacts.find(a=>a.revisions.some(r=>r.path==='source/final/chapters/0003.md'))!;
    expect(removed.currentRevisionId).toBeNull();
    const originalManuscript=original.artifacts.find(a=>a.revisions.some(r=>r.path==='source/final/short-story.json'))!;
    const previous=after.artifacts.find(a=>a.id===originalManuscript.id)!.revisions.find(r=>r.id===originalManuscript.currentRevisionId)!;
    expect(createHash('sha256').update(await readFile(join(root,'works/tea',previous.snapshotPath!))).digest('hex')).toBe(previous.checksum.slice(7));
    expect(calls.filter(name=>name==='submit_short_revision_chapter')).toHaveLength(1);
    expect(planNumber).toBe(4);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
},20000);

it('allows an independent script edit and export in a composed Work while preserving managed domain state',async()=>{
  const root=await mkdtemp(join(tmpdir(),'inkos-composed-edit-'));
  try{
    await mkdir(join(root,'.inkos/profiles'),{recursive:true});
    await mkdir(join(root,'works/hybrid/source'),{recursive:true});
    const profile={...createBuiltInWorkProfileRegistry().require('script'),id:'hybrid',capabilityIds:['workspace','script','longform','interactive-world']};
    await writeFile(join(root,'.inkos/profiles/hybrid.json'),JSON.stringify(profile));
    await saveWorkManifest(root,createWorkManifest({id:'hybrid',title:'Hybrid',profileId:'hybrid',language:'en'}));
    const state=JSON.stringify({id:'hybrid'});
    await syncWorkSourceArtifacts({projectRoot:root,workId:'hybrid',accept:true,writes:[
      {relativePath:'works/hybrid/source/script.md',content:'Mara puts the bowl down.'},
      {relativePath:'works/hybrid/source/book.json',content:state},
      {relativePath:'works/hybrid/source/runs/main/state/current.json',content:state},
      {relativePath:'works/hybrid/source/runs/main/state/opaque.bin',content:Buffer.from([1,2,3])},
    ]});
    const tool=createReplaceWorkArtifactTool(root,'hybrid');
    for(const path of ['source/book.json','source/runs/main/state/current.json'])await expect(tool.execute('protected',{path,content:'{}'})).rejects.toMatchObject({code:'ARTIFACT_DOMAIN_ACTION_REQUIRED'});
    const saved=await loadWorkManifest(root,'hybrid');
    const binary=saved.artifacts.find(a=>a.revisions.some(r=>r.path.endsWith('/opaque.bin')))!;
    await expect(createAdoptWorkRevisionTool(root,'hybrid').execute('restore',{artifactId:binary.id,revisionId:binary.currentRevisionId!,expectedCurrentRevisionId:binary.currentRevisionId})).rejects.toMatchObject({code:'ARTIFACT_DOMAIN_ACTION_REQUIRED'});
    const content='Mara sets the bowl beside the vase.';
    const result=await tool.execute('edit',{path:'source/script.md',content});
    const details=result.details as {artifactId:string;revisionId:string};
    const exported=await createExportWorkTool(root,'hybrid').execute('export',{artifactId:details.artifactId,expectedRevisionId:details.revisionId});
    const exportedPath=(exported.details as {path:string}).path;
    expect(await readFile(join(root,'works/hybrid',exportedPath),'utf8')).toBe(content);
    expect(await readFile(join(root,'works/hybrid/source/book.json'),'utf8')).toBe(state);
    expect(await readFile(join(root,'works/hybrid/source/runs/main/state/current.json'),'utf8')).toBe(state);
  }finally{await rm(root,{recursive:true,force:true});}
},15000);
