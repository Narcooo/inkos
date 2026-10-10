import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {it,expect} from 'vitest';
import {PlayDB} from '../play/play-db.js';
import {PlayStore} from '../play/play-store.js';
import {PlayRunner} from '../play/play-runner.js';
import {PlayTurnAgent} from '../play/play-agents.js';
import {applyPlayMutation} from '../play/play-reducer.js';
import {PlayMutationSchema} from '../models/play.js';
import {createLLMClient} from '../llm/provider.js';
import {withExecutionEvidence} from '../harness/execution-evidence.js';

it('corrects a lost placement before committing a turn, and preserves explicit movement, return and consumption outcomes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'inkos-play-placement-'));
  const store=new PlayStore(root);
  await store.createWorld({id:'world',title:'Workshop',premise:'A visitor has a parcel in a workshop.',worldContract:'Track physical placements.',visualContract:'',mode:'open',language:'en'});
  await store.ensureRun('world','main');
  const db=new PlayDB(store.runDir('world','main'));
  const entities=[{id:'actor_player',type:'actor' as const,label:'Visitor'},{id:'parcel',type:'item' as const,label:'Parcel'},
    {id:'workshop',type:'location' as const,label:'Workshop'},{id:'counter',type:'location' as const,label:'Counter'}];
  for(const entity of entities)db.upsertEntity({...entity,summary:'Fixture',createdEventId:'evt-0',updatedEventId:'evt-0'});
  const relation=(id:string,fromId:string,toId:string,type='at',value={})=>({id,fromId,toId,type,value,validFromEventId:'evt-0',sourceEventId:'evt-0'});
  db.upsertEdge(relation('visitor-place','actor_player','workshop'));
  db.upsertEdge(relation('parcel-place','parcel','counter'));
  const initial=db.snapshot();
  let calls=0;
  const server=createServer(async(req,res)=>{
    const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));const body=JSON.parse(Buffer.concat(chunks).toString());
    calls++;
    expect(db.snapshot()).toEqual(initial);
    const result={action:{actionKind:'walk',intent:'Go to the counter'},mutation:{summary:'The visitor reaches the counter.',entities:[],
      edges:calls===1?[]:[{id:'visitor-place',fromId:'actor_player',toId:'counter',type:'stands beside',value:{role:'placement'}}],expiredEdges:[{edgeId:'visitor-place',reason:'Movement'}],stateSlots:[],evidenceTransitions:[],blocked:false,blockedReason:'',notes:[]},
      sceneText:'The visitor walks to the counter.',suggestedActions:[]};
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',tool_calls:[{id:'turn-'+calls,type:'function',function:{name:body.tools[0].function.name,arguments:JSON.stringify(result)}}]}}]}));
  });server.listen(0,'127.0.0.1');await once(server,'listening');
  const client=createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat',stream:false,thinkingBudget:0});
  const runner=new PlayRunner({projectRoot:root,worldId:'world',runId:'main',store,db,agents:{openingState:{async extract(){throw Error('Unexpected seed');}},turn:new PlayTurnAgent({client,model:'fixture',projectRoot:root,bookId:'world'})}});
  const evidence:Array<{type:string;payload:Record<string,unknown>}>=[];
  try{
    await withExecutionEvidence((type,payload)=>evidence.push({type,payload}),()=>runner.step('Walk to the counter.'));
    expect(calls).toBe(2);
    expect(evidence.filter(e=>e.type==='worker-result-invalid').map(e=>e.payload.code)).toEqual(['PLAY_PLACEMENT_UNRESOLVED']);
    expect(db.snapshot().events).toHaveLength(1);
    expect((await store.readEvents('world','main')).map(event=>event.turn)).toEqual([1]);
    expect(db.snapshot().edges.find(edge=>edge.id==='visitor-place')).toMatchObject({toId:'counter',validUntilEventId:null,validFromEventId:'evt-1'});
    const mutation=(turn:number,upsert:unknown[]=[],expire:string[]=[],entityUpdates:unknown[]=[])=>PlayMutationSchema.parse({eventId:'evt-'+turn,turn,actionKind:'fixture',summary:'Fixture transition',entities:{upsert:entityUpdates},edges:{upsert:upsert.map(edge=>({...edge as object,validFromEventId:'evt-'+turn,sourceEventId:'evt-'+turn})),expire:expire.map(edgeId=>({edgeId,validUntilEventId:'evt-'+turn}))},stateSlots:{upsert:[]},evidence:{transitions:[]},blocked:false,blockedReason:'',notes:[]});
    applyPlayMutation({db,rawInput:'Take the parcel.',mutation:mutation(2,[relation('parcel-holder','actor_player','parcel','holding',{role:'holding'})],['parcel-place'])});
    const held=db.snapshot();
    expect(()=>applyPlayMutation({db,rawInput:'Return the parcel.',mutation:mutation(3,[],['parcel-holder'])})).toThrow(expect.objectContaining({code:'PLAY_PLACEMENT_UNRESOLVED'}));
    expect(db.snapshot()).toEqual(held);
    applyPlayMutation({db,rawInput:'Return the parcel.',mutation:mutation(3,[relation('parcel-place','parcel','counter','放置于',{role:'placement'})],['parcel-holder'])});
    expect(db.snapshot().edges.find(edge=>edge.id==='parcel-place')).toMatchObject({toId:'counter',validUntilEventId:null,validFromEventId:'evt-3'});
    applyPlayMutation({db,rawInput:'The parcel is destroyed.',mutation:mutation(4,[],['parcel-place'],[{...entities[1],summary:'No longer physically present',status:'destroyed'}])});
    expect(db.getEntity('parcel')?.status).toBe('destroyed');
    expect(db.snapshot().events).toHaveLength(4);
    db.upsertEdge(relation('social-link','actor_player','parcel','knows'));
    applyPlayMutation({db,rawInput:'End a non-placement relation.',mutation:mutation(5,[],['social-link'])});
    expect(db.snapshot().events).toHaveLength(5);
  }finally{runner.close();db.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
},15000);
