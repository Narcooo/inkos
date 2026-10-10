import {createServer} from 'node:http';import {once} from 'node:events';import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {it,expect} from 'vitest';
import {createWorkManifest,saveWorkManifest} from '../harness/work-store.js';import {syncWorkSourceArtifacts} from '../harness/source-sync.js';import {createLLMClient} from '../llm/provider.js';import {PipelineRunner} from '../pipeline/runner.js';import {createArtifactMethodTools} from '../harness/tools/artifact-methods.js';import {executeExplicitCapabilityTool} from '../harness/explicit-action.js';
import {scriptDialogueScopeRequest} from '../agents/script-edit-scope.js';
import {authorTextScopeContract} from '../agents/author-edit-scope.js';

it.each(['plain','bold-name','bold-colon'])('maps %s speech to exact source bytes while preserving cast, cues and earlier exchanges',format=>{
 const source='# Late close\n\n## Cast\n\n**Mara**（45）\nCleaner.\n\n**Noah**（28）\nTicket clerk.\n\n## Script\n\n**First scene**\n\nNoah: We should go.\n\n**Final scene**\n\nMara: Can you stay?\nNoah：（puts the note away）Maybe.\n\nThey leave together.\n'.replace(/^(Mara|Noah)([:：])/gmu,(_match,name,colon)=>format==='bold-name'?`**${name}**${colon}`:format==='bold-colon'?`**${name}${colon}**`:name+colon);
 const request=scriptDialogueScopeRequest(source,'Change only the ticket clerk’s final spoken response; preserve all other text.');
 expect(request).toBeDefined();
 const indexed=JSON.parse(request!.messages[1]!.content);
 expect(indexed.cast.map((c:any)=>({id:c.id,name:c.name}))).toEqual([{id:'speaker-1',name:'Mara'},{id:'speaker-2',name:'Noah'}]);
 const speeches=indexed.sourceUnits.filter((unit:any)=>unit.kind==='dialogue'&&unit.speakerId==='speaker-2');
 expect(speeches).toHaveLength(2);
 expect(speeches[1].speechBlock).toBeGreaterThan(speeches[0].speechBlock);
 const last=speeches[1],selection={wholeDocument:false,speakerIds:['speaker-2'],dialoguePosition:null,selections:[{unitId:last.id,text:''}],reason:'The final clerk response.'};
 const scope=request!.toAuthorScope(selection),contract=authorTextScopeContract(source,scope);
 expect(scope.selections[0]!.unitId).toBe(last.sourceUnitId);
 expect(contract.apply({selection_0_text:'I will wait with you.'})).toBe(source.replace('Maybe.','I will wait with you.'));
 const label=indexed.sourceUnits.find((unit:any)=>unit.kind==='speaker_label'&&unit.sourceUnitId===last.sourceUnitId);
 expect(()=>request!.tool.validate({...selection,selections:[{unitId:last.id,text:label.text+last.text}]})).toThrow(expect.objectContaining({code:'SCRIPT_SCOPE_SEGMENT_INVALID'}));
 const positional={...selection,selections:[],dialoguePosition:{scene:last.scene,position:'last' as const,unit:'exchange' as const}};
 expect(request!.toAuthorScope(positional)).toEqual(scope);
 expect(()=>request!.tool.validate({...positional,selections:selection.selections})).toThrow(expect.objectContaining({code:'SCRIPT_SCOPE_POSITION_INVALID'}));
});

