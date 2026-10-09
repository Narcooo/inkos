import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {it,expect} from 'vitest';
import {createWorkManifest,saveWorkManifest,syncWorkSourceArtifacts,loadWorkManifest,StoryGraphSchema,saveStoryGraph,loadStoryGraph,evictAgentCache} from '@actalk/inkos-core';
import {createStudioServer} from '../api/server.js';
import {loadStudioTaskSnapshot} from '../api/task-store.js';

it('retains a confirmed primary mutation but does not report delivery when its requested continuation is incomplete',async()=>{
  const root=await mkdtemp(join(tmpdir(),'inkos-confirmed-completion-'));
  let calls=0,artifactId='',sessionId:string|undefined;
  const upstream=createServer(async(req,res)=>{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=JSON.parse(Buffer.concat(chunks).toString());
    if(body.tools[0].function.name==='submit_requested_operations'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',tool_calls:[{id:'scope',type:'function',function:{name:'submit_requested_operations',arguments:JSON.stringify({newContentQuote:'',contentReviewQuote:'review the graph',exportQuote:''})}}]}}]}));return;}
    const name=calls++===0?'bind_delivery_sources':'finish_turn';
    const args=name==='bind_delivery_sources'?{steps:[{id:'review',targets:[{workId:'film',artifactId}]}]}:{status:'blocked',message:'The requested content review has not completed.'};
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',tool_calls:[{id:'call-'+calls,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]}));
  });upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  try{
    await mkdir(join(root,'.inkos'));
    await writeFile(join(root,'inkos.json'),JSON.stringify({name:'fixture',version:'0.1.0',language:'en',llm:{defaultModel:'fixture',services:[{service:'custom',name:'fixture',baseUrl:`http://127.0.0.1:${(upstream.address() as {port:number}).port}/v1`,apiFormat:'chat',stream:false,models:['fixture']}]}}));
    await writeFile(join(root,'.inkos/secrets.json'),JSON.stringify({services:{'custom:fixture':{apiKey:'fixture'}}}));
    await saveWorkManifest(root,createWorkManifest({id:'film',title:'Counter',profileId:'interactive-film',language:'en'}));
    const graph=StoryGraphSchema.parse({schemaVersion:1,projectId:'film',title:'Counter',nodes:[
      {id:'start',type:'start',choices:[{id:'leave',text:'Leave',targetNodeId:'end'}]},
      {id:'wait',type:'normal',choices:[{id:'finish',text:'Finish',targetNodeId:'end'}]},
      {id:'end',type:'ending',choices:[]},
    ]});
    await saveStoryGraph(root,'film',graph);const initial=await syncWorkSourceArtifacts({projectRoot:root,workId:'film',accept:true});
    artifactId=initial.artifacts.find(a=>a.kind==='story-graph')!.id;
    const app=createStudioServer({} as never,root),post=(body:unknown)=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const created=await(await app.request('/api/v1/sessions',post({sessionKind:'work',profileId:'interactive-film',workId:'film'}))).json();sessionId=created.session.sessionId;
    const updated={...graph.nodes[0]!,choices:[...graph.nodes[0]!.choices,{id:'stay',text:'Wait',targetNodeId:'wait',effects:[]}]};
    const response=await app.request('/api/v1/agent',post({sessionId,workId:'film',activeBookId:'film',profileId:'interactive-film',sessionKind:'work',instruction:'Add the second opening choice, then review the graph.',actionSource:'button',requestedIntent:'connect_choice',actionPayload:{connectChoice:{projectId:'film',node:updated}},model:'fixture',service:'custom:fixture'}));
    const body=await response.json();expect({status:response.status,body},JSON.stringify(body)).toMatchObject({status:422,body:{error:{code:'AGENT_TASK_INCOMPLETE'},completionStatus:'blocked'}});
    expect((await loadStoryGraph(root,'film'))!.nodes.find(n=>n.id==='start')!.choices.map(c=>c.id)).toEqual(['leave','stay']);
    const task=await loadStudioTaskSnapshot(root,sessionId!);
    expect(task?.execution).toMatchObject({status:'error',details:{primaryExecutionStatus:'completed'},deliveryState:{declared:true,steps:[{id:'review',operation:'review'}],receipts:[]}});
    expect((await loadWorkManifest(root,'film')).artifacts.find(a=>a.id===artifactId)!.currentRevisionId).not.toBe(initial.artifacts.find(a=>a.id===artifactId)!.currentRevisionId);
  }finally{if(sessionId)evictAgentCache(sessionId);upstream.closeAllConnections();await new Promise<void>(resolve=>upstream.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
},20000);
