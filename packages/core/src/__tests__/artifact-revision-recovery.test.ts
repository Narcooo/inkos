import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createWorkManifest, loadWorkManifest, saveWorkManifest } from "../harness/work-store.js";
import { syncWorkSourceArtifacts } from "../harness/source-sync.js";
import { readArtifactRevision } from "../harness/artifact-reader.js";
import { createInspectWorkTool } from "../agent/agent-tools.js";
import { createArtifactMethodTools } from "../harness/tools/artifact-methods.js";
import { createAdoptWorkRevisionTool } from "../harness/tools/work-artifacts.js";
import { actionFailureFacts } from "../harness/action-observation.js";
import { PipelineRunner } from "../pipeline/runner.js";
import { validatedArtifactWrites } from "../harness/artifact-validation.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture(withCurrent = false) {
  const root = await mkdtemp(join(tmpdir(), "inkos-revision-recovery-")); roots.push(root);
  await saveWorkManifest(root, createWorkManifest({ id: "fixture", title: "Fixture", profileId: "short-fiction", language: "en" }));
  await mkdir(join(root, "works/fixture/source"), { recursive: true });
  const write = (content: string, accept: boolean) => syncWorkSourceArtifacts({ projectRoot: root, workId: "fixture", accept,
    writes: [{ relativePath: "works/fixture/source/outline/v001.md", content }] });
  if (withCurrent) await write("Accepted outline", true);
  const work = await write("Candidate outline", false);
  return { root, artifact: work.artifacts[0]!, revision: work.artifacts[0]!.revisions.at(-1)! };
}

it("includes the exact candidate revision in the readable inventory", async () => {
  const { root, revision } = await fixture();
  const result = await createInspectWorkTool(root).execute("inspect", { workId: "fixture" }, undefined as never, undefined);
  const text = result.content.filter(part => part.type === "text").map(part => part.text).join("\n");
  expect(text).toContain(`revision=${JSON.stringify(revision.id)}`);
});

it.each([false, true])("preserves unregistered source edits when adopting a candidate (current=%s)", async (withCurrent) => {
  const { root, artifact, revision } = await fixture(withCurrent);
  const path = join(root, "works/fixture", revision.path);
  const edited = "Unregistered author edit — must not disappear.\n";
  await writeFile(path, edited);
  await expect(createAdoptWorkRevisionTool(root, "fixture").execute("adopt", {
    artifactId: artifact.id, revisionId: revision.id, expectedCurrentRevisionId: artifact.currentRevisionId,
  }, undefined as never, undefined)).rejects.toMatchObject({ code: "ARTIFACT_REVISION_CONFLICT" });
  expect(await readFile(path, "utf8")).toBe(edited);
  expect((await loadWorkManifest(root, "fixture")).artifacts[0]).toEqual(artifact);
});

it("rejects a stale adoption without overwriting the newly accepted source", async () => {
  const { root, artifact, revision } = await fixture(true);
  const current = await syncWorkSourceArtifacts({ projectRoot: root, workId: "fixture", accept: true,
    writes: [{ relativePath: "works/fixture/source/outline/v001.md", content: "Newly accepted outline" }] });
  await expect(createAdoptWorkRevisionTool(root, "fixture").execute("adopt", {
    artifactId: artifact.id, revisionId: revision.id, expectedCurrentRevisionId: artifact.currentRevisionId,
  }, undefined as never, undefined)).rejects.toMatchObject({ code: "ARTIFACT_REVISION_CONFLICT" });
  expect((await loadWorkManifest(root, "fixture"))).toEqual(current);
  expect((await readArtifactRevision({ projectRoot: root, workId: "fixture", artifactId: artifact.id })).bytes.toString()).toBe("Newly accepted outline");
});

