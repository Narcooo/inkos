import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createInitialWorkManifestWrite, commitAtomicFileSet, createReplaceWorkArtifactTool, executeExplicitCapabilityTool, loadWorkManifest, createBuiltInWorkProfileRegistry, createAndPersistBookSession, transitionSessionToWork, loadBookSession } from "@actalk/inkos-core";
import { recoverSessionAfterAgentFailure, workSessionResponseMetadata } from "../api/work-session.js";
import { createStudioServer } from "../api/server.js";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
it("keeps explicitly configured models scoped to each custom service protocol", async () => {
  const root = await mkdtemp(join(tmpdir(), "inkos-model-catalog-")); roots.push(root);
  await mkdir(join(root, ".inkos"));
  await writeFile(join(root, "inkos.json"), JSON.stringify({llm:{services:[
    {service:"custom",name:"native",apiFormat:"anthropic",baseUrl:"http://127.0.0.1:1",models:["claude-opus-5"]},
    {service:"custom",name:"responses",apiFormat:"responses",baseUrl:"http://127.0.0.1:1/v1",models:["gpt-5.6-sol"]},
  ]}}));
  await writeFile(join(root, ".inkos/secrets.json"), JSON.stringify({services:{"custom:native":{apiKey:"fixture"},"custom:responses":{apiKey:"fixture"}}}));
  const response = await createStudioServer({} as never, root).request("/api/v1/services/models/custom");
  expect(response.status).toBe(200);
  const {groups} = await response.json();
  expect(groups.map((group:{service:string;models:Array<{id:string}>})=>({service:group.service,models:group.models.map(model=>model.id)}))).toEqual([
    {service:"custom:native",models:["claude-opus-5"]},
    {service:"custom:responses",models:["gpt-5.6-sol"]},
  ]);
});
it("serves actual historical bytes, adopts a revision, and exposes execution and method evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "inkos-workbench-")); roots.push(root);
  const writes = [{ relativePath: "works/probe/source/probe.md", content: JSON.stringify({ version: 1 }) }];
  const initial = createInitialWorkManifestWrite({ workId: "probe", title: "Probe", profileId: "visual-asset", language: "en", writes });
  await commitAtomicFileSet({ rootDir: root, writes: [...writes, initial.write] });
  const session = await createAndPersistBookSession(root, null, undefined, "chat", {modelOverride:"shared-model",serviceOverride:"custom:responses"});
  expect((await transitionSessionToWork(root, session.sessionId, null, "probe")).workId).toBe("probe");
  expect((await loadBookSession(root, session.sessionId))?.profileId).toBe("visual-asset");
  expect((await loadBookSession(root, session.sessionId))?.serviceOverride).toBe("custom:responses");
  const bound = (await loadBookSession(root, session.sessionId))!;
  expect(workSessionResponseMetadata(bound)).toMatchObject({
    sessionId: session.sessionId,
    sessionKind: "work",
    profileId: "visual-asset",
    workId: "probe",
  });
  const failedBookSession = await createAndPersistBookSession(root, null, undefined, "chat", {
    modelOverride: "shared-model",
    serviceOverride: "custom:responses",
  });
  const bookWork = createInitialWorkManifestWrite({ workId: "probe-book", title: "Book", profileId: "longform-novel", language: "en", writes: [] });
  await commitAtomicFileSet({ rootDir: root, writes: [bookWork.write] });
  await transitionSessionToWork(root, failedBookSession.sessionId, null, "probe-book");
  const recoveredBookSession = await recoverSessionAfterAgentFailure(root, failedBookSession.sessionId);
  expect(recoveredBookSession).toMatchObject({
    bookId: "probe-book",
    sessionKind: "book",
    profileId: "longform-novel",
    workId: "probe-book",
    modelOverride: "shared-model",
    serviceOverride: "custom:responses",
  });
  await executeExplicitCapabilityTool({ projectRoot: root, workId: "probe", tool: createReplaceWorkArtifactTool(root, "probe"),
    binding: { capabilityId: "workspace", actionId: "replace_work_artifact", profileId: "visual-asset", risk: "recoverable-write" },
    parameters: { path: "source/probe.md", content: JSON.stringify({ version: 2 }) },
  });
  const artifact = (await loadWorkManifest(root, "probe")).artifacts[0]!;
  const app = createStudioServer({} as never, root);
  const prefix = `/api/v1/works/probe/artifacts/${artifact.id}/revisions`;
  const historical = await (await app.request(`${prefix}/initial`)).json();
  expect(JSON.parse(historical.content)).toEqual({ version: 1 });
  const download=await app.request(`${prefix}/initial?download=1`);
  expect(download.status).toBe(200);
  expect(download.headers.get('content-type')).toBe(historical.revision.contentType);
  expect(download.headers.get('content-disposition')).toContain('attachment;');
  expect(Buffer.from(await download.arrayBuffer())).toEqual(Buffer.from(writes[0]!.content));
  const adoption = await app.request(`${prefix}/initial/adopt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedCurrentRevisionId: artifact.currentRevisionId }) });
  expect(adoption.status).toBe(200);
  const current = (await loadWorkManifest(root, "probe")).artifacts[0]!;
  expect(current.revisions.find(item => item.id === current.currentRevisionId)?.checksum).toBe(artifact.revisions.find(item => item.id === "initial")?.checksum);
  const episodes = await (await app.request("/api/v1/episodes?workId=probe")).json();
  const evidence = await (await app.request(`/api/v1/episodes/${episodes.episodes[0].id}`)).json();
  expect(evidence.events.find((event: {type:string}) => event.type === "action-started").payload.parameters.revisionId).toBe("initial");
  expect(evidence.events.find((event: {type:string}) => event.type === "action-completed").payload.result.status).toBe("success");
  const profile = { ...createBuiltInWorkProfileRegistry().require("visual-asset"), qualityCriteria: ["fixture-contract"] };
  expect((await app.request("/api/v1/profiles/visual-asset", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile) })).status).toBe(200);
  expect(createBuiltInWorkProfileRegistry(root).require("visual-asset").qualityCriteria).toEqual(profile.qualityCriteria);
  const documents = await (await app.request("/api/v1/skills/inkos-story-cover/documents")).json();
  expect(documents.documents.map((document:{path:string}) => document.path)).toContain("references/cover-brief.md");
  expect((await app.request("/api/v1/skills/inkos-story-cover/documents", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(documents) })).status).toBe(200);
});
