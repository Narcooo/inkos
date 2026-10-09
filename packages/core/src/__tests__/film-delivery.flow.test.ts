import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it,vi} from 'vitest';
import {Value} from '@sinclair/typebox/value';
import {createWorkManifest,saveWorkManifest,loadWorkManifest} from '../harness/work-store.js';
import {applyGraphDelta} from '../interactive-film/authoring-store.js';
import {loadStoryGraph} from '../interactive-film/graph-store.js';
import {createConnectChoiceTool,createFillNodeTool,createReviseNodeTool,createDraftStructureTool,createDefineEndingTool} from '../agent/film-authoring-tools.js';
import {createInspectFilmTool,createExportFilmTool,createSetFilmRequirementsTool} from '../harness/tools/film-delivery.js';
import {StoryGraphSchema} from '../interactive-film/graph-schema.js';
import {findSimpleRuntimeRoute,enumerateRuntimePaths,exploreRuntimeStates} from '../interactive-film/paths.js';
import {checkFilmRequirements} from '../interactive-film/delivery-requirements.js';
import {createProductionCapabilityRegistry} from '../harness/production-capabilities.js';
import {createBuiltInWorkProfileRegistry} from '../harness/builtin-profiles.js';
import {CreativeHarnessRuntime} from '../harness/runtime.js';
import {CreativeEpisodeStore} from '../harness/episode-store.js';
import {readArtifactRevision} from '../harness/artifact-reader.js';
import {visibleDialogue,applyEffects,initVarState} from '../interactive-film/evaluator.js';

it('persists conditional dialogue and presents only the lines supported by the entering state',async()=>{
  const root=await mkdtemp(join(tmpdir(),'inkos-film-dialogue-'));
  try{
    await saveWorkManifest(root,createWorkManifest({id:'dialogue',title:'Fixture',profileId:'interactive-film',language:'en'}));
    const graph=StoryGraphSchema.parse({schemaVersion:1,projectId:'dialogue',title:'Fixture',
      variables:[{name:'recording',type:'flag',default:0}],
      nodes:[
        {id:'s',type:'start',choices:[
          {id:'take',text:'Take',targetNodeId:'m',effects:[{var:'recording',op:'set',value:1}]},
          {id:'leave',text:'Leave',targetNodeId:'m'}]},
        {id:'m',type:'merge',sceneDesc:'The player reaches the desk.',dialogue:[
          {speaker:'Player',text:'The recording is here.',condition:{var:'recording',op:'==',value:1}},
          {speaker:'Player',text:'The recording is missing.',condition:{var:'recording',op:'==',value:0}},
        ],choices:[{id:'end',text:'End',targetNodeId:'e'}]},
        {id:'e',type:'ending',choices:[]}],
    });
    await applyGraphDelta({projectRoot:root,projectId:'dialogue',delta:{variables:{upsert:graph.variables,remove:[]},nodes:{upsert:graph.nodes,remove:[]},notes:[]}});
    const saved=(await loadStoryGraph(root,'dialogue'))!;
    const start=saved.nodes.find(n=>n.id==='s')!,merged=saved.nodes.find(n=>n.id==='m')!;
    const states=start.choices.map(choice=>applyEffects(initVarState(saved.variables),choice.effects));
    expect(states.map(state=>visibleDialogue(merged,state))).toEqual([[merged.dialogue[0]],[merged.dialogue[1]]]);
    const inspection=await createInspectFilmTool(root,'dialogue').execute('visibility',{}) as any;
    expect(inspection.details.dialogueVisibility).toEqual({exhaustive:true,lines:[
      {nodeId:'m',dialogueIndex:0,condition:{var:'recording',op:'==',value:1},witnesses:[{state:{recording:1},visible:true},{state:{recording:0},visible:false}]},
      {nodeId:'m',dialogueIndex:1,condition:{var:'recording',op:'==',value:0},witnesses:[{state:{recording:1},visible:false},{state:{recording:0},visible:true}]},
    ]});
    const before=await readFile(join(root,'works/dialogue/source/story-graph.json'));
    await expect(applyGraphDelta({projectRoot:root,projectId:'dialogue',delta:{nodes:{upsert:[{...merged,dialogue:[{...merged.dialogue[0]!,condition:{var:'recording',op:'==',value:true}}]}],remove:[]},notes:[]}})).rejects.toMatchObject({code:'VARIABLE_TYPE_MISMATCH'});
    expect(await readFile(join(root,'works/dialogue/source/story-graph.json'))).toEqual(before);
    const endingTool=createDefineEndingTool(root,'dialogue');
    const ending={id:'outcome',nodeId:'e',title:String.raw`\u5b8c\u6210`,type:'complete'};
    await expect(endingTool.execute('encoded',ending)).rejects.toMatchObject({code:'ENCODED_DISPLAY_TEXT',issues:[{path:'/endings/0/title'}]});
    expect(await readFile(join(root,'works/dialogue/source/story-graph.json'))).toEqual(before);
    const legacy=StoryGraphSchema.parse({...saved,endings:[ending]});
    expect(checkFilmRequirements(legacy,{nodeCount:3}).issues).toContainEqual({code:'FILM_STRUCTURE_INVALID',actual:'ENCODED_DISPLAY_TEXT',nodeIds:['e']});
    await endingTool.execute('readable',{...ending,title:'完成',description:String.raw`A code example: \u5b8c`});
    expect((await loadStoryGraph(root,'dialogue'))!.endings[0].title).toBe('完成');
  }finally{await rm(root,{recursive:true,force:true});}
});

