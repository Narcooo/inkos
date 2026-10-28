import { createBuiltInWorkProfileRegistry } from "../builtin-profiles.js";
import { Type, type Static } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createHash } from "node:crypto";
import { validatedArtifactWrites } from "../artifact-validation.js";
import { assertGenericArtifactEditable } from '../artifact-edit-policy.js';
import { loadWorkManifest } from "../work-store.js";
import { syncWorkSourceArtifacts } from "../source-sync.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readArtifactRevision } from "../artifact-reader.js";
import { changedSourceRegion } from "../../utils/source-text.js";

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
      // A candidate can legitimately occupy source/ while current still points to
      // an older snapshot. Allow any registered version, but never discard an
      // unregistered author edit, including edits to regenerated projections.
      for (const write of writes) {
        let sourceBytes: Buffer;
        try { sourceBytes = await readFile(join(projectRoot, write.relativePath)); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
        const sourcePath = write.relativePath.slice(join("works", workId).length + 1).replaceAll("\\", "/");
        const checksum = `sha256:${createHash("sha256").update(sourceBytes).digest("hex")}`;
        if (!work.artifacts.some(item => item.revisions.some(version => version.path === sourcePath && version.checksum === checksum))) {
          throw Object.assign(new Error(`Source has unregistered changes: ${sourcePath}. Preserve and register these edits before adopting another revision. No text was changed.`), {
            code: "ARTIFACT_REVISION_CONFLICT",
            recovery: { action: "workspace__inspect_work", parameters: { workId },
              reason: "The source file differs from every registered version. Preserve the on-disk edits and reconcile them with the Work before retrying adoption." },
          });
        }
      }
      await syncWorkSourceArtifacts({ projectRoot, workId, accept: true, writes,
        ...(revision.path === "source/final/short-story.json" ? { title: JSON.parse(bytes.toString("utf8")).storyTitle } : {}),
      });
      return { content: [{ type: "text", text: `Adopted revision ${revision.id}.` }], details: {
        kind: "work_revision_adopted", workId, artifactId: artifact.id, revisionId: revision.id, previousRevisionId: artifact.currentRevisionId,
      } };
    },
  };
}
