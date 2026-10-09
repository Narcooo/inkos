import {createServer} from 'node:http';import {once} from 'node:events';import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {it,expect} from 'vitest';
import {createWorkManifest,saveWorkManifest} from '../harness/work-store.js';import {syncWorkSourceArtifacts} from '../harness/source-sync.js';import {createLLMClient} from '../llm/provider.js';import {PipelineRunner} from '../pipeline/runner.js';import {createArtifactMethodTools} from '../harness/tools/artifact-methods.js';import {executeExplicitCapabilityTool} from '../harness/explicit-action.js';
it('locates author-authorized text before rewriting and preserves surrounding bytes despite an overbroad coordinator range',async()=>{
 const root=await mkdtemp(join(tmpdir(),'inkos-author-scope-')),requests:any[]=[];
 const server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));requests.push(body);const name=body.tools[0].function.name,args=name==='submit_author_edit_scope'?{wholeDocument:false,selections:[{startLine:3,endLine:3,text:'Maybe.'}],reason:'The final speech line is between protected stage directions.'}:{selection_0_text:'I will stay.'};res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'scope-'+requests.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]}));});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const original='The gallery is open.\n\nMARA (facing the window): Maybe.\n\nShe closes the door.\n',authorRequest='Change only Mara’s final spoken response. Preserve both stage directions.';
  await saveWorkManifest(root,createWorkManifest({id:'gallery',profileId:'script',title:'Gallery',language:'en'}));await mkdir(join(root,'works/gallery/source'),{recursive:true});const work=await syncWorkSourceArtifacts({projectRoot:root,workId:'gallery',accept:true,writes:[{relativePath:'works/gallery/source/script.md',content:original}]});
  const llm={service:'custom',provider:'openai' as const,configSource:'studio' as const,model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat' as const,stream:false,temperature:0,thinkingBudget:0,maxTokens:8192};
  const pipeline=new PipelineRunner({projectRoot:root,client:createLLMClient(llm),model:'fixture',defaultLLMConfig:llm});
  await executeExplicitCapabilityTool({projectRoot:root,workId:'gallery',authorRequest,binding:{capabilityId:'workspace',actionId:'revise_work_artifact',profileId:'script',risk:'recoverable-write'},tool:createArtifactMethodTools(pipeline,root,'gallery')[1]!,parameters:{artifactId:work.artifacts[0]!.id,editRanges:[{startLine:1,endLine:5}],instruction:'Rewrite the entire closing passage to make her choice clear.'}});
  expect(requests.map(r=>r.tools[0].function.name)).toEqual(['submit_author_edit_scope','submit_artifact_revision']);
  expect(JSON.parse(requests[0].messages.findLast((m:any)=>m.role==='user').content).authorRequest).toBe(authorRequest);
  expect(JSON.parse(requests[1].messages.findLast((m:any)=>m.role==='user').content).editableSelections).toMatchObject([{startLine:3,endLine:3}]);
  expect(JSON.parse(requests[1].messages.findLast((m:any)=>m.role==='user').content).instruction).toBe(authorRequest);
  expect(await readFile(join(root,'works/gallery/source/script.md'),'utf8')).toBe('The gallery is open.\n\nMARA (facing the window): I will stay.\n\nShe closes the door.\n');
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
},20000);


it('keeps original chapter scope when a failed length repair is retried in a broader revision mode',async()=>{
 const {ReviserAgent}=await import('../agents/reviser.js');
 const {withExecutionEvidence}=await import('../harness/execution-evidence.js');
 const {buildLengthSpec}=await import('../utils/length-metrics.js');
 const original='Before dawn, Mara checks the locked gallery.\n\nMaybe.\n\nShe closes the door.\n';
 const authorRequest='Change only the final spoken response, Maybe. Preserve all surrounding narration.';
 const requests:any[]=[];let repair=false;
 const server=createServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body);
  const name=body.tools[0].function.name;
  const args=name==='submit_author_edit_scope'?{wholeDocument:false,selections:[{startLine:3,endLine:3,text:'Maybe.'}],reason:'Only the spoken response is authorized.'}:{selection_0_text:repair?'I will stay.':'I '.repeat(40)};
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'scope-'+requests.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]}));
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const client=createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat',stream:false,thinkingBudget:0});
  const reviser=new ReviserAgent({client,model:'fixture',projectRoot:'/tmp'});
  const options={language:'en' as const,lengthSpec:buildLengthSpec(15,'en',{minChapterLength:10,maxChapterLength:16}),contextPackage:{chapter:1,selectedContext:[{source:'delegated-instruction',protection:'protected' as const,reason:'Coordinator workaround',excerpt:'Shorten the entire chapter and revise any paragraph necessary to fit the length budget.'}]}};
  await expect(withExecutionEvidence(()=>{},()=>reviser.reviseChapter('/tmp',original,1,[],'polish',undefined,options),undefined,undefined,authorRequest)).rejects.toMatchObject({code:'CHAPTER_LENGTH_OUT_OF_RANGE'});
  repair=true;
  const result=await withExecutionEvidence(()=>{},()=>reviser.reviseChapter('/tmp',original,1,[],'rewrite',undefined,options),undefined,undefined,authorRequest);
  expect(result.revisedContent).toBe(original.replace('Maybe.','I will stay.'));
  const scopes=requests.filter(r=>r.tools[0].function.name==='submit_author_edit_scope');
  expect(scopes).toHaveLength(2);
  expect(scopes.every(r=>JSON.parse(r.messages.findLast((m:any)=>m.role==='user').content).authorRequest===authorRequest)).toBe(true);
  const writes=requests.filter(r=>r.tools[0].function.name==='submit_chapter_range_replacements');
  expect(writes).toHaveLength(4);
  expect(writes.every(r=>Object.keys(r.tools[0].function.parameters.properties).join(',')==='selection_0_text')).toBe(true);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
},20000);
