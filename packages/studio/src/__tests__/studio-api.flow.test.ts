import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAndPersistBookSession,
  createInitialWorkManifestWrite,
  PlayStore,
  createPlayDB,
} from "@actalk/inkos-core";
import { createStudioServer } from "../api/server.js";
import { loadStudioTaskSnapshot, saveStudioTaskSnapshot } from "../api/task-store.js";

describe("Studio API mini-flows", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-studio-flow-"));
    await writeFile(join(root, "inkos.json"), JSON.stringify({
      name: "flow-project",
      version: "2.0.0",
      language: "zh",
      llm: { model: "test-model", provider: "openai" },
      notify: [],
    }));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("clears an explicit service temperature without changing another service or injecting a default", async () => {
    const config = JSON.parse(await readFile(join(root, "inkos.json"), "utf8"));
    config.llm = { ...config.llm, service: "kkaiapi", temperature: 0.8, services: [
      { service: "kkaiapi", temperature: 0.8, models: ["test-model"] },
      { service: "openai", temperature: 0.2 },
    ] };
    await writeFile(join(root, "inkos.json"), JSON.stringify(config));
    const app = createStudioServer({} as never, root);
    const save = (entry: Record<string, unknown>) => app.request("/api/v1/services/config", {
      method: "PUT", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ service:"kkaiapi", services:[{service:"kkaiapi",...entry}] }),
    });
    expect((await save({models:["test-model"]})).status).toBe(200);
    expect(JSON.parse(await readFile(join(root,"inkos.json"),"utf8")).llm.temperature).toBe(0.8);
    expect((await save({temperature:null})).status).toBe(200);
    const persisted = JSON.parse(await readFile(join(root,"inkos.json"),"utf8")).llm;
    expect(persisted.temperature).toBeUndefined();
    expect(persisted.services).toEqual([
      {service:"kkaiapi",models:["test-model"]}, {service:"openai",temperature:0.2},
    ]);
    expect((await save({temperature:0})).status).toBe(200);
    expect(JSON.parse(await readFile(join(root,"inkos.json"),"utf8")).llm.temperature).toBe(0);
  });

  it("protects local API reads and mutations from untrusted browser origins while preserving native and proxy requests", async () => {
    const app = createStudioServer({} as never, root);
    const origin = "https://untrusted.example";
    for (const method of ["GET", "OPTIONS", "POST"] as const) {
      const response = await app.request("/api/v1/sessions", {
        method, headers: {Origin:origin,"Content-Type":"application/json",...(method==="OPTIONS"?{"Access-Control-Request-Method":"POST"}:{})},
        ...(method==="POST"?{body:JSON.stringify({bookId:null})}:{}),
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({error:{code:"STUDIO_ORIGIN_FORBIDDEN"}});
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
    expect(await (await app.request("/api/v1/sessions")).json()).toEqual({sessions:[]});
    const rebound=await app.request("http://untrusted.example/api/v1/sessions",{headers:{Origin:"http://untrusted.example"}});
    expect(rebound.status).toBe(403);
    expect(await rebound.json()).toMatchObject({error:{code:"STUDIO_HOST_FORBIDDEN"}});
    expect((await app.request("/api/v1/sessions",{headers:{Origin:"null"}})).status).toBe(403);
    const localOrigin="http://localhost:4567";
    const created=await app.request(localOrigin+"/api/v1/sessions",{method:"POST",headers:{Origin:localOrigin,"Content-Type":"application/json"},body:JSON.stringify({bookId:null})});
    expect(created.status).toBe(200);
    expect(created.headers.get("Access-Control-Allow-Origin")).toBe(localOrigin);
    expect((await (await app.request("/api/v1/sessions")).json()).sessions).toHaveLength(1);
    const embedded=createStudioServer({} as never,root,{allowedOrigins:["https://trusted.example"]});
    const trusted=await embedded.request("/api/v1/sessions",{headers:{Origin:"https://trusted.example"}});
    expect(trusted.status).toBe(200);
    expect(trusted.headers.get("Access-Control-Allow-Origin")).toBe("https://trusted.example");
    expect((await embedded.request("/api/v1/sessions",{headers:{Origin:"https://trusted.example.evil"}})).status).toBe(403);
  });

  it("serves the same saved scene and choices to a new Work session without creating worlds on read", async () => {
    const store = new PlayStore(root);
    await store.createWorld({ id: "world", title: "Fixture", premise: "Fixture", worldContract: "", visualContract: "", mode: "guided", language: "en" });
    await store.ensureRun("world", "main");
    const db = createPlayDB(store.runDir("world", "main")); db.close?.();
    await store.saveCurrentState("world", "main", { turn: 0 });
    const presentation = { version: 1 as const, renderId: "render-1", turn: 0, sceneText: "Saved scene", suggestedActions: ["Wait", "Leave"] };
    await store.savePresentation("world", "main", presentation);
    const session = await createAndPersistBookSession(root, null, undefined, "work", { workId: "world", profileId: "interactive-world" });
    expect(session.sessionId).not.toBe(session.workId);
    const app = createStudioServer({} as never, root);
    const response = await app.request(`/api/v1/play/runs/${session.workId}/main`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ worldId: "world", mode: "guided", currentPresentation: presentation });
    expect((await app.request(`/api/v1/play/runs/${session.sessionId}/main`)).status).toBe(404);
    await expect(access(join(root, "works", session.sessionId))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("lists initialized books while preserving an unfinished Work in the canonical library", async () => {
    for (const id of ["ready-book", "unfinished-book"]) {
      const initial = createInitialWorkManifestWrite({
        workId: id, title: id, profileId: "longform-novel", language: "en", writes: [],
      });
      await mkdir(join(root, "works", id, "source"), { recursive: true });
      await writeFile(join(root, initial.write.relativePath), initial.write.content);
    }
    await writeFile(join(root, "works/ready-book/source/book.json"), JSON.stringify({
      id: "ready-book", title: "Ready", platform: "local", genre: "mystery",
      status: "outlining", targetChapters: 3, chapterWordCount: 500, language: "en",
      createdAt: "2026-09-09T00:00:00.000Z", updatedAt: "2026-09-09T00:00:00.000Z",
    }));
    const app = createStudioServer({} as never, root);
    const response = await app.request("/api/v1/books");
    const body = await response.json() as { books: Array<{ id: string }>; incompleteWorkIds: string[] };
    const works = await (await app.request("/api/v1/works")).json() as { works: Array<{ id: string }> };
    expect(response.status).toBe(200);
    expect(body.books.map(book => book.id)).toEqual(["ready-book"]);
    expect(body.incompleteWorkIds).toEqual(["unfinished-book"]);
    expect(works.works.map(work => work.id).sort()).toEqual(["ready-book", "unfinished-book"]);
  });

  it("exposes canonical Works and their accepted artifacts", async () => {
    const initial = createInitialWorkManifestWrite({
      workId: "night-script",
      title: "Night Script",
      profileId: "script",
      language: "en",
      writes: [{ relativePath: "works/night-script/source/script.md", content: "# Night Script\n" }],
    });
    await mkdir(join(root, "works", "night-script", "source"), { recursive: true });
    await writeFile(join(root, "works", "night-script", "source", "script.md"), "# Night Script\n");
    await writeFile(join(root, initial.write.relativePath), initial.write.content);
    const app = createStudioServer({} as never, root);

    const list = await app.request("/api/v1/works");
    const detail = await app.request("/api/v1/works/night-script");
    const listBody = await list.json() as { works: Array<{ id: string; profileId: string }> };
    const detailBody = await detail.json() as { work: { id: string; artifacts: unknown[] } };

    expect({
      listStatus: list.status,
      detailStatus: detail.status,
      works: listBody.works.map((work) => [work.id, work.profileId]),
      artifactCount: detailBody.work.artifacts.length,
    }).toEqual({
      listStatus: 200,
      detailStatus: 200,
      works: [["night-script", "script"]],
      artifactCount: 1,
    });
  });

  it("takes a translation upload through creation, inspection, and export", async () => {
    const app = createStudioServer({} as never, root);
    const source = "# 第一章 雨夜\n\n雨水落在旧码头。\n";
    const upload = await app.request("/api/v1/translations/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "source.md",
        dataUrl: `data:text/markdown;base64,${Buffer.from(source).toString("base64")}`,
      }),
    });
    const uploaded = await upload.json() as { storedPath: string };
    const create = await app.request("/api/v1/translations/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filePath: uploaded.storedPath,
        sourceLanguage: "zh",
        targetLanguage: "en",
        title: "Rain Translation",
      }),
    });
    const created = await create.json() as { projectId: string; manifest: { chapters: unknown[] } };
    const list = await app.request("/api/v1/translations");
    const listBody = await list.json() as { translations: Array<{ projectId: string }> };
    const detail = await app.request(`/api/v1/translations/${created.projectId}`);
    const detailBody = await detail.json() as { manifest: { id: string } };
    const exported = await app.request(`/api/v1/translations/${created.projectId}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "md" }),
    });
    const exportBody = await exported.json() as { outputPath: string; chaptersExported: number };

    expect({
      statuses: [upload.status, create.status, list.status, detail.status, exported.status],
      projectId: detailBody.manifest.id,
      listedIds: listBody.translations.map((item) => item.projectId),
      sourceChapters: created.manifest.chapters.length,
      exportedChapters: exportBody.chaptersExported,
    }).toEqual({
      statuses: [200, 200, 200, 200, 200],
      projectId: created.projectId,
      listedIds: [created.projectId],
      sourceChapters: 1,
      exportedChapters: 1,
    });
    await expect(access(exportBody.outputPath)).resolves.toBeUndefined();
    expect((await readFile(exportBody.outputPath)).byteLength).toBeGreaterThan(0);
  });

  it("turns a server-interrupted task snapshot into a terminal session result", async () => {
    const sessionId = "flow-session";
    await createAndPersistBookSession(root, null, sessionId, "short");
    await saveStudioTaskSnapshot(root, {
      version: 1,
      sessionId,
      requestedIntent: "short_run",
      updatedAt: 20,
      execution: {
        id: "short-task",
        tool: "short-fiction__short_fiction_run",
        label: "Short production",
        status: "running",
        startedAt: 10,
      },
    });
    const app = createStudioServer({} as never, root);

    const response = await app.request(`/api/v1/sessions/${sessionId}`);
    const body = await response.json() as { task: { execution: { status: string; completedAt?: number } } };
    const persisted = await loadStudioTaskSnapshot(root, sessionId);

    expect({
      responseStatus: response.status,
      responseTask: body.task.execution.status,
      persistedTask: persisted?.execution.status,
      completed: typeof body.task.execution.completedAt === "number",
    }).toEqual({
      responseStatus: 200,
      responseTask: "error",
      persistedTask: "error",
      completed: true,
    });
  });
});