it("preserves hand edits in projections before adopting their authority document", async () => {
  const { root } = await fixture();
  const salesPath = "source/final/sales-package.json";
  const writePackage = async (intro: string) => {
    const work = await loadWorkManifest(root, "fixture");
    const content = JSON.stringify({ title: "Fixture", intro, sellingPoints: ["A fixture"], coverPrompt: "A fixture cover" });
    return syncWorkSourceArtifacts({ projectRoot: root, workId: "fixture", accept: true,
      writes: validatedArtifactWrites(work, salesPath, content) });
  };
  const first = await writePackage("Original introduction");
  const original = first.artifacts.find(item => item.revisions.some(revision => revision.path === salesPath))!;
  const before = await writePackage("New introduction");
  const current = before.artifacts.find(item => item.id === original.id)!;
  const projectionPath = join(root, "works/fixture/source/final/cover-prompt.md");
  await writeFile(projectionPath, "An unregistered cover edit");
  await expect(createAdoptWorkRevisionTool(root, "fixture").execute("adopt", {
    artifactId: original.id, revisionId: original.currentRevisionId!, expectedCurrentRevisionId: current.currentRevisionId,
  }, undefined as never, undefined)).rejects.toMatchObject({ code: "ARTIFACT_REVISION_CONFLICT" });
  expect(await readFile(projectionPath, "utf8")).toBe("An unregistered cover edit");
  expect(await loadWorkManifest(root, "fixture")).toEqual(before);
  expect(JSON.parse(await readFile(join(root, "works/fixture", salesPath), "utf8")).intro).toBe("New introduction");
});

it("explains that a registered candidate needs an explicit revision instead of calling it missing", async () => {
  const { root, artifact, revision } = await fixture();
  await expect(readArtifactRevision({ projectRoot: root, workId: "fixture", artifactId: artifact.id }))
    .rejects.toMatchObject({ code: "ARTIFACT_REVISION_REQUIRED", recovery: { action: "workspace__inspect_work" } });
  const selected = await readArtifactRevision({ projectRoot: root, workId: "fixture", artifactId: artifact.id, revisionId: revision.id });
  expect(selected.bytes.toString()).toBe("Candidate outline");
  expect((await loadWorkManifest(root, "fixture")).artifacts[0]!.currentRevisionId).toBeNull();
});

it.each([false, true])("explains a candidate revision conflict without adopting or editing it (current=%s)", async (withCurrent) => {
  const { root, artifact, revision } = await fixture(withCurrent);
  const pipeline = new PipelineRunner({ client: {} as never, model: "unused", projectRoot: root });
  const tool = createArtifactMethodTools(pipeline, root, "fixture").find(tool => tool.name === "revise_work_artifact")!;
  const failure = await tool.execute("revise", { artifactId: artifact.id, revisionId: revision.id, instruction: "Revise this outline." }, undefined as never, undefined)
    .then(() => { throw new Error("Unexpected revision success"); }, error => actionFailureFacts(error));
  expect(failure).toMatchObject({ code: "ARTIFACT_REVISION_CONFLICT", recovery: {
    action: "workspace__inspect_work", parameters: { workId: "fixture" }, artifactId: artifact.id,
    requestedRevisionId: revision.id, currentRevisionId: artifact.currentRevisionId,
  } });
  expect(failure.message).toContain("adopt_work_revision");
  expect((await loadWorkManifest(root, "fixture")).artifacts[0]).toEqual(artifact);

  if (withCurrent) {
    expect((await readArtifactRevision({ projectRoot: root, workId: "fixture", artifactId: artifact.id })).bytes.toString()).toBe("Accepted outline");
  }
  await createAdoptWorkRevisionTool(root, "fixture").execute("adopt", {
    artifactId: artifact.id, revisionId: revision.id, expectedCurrentRevisionId: artifact.currentRevisionId,
  }, undefined as never, undefined);
  const current = await readArtifactRevision({ projectRoot: root, workId: "fixture", artifactId: artifact.id });
  expect(current.revision.id).toBe(revision.id);
  expect(current.bytes.toString()).toBe("Candidate outline");
});
