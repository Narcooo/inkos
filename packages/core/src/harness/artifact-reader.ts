import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { loadWorkManifest } from "./work-store.js";
import { WorkResourceIdSchema } from "./contracts.js";

/** Read the selected registered revision; never substitute the newest candidate. */
export async function readArtifactRevision(input: {
  projectRoot: string;
  workId: string;
  artifactId: string;
  revisionId?: string;
}) {
  const workId = WorkResourceIdSchema.parse(input.workId);
  const work = await loadWorkManifest(input.projectRoot, workId);
  const artifact = work.artifacts.find(item => item.id === input.artifactId);
  const revision = artifact?.revisions.find(item => item.id === (input.revisionId ?? artifact.currentRevisionId));
  const fail = (code: string, message: string): never => {
    throw Object.assign(new Error(message), { code, recovery: {
      action: "workspace__inspect_work", parameters: { workId },
      reason: "Select a registered artifact and revision from the current inventory; do not guess a file path.",
    } });
  };
  if (artifact?.revisions.length && !input.revisionId && artifact.currentRevisionId === null) {
    return fail("ARTIFACT_REVISION_REQUIRED", "This artifact has no accepted current revision. Supply an explicit revisionId from inspect_work to read a candidate or historical version without adopting it.");
  }
  if (!artifact || !revision) return fail("ARTIFACT_NOT_FOUND", "The requested artifact revision is not registered.");
  const root = await realpath(join(input.projectRoot, "works", workId));
  let path: string;
  try { path = await realpath(join(root, revision.snapshotPath ?? revision.path)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fail("ARTIFACT_SNAPSHOT_UNAVAILABLE", "The registered revision has no readable snapshot.");
    throw error;
  }
  const child = relative(root, path);
  if (child === ".." || child.startsWith("../") || isAbsolute(child)) return fail("ARTIFACT_PATH_OUTSIDE_WORK", "The revision resolves outside its Work.");
  const bytes = await readFile(path);
  if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== revision.checksum) {
    return fail("ARTIFACT_REVISION_CONFLICT", "The stored bytes do not match the registered revision.");
  }
  return { work, artifact, revision, bytes };
}