it.each([
 {format:'inline',cast:'**Mara** Cleaner.\n\n**Noah** Ticket clerk.'},
 {format:'multiline',cast:'## 人物\n\n**Mara**\nCleaner.\n\n**Noah**\nTicket clerk.\n\n## 剧本正文'},
 {format:'separate paragraphs',cast:'## Cast\n\n**Mara**\n\nCleaner.\n\n**Noah**\n\nTicket clerk.\n\n## Script'},
 {format:'separate speaker with inline cue',cast:'## Cast\n\n**Mara**\nCleaner.\n\n**Noah**\nTicket clerk.\n\n## Script',inlineCue:true},
])('binds a requested speaker to speech lines and protects $format cast and stage directions',async({cast,inlineCue=false})=>{
 const root=await mkdtemp(join(tmpdir(),'inkos-script-dialogue-')),requests:any[]=[];let selections=0;
 const original=`# Late close\n\n${cast}\n\n**Final scene**\n\nMara puts down the bucket.\n\n**MARA**\n(quietly)${inlineCue?'':'\n'}Let us go.\n\n**NOAH**\n(puts the note away)${inlineCue?'':'\n'}All right.\n\nThey leave together.\n`;
 const server=createServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body);
  const name=body.tools[0].function.name,scope=name==='submit_script_edit_scope'?JSON.parse(body.messages.find((m:any)=>m.role==='user').content):undefined;
  const selectedSpeaker=scope&&++selections===1?'speaker-1':'speaker-2';
  const args=scope
   ?{wholeDocument:false,speakerIds:['speaker-2'],dialoguePosition:null,selections:[{unitId:scope.sourceUnits.find((unit:any)=>unit.kind==='dialogue'&&unit.speakerId===selectedSpeaker)?.id,text:''}],reason:'Only the requested clerk speech.'}
   :{selection_0_text:'I will register the box first.'+(inlineCue?'':'\n')};
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'dialogue-'+requests.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]}));
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  await saveWorkManifest(root,createWorkManifest({id:'gallery',profileId:'script',title:'Gallery',language:'en'}));await mkdir(join(root,'works/gallery/source'),{recursive:true});
  const work=await syncWorkSourceArtifacts({projectRoot:root,workId:'gallery',accept:true,writes:[{relativePath:'works/gallery/source/script.md',content:original}]});
  const llm={service:'custom',provider:'openai' as const,configSource:'studio' as const,model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat' as const,stream:false,thinkingBudget:0,maxTokens:8192};
  const pipeline=new PipelineRunner({projectRoot:root,client:createLLMClient(llm),model:'fixture',defaultLLMConfig:llm});
  const edited=await executeExplicitCapabilityTool({projectRoot:root,workId:'gallery',authorRequest:'Change only the ticket clerk’s final speech to express a concrete choice. Preserve all stage directions.',binding:{capabilityId:'workspace',actionId:'revise_work_artifact',profileId:'script',risk:'recoverable-write'},tool:createArtifactMethodTools(pipeline,root,'gallery')[1]!,parameters:{artifactId:work.artifacts[0]!.id,instruction:'Rewrite Mara’s closing scene, including her actions.'}});
  expect(requests.map(r=>r.tools[0].function.name)).toEqual(['submit_script_edit_scope','submit_script_edit_scope','submit_artifact_revision']);
  expect(JSON.parse(requests[1].messages.find((m:any)=>m.role==='tool').content)).toMatchObject({code:'SCRIPT_SCOPE_SPEAKER_MISMATCH'});
  const indexed=JSON.parse(requests[0].messages.find((m:any)=>m.role==='user').content);
  expect(indexed.cast).toMatchObject([{id:'speaker-1',name:'Mara',description:'Cleaner.'},{id:'speaker-2',name:'Noah',description:'Ticket clerk.'}]);
  const ending=inlineCue?'':'\n';
  expect(indexed.sourceUnits.filter((unit:any)=>unit.kind==='dialogue').map((unit:any)=>({speakerId:unit.speakerId,text:unit.text}))).toEqual([{speakerId:'speaker-1',text:'Let us go.'+ending},{speakerId:'speaker-2',text:'All right.'+ending}]);
  expect(edited.data).toMatchObject({editPermission:{basis:'original_author_request',selectedOriginalText:['All right.'+ending],surroundingText:'protected'}});
  expect(JSON.parse(requests.at(-1).messages.findLast((m:any)=>m.role==='user').content).revisionGuidance).toEqual({source:'coordinator',instruction:'Rewrite Mara’s closing scene, including her actions.',authority:'advice_within_author_scope'});
  expect(await readFile(join(root,'works/gallery/source/script.md'),'utf8')).toBe(original.replace('All right.','I will register the box first.'));
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
},20000);
it('locates author-authorized text before rewriting and preserves surrounding bytes despite an overbroad coordinator range',async()=>{
 const root=await mkdtemp(join(tmpdir(),'inkos-author-scope-')),requests:any[]=[];let replacements=0;
 const server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));requests.push(body);const name=body.tools[0].function.name,args=name==='submit_edit_location'?{kind:'reference',boundary:'none',count:0,target:'Only Mara’s final spoken response, preserving all surrounding stage directions.'}:name==='submit_author_edit_scope'?{wholeDocument:false,selections:[{unitId:'p2.l1',text:'Maybe.'}],reason:'The final speech line is between protected stage directions.'}:{selection_0_text:++replacements===1?'I will stay.\nNOAH: An unauthorized extra line.':'I will stay.'};res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'scope-'+requests.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]}));});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const original='The gallery is open.\n\nMARA (facing the window): Maybe.\nNOAH: Maybe.\n\nShe closes the door.\n',authorRequest='Change only Mara’s final spoken response. Preserve both stage directions.';
  await saveWorkManifest(root,createWorkManifest({id:'gallery',profileId:'script',title:'Gallery',language:'en'}));await mkdir(join(root,'works/gallery/source'),{recursive:true});const work=await syncWorkSourceArtifacts({projectRoot:root,workId:'gallery',accept:true,writes:[{relativePath:'works/gallery/source/script.md',content:original}]});
  const llm={service:'custom',provider:'openai' as const,configSource:'studio' as const,model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat' as const,stream:false,temperature:0,thinkingBudget:0,maxTokens:8192};
  const pipeline=new PipelineRunner({projectRoot:root,client:createLLMClient(llm),model:'fixture',defaultLLMConfig:llm});
  await executeExplicitCapabilityTool({projectRoot:root,workId:'gallery',authorRequest,binding:{capabilityId:'workspace',actionId:'revise_work_artifact',profileId:'script',risk:'recoverable-write'},tool:createArtifactMethodTools(pipeline,root,'gallery')[1]!,parameters:{artifactId:work.artifacts[0]!.id,editRanges:[{startLine:1,endLine:5}],instruction:'Rewrite the entire closing passage to make her choice clear.'}});
  expect(requests.map(r=>r.tools[0].function.name)).toEqual(['submit_edit_location','submit_author_edit_scope','submit_artifact_revision','submit_artifact_revision']);
  expect(JSON.parse(requests[0].messages.findLast((m:any)=>m.role==='user').content).authorRequest).toBe(authorRequest);
  expect(JSON.parse(requests[2].messages.findLast((m:any)=>m.role==='user').content).editableSelections).toMatchObject([{startLine:3,endLine:3}]);
  expect(JSON.parse(requests[2].messages.findLast((m:any)=>m.role==='user').content)).toMatchObject({instruction:authorRequest});
  expect(await readFile(join(root,'works/gallery/source/script.md'),'utf8')).toBe('The gallery is open.\n\nMARA (facing the window): I will stay.\nNOAH: Maybe.\n\nShe closes the door.\n');
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
},20000);

