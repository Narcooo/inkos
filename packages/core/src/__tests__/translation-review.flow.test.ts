import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {createLLMClient} from '../llm/provider.js';
import {createLLMTranslationModel,createTranslationProjectFromFile,runTranslationProject} from '../translation/index.js';
import {loadTranslationChapter,loadTranslationManifest,saveTranslationProgress} from '../translation/run-store.js';
import {syncWorkSourceArtifacts} from '../harness/source-sync.js';
import {loadWorkManifest} from '../harness/work-store.js';
import {createBuiltInWorkProfileRegistry} from '../harness/builtin-profiles.js';
import {withExecutionEvidence} from '../harness/execution-evidence.js';
import {loadAvailableAgentSkills} from '../skills/builtin-loader.js';

it('reads originals independently, persists only verified source pairs and retains the accepted translation when review fails',async()=>{
  const root=await mkdtemp(join(tmpdir(),'inkos-translation-review-'));
  const originals=['她借给弟弟八十元。','她把收据放进抽屉。'];
  const targets=['Her younger brother lent her eighty yuan.','She put the receipt in the drawer.'];
  const references=['She lent eighty yuan to her younger brother.','She placed the receipt in the drawer.'];
  const calls:any[]=[];let referenceFails=false,reviewTurns=0;
  const finding={code:'LENDING_DIRECTION',assessment:'issue',category:'quality',summary:'The translation reverses the lender and borrower.'};
  const originalRef={sourceId:'original-1',startLine:1,endLine:1};
  const targetRef={sourceId:'target-1',startLine:1,endLine:1};
  const server=createServer(async(req,res)=>{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
    const body=JSON.parse(Buffer.concat(chunks).toString());calls.push(body);
    let name=body.tools[0].function.name,args:unknown;
    if(name==='submit_translation_source_reading')args={segment_1_target:referenceFails?' ':references[0],segment_2_target:references[1]};
    else{
      reviewTurns++;
      if(reviewTurns===1){name='record_review_observation';args={...finding,sourceRefs:[originalRef]};}
      else if(reviewTurns===2){name='record_review_observation';args={...finding,sourceRefs:[originalRef,{...targetRef,sourceId:'reference-1'}]};}
      else if(reviewTurns===3){name='record_review_observation';args={...finding,sourceRefs:[originalRef,targetRef]};}
      else args={summary:'The source and target differ in transaction direction.',observationCodes:[finding.code]};
    }
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'review-'+calls.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]}));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const created=await createTranslationProjectFromFile(root,{sourceText:'# 归还\n\n'+originals.join('\n\n'),sourceLanguage:'zh',targetLanguage:'en'});
    const info=created.manifest.chapters[0]!;
    const source=await loadTranslationChapter(root,info.sourcePath);
    const translated={...source,title:'Return',segments:source.segments.map((segment,index)=>({...segment,target:targets[index]}))};
    await saveTranslationProgress(root,created.manifest.id,info.translatedPath,translated,[]);
    await syncWorkSourceArtifacts({projectRoot:root,workId:created.manifest.id,accept:true});
    const before=await readFile(join(root,info.translatedPath));
    const sourceBefore=await readFile(join(root,info.sourcePath));
    const client=createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat',stream:false,thinkingBudget:0});
    const model=createLLMTranslationModel({client,model:'fixture',projectRoot:root});
    const profile=createBuiltInWorkProfileRegistry(root).require('translation');
    const work=await loadWorkManifest(root,created.manifest.id);
    const skill=(await loadAvailableAgentSkills({projectRoot:root})).skills.find(skill=>skill.id==='inkos-translation')!;
    const skillHash=createHash('sha256').update(skill.body).digest('hex');
    const methods:Array<{worker:string;skills:Array<{id:string;hash:string}>}>=[];
    const review=()=>withExecutionEvidence((type,payload)=>{
      if(type==='skills-applied')methods.push(payload as typeof methods[number]);
    },()=>runTranslationProject(root,created.manifest.id,{model}),profile,work,'Review the current translation without changing it.');
    const result=await review();
    expect(result).toMatchObject({translatedSegments:0,reviewedChapters:1,pendingSegments:0});
    expect(methods).toHaveLength(2);
    expect(methods.every(method=>method.skills.some(skill=>skill.id==='inkos-translation'&&skill.hash===skillHash))).toBe(true);
    // Verify the loaded asset reaches the actual provider payload, beyond the
    // activation receipt. This compares the complete method, not sample prose.
    expect(calls.every(call=>call.messages.some((message:any)=>message.role==='system'&&message.content.includes(skill.body.trim())))).toBe(true);
    const reading=JSON.parse(calls[0].messages.findLast((message:any)=>message.role==='user').content);
    expect(reading).toMatchObject({chapterTitle:source.title,originals:source.segments.map(({index,source})=>({index,source})),requestedIndices:[1,2]});
    expect(calls[0].messages.every((message:any)=>targets.every(target=>!message.content.includes(target)))).toBe(true);
    expect(Object.keys(calls[0].tools[0].function.parameters.properties)).toEqual(['segment_1_target','segment_2_target']);
    const toolResults=calls.at(-1).messages.filter((message:any)=>message.role==='tool').map((message:any)=>JSON.parse(message.content));
    expect(toolResults.map((result:any)=>result.code)).toEqual(['TRANSLATION_REVIEW_PAIR_REQUIRED','REVIEW_SOURCE_RANGE_INVALID',finding.code]);
    const sourceRefs=[{sourceId:'original-1',quote:originals[0]},{sourceId:'target-1',quote:targets[0]}];
    expect(result.observations).toMatchObject([{...finding,sourceRefs,targetHash:'sha256:'+createHash('sha256').update(before).digest('hex')}]);
    const manifest=await loadTranslationManifest(root,created.manifest.id);
    expect(manifest.chapters[0]!.observations?.[0]?.sourceRefs).toEqual(sourceRefs);
    const report=await readFile(join(root,result.reportPath),'utf8');
    for(const {quote} of sourceRefs)expect(report).toContain(quote);
    for(const reference of references)expect(report).not.toContain(reference);
    expect(await readFile(join(root,info.translatedPath))).toEqual(before);
    expect(await readFile(join(root,info.sourcePath))).toEqual(sourceBefore);

    referenceFails=true;
    await expect(review()).rejects.toMatchObject({code:'TRANSLATION_TARGET_EMPTY'});
    expect(calls.filter(call=>call.tools[0].function.name==='submit_translation_source_reading')).toHaveLength(4);
    expect(await readFile(join(root,result.reportPath),'utf8')).toBe(report);
    expect(await readFile(join(root,info.translatedPath))).toEqual(before);
    expect(await readFile(join(root,info.sourcePath))).toEqual(sourceBefore);
  }finally{
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
    await rm(root,{recursive:true,force:true});
  }
},20000);
