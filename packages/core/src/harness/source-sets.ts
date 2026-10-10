import type {WorkManifest} from './contracts.js';

/** Canonical text collections expose ready-to-use references. Briefs, planning
 * documents, exports and old drafts are not substitutes for manuscript text. */
export function currentWorkSourceSets(work:WorkManifest) {
  const current=work.artifacts.flatMap(artifact=>{
    const revision=artifact.revisions.find(item=>item.id===artifact.currentRevisionId);
    return revision?[{workId:work.id,artifactId:artifact.id,revisionId:revision.id,path:revision.path,kind:artifact.kind}]:[];
  });
  const definitions=[
    {id:'novel-manuscript',label:'All available novel chapters in reading order',match:(source:typeof current[number])=>source.kind==='chapter'},
    {id:'short-manuscript',label:'Complete short-fiction manuscript, including opening and chapters',match:(source:typeof current[number])=>source.path==='source/final/full.md'},
    {id:'script',label:'Script text',match:(source:typeof current[number])=>source.kind==='script'},
    {id:'storyboard',label:'Storyboard text',match:(source:typeof current[number])=>source.kind==='storyboard'},
    {id:'interactive-story',label:'Interactive story graph with all scenes and choices',match:(source:typeof current[number])=>source.kind==='story-graph'},
    {id:'translated-manuscript',label:'Translated chapters in reading order',match:(source:typeof current[number])=>source.kind==='translation-chapter'},
  ];
  return definitions.flatMap(definition=>{
    const members=current.filter(source=>definition.match(source)).sort((a,b)=>a.path.localeCompare(b.path,undefined,{numeric:true}));
    return members.length?[{id:definition.id,label:definition.label,sources:members.map(({workId,artifactId,revisionId})=>({workId,artifactId,revisionId}))}]:[];
  });
}
