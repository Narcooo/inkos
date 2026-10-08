/** HTTP fixture for a worker response; review records use the actual tool contract. */
export function isReviewReadback(messages: Array<{role:string;content?:string}> = []) {
  const last=messages.filter(message=>message.role==='tool').at(-1);
  try{return JSON.parse(last?.content??'{}').code==='WORKER_RESULT_READBACK_REQUIRED';}catch{return false;}
}

export function fixtureToolCalls(name: string, args: unknown, id: string, messages?: Array<{role:string;content?:string}>) {
  const call = (tool: string, input: unknown, index: number) => ({index,id:`${id}-${messages?.length??0}-${index}`,type:'function',function:{name:tool,arguments:JSON.stringify(input)}});
  const review = args as {summary?: string; observations?: Array<{code: string}>};
  if (Array.isArray(review?.observations)) {
    const records=isReviewReadback(messages)?[]:review.observations.map((observation,index)=>call('record_review_observation',observation,index));
    return [...records,call(name,{summary:review.summary,observationCodes:review.observations.map(observation=>observation.code)},records.length)];
  }
  return [call(name,args,0)];
}
