import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';
import {it,expect} from 'vitest';
import {createWorkManifest,saveWorkManifest,loadWorkManifest} from '../harness/work-store.js';
import {syncWorkSourceArtifacts} from '../harness/source-sync.js';
import {createExportWorkPackageTool} from '../harness/tools/work-artifacts.js';
import {executeExplicitCapabilityTool} from '../harness/explicit-action.js';
import {TurnArtifactDeliveries} from '../agent/turn-completion.js';

it('packages exact manuscript, sales and image revisions, reuses identical exports and detects a changed component',async()=>{
  const root=await mkdtemp(join(tmpdir(),'inkos-package-export-'));
  try{
    await saveWorkManifest(root,createWorkManifest({id:'story',title:'The Key',profileId:'short-fiction',language:'en'}));
    await mkdir(join(root,'works/story/source'),{recursive:true});
    const inputs={
      'final/full.md':Buffer.from('# The Key\n\nThe keeper returns a borrowed key.\n'),
      'final/sales-package.md':Buffer.from('# The Key\n\nA keeper must return a key before dawn.\n'),
      'final/cover.png':Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'),
    };
    const work=await syncWorkSourceArtifacts({projectRoot:root,workId:'story',accept:true,writes:Object.entries(inputs).map(([path,content])=>({relativePath:'works/story/source/'+path,content}))});
    const sourceRefs=work.artifacts.map(a=>({artifactId:a.id,revisionId:a.currentRevisionId!}));
    const pending=await syncWorkSourceArtifacts({projectRoot:root,workId:'story',accept:false,writes:[{relativePath:'works/story/source/notes.md',content:'Unaccepted notes.'}]});
    const note=pending.artifacts.find(a=>a.revisions.some(r=>r.path==='source/notes.md'))!;
    await writeFile(join(root,'works/story/source/final/full.md'),'Unregistered working text.');
    const exportPackage=()=>executeExplicitCapabilityTool({projectRoot:root,workId:'story',tool:createExportWorkPackageTool(root,'story'),parameters:{sourceRefs},binding:{capabilityId:'workspace',actionId:'export_work_package',profileId:'short-fiction',risk:'recoverable-write'}});
    const result=await exportPackage(),data=result.data as {path:string;includedSources:Array<{artifactId:string;revisionId:string;entry:string;checksum:string;byteLength:number}>};
    expect(result.operationReceipts).toEqual([{operation:'export',sources:expect.arrayContaining(sourceRefs.map(source=>({...source,workId:'story',path:work.artifacts.find(a=>a.id===source.artifactId)!.revisions[0]!.path})))}]);
    const bytes=await readFile(join(root,'works/story',data.path)),zip=await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files).sort()).toEqual([...Object.keys(inputs),'inkos-package.json'].sort());
    for(const [entry,expected]of Object.entries(inputs))expect(await zip.file(entry)!.async('nodebuffer')).toEqual(expected);
    const manifest=JSON.parse(await zip.file('inkos-package.json')!.async('string'));
    expect(manifest).toMatchObject({version:1,workId:'story',title:'The Key',sources:data.includedSources});
    for(const source of manifest.sources){const content=await zip.file(source.entry)!.async('nodebuffer');expect(source.checksum).toBe('sha256:'+createHash('sha256').update(content).digest('hex'));expect(source.byteLength).toBe(content.length);}
    const deliveries=new TurnArtifactDeliveries();deliveries.observe(result);await deliveries.validate(root);
    const before=(await loadWorkManifest(root,'story')).artifacts.find(a=>a.revisions.some(r=>r.path===data.path))!;
    await exportPackage();
    expect(await readFile(join(root,'works/story',data.path))).toEqual(bytes);
    const repeated=await loadWorkManifest(root,'story');expect(repeated.artifacts.find(a=>a.id===before.id)!.revisions).toEqual(before.revisions);
    expect(repeated.artifacts.find(a=>a.id===note.id)!.currentRevisionId).toBeNull();
    await syncWorkSourceArtifacts({projectRoot:root,workId:'story',accept:true,acceptPaths:['source/final/sales-package.md'],writes:[{relativePath:'works/story/source/final/sales-package.md',content:'# The Key\n\nAn updated synopsis.\n'}]});
    await expect(exportPackage()).rejects.toMatchObject({code:'ARTIFACT_REVISION_CONFLICT'});
    expect(await readFile(join(root,'works/story',data.path))).toEqual(bytes);
    await expect(deliveries.validate(root)).rejects.toMatchObject({code:'TURN_DELIVERY_STALE'});
  }finally{await rm(root,{recursive:true,force:true});}
});