it('proves a simple route even when earlier cycling paths exhaust general enumeration',()=>{
  const graph=StoryGraphSchema.parse({schemaVersion:1,projectId:'loop',title:'Loop',variables:[{name:'count',type:'resource',default:0,desc:''}],nodes:[
    {id:'s',type:'start',title:'Start',choices:[{id:'loop',text:'Loop',targetNodeId:'s',effects:[{var:'count',op:'add',value:1}]},{id:'middle',text:'Next',targetNodeId:'m',effects:[]}]},
    {id:'m',type:'normal',title:'Middle',choices:[{id:'end',text:'End',targetNodeId:'e',effects:[]}]},
    {id:'e',type:'ending',title:'End',choices:[]},
  ]});
  expect(enumerateRuntimePaths(graph,{maxPaths:1}).truncated).toBe(true);
  expect(findSimpleRuntimeRoute(graph,{endingNodeId:'e',minChoices:2}).route?.nodeIds).toEqual(['s','m','e']);
  expect(checkFilmRequirements(graph,{minRouteChoices:2,primaryEndingNodeId:'e'}).status).toBe('checks_passed');
  expect(checkFilmRequirements(graph,{minRouteChoices:3}).issues).toEqual([{code:'FILM_ROUTE_TOO_SHORT',expected:3}]);
});

