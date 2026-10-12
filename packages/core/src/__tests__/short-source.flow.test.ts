import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {createLLMClient} from '../llm/provider.js';
import {PipelineRunner} from '../pipeline/runner.js';
import {createWorkManifest,saveWorkManifest,loadWorkManifest} from '../harness/work-store.js';
import {syncWorkSourceArtifacts} from '../harness/source-sync.js';
import {createProductionCapabilityRegistry} from '../harness/production-capabilities.js';
import {createProfileWorkTools} from '../harness/tools/work-creation.js';
import {createShortProductionStageTools} from '../harness/tools/short-production.js';
import {withExecutionEvidence} from '../harness/execution-evidence.js';
import {createBuiltInWorkProfileRegistry} from '../harness/builtin-profiles.js';
import {loadAvailableAgentSkills} from '../skills/builtin-loader.js';
import {hydrateActivatedSkillGuidance} from '../agent/skill-tool.js';
import {resolveProfileSkillActivations} from '../skills/activations.js';

it('delivers the registered short-story reference to the planner and retains its version across failure and retry',async()=>{
  const root=await mkdtemp(join(tmpdir(),'inkos-short-source-'));
  const calls:any[]=[];let available=false;
  const server=createServer(async(req,res)=>{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
    const body=JSON.parse(Buffer.concat(chunks).toString());calls.push(body);
    res.writeHead(available?200:401,{'Content-Type':'application/json'});
    res.end(JSON.stringify(available?{choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'outline',type:'function',function:{name:'submit_short_outline',arguments:JSON.stringify({storyTitle:'The key',planMarkdown:'A keeper returns a key.',chapter_1_plan:'The keeper checks the receipt before handing over the key.'})}}]}}]}:{error:{message:'Fixture unavailable'}}));
  });server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const client=createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat',stream:false,thinkingBudget:0});
    const pipeline=new PipelineRunner({projectRoot:root,client,model:'fixture'});
    await saveWorkManifest(root,createWorkManifest({id:'sample',title:'Sample analysis',profileId:'short-fiction',language:'en'}));
    await mkdir(join(root,'works/sample/source'),{recursive:true});
    const reference='# Sample analysis\nA missing key exposes the keeper’s unpaid work. The receipt pays off the opening promise.\n';
    const parent=await syncWorkSourceArtifacts({projectRoot:root,workId:'sample',accept:true,writes:[{relativePath:'works/sample/source/analysis.md',content:reference}]});
    const original=parent.artifacts[0]!;
    const environment={pipeline,projectRoot:root,sessionId:'flow',profileId:'workspace-default',work:null,language:'en',playWorldExists:false,sameSessionProposal:false,allowSystemFileRead:false};
    const registry=createProductionCapabilityRegistry(environment);
    expect(registry.get('short-fiction')!.actions.map(action=>action.id)).not.toContain('short_fiction_run');
    expect(createProductionCapabilityRegistry({...environment,confirmedCreation:true}).get('short-fiction')!.actions.map(action=>action.id)).toContain('short_fiction_run');
    const unboundPlan=createShortProductionStageTools(pipeline,root).find(tool=>tool.name==='plan_short_fiction')!;
    await expect(unboundPlan.execute('missing',{workId:'story',chapters:1})).rejects.toMatchObject({code:'WORK_TARGET_REQUIRED',recovery:{action:'workspace__create_work'}});
    expect(calls).toHaveLength(0);
    await expect(readFile(join(root,'works/story/work.json'))).rejects.toMatchObject({code:'ENOENT'});
    await createProfileWorkTools(root,registry).find(tool=>tool.name==='create_work')!.execute('create',{
      workId:'story',title:'The key',profileId:'short-fiction',language:'en',intent:'Write an original keeper story.',
      source:{workId:'sample',artifactId:original.id,revisionId:original.currentRevisionId!},
    });
    const work=await syncWorkSourceArtifacts({projectRoot:root,workId:'story',accept:true});
    const bound=work.artifacts.find(artifact=>artifact.revisions.some(revision=>revision.path==='source/source-material.md'))!;
    const revision=bound.revisions.find(revision=>revision.id===bound.currentRevisionId)!;
    const source={workId:work.id,artifactId:bound.id,revisionId:revision.id,checksum:revision.checksum};
    const events:Array<{type:string;payload:any}>=[];
    const profile=createBuiltInWorkProfileRegistry(root).require('short-fiction');
    const plan=createShortProductionStageTools(pipeline,root,work.id).find(tool=>tool.name==='plan_short_fiction')!;
    const run=()=>withExecutionEvidence((type,payload)=>events.push({type,payload}),()=>plan.execute('plan',{workId:work.id,chapters:1,charsPerChapter:100}),profile,work);
    await expect(run()).rejects.toThrow();
    expect(calls).toHaveLength(1);
    await syncWorkSourceArtifacts({projectRoot:root,workId:'sample',accept:true,writes:[{relativePath:'works/sample/source/analysis.md',content:'A later interpretation of the sample.'}]});
    await writeFile(join(root,'works/story/source/source-material.md'),'An unaccepted working copy.');
    const snapshot=join(root,'works/story',revision.snapshotPath!);
    await writeFile(snapshot,'Corrupt snapshot');
    await expect(run()).rejects.toMatchObject({code:'ARTIFACT_REVISION_CONFLICT'});
    expect(calls).toHaveLength(1);
    await writeFile(snapshot,reference);
    available=true;
    const result=await run();
    expect(result.details).toMatchObject({kind:'short_stage_completed',stage:'outline',stageStatus:'completed'});
    expect(calls).toHaveLength(2);
    for(const call of calls){
      const task=call.messages.find((message:any)=>message.role==='user').content;
      expect(task).toContain(reference.trim());
      expect(task).toContain(JSON.stringify(source));
    }
    expect(events.filter(event=>event.type==='source-material-used').map(event=>event.payload)).toEqual([1,2].map(()=>({worker:'short-fiction-outline',source,lineage:work.lineage})));
    const state=JSON.parse(await readFile(join(root,'works/story/source/production-state.json'),'utf8'));
    expect(state.outlineSource).toEqual(source);
    expect(state.intent).toBe(work.metadata.intent);
    expect((await loadWorkManifest(root,'story')).lineage).toEqual(work.lineage);
    const methods=await hydrateActivatedSkillGuidance(resolveProfileSkillActivations((await loadAvailableAgentSkills({projectRoot:root})).skills,profile),'');
    const method=methods!.find(item=>item.skill.id==='inkos-short-writing')!;
    const bodyHash=createHash('sha256').update(method.skill.body).digest('hex');
    expect(events.filter(event=>event.type==='skills-applied').every(event=>event.payload.skills.some((skill:any)=>skill.id===method.skill.id&&skill.hash===bodyHash))).toBe(true);
    expect(method.resources.length).toBeGreaterThan(0);
    for(const text of [method.skill.body,...method.resources.map(resource=>resource.body)]){
      expect(calls.every(call=>call.messages.some((message:any)=>message.role==='system'&&message.content.includes(text.trim())))).toBe(true);
    }
  }finally{
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
    await rm(root,{recursive:true,force:true});
  }
},20000);
