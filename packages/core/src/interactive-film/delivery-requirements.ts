import{Type,type Static}from'@sinclair/typebox';
import{Value}from'@sinclair/typebox/value';
import{readFile}from'node:fs/promises';
import{join}from'node:path';
import type{StoryGraph}from'./graph-schema.js';
import{exploreRuntimeStates,findSimpleRuntimeRoute}from'./paths.js';
import{validateStoryGraph}from'./validation.js';
import{ConditionToolSchema}from'./tool-schemas.js';
import{evaluateCondition}from'./evaluator.js';

export const FilmRequirementsSchema=Type.Object({
  nodeCount:Type.Optional(Type.Integer({minimum:1,description:"Exact node count, only when the author requires exactly this many. For at least, use minNodeCount instead."})),
  minNodeCount:Type.Optional(Type.Integer({minimum:1,description:"Minimum node count when the author requests at least this many. Additional nodes are permitted."})),
  endingCount:Type.Optional(Type.Integer({minimum:1})),
  minChoicesPerNode:Type.Optional(Type.Integer({minimum:1,description:"Minimum choices visible to the player at each reachable non-ending node/state. Conditional alternatives are counted only when their conditions hold."})),
  minRouteChoices:Type.Optional(Type.Integer({minimum:1,description:"Require at least one reachable route without repeated nodes containing this many choices, to primaryEndingNodeId when supplied. Other routes and failure endings may be shorter."})),
  primaryEndingNodeId:Type.Optional(Type.String({minLength:1})),
  endingStateRules:Type.Optional(Type.Array(Type.Object({nodeId:Type.String({minLength:1}),conditions:Type.Array(ConditionToolSchema,{minItems:1})}))),
  conditionVariables:Type.Optional(Type.Array(Type.String({minLength:1}),{description:"Only variables the user explicitly requires to occur in choice conditions. This is not the list of all declared variables; do not add constraints for every state flag."})),
  dialogueConditionVariables:Type.Optional(Type.Array(Type.String({minLength:1}),{description:"Only variables the author explicitly requires to change visible dialogue. This does not require conditional choices."})),
  allowUnreachable:Type.Optional(Type.Boolean()),
},{additionalProperties:false});
export type FilmRequirements=Static<typeof FilmRequirementsSchema>;
export async function readFilmRequirements(root:string,id:string):Promise<FilmRequirements|undefined>{
  try{return Value.Parse(FilmRequirementsSchema,JSON.parse(await readFile(join(root,'works',id,'source','delivery-requirements.json'),'utf8'))) as FilmRequirements;}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}
}
export function checkFilmRequirements(graph:StoryGraph,requirements?:FilmRequirements,phase:'structure'|'delivery'='delivery'){
  const issues:Array<{code:string;expected?:unknown;actual?:unknown;nodeIds?:readonly string[];state?:Record<string,number|string|boolean>}>=[];
  if(!requirements)return{status:'unverified' as const,issues:[{code:'FILM_REQUIREMENTS_MISSING'}]};
  for(const issue of validateStoryGraph(graph).issues.filter(i=>i.level==='error'))issues.push({code:'FILM_STRUCTURE_INVALID',actual:issue.code,nodeIds:issue.nodeIds});
  const count=(code:string,expected:number|undefined,actual:number)=>{if(expected!==undefined&&actual!==expected)issues.push({code,expected,actual});};
  count('FILM_NODE_COUNT',requirements.nodeCount,graph.nodes.length);
  if(requirements.minNodeCount!==undefined&&graph.nodes.length<requirements.minNodeCount)issues.push({code:'FILM_MIN_NODE_COUNT',expected:requirements.minNodeCount,actual:graph.nodes.length});
  count('FILM_ENDING_COUNT',requirements.endingCount,graph.nodes.filter(n=>n.type==='ending').length);
  const runtime=exploreRuntimeStates(graph);
  const nodes=new Map(graph.nodes.map(node=>[node.id,node]));
  if(requirements.minChoicesPerNode!==undefined){
    const reported=new Set<string>();
    for(const entry of runtime.states){
      if(nodes.get(entry.nodeId)?.type==='ending'||entry.visibleChoiceCount>=requirements.minChoicesPerNode||reported.has(entry.nodeId))continue;
      reported.add(entry.nodeId);
      issues.push({code:'FILM_VISIBLE_CHOICES',expected:requirements.minChoicesPerNode,actual:entry.visibleChoiceCount,nodeIds:[entry.nodeId],state:entry.state});
    }
    if(runtime.truncated)issues.push({code:'FILM_VISIBLE_CHOICES_NOT_PROVEN'});
  }
  for(const variable of requirements.conditionVariables??[])if(!graph.nodes.some(n=>n.choices.some(c=>c.condition?.var===variable)))issues.push({code:'FILM_CONDITION_UNUSED',expected:variable});
  if(phase==='delivery')for(const variable of requirements.dialogueConditionVariables??[]){
    const conditioned=graph.nodes.filter(node=>node.dialogue.some(line=>line.condition?.var===variable));
    if(!conditioned.length){issues.push({code:'FILM_DIALOGUE_CONDITION_UNUSED',expected:variable});continue;}
    const varies=conditioned.some(node=>{
      const lines=node.dialogue.filter(line=>line.condition?.var===variable),variants=new Set<string>();
      for(const entry of runtime.states){
        if(entry.nodeId!==node.id)continue;
        variants.add(JSON.stringify(lines.filter(line=>evaluateCondition(line.condition,entry.state)).map(({speaker,text,emotion})=>({speaker,text,emotion}))));
        if(variants.size>1)return true;
      }
      return false;
    });
    if(!varies)issues.push({code:runtime.truncated?'FILM_DIALOGUE_VARIATION_NOT_PROVEN':'FILM_DIALOGUE_VARIATION_UNREACHABLE',expected:variable,nodeIds:conditioned.map(node=>node.id)});
  }
  if(!requirements.allowUnreachable){
    const reached=new Set(runtime.states.map(entry=>entry.nodeId));
    const unreachable=graph.nodes.filter(node=>!reached.has(node.id)).map(node=>node.id);
    if(unreachable.length)issues.push({code:runtime.truncated?'FILM_REACHABILITY_NOT_PROVEN':'FILM_UNREACHABLE_NODES',nodeIds:unreachable});
  }
  if(requirements.minRouteChoices!==undefined){
    const witness=findSimpleRuntimeRoute(graph,{endingNodeId:requirements.primaryEndingNodeId,minChoices:requirements.minRouteChoices});
    if(!witness.route)issues.push({code:witness.truncated?'FILM_ROUTE_NOT_PROVEN':'FILM_ROUTE_TOO_SHORT',expected:requirements.minRouteChoices});
  }
  if(requirements.endingStateRules?.length){
    for(const rule of requirements.endingStateRules){
      if(!graph.nodes.some(n=>n.id===rule.nodeId&&n.type==='ending')){issues.push({code:'FILM_ENDING_RULE_TARGET_MISSING',expected:rule.nodeId});continue;}
      const bad=runtime.states.find(entry=>entry.nodeId===rule.nodeId&&!rule.conditions.every(c=>evaluateCondition(c,entry.state)));
      if(bad)issues.push({code:'FILM_ENDING_STATE_MISMATCH',expected:rule.conditions,actual:bad.state,nodeIds:[bad.nodeId]});
    }
    if(runtime.truncated)issues.push({code:'FILM_ENDING_STATES_NOT_PROVEN'});
  }
  return{status:issues.length?'needs_revision' as const:'checks_passed' as const,requirements,issues};
}