it('validates player-visible choices across merged states and permits distinct choices with the same destination',async()=>{
  const root=await mkdtemp(join(tmpdir(),'inkos-film-visible-'));
  try{
    await saveWorkManifest(root,createWorkManifest({id:'visible',title:'Visible choices',profileId:'interactive-film',language:'en'}));
    const graph=StoryGraphSchema.parse({schemaVersion:1,projectId:'visible',title:'Visible choices',variables:[{name:'invited',type:'flag',default:false}],nodes:[
      {id:'s',type:'start',choices:[
        {id:'accept',text:'Accept invitation',targetNodeId:'m',effects:[{var:'invited',op:'set',value:true}]},
        {id:'decline',text:'Decline invitation',targetNodeId:'m'}]},
      {id:'m',type:'merge',choices:[
        {id:'enter',text:'Enter',targetNodeId:'e',condition:{var:'invited',op:'==',value:true}},
        {id:'leave',text:'Leave',targetNodeId:'e'}]},
      {id:'e',type:'ending',choices:[]}],endings:[{id:'end',nodeId:'e',title:'End',type:'end'}]});
    await applyGraphDelta({projectRoot:root,projectId:'visible',delta:{variables:{upsert:graph.variables,remove:[]},nodes:{upsert:graph.nodes,remove:[]},endings:{upsert:graph.endings,remove:[]},notes:[]}});
    await createSetFilmRequirementsTool(root,'visible').execute('requirements',{minChoicesPerNode:2});
    const expected={status:'needs_revision',issues:expect.arrayContaining([expect.objectContaining({code:'FILM_VISIBLE_CHOICES',nodeIds:['m'],state:{invited:false},actual:1,expected:2})])};
    expect((await createInspectFilmTool(root,'visible').execute('inspect',{})).details).toMatchObject({delivery:expected});
    expect((await createExportFilmTool(root,'visible').execute('export',{})).details).toMatchObject({delivery:expected});
    const merged=graph.nodes[1]!;
    const choices=merged.choices.map(({condition:_condition,...choice})=>choice);
    await applyGraphDelta({projectRoot:root,projectId:'visible',delta:{nodes:{upsert:[{...merged,choices}],remove:[]},notes:[]}});
    expect((await createInspectFilmTool(root,'visible').execute('corrected',{})).details).toMatchObject({delivery:{status:'checks_passed'}});
    const bounded=exploreRuntimeStates(graph,{maxStates:1});
    expect(bounded.truncated).toBe(true);
    expect(bounded.states.map(entry=>entry.nodeId)).toEqual(['s']);
  }finally{await rm(root,{recursive:true,force:true});}
});

