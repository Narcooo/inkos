import {readFile} from 'node:fs/promises';
import {basename,isAbsolute,join,relative,sep} from 'node:path';
import {Type} from '@sinclair/typebox';
import {safeChildPath} from '../utils/path-safety.js';
import {ingestMaterial} from '../materials/ingest.js';
import {readArtifactRevision} from '../harness/artifact-reader.js';
import {loadWorkManifest} from '../harness/work-store.js';
import {syncWorkSourceArtifacts} from '../harness/source-sync.js';
import {currentExecutionAuthorRequest} from '../harness/execution-evidence.js';
import type {WorkLineage,WorkManifest} from '../harness/contracts.js';

export const CreationSourceReference = Type.Object({
  workId:Type.String(),artifactId:Type.String(),revisionId:Type.Optional(Type.String()),
},{additionalProperties:false,description:'For an existing Work, select its registered source artifact and exact revision. Never replace its text with a summary.'});

export const CreationSourceReferences = Type.Array(CreationSourceReference, {
  minItems: 1,
  description: 'Ordered source artifacts covering the full material requested by the author, such as several chapters. Include every requested artifact; each exact revision is preserved for production and review. Use instead of source, sourceText or sourcePath.',
});

export interface CreationSource {
  readonly text:string;
  readonly name:string;
  readonly lineage:WorkLineage[];
}
interface CreationArtifactReference {workId:string;artifactId:string;revisionId?:string}

export async function loadCreationSource(input:{
  projectRoot:string;targetWorkId?:string;
  source?:CreationArtifactReference;
  sources?:ReadonlyArray<CreationArtifactReference>;
  sourceText?:string;sourcePath?:string;sourceName?:string;purpose:'reference';
}):Promise<CreationSource>{
  let previous:WorkManifest|undefined;
  if(input.targetWorkId){
    try{previous=await loadWorkManifest(input.projectRoot,input.targetWorkId);}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
  if([input.source,input.sources,input.sourceText?.trim(),input.sourcePath?.trim()].filter(Boolean).length>1)throw Object.assign(new Error('Select one source input: a reference, ordered references, a file, or supplied text.'),{code:'CREATION_SOURCE_CONFLICT'});
  const readRegistered=async(reference:CreationArtifactReference):Promise<CreationSource>=>{
    const pinned=previous?.lineage.find(item=>item.sourceWorkId===reference.workId&&item.sourceArtifactId===reference.artifactId);
    const source=await readArtifactRevision({projectRoot:input.projectRoot,...reference,revisionId:reference.revisionId??pinned?.sourceRevisionId});
    if(!source.revision.contentType.startsWith('text/')&&source.revision.contentType!=='application/json')throw Object.assign(new Error('Select a registered text manuscript or structured text artifact.'),{code:'SOURCE_NOT_TEXT'});
    return {text:source.bytes.toString('utf8'),name:input.sourceName?.trim()||source.work.title,
      lineage:[{relation:'derived-from',sourceWorkId:source.work.id,sourceArtifactId:source.artifact.id,sourceRevisionId:source.revision.id}]};
  };
  let result:CreationSource;
  if(input.sources){
    if(!input.sources.length)throw Object.assign(new Error('Select at least one source artifact.'),{code:'CREATION_SOURCE_REQUIRED'});
    const identities=input.sources.map(source=>JSON.stringify([source.workId,source.artifactId]));
    if(new Set(identities).size!==identities.length)throw Object.assign(new Error('Select each source artifact once.'),{code:'CREATION_SOURCE_CONFLICT'});
    const sources=await Promise.all(input.sources.map(readRegistered));
    result={text:sources.map(source=>source.text).join('\n\n'),name:input.sourceName?.trim()||[...new Set(sources.map(source=>source.name))].join(' / '),lineage:sources.flatMap(source=>source.lineage)};
  }else if(input.source){
    result=await readRegistered(input.source);
  }else if(input.sourceText?.trim()){
    const author=currentExecutionAuthorRequest();
    if(author!==undefined&&!author.includes(input.sourceText.trim()))throw Object.assign(new Error('Inline source text must be supplied verbatim by the author. For existing material, select its registered source or file path instead of summarizing it.'),{
      code:'SOURCE_REFERENCE_REQUIRED',recovery:{action:'workspace__list_works',reason:'Find the source Work, inspect its artifacts, and pass the selected source reference.'},
    });
    result={text:input.sourceText.trim(),name:input.sourceName?.trim()||'source',lineage:[]};
  }else{
    if(!input.sourcePath?.trim())throw Object.assign(new Error('Select a source artifact, file path, or author-supplied text.'),{code:'CREATION_SOURCE_REQUIRED'});
    if(isAbsolute(input.sourcePath))throw new Error('Creation sourcePath must be project-relative. Upload or ingest the file first.');
    const path=safeChildPath(input.projectRoot,input.sourcePath),parts=relative(input.projectRoot,path).split(sep);
    let reference:CreationArtifactReference|undefined;
    if(parts[0]==='works'&&parts[1]){
      const work=await loadWorkManifest(input.projectRoot,parts[1]);
      const workPath=parts.slice(2).join('/');
      const artifact=work.artifacts.find(a=>a.revisions.some(r=>r.path===workPath&&(r.id===a.currentRevisionId||previous?.lineage.some(p=>p.sourceArtifactId===a.id&&p.sourceRevisionId===r.id))));
      if(!artifact)throw Object.assign(new Error('Work source must be a registered artifact; inspect the source Work for its accepted versions.'),{code:'SOURCE_ARTIFACT_REQUIRED'});
      reference={workId:work.id,artifactId:artifact.id};
    }
    if(reference)result=await readRegistered(reference);
    else{
      const material=await ingestMaterial(input.projectRoot,{sourceKind:'file',filePath:path,filename:basename(path),title:input.sourceName?.trim()||basename(path).replace(/\.[^.]+$/u,''),purpose:input.purpose});
      result={text:await readFile(join(input.projectRoot,material.markdownPath),'utf8'),name:input.sourceName?.trim()||material.title,lineage:[]};
    }
  }
  const bound=previous?.artifacts.find(a=>a.revisions.some(r=>r.id===a.currentRevisionId&&r.path==='source/source-material.md'));
  if(bound){
    const original=await readArtifactRevision({projectRoot:input.projectRoot,workId:previous!.id,artifactId:bound.id});
    const pinned=previous!.lineage.filter(item=>item.sourceRevisionId);
    const identities=(items:ReadonlyArray<WorkLineage>)=>items.map(item=>[item.sourceWorkId,item.sourceArtifactId,item.sourceRevisionId].join('/')).sort();
    if(original.bytes.toString('utf8')!==result.text||JSON.stringify(identities(pinned))!==JSON.stringify(identities(result.lineage)))throw Object.assign(new Error('This draft already has a different source. Resume with its pinned source or create another Work.'),{code:'CREATION_SOURCE_CONFLICT'});
  }
  return result;
}

/** Bind source bytes and their exact lineage together before model production. */
export async function bindCreationSource(projectRoot:string,workId:string,source:CreationSource):Promise<void>{
  const work=await loadWorkManifest(projectRoot,workId);
  const lineage=work.lineage.filter(item=>!source.lineage.some(ref=>ref.sourceWorkId===item.sourceWorkId));
  await syncWorkSourceArtifacts({projectRoot,workId,accept:true,status:work.status,lineage:[...lineage,...source.lineage],
    writes:[{relativePath:join('works',workId,'source/source-material.md'),content:source.text}]});
}
