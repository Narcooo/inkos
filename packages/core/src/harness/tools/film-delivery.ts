import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { loadStoryGraph } from "../../interactive-film/graph-store.js";
import { validateStoryGraph } from "../../interactive-film/validation.js";
import { enumerateRuntimePaths } from "../../interactive-film/paths.js";
import { buildPlayableHtml } from "../../interactive-film/export-html.js";
import { exportInk } from "../../interactive-film/export-ink.js";
import { safeChildPath } from "../../utils/path-safety.js";
import { syncWorkSourceArtifacts } from "../source-sync.js";
import{FilmRequirementsSchema,readFilmRequirements,checkFilmRequirements}from'../../interactive-film/delivery-requirements.js';
import type {FilmRequirements} from '../../interactive-film/delivery-requirements.js';
import type {StoryGraph} from '../../interactive-film/graph-schema.js';

export function inspectFilmGraph(graph: StoryGraph, requirements?: FilmRequirements) {
  const report=validateStoryGraph(graph),enumeration=enumerateRuntimePaths(graph);
  const paths=enumeration.paths.filter(path=>path.endingId!==null).sort((a,b)=>b.length-a.length);
  const simple=paths.find(path=>new Set(path.nodeIds).size===path.nodeIds.length);
  return {delivery:checkFilmRequirements(graph,requirements),nodeCount:graph.nodes.length,
    endingNodeCount:graph.nodes.filter(node=>node.type==='ending').length,registeredEndingCount:graph.endings.length,
    report,pathsTruncated:enumeration.truncated,longestObservedSimpleRoute:simple?{...simple,choices:simple.length-1}:null,
    nodes:graph.nodes.map(node=>({id:node.id,type:node.type,choiceCount:node.choices.length,hasScene:!!node.sceneDesc.trim()}))};
}

export function createSetFilmRequirementsTool(root:string,workId:string):AgentTool<typeof FilmRequirementsSchema>{
  return{name:'set_film_requirements',label:'Set confirmed film requirements',parameters:FilmRequirementsSchema,
    description:'Persist the numeric and variable constraints the user requested. Distinguish exact counts from minimums, and conditional choices from conditional dialogue. Omit unrequested constraints. A new count relation replaces the previous relation; other saved constraints remain. An empty variable list clears that list.',
    execute:async(_id,params)=>{
      if(params.nodeCount!==undefined&&params.minNodeCount!==undefined)throw Object.assign(new Error('Choose exact nodeCount or minimum minNodeCount according to the author request, not both.'),{code:'FILM_COUNT_CONSTRAINT_CONFLICT'});
      const requirements={...await readFilmRequirements(root,workId),...params};
      if(params.nodeCount!==undefined)delete requirements.minNodeCount;
      if(params.minNodeCount!==undefined)delete requirements.nodeCount;
      const path=`works/${workId}/source/delivery-requirements.json`;
      await syncWorkSourceArtifacts({projectRoot:root,workId,accept:true,writes:[{relativePath:path,content:JSON.stringify(requirements,null,2)+'\n'}]});
      return{content:[{type:'text',text:JSON.stringify({kind:'film_requirements_saved',path,requirements})}],details:{kind:'film_requirements_saved',workId,path,requirements}};
    }};
}

const Inspect = Type.Object({});
const Export = Type.Object({format:Type.Optional(Type.Union([Type.Literal('html'),Type.Literal('json'),Type.Literal('ink')]))});
async function requireGraph(root:string,workId:string) {
  const graph=await loadStoryGraph(root,workId);
  if(!graph)throw Object.assign(new Error('Create the story graph first'),{code:'STORY_GRAPH_REQUIRED'});
  return graph;
}
export function createInspectFilmTool(root:string,workId:string):AgentTool<typeof Inspect> {
  return {name:'inspect_story_graph',label:'Inspect story graph',parameters:Inspect,
    description:'Read actual node and ending counts, structural validation and bounded runtime path witnesses. Optional image hints do not authorize image generation.',
    execute:async()=>{
      const graph=await requireGraph(root,workId);
      const result={kind:'story_graph_inspected',workId,...inspectFilmGraph(graph,await readFilmRequirements(root,workId))};
      return {content:[{type:'text',text:JSON.stringify(result)}],details:result};
    }};
}
export function createExportFilmTool(root:string,workId:string):AgentTool<typeof Export> {
  return {name:'export_interactive_film',label:'Export interactive film',parameters:Export,
    description:'Persist the current graph as a playable HTML file, JSON, or Ink. Return the real export path and local preview URL.',
    execute:async(_id,params)=>{
      const graph=await requireGraph(root,workId),format=params.format??'html',assets:Record<string,string>={},missing:string[]=[];
      const report=validateStoryGraph(graph);
      if(!report.ok)throw Object.assign(new Error('Resolve story graph validation errors before exporting'),{code:'STORY_GRAPH_INVALID',issues:report.issues});
      if(format==='html')for(const ref of new Set(graph.nodes.flatMap(node=>node.imageSlot?.assetRef?[node.imageSlot.assetRef]:[]))) {
        try {
          const mime:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'};
          const type=mime[extname(ref).toLowerCase()];if(!type)throw new Error('Unsupported image type');
          assets[ref]=`data:${type};base64,${(await readFile(safeChildPath(root,ref))).toString('base64')}`;
        }catch{missing.push(ref);}
      }
      const content=format==='html'?buildPlayableHtml(graph,{assetDataUris:assets}):format==='ink'?exportInk(graph):JSON.stringify(graph,null,2);
      const path=`works/${workId}/source/exports/${format==='html'?'playable.html':format==='ink'?'story.ink':'story-graph.json'}`;
      await syncWorkSourceArtifacts({projectRoot:root,workId,accept:true,writes:[{relativePath:path,content}]});
      const previewUrl=`/api/v1/projects/${encodeURIComponent(workId)}/preview/html`;
      const observations=missing.map(ref=>({code:'EXPORT_ASSET_UNAVAILABLE',category:'execution' as const,assessment:'unavailable' as const,summary:'A referenced image could not be embedded',evidence:[ref]}));
      const delivery=checkFilmRequirements(graph,await readFilmRequirements(root,workId));
      const deliveryObservations=delivery.issues.map(issue=>({code:issue.code,category:'quality' as const,assessment:delivery.status==='unverified'?'unavailable' as const:'issue' as const,summary:JSON.stringify(issue),evidence:[`works/${workId}/source/delivery-requirements.json`]}));
      return {content:[{type:'text',text:`Exported ${path}. Local preview: ${previewUrl}. Delivery checks: ${delivery.status}`}],details:{kind:'film_exported',workId,path,format,previewUrl,delivery,exportSourcePaths:['source/story-graph.json'],observations:[...observations,...deliveryObservations]}};
    }};
}