it('checks exact delivery requirements, corrects a draft and preserves topology during prose edits',async()=>{
  const root=await mkdtemp(join(tmpdir(),'inkos-film-contract-'));
  const start={id:'s',type:'start' as const,title:'Start',sceneDesc:'Original',dialogue:[],act:'',choices:[{id:'go',text:'Go',targetNodeId:'e',condition:{var:'key',op:'==' as const,value:true},effects:[]}]};
  const end={id:'e',type:'ending' as const,title:'End',sceneDesc:'End',dialogue:[],act:'',choices:[]};
  try{
    await saveWorkManifest(root,createWorkManifest({id:'film',title:'Fixture',profileId:'interactive-film',language:'en'}));
    await applyGraphDelta({projectRoot:root,projectId:'film',delta:{nodes:{upsert:[start,end,{...end,id:'orphan'}],remove:[]},variables:{upsert:[{name:'key',type:'flag',default:true,desc:''}],remove:[]},notes:[]}});
    await createSetFilmRequirementsTool(root,'film').execute('requirements',{nodeCount:2,endingCount:1,minChoicesPerNode:1,minRouteChoices:1,conditionVariables:['key']});
    expect((await createInspectFilmTool(root,'film').execute('inspect',{})).details).toMatchObject({delivery:{status:'needs_revision'}});
    const structure=vi.fn().mockResolvedValueOnce([start,end,{...end,id:'extra'}]).mockResolvedValueOnce([start,end]);
    const deps={submitStructure:structure,submitNode:async()=>({...start,id:'wrong',type:'ending' as const,sceneDesc:'Edited',choices:[]})};
    await createDraftStructureTool(root,'film',deps).execute('structure',{instruction:'Two nodes'},undefined);
    expect(structure).toHaveBeenCalledTimes(2);
    expect((await loadStoryGraph(root,'film'))?.nodes.map(n=>n.id)).toEqual(['s','e']);
    for(const tool of [createFillNodeTool(root,'film',deps),createReviseNodeTool(root,'film',deps)]) {
      const receipt=await tool.execute('edit',{nodeId:'s',instruction:'Edit prose',fields:['sceneDesc','dialogue']},undefined);
      const persisted=(await loadStoryGraph(root,'film'))!.nodes.find(node=>node.id==='s');
      expect(receipt.details).toMatchObject({kind:'graph_updated',node:persisted});
      const visible=JSON.parse(receipt.content.find(item=>item.type==='text')!.text!);
      expect(visible.node).toEqual(persisted);
    }
    expect((await loadStoryGraph(root,'film'))?.nodes[0]).toMatchObject({id:'s',type:'start',sceneDesc:'Edited',choices:start.choices});
    const beforeProseRevision=(await loadStoryGraph(root,'film'))!.nodes[0]!;
    await createReviseNodeTool(root,'film',{...deps,submitNode:async()=>({...beforeProseRevision,title:'Unrequested rename',act:'Unrequested act',position:{x:10,y:20},imageSlot:{prompt:'Unrequested image'},sceneDesc:'Scoped scene',dialogue:[{speaker:'Player',text:'Ready',emotion:''}]})}).execute('scoped-edit',{nodeId:'s',fields:['sceneDesc','dialogue'],instruction:'Revise prose only'},undefined);
    expect((await loadStoryGraph(root,'film'))!.nodes[0]).toEqual({...beforeProseRevision,sceneDesc:'Scoped scene',dialogue:[{speaker:'Player',text:'Ready',emotion:''}]});
    const beforeTitleRevision=(await loadStoryGraph(root,'film'))!.nodes[0]!;
    await createReviseNodeTool(root,'film',{...deps,submitNode:async()=>({...beforeTitleRevision,title:'A new title',sceneDesc:'Unrequested scene',dialogue:[],choices:[]})}).execute('title-edit',{nodeId:'s',fields:['title'],instruction:'Change only the scene title'},undefined);
    expect((await loadStoryGraph(root,'film'))!.nodes[0]).toEqual({...beforeTitleRevision,title:'A new title'});
    const exported=await createExportFilmTool(root,'film').execute('export',{});
    expect(exported.details).toMatchObject({delivery:{status:'checks_passed'}});
    await createSetFilmRequirementsTool(root,'film').execute('ending-state',{endingStateRules:[{nodeId:'e',conditions:[{var:'key',op:'==',value:false}]}]});
    expect((await createInspectFilmTool(root,'film').execute('inspect-state',{})).details).toMatchObject({delivery:{status:'needs_revision',issues:expect.arrayContaining([expect.objectContaining({code:'FILM_ENDING_STATE_MISMATCH',actual:{key:true}})])}});
    await createSetFilmRequirementsTool(root,'film').execute('stricter',{minChoicesPerNode:2});
    expect((await createInspectFilmTool(root,'film').execute('inspect',{})).details).toMatchObject({delivery:{status:'needs_revision',issues:expect.arrayContaining([expect.objectContaining({code:'FILM_VISIBLE_CHOICES',actual:1,expected:2})])}});
  }finally{await rm(root,{recursive:true,force:true});}
});