it('retains review guidance for an authorized whole-document rewrite',async()=>{
 const root=await mkdtemp(join(tmpdir(),'inkos-whole-revision-')),requests:any[]=[];
 const original='Mara waits in the gallery.\n',revised='Mara locks the gallery and leaves.\n';
 const authorRequest='Revise the complete script using the professional review. Preserve Mara as the sole character.';
 const instruction='Replace the passive ending with Mara locking the gallery before leaving.';
 const server=createServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
  const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body);const name=body.tools[0].function.name;
  const args=name==='submit_edit_location'?{kind:'document',boundary:'none',count:0,target:''}:{range_0_content:revised};
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'whole-'+requests.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]}));
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  await saveWorkManifest(root,createWorkManifest({id:'gallery',profileId:'script',title:'Gallery',language:'en'}));await mkdir(join(root,'works/gallery/source'),{recursive:true});
  const work=await syncWorkSourceArtifacts({projectRoot:root,workId:'gallery',accept:true,writes:[{relativePath:'works/gallery/source/script.md',content:original}]});
  const llm={service:'custom',provider:'openai' as const,configSource:'studio' as const,model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat' as const,stream:false,thinkingBudget:0,maxTokens:8192};
  const pipeline=new PipelineRunner({projectRoot:root,client:createLLMClient(llm),model:'fixture',defaultLLMConfig:llm});
  await executeExplicitCapabilityTool({projectRoot:root,workId:'gallery',authorRequest,binding:{capabilityId:'workspace',actionId:'revise_work_artifact',profileId:'script',risk:'recoverable-write'},tool:createArtifactMethodTools(pipeline,root,'gallery')[1]!,parameters:{artifactId:work.artifacts[0]!.id,instruction}});
  expect(JSON.parse(requests[1].messages.findLast((m:any)=>m.role==='user').content)).toMatchObject({instruction,editableRanges:[{startLine:1,endLine:1}]});
  const authorContexts=requests[1].messages.flatMap((m:any)=>m.content.split('\n\n')).flatMap((block:string)=>{try{return [JSON.parse(block).authorRequest].filter(Boolean);}catch{return[];}});
  expect(authorContexts).toEqual([authorRequest]);
  expect(await readFile(join(root,'works/gallery/source/script.md'),'utf8')).toBe(revised);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
},15000);

