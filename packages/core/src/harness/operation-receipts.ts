import {isAbsolute,join,relative} from 'node:path';
import {OperationReceiptSchema,type OperationReceipt} from './contracts.js';
import {loadWorkManifest} from './work-store.js';
import {readArtifactRevision} from './artifact-reader.js';
import {toPosixPath} from '../utils/posix-path.js';
import {chapterReviewContentHash} from '../utils/chapter-review-hash.js';
import type {Observation} from '../models/observation.js';

/** The producer's chapter groups establish finding ownership, including when
 * replaying recorded actions whose findings predate explicit target binding. */
export function bindChapterReviewObservations(details:Record<string,any>,observations:readonly Observation[],chapterTargets:ReadonlyMap<number,NonNullable<Observation['target']>>):Observation[]{
  const chapters=Array.isArray(details.reviewedChapters)?details.reviewedChapters:[];
  const groups=Array.isArray(details.chapters)&&details.chapters.every((chapter:any)=>Array.isArray(chapter.observations))
    ?details.chapters:chapters.length===1?[{chapterNumber:chapters[0].chapterNumber,observations}]:[];
  const targets=groups.flatMap((chapter:any)=>chapter.observations.map(()=>chapterTargets.get(chapter.chapterNumber)));
  return targets.length===observations.length?observations.map((observation,index)=>
    observation.target||!targets[index]?observation:{...observation,target:targets[index]}):[...observations];
}

/** Only domain-produced completion facts become receipts. Reading, technical
 * inspection and a model's narrative claim do not establish an operation. */
export async function resolveOperationEvidence(root:string,details:unknown,observations:readonly Observation[]){
  const empty={operationReceipts:[] as OperationReceipt[],observations:[...observations]};
  if(!details||typeof details!=='object')return empty;
  const data=details as Record<string,any>;
  const workId=data.workId;
  if(typeof workId!=='string')return empty;
  const receipts:OperationReceipt[]=[];
  const chapterTargets=new Map<number,NonNullable<Observation['target']>>();
  const direct=(operation:OperationReceipt['operation'],artifactId:unknown,revisionId:unknown)=>{
    if(typeof artifactId==='string'&&typeof revisionId==='string')receipts.push({operation,sources:[{workId,artifactId,revisionId}]});
  };
  if(data.kind==='artifact_reviewed'||data.kind==='artifact_delivered')direct('review',data.artifactId,data.revisionId);
  if(data.kind==='artifact_delivered')direct('export',data.artifactId,data.revisionId);
  if(data.kind==='work_exported')direct('export',data.sourceArtifactId,data.sourceRevisionId);
  if(data.reviewedArtifact)direct('review',data.reviewedArtifact.artifactId,data.reviewedArtifact.revisionId);
  const pathsFor=new Map<OperationReceipt['operation'],string[]>();
  for(const operation of ['review','export'] as const){
    const paths=data[operation+'SourcePaths'];
    if(Array.isArray(paths)&&paths.every(path=>typeof path==='string'))pathsFor.set(operation,paths);
  }
  const chapters=Array.isArray(data.reviewedChapters)?data.reviewedChapters:[];
  if(pathsFor.size||chapters.length){
    const work=await loadWorkManifest(root,workId);
    const current=work.artifacts.flatMap(artifact=>{
      const revision=artifact.revisions.find(revision=>revision.id===artifact.currentRevisionId);
      return revision?[{artifact,revision}]:[];
    });
    for(const [operation,paths] of pathsFor){
      const sources=paths.map(path=>{
        const normalized=toPosixPath(isAbsolute(path)?relative(join(root,'works',workId),path):path);
        const workPrefix=`works/${workId}/`,workPath=normalized.startsWith(workPrefix)?normalized.slice(workPrefix.length):normalized;
        const found=current.find(item=>item.revision.path===workPath);
        if(!found)throw Object.assign(new Error(`Completed operation source is not registered: ${workPath}`),{code:'OPERATION_SOURCE_MISSING'});
        return{workId,artifactId:found.artifact.id,revisionId:found.revision.id,path:found.revision.path};
      });
      if(sources.length)receipts.push({operation,sources});
    }
    for(const chapter of chapters){
      if(typeof chapter.chapterNumber!=='number'||typeof chapter.contentHash!=='string')continue;
      const prefix=`source/chapters/${String(chapter.chapterNumber).padStart(4,'0')}_`;
      const source=current.find(item=>item.revision.path.startsWith(prefix)&&item.revision.path.endsWith('.md'));
      if(!source)continue;
      const {bytes}=await readArtifactRevision({projectRoot:root,workId,artifactId:source.artifact.id,revisionId:source.revision.id});
      if(chapterReviewContentHash(bytes.toString('utf8'),chapter.chapterNumber)===chapter.contentHash){
        direct('review',source.artifact.id,source.revision.id);
        chapterTargets.set(chapter.chapterNumber,{workId,artifactId:source.artifact.id,revisionId:source.revision.id});
      }
    }
  }
  // A batch exposes one flattened findings list, but each finding belongs to
  // its chapter review. Bind by the producer's chapter grouping before those
  // findings reach per-artifact delivery checks.
  return {operationReceipts:OperationReceiptSchema.array().parse(receipts),observations:bindChapterReviewObservations(data,observations,chapterTargets)};
}