it('rewires without losing authored content, inspects real paths and versions a playable export',async()=>{
  const root=await mkdtemp(join(tmpdir(),'inkos-film-delivery-'));
  try {
    await saveWorkManifest(root,createWorkManifest({id:'film',title:'Fixture film',profileId:'interactive-film',language:'en'}));
    await applyGraphDelta({projectRoot:root,projectId:'film',delta:{nodes:{upsert:[
      {id:'s',title:'Start',type:'start',sceneDesc:'Preserved scene',dialogue:[],choices:[],act:''},
      {id:'e',title:'End',type:'ending',sceneDesc:'Outcome',dialogue:[],choices:[],act:''},
    ],remove:[]},variables:{upsert:[{name:'battery',type:'resource',default:100,desc:''}],remove:[]},endings:{upsert:[{id:'ending',nodeId:'e',title:'Outcome',type:'end',description:''}],remove:[]},notes:[]}});
    const connect=createConnectChoiceTool(root,'film');
    const parameters={node:{id:'s',title:'Start',type:'start' as const,sceneDesc:'Do not replace the authored scene',dialogue:[],act:'',choices:[{id:'go',text:'Proceed',targetNodeId:'e',effects:[]}]}};
    expect(Value.Check(connect.parameters,parameters)).toBe(true);
    await connect.execute('connect',parameters);
    expect((await loadStoryGraph(root,'film'))?.nodes.find(node=>node.id==='s')?.sceneDesc).toBe('Preserved scene');
    const before = await readFile(join(root,'works/film/source/story-graph.json'));
    await expect(createConnectChoiceTool(root,'film').execute('invalid',{nodeId:'s',choices:[{id:'go',text:'Proceed',targetNodeId:'e',effects:[{var:'battery',op:'set',value:'sufficient'}]}]})).rejects.toMatchObject({code:'VARIABLE_TYPE_MISMATCH'});
    expect(await readFile(join(root,'works/film/source/story-graph.json'))).toEqual(before);
    const inspected=await createInspectFilmTool(root,'film').execute('inspect',{});
    expect(inspected.details).toMatchObject({nodeCount:2,registeredEndingCount:1,longestObservedSimpleRoute:{nodeIds:['s','e'],choices:1}});
    const exported=await createExportFilmTool(root,'film').execute('export',{format:'html'}) as any;
    const details=exported.details as {path:string;previewUrl:string};
    expect((await readFile(join(root,details.path))).length).toBeGreaterThan(0);
    const work=await loadWorkManifest(root,'film');
    expect(work.artifacts.flatMap(a=>a.revisions.filter(r=>r.id===a.currentRevisionId)).find(r=>r.path==='source/exports/playable.html')?.contentType).toBe('text/html');
    const stableGraph=(await loadStoryGraph(root,'film'))!;
    await applyGraphDelta({projectRoot:root,projectId:'film',delta:{nodes:{upsert:[
      {...stableGraph.nodes[0]!,choices:[...stableGraph.nodes[0]!.choices,{id:'unused-route',text:'Unused route',targetNodeId:'unused',effects:[]}]},
      {id:'unused',title:'Unused',type:'ending',sceneDesc:'Preserved in history',dialogue:[],choices:[],act:''},
    ],remove:[]},endings:{upsert:[{id:'retired-ending',nodeId:'unused',title:'Unused',type:'end',description:''}],remove:[]},notes:[]}});
    const withUnused=await loadWorkManifest(root,'film');
    const graphArtifact=withUnused.artifacts.find(a=>a.revisions.some(r=>r.id===a.currentRevisionId&&r.path==='source/story-graph.json'))!;
    const previous=await readArtifactRevision({projectRoot:root,workId:'film',artifactId:graphArtifact.id});
    const registry=createProductionCapabilityRegistry({
      projectRoot:root,sessionId:'edit-film',profileId:'interactive-film',work:withUnused,language:'en',
      playWorldExists:false,sameSessionProposal:false,allowSystemFileRead:false,interactiveFilmAuthoring:true,
      pipeline:{createAgentContext:()=>({client:{},model:'fixture'})} as never,
    });
    const ledger=new CreativeEpisodeStore(join(root,'.inkos/harness.sqlite'));
    try {
      const runtime=new CreativeHarnessRuntime(root,registry,createBuiltInWorkProfileRegistry(root),ledger);
      const handle=runtime.startEpisode({profileId:'interactive-film',work:withUnused});
      const removed=await runtime.executeAction({handle,capabilityId:'interactive-film',actionId:'remove_node',source:'agent',parameters:{nodeId:'unused'}});
      expect(removed.status).toBe('success');
      const current=(await loadStoryGraph(root,'film'))!;
      expect(current).toEqual(stableGraph);
      expect(removed.data).toMatchObject({removedNodeId:'unused',remainingEndingIds:['ending']});
      await expect(applyGraphDelta({projectRoot:root,projectId:'film',delta:{endings:{upsert:[{id:'dangling',nodeId:'unused',title:'Invalid',type:'end',description:''}],remove:[]},notes:[]}})).rejects.toMatchObject({code:'ENDING_NODE_NOT_FOUND',endingId:'dangling',nodeId:'unused'});
      expect(await loadStoryGraph(root,'film')).toEqual(stableGraph);
      expect((await readArtifactRevision({projectRoot:root,workId:'film',artifactId:graphArtifact.id,revisionId:previous.revision.id})).bytes).toEqual(previous.bytes);
      expect(JSON.parse(previous.bytes.toString('utf8')).nodes.some((node:{id:string})=>node.id==='unused')).toBe(true);
      runtime.finishEpisode(handle,'completed');
    } finally {ledger.close();}
  } finally {await rm(root,{recursive:true,force:true});}
});

