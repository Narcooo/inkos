import {createServer} from 'node:http';
import {once} from 'node:events';
import {it,expect} from 'vitest';
import {BaseAgent} from '../agents/base.js';
import {createLLMClient} from '../llm/provider.js';
import {createReviewCalculationTool} from '../agents/review-calculation.js';

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
    expect(review.result.observations).toMatchObject([{code:'BALANCE',assessment:'issue',sourceRefs:[{sourceId:'ledger',quote:source}]}]);
    await expect(createReviewCalculationTool().execute('undefined',{operation:'divide',values:[1,0]})).rejects.toMatchObject({code:'REVIEW_CALCULATION_UNDEFINED'});
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
},15000);
