import {createServer} from 'node:http';
import {once} from 'node:events';
import {it,expect} from 'vitest';
import {BaseAgent} from '../agents/base.js';
import {createLLMClient} from '../llm/provider.js';
import {createReviewCalculationTool} from '../agents/review-calculation.js';
import {createStoryIntervalTool} from '../agents/story-interval.js';
import {ShortFictionWriterAgent} from '../agents/short-fiction.js';

it('uses a computed weekday interval in a revision plan and rejects incompatible clock precision',async()=>{
  const points={start:{clock:'project',week:2,weekday:1},end:{clock:'project',week:6,weekday:5}};
  const draft={storyTitle:'The receipt',rawContent:'',chapters:[{number:1,title:'Return',content:'She sent the warning in week two on Monday. The loan arrived in week six on Friday. Exactly four weeks had passed.',charCount:25}]};
  const original=JSON.stringify(draft),requests:any[]=[];
  const server=createServer(async(req,res)=>{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
    const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body);
    const name=requests.length===1?'calculate_story_interval':body.tools[0].function.name;
    const receipt=body.messages.filter((m:any)=>m.role==='tool').map((m:any)=>JSON.parse(m.content)).find((r:any)=>r.kind==='story_interval');
    const args=requests.length===1?points:requests.length===2?{
      revisionBrief:JSON.stringify(receipt),chapter_1_instruction:'Replace the elapsed interval using the computed weeks and days; preserve the events.',
    }:{title:'Return',content:'She sent the warning in week two on Monday. The loan arrived in week six on Friday. Four weeks and four days had passed.'};
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'interval-'+requests.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]}));
  });server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const client=createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'writing-fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat',stream:false,thinkingBudget:0});
    const planningClient=createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'planning-fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat',stream:false,thinkingBudget:0});
    const result=await new ShortFictionWriterAgent({client,model:'writing-fixture',projectRoot:'/tmp'},{client:planningClient,model:'planning-fixture',projectRoot:'/tmp'}).reviseDraft({draft,direction:'Correct the elapsed interval.',review:'',outlineMarkdown:'A warning precedes the loan.',chapterCount:1,charsPerChapter:30,minChapterLength:1,maxChapterLength:60,language:'en'});
    expect(requests.map(request=>request.model)).toEqual(['planning-fixture','planning-fixture','writing-fixture']);
    const receipts=requests[1].messages.filter((m:any)=>m.role==='tool').map((m:any)=>JSON.parse(m.content));
    expect(receipts).toContainEqual(expect.objectContaining({kind:'story_interval',elapsedDays:32,exactWholeWeeks:false,magnitude:{weeks:4,days:4,hours:0,minutes:0}}));
    expect(result.draft.chapters[0]!.content).toBe('She sent the warning in week two on Monday. The loan arrived in week six on Friday. Four weeks and four days had passed.');
    expect(JSON.stringify(draft)).toBe(original);
    const calc=createStoryIntervalTool();
    const timed=await calc.execute('timed',{start:{...points.start,minuteOfDay:1006},end:{...points.end,minuteOfDay:940}});
    expect(timed.details).toMatchObject({precision:'minutes',elapsedMinutes:46014,exactWholeWeeks:false,magnitude:{weeks:4,days:3,hours:22,minutes:54}});
    expect((await calc.execute('reverse',{start:points.end,end:points.start})).details).toMatchObject({direction:-1,elapsedDays:-32,exactWholeWeeks:false});
    expect((await calc.execute('same-day',{start:points.start,end:{...points.start,week:6}})).details).toMatchObject({elapsedDays:28,exactWholeWeeks:true});
    await expect(calc.execute('clock',{...points,end:{...points.end,clock:'employment'}})).rejects.toMatchObject({code:'STORY_INTERVAL_CLOCK_MISMATCH'});
    await expect(calc.execute('precision',{...points,end:{...points.end,minuteOfDay:940}})).rejects.toMatchObject({code:'STORY_INTERVAL_PRECISION_MISMATCH'});
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
},15000);

it('returns computed quantities to a sourced reviewer before recording its finding',async()=>{
  const source='Monthly income: 12000. Expenses: 5000, 3000, 3000, 6000. Claimed deficit: 2000.';
  const requests:any[]=[];
  const calculations=[
    {operation:'add',values:[12000,-5000,-3000,-3000,-6000]},
    {operation:'divide',values:[18,6]},
    {operation:'multiply',values:[30,12,500]},
  ];
  const server=createServer(async(req,res)=>{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
    const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body);
    const call=(name:string,args:unknown,id:string)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
    let calls;
    if(requests.length===1)calls=calculations.map((input,index)=>call('calculate_review_values',input,'calc-'+index));
    else if(requests.length===2){
      const results=body.messages.filter((m:any)=>m.role==='tool').map((m:any)=>JSON.parse(m.content));
      expect(results.map((r:any)=>r.result)).toEqual([-5000,3,180000]);
      expect(results.map((r:any)=>({operation:r.operation,values:r.values}))).toEqual(calculations);
      calls=[call('record_review_observation',{code:'BALANCE',assessment:'issue',summary:'The listed expenses exceed income by5000.',sourceRefs:[{sourceId:'ledger',startLine:1,endLine:1}]},'finding')];
    }else calls=[call('submit_calculated_review',{summary:'Balance checked.',observationCodes:['BALANCE']},'finish')];
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',tool_calls:calls}}]}));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const client=createLLMClient({service:'custom',provider:'openai',configSource:'studio',model:'fixture',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiFormat:'chat',stream:false,thinkingBudget:0});
    class Reviewer extends BaseAgent{
      get name(){return 'calculation-review';}
      review(){return this.submitSourcedReview([{role:'user',content:source}],new Map([['ledger',source]]),{name:'submit_calculated_review',label:'Review',description:'Submit the sourced review.'},{maxTokens:1024});}
    }
    const review=await new Reviewer({client,model:'fixture',projectRoot:'/tmp'}).review();
    expect(requests).toHaveLength(3);
    const budgets=requests.map(request=>request.messages.flatMap((message:any)=>String(message.content??'').split('\n')).flatMap((line:string)=>{try{const value=JSON.parse(line);return value.workerBudget?[value.workerBudget]:[];}catch{return[];}}));
    expect(budgets).toEqual([1,2,3].map(response=>[{response,maxResponses:16,remainingResponses:16-response,finalTool:'submit_calculated_review'}]));
    expect(review.result.observations).toMatchObject([{code:'BALANCE',assessment:'issue',sourceRefs:[{sourceId:'ledger',quote:source}]}]);
    await expect(createReviewCalculationTool().execute('undefined',{operation:'divide',values:[1,0]})).rejects.toMatchObject({code:'REVIEW_CALCULATION_UNDEFINED'});
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
},15000);