it('reuses an explicitly selected topology without copying reference prose and rejects incompatible requirements before writing',async()=>{
 const root=await mkdtemp(join(tmpdir(),'inkos-film-reference-'));
 try{
  for(const id of ['reference','target'])await saveWorkManifest(root,createWorkManifest({id,title:id,profileId:'interactive-film',language:'en'}));
  const nodes=StoryGraphSchema.parse({schemaVersion:1,projectId:'reference',title:'Reference',nodes:[
   {id:'s',type:'start',title:'Start',sceneDesc:'Reference opening',dialogue:[{speaker:'Reference person',text:'Reference dialogue'}],choices:[{id:'go',text:'Use key',targetNodeId:'e',condition:{var:'key',op:'==',value:true},effects:[]}]},
   {id:'e',type:'ending',title:'End',sceneDesc:'Reference ending',choices:[]},
  ]}).nodes;
  await applyGraphDelta({projectRoot:root,projectId:'reference',delta:{nodes:{upsert:nodes,remove:[]},variables:{upsert:[{name:'key',type:'flag',default:true,desc:'Key'}],remove:[]},notes:[]}});
  await applyGraphDelta({projectRoot:root,projectId:'target',delta:{nodes:{upsert:[{...nodes[0]!,sceneDesc:'Target opening',dialogue:[],choices:[]},{...nodes[1]!,id:'stale'}],remove:[]},notes:[]}});
  const referenceBefore=await readFile(join(root,'works/reference/source/story-graph.json'));
  const targetBefore=await readFile(join(root,'works/target/source/story-graph.json'));
  const requirements=createSetFilmRequirementsTool(root,'target');
  await requirements.execute('too-many',{nodeCount:3,endingCount:1,minChoicesPerNode:1,minRouteChoices:1,conditionVariables:['key']});
  const submitStructure=vi.fn();const tool=createDraftStructureTool(root,'target',{submitStructure,submitNode:async()=>nodes[0]!});
  await expect(tool.execute('invalid',{instruction:'Reuse selected structure',referenceWorkId:'reference'})).rejects.toMatchObject({code:'FILM_REFERENCE_REQUIREMENTS_UNMET'});
  expect(await readFile(join(root,'works/target/source/story-graph.json'))).toEqual(targetBefore);
  await requirements.execute('exact',{nodeCount:2});
  const result=await tool.execute('reuse',{instruction:'Reuse selected structure',referenceWorkId:'reference'});
  const target=(await loadStoryGraph(root,'target'))!;
  expect(submitStructure).not.toHaveBeenCalled();
  expect(target.nodes.map(node=>node.id)).toEqual(['s','e']);
  expect(target.nodes[0]).toMatchObject({sceneDesc:'Target opening',dialogue:[],choices:nodes[0]!.choices});
  expect(target.nodes[1]).toMatchObject({sceneDesc:'',dialogue:[]});
  expect(target.variables).toEqual([{name:'key',type:'flag',default:true,desc:'Key'}]);
  expect(result.details).toMatchObject({referenceTopology:{workId:'reference'},missingSceneNodeIds:['e']});
  expect(await readFile(join(root,'works/reference/source/story-graph.json'))).toEqual(referenceBefore);
 }finally{await rm(root,{recursive:true,force:true});}
});

