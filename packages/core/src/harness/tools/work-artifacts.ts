import { createBuiltInWorkProfileRegistry } from "../builtin-profiles.js";
import { Type, type Static } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createHash } from "node:crypto";
import { validatedArtifactWrites } from "../artifact-validation.js";
import { assertGenericArtifactEditable } from '../artifact-edit-policy.js';
import { loadWorkManifest } from "../work-store.js";
import { syncWorkSourceArtifacts } from "../source-sync.js";
import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { readArtifactRevision } from "../artifact-reader.js";
import { changedSourceRegion } from "../../utils/source-text.js";
import JSZip from 'jszip';
import {RelativeArtifactPathSchema} from '../contracts.js';

const ExportWorkParams = Type.Object({
  artifactId: Type.String({ minLength: 1, description: "Exact current Markdown artifact ID from inspect_work." }),
  expectedRevisionId: Type.Optional(Type.String({ description: "Require this current revision, for example the version just reviewed." })),
});

export function createExportWorkTool(projectRoot: string, workId: string): AgentTool<typeof ExportWorkParams> & { readonly artifactsCommitted: true } {
  return {
    artifactsCommitted: true,
    name: "export_work", label: "Export current manuscript",
    description: "Export a current Markdown manuscript without reviewing it. If the user requests both review and export, use review_and_export_work_artifact. Use the exact artifact ID from inspect_work.",
    parameters: ExportWorkParams,
    async execute(_id, params) {
      const { work, artifact, revision, bytes } = await readArtifactRevision({ projectRoot, workId, artifactId: params.artifactId });
      if (params.expectedRevisionId && params.expectedRevisionId !== revision.id) {
        throw Object.assign(new Error("The current artifact changed after review. Review the new revision before exporting it."), { code: "ARTIFACT_REVISION_CONFLICT" });
      }
      if (!revision.path.endsWith(".md") || revision.path.startsWith("source/exports/")) {
        throw Object.assign(new Error("Select a source Markdown artifact"), { code: "ARTIFACT_EXPORT_FORMAT_UNSUPPORTED" });
      }
      const outputPath = `source/exports/${encodeURIComponent(artifact!.id)}.md`;
      await syncWorkSourceArtifacts({ projectRoot, workId, accept: true, acceptPaths: [outputPath],
        writes: [{ relativePath: `works/${workId}/${outputPath}`, content: bytes }],
      });
      return { content: [{ type: "text", text: `Exported ${work.title}: works/${workId}/${outputPath}` }],
        details: { kind: "work_exported", workId, sourceArtifactId: artifact!.id, sourceRevisionId: revision.id, path: outputPath } };
    },
  };
}

const ExportPackageParams=Type.Object({
  sourceRefs:Type.Array(Type.Object({artifactId:Type.String({minLength:1}),revisionId:Type.String({minLength:1})},{additionalProperties:false}),{
    minItems:1,description:'Every current source artifact to include, using exact versions from inspect_work. For a complete short-fiction delivery, include the full manuscript Markdown, sales-package Markdown and requested cover image. Include other files only when requested.',
  }),
},{additionalProperties:false});

