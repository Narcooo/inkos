/** HTTP fixture for a worker response; review records use the actual tool contract. */
export function fixtureToolCalls(name: string, args: unknown, id: string) {
  const call = (tool: string, input: unknown, index: number) => ({index,id:`${id}-${index}`,type:'function',function:{name:tool,arguments:JSON.stringify(input)}});
  const review = args as {summary?: string; observations?: Array<{code: string}>};
  if (Array.isArray(review?.observations)) return [
    ...review.observations.map((observation,index)=>call('record_review_observation',observation,index)),
    call(name,{summary:review.summary,observationCodes:review.observations.map(observation=>observation.code)},review.observations.length),
  ];
  return [call(name,args,0)];
}
