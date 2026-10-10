import {Type} from '@sinclair/typebox';
import type {AgentContext} from './base.js';
import type {LengthSpec} from '../models/length-governance.js';
import {runWorkerAgentTool} from '../agent/worker-agent.js';
import {runWithAgentTrajectoryRole} from '../llm/agent-trajectory.js';
import {recordExecutionEvidence} from '../harness/execution-evidence.js';

/** Resolve only the chapter being produced. Imported chapters and other Works
 * do not inherit a new chapter's requested limits. No sampling preset is added. */
export async function resolveChapterLengthRequest(ctx:AgentContext,input:{authorRequest:string;workTitle:string;chapterNumber:number;fallback:LengthSpec}):Promise<LengthSpec>{
  const result=await runWithAgentTrajectoryRole('workflow',()=>runWorkerAgentTool(ctx.client,ctx.model,[
    {role:'system',content:'Identify the length instruction assigned to the specified chapter of the specified Work. Use the original author request only. A stated range, at-least requirement or upper limit supplies a hard bound. A single length target is soft unless the author explicitly requires exact equality: return it as target with zero bounds. Ignore lengths assigned to other chapters or Works, discussion/examples, and lengths of imported source that the author requires preserving. Return zero for each unstated value and an empty sourceQuote when no length instruction is assigned. Quote the complete relevant instruction exactly. Do not invent bounds around a target or infer values from defaults, chapter counts, or earlier context.'},
    {role:'user',content:JSON.stringify({authorRequest:input.authorRequest,workTitle:input.workTitle,chapterNumber:input.chapterNumber,countingMode:input.fallback.countingMode})},
  ],{
    name:'submit_chapter_length_bounds',label:'Identify this chapter’s requested length',description:'Distinguish a requested soft target from explicit hard bounds for this chapter.',
    parameters:Type.Object({target:Type.Integer({minimum:0,description:'An explicitly requested length target; zero means none. A soft target does not create bounds.'}),minimum:Type.Integer({minimum:0,description:'Explicit lower bound in the chapter counting unit; zero means none.'}),maximum:Type.Integer({minimum:0,description:'Explicit upper bound in the chapter counting unit; zero means none.'}),sourceQuote:Type.String({description:'Exact author instruction assigning this length to this chapter; empty when none is assigned.'})},{additionalProperties:false}),
    validate:result=>{
      result={...result,sourceQuote:result.sourceQuote.trim()};
      if(Boolean(result.target||result.minimum||result.maximum)!==Boolean(result.sourceQuote.trim())||result.sourceQuote&&!input.authorRequest.includes(result.sourceQuote))throw Object.assign(new Error('Length values require an exact affirmative author instruction; otherwise return zeros and an empty quote.'),{code:'CHAPTER_LENGTH_REQUEST_SOURCE_INVALID'});
      if(result.minimum&&result.maximum&&result.minimum>result.maximum)throw Object.assign(new Error('The lower bound cannot exceed the upper bound.'),{code:'CHAPTER_LENGTH_REQUEST_RANGE_INVALID'});
      return result;
    },
  },{signal:ctx.signal,onStreamProgress:ctx.onStreamProgress}));
  recordExecutionEvidence('chapter-length-request-resolved',{workTitle:input.workTitle,chapterNumber:input.chapterNumber,...result});
  if(!result.sourceQuote)return input.fallback;
  return{target:Math.min(result.maximum||Infinity,Math.max(result.minimum||1,result.target||input.fallback.target)),countingMode:input.fallback.countingMode,
    ...(result.minimum?{minChapterLength:result.minimum}:{}),...(result.maximum?{maxChapterLength:result.maximum}:{}),
  };
}