export function createExportWorkPackageTool(projectRoot:string,workId:string):AgentTool<typeof ExportPackageParams>&{readonly artifactsCommitted:true}{
  return{artifactsCommitted:true,name:'export_work_package',label:'Export delivery package',parameters:ExportPackageParams,
    description:'Create one downloadable ZIP containing the selected current source files and their version manifest. Copies verified bytes without rewriting content. Include every requested deliverable explicitly; this action does not generate or review missing content. Report the returned included-file list and package location. Content descriptions require reading those sources; export success does not establish a review result.',
    async execute(_id,params){
      if(new Set(params.sourceRefs.map(source=>source.artifactId)).size!==params.sourceRefs.length)throw Object.assign(new Error('Select each source artifact once.'),{code:'WORK_PACKAGE_DUPLICATE_SOURCE'});
      const work=await loadWorkManifest(projectRoot,workId),zip=new JSZip();
      const sources=[];
      for(const ref of params.sourceRefs){
        const {artifact,revision,bytes}=await readArtifactRevision({projectRoot,workId,artifactId:ref.artifactId});
        if(revision.id!==ref.revisionId)throw Object.assign(new Error('A selected source changed. Inspect current sources before exporting the package.'),{code:'ARTIFACT_REVISION_CONFLICT',artifactId:ref.artifactId,expectedRevisionId:ref.revisionId,currentRevisionId:revision.id});
        if(!revision.path.startsWith('source/')||revision.path.startsWith('source/exports/'))throw Object.assign(new Error('Package current source artifacts, not earlier export copies.'),{code:'WORK_PACKAGE_SOURCE_REQUIRED'});
        const entry=revision.path.slice('source/'.length);
        if(!RelativeArtifactPathSchema.safeParse(entry).success||entry!==posix.normalize(entry)||entry.includes('\\'))throw Object.assign(new Error('Package entries require canonical relative paths.'),{code:'WORK_PACKAGE_ENTRY_INVALID'});
        sources.push({artifactId:artifact.id,revisionId:revision.id,checksum:revision.checksum,path:revision.path,entry,byteLength:bytes.length,bytes});
      }
      sources.sort((a,b)=>a.entry<b.entry?-1:a.entry>b.entry?1:0);
      const manifestEntry='inkos-package.json';
      if(sources.some(source=>source.entry===manifestEntry)||new Set(sources.map(source=>source.entry)).size!==sources.length)throw Object.assign(new Error('Package source paths collide.'),{code:'WORK_PACKAGE_ENTRY_CONFLICT'});
      const includedSources=sources.map(({bytes,...source})=>source);
      const fileOptions={date:new Date(1980,0,1),createFolders:false,unixPermissions:0o644};
      for(const source of sources)zip.file(source.entry,source.bytes,fileOptions);
      zip.file(manifestEntry,JSON.stringify({version:1,workId,title:work.title,sources:includedSources},null,2)+'\n',fileOptions);
      const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6},platform:'UNIX'});
      const path='source/exports/delivery.zip';
      await syncWorkSourceArtifacts({projectRoot,workId,accept:true,acceptPaths:[path],writes:[{relativePath:`works/${workId}/${path}`,content:bytes}]});
      return{content:[{type:'text',text:`Exported ${work.title}: works/${workId}/${path}\nIncluded files:\n${includedSources.map(source=>'- '+source.entry).join('\n')}`}],
        details:{kind:'work_package_exported',workId,path,includedSources,manifestEntry,byteLength:bytes.length,checksum:'sha256:'+createHash('sha256').update(bytes).digest('hex'),exportSourcePaths:sources.map(source=>source.path)}};
    },
  };
}

const ReplaceWorkArtifactParams = Type.Object({
  artifactId: Type.Optional(Type.String({ minLength: 1, description: "Preferred: exact artifact ID from inspect_work." })),
  path: Type.Optional(Type.String({ minLength: 1, description: "Alternatively use the registered Work-relative source/ path or project-relative works/<id>/source/ path shown by inspect_work." })),
  content: Type.String({ description: "Complete replacement text." }),
  expectedRevisionId: Type.Optional(Type.String({ description: "Optional optimistic-lock revision id from the Work manifest." })),
});

export function createReplaceWorkArtifactTool(
  projectRoot: string,
  workId: string,
): AgentTool<typeof ReplaceWorkArtifactParams> & { readonly artifactsCommitted: true } {
  return {
    artifactsCommitted: true,
    name: "replace_work_artifact",
    label: "Replace Work Artifact",
    description:
      "Replace one registered text artifact in the current Work. The path must already be the current source/ revision; " +
      "this cannot create arbitrary files or edit binary artifacts.",
    parameters: ReplaceWorkArtifactParams,
    async execute(_toolCallId, params: Static<typeof ReplaceWorkArtifactParams>) {
      const work = await loadWorkManifest(projectRoot, workId);
      const profile = createBuiltInWorkProfileRegistry(projectRoot).require(work.profileId);
      if (!params.artifactId && !params.path) throw Object.assign(new Error("Supply artifactId or path"), { code: "ARTIFACT_REF_REQUIRED" });
      const projectPrefix = `works/${workId}/`;
      const path = params.path?.startsWith(projectPrefix) ? params.path.slice(projectPrefix.length) : params.path;
      const artifact = work.artifacts.find(candidate => params.artifactId ? candidate.id === params.artifactId : candidate.revisions.some(revision => revision.id === candidate.currentRevisionId && revision.path === path));
      const current = artifact?.revisions.find((revision) => revision.id === artifact.currentRevisionId);
      if (!artifact || !current) throw Object.assign(new Error(`Current Work artifact not found: ${params.artifactId ?? params.path}`), { code: "ARTIFACT_NOT_FOUND" });
      if (path && path !== current.path) throw Object.assign(new Error("Artifact ID and path identify different resources"), { code: "ARTIFACT_REF_MISMATCH" });
      if (!current.path.startsWith("source/")) throw new Error(`Work artifact is not editable source: ${current.path}`);
      if (!(current.contentType.startsWith("text/") || current.contentType === "application/json")) {
        throw new Error(`Work artifact is not text: ${current.path}`);
      }
      if (params.expectedRevisionId && params.expectedRevisionId !== current.id) {
        throw Object.assign(new Error(`Work artifact changed: expected ${params.expectedRevisionId}, current ${current.id}`), { code: "ARTIFACT_REVISION_CONFLICT" });
      }
      const currentContent = await readFile(join(projectRoot, "works", workId, current.path), "utf-8");
      if (currentContent === params.content) throw new Error(`Work artifact already has the supplied content: ${current.path}`);
      if (current.checksum !== `sha256:${createHash("sha256").update(currentContent).digest("hex")}`) {
        throw Object.assign(new Error("Source changed since its registered revision"), { code: "ARTIFACT_REVISION_CONFLICT" });
      }
      const writes = validatedArtifactWrites(work, current.path, params.content, profile,currentContent);
      const updated = await syncWorkSourceArtifacts({ projectRoot, workId, accept: true, writes, acceptPaths:writes.map(write=>write.relativePath.slice(`works/${workId}/`.length)),
        ...(current.path === "source/final/short-story.json" ? { title: JSON.parse(params.content).storyTitle } : {}),
      });
      const revisionId = updated.artifacts.find(item => item.id === artifact.id)!.currentRevisionId!;
      const saved = await readArtifactRevision({projectRoot, workId, artifactId: artifact.id, revisionId});
      return {
        content: [{ type: "text", text: `Replaced ${current.path} in "${work.title}".` }],
        details: {
          kind: "work_artifact_replaced",
          workId,
          artifactId: artifact.id,
          previousRevisionId: current.id,
          revisionId,
          changedRegion: changedSourceRegion(currentContent, saved.bytes.toString('utf8')),
          path: current.path,
        },
      };
    },
  };
}