it('retains the original final paragraph permission after committed prose expands into multiple paragraphs',async()=>{
 const {ReviserAgent}=await import('../agents/reviser.js');
 const {withExecutionEvidence}=await import('../harness/execution-evidence.js');
 const root=await mkdtemp(join(tmpdir(),'inkos-fixed-scope-')),requests:any[]=[];
 let revision=0;
 const server=createServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body);
  const name=body.tools[0].function.name,args=name==='submit_edit_location'
   ?{kind:'paragraphs',boundary:'last',count:1,target:''}
   :{selection_0_text:++revision===1?'She locks the door.\n\nThen pockets the key.':'She pockets the key and leaves.'};
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'fixed-'+requests.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]}));
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const original='The gallery closes at nine.\n\nMara puts the ledger beside the lamp.\n\nMaybe she should wait.';
  await saveWorkManifest(root,createWorkManifest({id:'gallery',profileId:'longform-novel',title:'Gallery',language:'en'}));
  await mkdir(join(root,'works/gallery/source'),{recursive:true});
  const baseline=await syncWorkSourceArtifacts({projectRoot:root,workId:'gallery',accept:true,writes:[{relativePath:'works/gallery/source/chapters/0001_Close.md',content:original}]});
  const client=createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat',stream:false,thinkingBudget:0});
  const authorRequest='Rewrite only the final paragraph into a concrete decision. Preserve every other paragraph.';
  const revise=(content:string)=>withExecutionEvidence(()=>{},()=>new ReviserAgent({client,model:'fixture',projectRoot:root}).reviseChapter(root,content,1,[],'rewrite',undefined,{language:'en',contextPackage:{chapter:1,selectedContext:[]}}),undefined,baseline,authorRequest,baseline);
  const first=await revise(original);
  await syncWorkSourceArtifacts({projectRoot:root,workId:'gallery',accept:true,writes:[{relativePath:'works/gallery/source/chapters/0001_Close.md',content:first.revisedContent}]});
  const second=await revise(first.revisedContent);
  expect(second.revisedContent).toBe(original.replace('Maybe she should wait.','She pockets the key and leaves.'));
  expect(requests.filter(r=>r.tools[0].function.name==='submit_edit_location')).toHaveLength(1);
  expect(JSON.parse(requests[0].messages.find((m:any)=>m.role==='user').content)).toEqual({authorRequest,documentIdentity:{kind:'chapter',chapterNumber:1},paragraphCount:3});
  await expect(revise(first.revisedContent.replace('The gallery closes at nine.','The gallery closes at eight.'))).rejects.toMatchObject({code:'ARTIFACT_EDIT_BASELINE_CONFLICT'});
  expect(requests).toHaveLength(3);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
},20000);