it('keeps minimum counts and dialogue conditions distinct through structure repair, scene writing and export',async()=>{
 const root=await mkdtemp(join(tmpdir(),'inkos-film-minimum-'));
 try{
  await saveWorkManifest(root,createWorkManifest({id:'film',title:'Note',profileId:'interactive-film',language:'en'}));
  await applyGraphDelta({projectRoot:root,projectId:'film',delta:{variables:{upsert:[{name:'note',type:'flag',default:false,desc:'A found note'}],remove:[]},notes:[]}});
  const requirements=createSetFilmRequirementsTool(root,'film');
  await requirements.execute('minimum',{minNodeCount:3,endingCount:2,minChoicesPerNode:2,minRouteChoices:2,dialogueConditionVariables:['note']});
  const nodes=StoryGraphSchema.parse({schemaVersion:1,projectId:'film',title:'Note',nodes:[
   {id:'s',type:'start',sceneDesc:'A note lies on the desk.',choices:[{id:'take',text:'Take it',targetNodeId:'m',effects:[{var:'note',op:'set',value:true}]},{id:'leave',text:'Leave it',targetNodeId:'m'}]},
   {id:'m',type:'normal',sceneDesc:'The guide waits.',choices:[{id:'stay',text:'Stay',targetNodeId:'a'},{id:'depart',text:'Depart',targetNodeId:'b'}]},
   {id:'a',type:'ending',sceneDesc:'The player stays.',choices:[]},
   {id:'b',type:'ending',sceneDesc:'The player leaves.',choices:[]},
  ]}).nodes;
  const first=structuredClone(nodes);first[1]!.choices=first[1]!.choices.slice(0,1);
  const requests:any[]=[];
  const deps={submitStructure:async(_system:string,user:string)=>{requests.push(JSON.parse(user));return requests.length===1?first:nodes;},submitNode:async()=>({...nodes[1]!,dialogue:[{speaker:'Guide',text:'You found the note.',emotion:'',condition:{var:'note',op:'==' as const,value:true}}]})};
  await createDraftStructureTool(root,'film',deps).execute('draft',{instruction:'At least three nodes; two endings; the note changes dialogue.'});
  expect(requests).toHaveLength(2);
  expect(requests[1].previousCandidate).toEqual(first);
  expect(requests[1].validationIssues).toEqual(expect.arrayContaining([expect.objectContaining({code:'FILM_VISIBLE_CHOICES',expected:2,actual:1,nodeIds:['m']})]));
  expect((await loadStoryGraph(root,'film'))!.nodes).toHaveLength(4);
  const pending=await createInspectFilmTool(root,'film').execute('inspect',{}) as any;
  expect(pending.details?.delivery.issues).toEqual([{code:'FILM_DIALOGUE_CONDITION_UNUSED',expected:'note'}]);
  await createFillNodeTool(root,'film',deps).execute('fill',{nodeId:'m',instruction:'The guide responds to possession of the note.'});
  const exported=await createExportFilmTool(root,'film').execute('export',{format:'html'}) as any;
  expect(exported.details?.delivery.status).toBe('checks_passed');
  expect((await readFile(join(root,exported.details!.path))).length).toBeGreaterThan(0);
  const exact=await requirements.execute('exact',{nodeCount:3}) as any;
  expect(exact.details?.requirements.nodeCount).toBe(3);
  expect(exact.details?.requirements.minNodeCount).toBeUndefined();
  expect(((await createInspectFilmTool(root,'film').execute('inspect-exact',{})) as any).details?.delivery.issues).toEqual([{code:'FILM_NODE_COUNT',expected:3,actual:4}]);
 }finally{await rm(root,{recursive:true,force:true});}
});