const AdoptWorkRevisionParams = Type.Object({
  artifactId: Type.String(), revisionId: Type.String(),
  expectedCurrentRevisionId: Type.Union([Type.String(), Type.Null()]),
});

export function createAdoptWorkRevisionTool(projectRoot: string, workId: string): AgentTool<typeof AdoptWorkRevisionParams> & { readonly artifactsCommitted: true } {
  return {
    artifactsCommitted: true,
    name: "adopt_work_revision", label: "Adopt work revision",
    description: "Adopt an inspected candidate or historical revision with an explicit current-version check. Validates authority documents and updates their projections atomically.",
    parameters: AdoptWorkRevisionParams,
    async execute(_toolCallId, params) {
      const work = await loadWorkManifest(projectRoot, workId);
      const profile = createBuiltInWorkProfileRegistry(projectRoot).require(work.profileId);
      const artifact = work.artifacts.find(artifact => artifact.id === params.artifactId);
      const revision = artifact?.revisions.find(revision => revision.id === params.revisionId);
      if (!artifact || !revision) throw Object.assign(new Error("Unknown artifact revision"), { code: "ARTIFACT_NOT_FOUND" });
      assertGenericArtifactEditable(work,revision.path,profile);
      if (artifact.currentRevisionId !== params.expectedCurrentRevisionId) throw Object.assign(new Error("Current revision changed"), { code: "ARTIFACT_REVISION_CONFLICT" });
      if (!revision.path.startsWith("source/")) throw Object.assign(new Error("Use this domain's revision action"), { code: "ARTIFACT_DERIVED" });
      const bytes = await readFile(join(projectRoot, "works", workId, revision.snapshotPath ?? revision.path));
      if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== revision.checksum) throw Object.assign(new Error("Revision snapshot does not match recorded content"), { code: "ARTIFACT_SNAPSHOT_UNAVAILABLE" });
      const currentBytes=artifact.currentRevisionId?(await readArtifactRevision({projectRoot,workId,artifactId:artifact.id,revisionId:artifact.currentRevisionId})).bytes:undefined;
      const writes = revision.contentType.startsWith("text/") || revision.contentType === "application/json"
        ? validatedArtifactWrites(work, revision.path, bytes.toString("utf8"), profile,currentBytes?.toString("utf8"))
        : [{ relativePath: join("works", workId, revision.path), content: bytes }];
      await syncWorkSourceArtifacts({ projectRoot, workId, accept: true, writes,
        ...(revision.path === "source/final/short-story.json" ? { title: JSON.parse(bytes.toString("utf8")).storyTitle } : {}),
      });
      return { content: [{ type: "text", text: `Adopted revision ${revision.id}.` }], details: {
        kind: "work_revision_adopted", workId, artifactId: artifact.id, revisionId: revision.id, previousRevisionId: artifact.currentRevisionId,
      } };
    },
  };
}