it.each([
 {language:'en' as const,original:'Before dawn, Mara checks the locked gallery.\n\nMaybe.\n\nShe closes the door.\n',selected:'Maybe.',replacement:'I will stay.',lineBreak:'I will\nstay.',overlong:'I '.repeat(40),authorRequest:'Change only the final spoken response, Maybe. Preserve all surrounding narration.',target:15,minimum:10,maximum:16,unit:'words'},
 {language:'zh' as const,original:'天亮前，她确认画廊的门锁。\n\n再想想。\n\n她关上门。\n',selected:'再想想。',replacement:'我留下。',lineBreak:'我会\n留下。',overlong:'我'.repeat(40),authorRequest:'只修改最后一句发言“再想想。”，其余叙述保持不变。',target:22,minimum:20,maximum:24,unit:'non-whitespace-characters'},
])('keeps original chapter scope and explicit $unit when a failed repair is retried',async fixture=>{
 const {ReviserAgent}=await import('../agents/reviser.js');
 const {withExecutionEvidence}=await import('../harness/execution-evidence.js');
 const {buildLengthSpec}=await import('../utils/length-metrics.js');
 const {original,authorRequest}=fixture;
 const requests:any[]=[];let repair=false;
 const server=createServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body);
  const name=body.tools[0].function.name;
  const args=name==='submit_edit_location'?{kind:'reference',boundary:'none',count:0,target:'Only the final spoken response; surrounding narration remains protected.'}:name==='submit_author_edit_scope'?{wholeDocument:false,selections:[{unitId:'p2',text:fixture.selected}],reason:'Only the spoken response is authorized.'}:{selection_0_text:repair?fixture.replacement:requests.filter(r=>r.tools[0].function.name==='submit_chapter_range_replacements').length===1?fixture.lineBreak:fixture.overlong};
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'scope-'+requests.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]}));
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const client=createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat',stream:false,thinkingBudget:0});
  const reviser=new ReviserAgent({client,model:'fixture',projectRoot:'/tmp'});
  const reference={source:'story/canon.md',protection:'protected' as const,reason:'Established story fact',excerpt:'Mara is the gallery keeper.'};
  const options={language:fixture.language,lengthSpec:buildLengthSpec(fixture.target,fixture.language,{minChapterLength:fixture.minimum,maxChapterLength:fixture.maximum}),contextPackage:{chapter:1,selectedContext:[{source:'runtime/chapter_memo',protection:'protected' as const,reason:'Coordinator workaround',excerpt:'Shorten the entire chapter and revise any paragraph necessary to fit the length budget.'},reference]}};
  const failed=await withExecutionEvidence(()=>{},()=>reviser.reviseChapter('/tmp',original,1,[],'polish',undefined,options),undefined,undefined,authorRequest).then(()=>{throw new Error('Overlong replacement was accepted');},error=>error);
  expect(failed).toMatchObject({code:'CHAPTER_LENGTH_OUT_OF_RANGE'});
  const budget=JSON.parse(failed.message).replacementBudget;
  expect(budget.submittedLength).toBe(40);
  expect(budget.reduceByAtLeast).toBe(40-budget.maximum);
  repair=true;
  const revisionGuidance='Use a shorter direct response. Rewrite the surrounding narration if necessary.';
  const result=await withExecutionEvidence(()=>{},()=>reviser.reviseChapter('/tmp',original,1,[],'rewrite',undefined,{...options,instruction:revisionGuidance,targetText:original}),undefined,undefined,authorRequest);
  expect(result.revisedContent).toBe(original.replace(fixture.selected,fixture.replacement));
  expect(result.editPermission).toEqual({basis:'original_author_request',selectedOriginalText:[fixture.selected],surroundingText:'protected'});
  const {actionResultFacts}=await import('../harness/action-observation.js');
  expect(actionResultFacts(result).editPermission).toEqual(result.editPermission);
  const scopes=requests.filter(r=>r.tools[0].function.name==='submit_author_edit_scope');
  expect(scopes).toHaveLength(2);
  expect(scopes.every(r=>JSON.parse(r.messages.findLast((m:any)=>m.role==='user').content).authorRequest==='Only the final spoken response; surrounding narration remains protected.')).toBe(true);
  expect(requests.filter(r=>r.tools[0].function.name==='submit_edit_location').every(r=>JSON.parse(r.messages.findLast((m:any)=>m.role==='user').content).authorRequest===authorRequest)).toBe(true);
  const writes=requests.filter(r=>r.tools[0].function.name==='submit_chapter_range_replacements');
  expect(writes).toHaveLength(4);
  const resumedTask=JSON.parse(writes.at(-1).messages.find((message:any)=>message.role==='user').content);
  expect(resumedTask.revisionGuidance).toEqual({source:'coordinator',instruction:revisionGuidance,authority:'advice_within_author_scope'});
  expect(writes.every(r=>Object.keys(r.tools[0].function.parameters.properties).join(',')==='selection_0_text')).toBe(true);
  for(const request of writes){
    const task=JSON.parse(request.messages.find((message:any)=>message.role==='user').content);
    expect(task).toMatchObject({instruction:authorRequest,references:[reference],lengthContract:{minChapterLength:fixture.minimum,maxChapterLength:fixture.maximum,unit:fixture.unit}});
    const selection=JSON.parse(request.messages.findLast((message:any)=>message.role==='user').content);
    expect(selection.editableRanges[0].singleLine).toBe(true);
    expect(selection.replacementBudget.unit).toBe(fixture.unit);
  }
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
},20000);

it('resolves the first two text paragraphs from a bounded location without exposing prose or changing Markdown headings',async()=>{
 const {SourceLocatorAgent}=await import('../agents/source-locator.js');
 const requests:any[]=[];
 const server=createServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body);
  const args={kind:'paragraphs',boundary:'first',count:requests.length===1?4:2,target:''};
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'position-'+requests.length,type:'function',function:{name:body.tools[0].function.name,arguments:JSON.stringify(args)}}]}}]}));
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const client=createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat',stream:false,thinkingBudget:0});
  const source='# Arrival\n\nMara reaches the gallery.\n\nThe curator waits outside.\n\n---\n\nThe door stays locked.\n';
  const authorRequest='Rewrite only the first two paragraphs to make the arrival urgent; preserve the title and all other text.';
  const identity={kind:'artifact' as const,path:'source/arrival.md'};
  const selected=await new SourceLocatorAgent({client,model:'fixture',projectRoot:'/tmp'}).select(source,authorRequest,identity);
  expect(selected.selections.map(s=>s.unitId)).toEqual(['p2','p3']);
  expect(authorTextScopeContract(source,selected).apply({selection_0_text:'Mara runs to the gallery.\n',selection_1_text:'The curator waves from the steps.\n'})).toBe('# Arrival\n\nMara runs to the gallery.\n\nThe curator waves from the steps.\n\n---\n\nThe door stays locked.\n');
  expect(requests).toHaveLength(2);
  expect(JSON.parse(requests[0].messages.find((m:any)=>m.role==='user').content)).toEqual({authorRequest,documentIdentity:identity,paragraphCount:3});
  expect(requests[1].messages.find((m:any)=>m.role==='tool')).toBeDefined();
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
},15000);
