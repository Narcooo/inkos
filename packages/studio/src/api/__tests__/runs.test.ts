import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StudioRun } from "../../shared/contracts.js";
import { createApp } from "../app.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 1000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition.");
}

describe("run APIs", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function createProjectFixture(): Promise<string> {
    const projectRoot = await mkdtemp(join(tmpdir(), "inkos-studio-runs-"));
    tempRoots.push(projectRoot);

    const bookDir = join(projectRoot, "books", "jade-city");
    const chaptersDir = join(bookDir, "chapters");

    await mkdir(chaptersDir, { recursive: true });

    await writeFile(join(projectRoot, "inkos.json"), JSON.stringify({
      llm: {
        provider: "openai",
        apiKey: "test-key",
        model: "test-model",
      },
    }, null, 2));

    await writeFile(join(bookDir, "book.json"), JSON.stringify({
      id: "jade-city",
      title: "Jade City",
      platform: "qidian",
      genre: "urban-fantasy",
      status: "active",
      targetChapters: 12,
      chapterWordCount: 2500,
      language: "en",
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-02T00:00:00.000Z",
    }, null, 2));

    await writeFile(join(chaptersDir, "index.json"), JSON.stringify([
      {
        number: 1,
        title: "The Door Opens",
        status: "audit-failed",
        wordCount: 1234,
        createdAt: "2026-03-01T10:00:00.000Z",
        updatedAt: "2026-03-01T11:00:00.000Z",
        auditIssues: ["[warning] tighten ending beat"],
        lengthWarnings: [],
      },
    ], null, 2));

    await writeFile(join(chaptersDir, "0001_the-door-opens.md"), "# The Door Opens\n\nA first chapter.\n");

    return projectRoot;
  }

  it("creates runs, exposes them in the run list, and streams snapshot events", async () => {
    const projectRoot = await createProjectFixture();
    const app = createApp({
      projectRoot,
      runExecutor: async ({ emitStage, emitLog }) => {
        emitStage("writing draft");
        emitLog("Draft is underway.");
        return { summary: "Draft completed." };
      },
    });

    const createResponse = await app.request("/api/books/jade-city/actions/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(createResponse.status).toBe(202);
    const createdRun = await createResponse.json() as StudioRun;
    expect(createdRun).toEqual({
      id: expect.any(String),
      bookId: "jade-city",
      chapter: null,
      chapterNumber: null,
      action: "draft",
      status: "running",
      stage: expect.any(String),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      startedAt: expect.any(String),
      finishedAt: null,
      logs: expect.arrayContaining([
        expect.objectContaining({ message: "Draft is underway." }),
      ]),
    });

    await waitFor(async () => {
      const runsResponse = await app.request("/api/runs");
      const runs = await runsResponse.json() as Array<StudioRun>;
      return runs.some((run: { id: string; status: string }) => run.id === createdRun.id && run.status === "succeeded");
    });

    const listResponse = await app.request("/api/runs");
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual([
      expect.objectContaining({
        id: createdRun.id,
        bookId: "jade-city",
        action: "draft",
        logs: expect.arrayContaining([
          expect.objectContaining({ message: "Draft is underway." }),
        ]),
        result: { summary: "Draft completed." },
      }),
    ]);

    const streamResponse = await app.request(`/api/runs/${createdRun.id}/stream`);
    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers.get("content-type")).toContain("text/event-stream");

    const streamBody = await streamResponse.text();
    expect(streamBody).toContain("data: ");
    expect(streamBody).toContain(`\"runId\":\"${createdRun.id}\"`);
    expect(streamBody).toContain("\"type\":\"snapshot\"");
  });

  it("rejects a second run for the same book with the active run id", async () => {
    const projectRoot = await createProjectFixture();
    const gate = deferred<void>();
    const app = createApp({
      projectRoot,
      runExecutor: async ({ emitStage }) => {
        emitStage("writing draft");
        await gate.promise;
        return { summary: "Done" };
      },
    });

    const firstResponse = await app.request("/api/books/jade-city/actions/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(firstResponse.status).toBe(202);
    const firstRun = await firstResponse.json() as StudioRun;

    const secondResponse = await app.request("/api/books/jade-city/actions/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chapterNumber: 1 }),
    });

    expect(secondResponse.status).toBe(409);
    await expect(secondResponse.json()).resolves.toEqual({
      error: {
        code: "RUN_CONFLICT",
        message: expect.stringContaining("already active"),
        runId: firstRun.id,
      },
    });

    gate.resolve();
  });

  it("records terminal succeeded and failed states", async () => {
    const projectRoot = await createProjectFixture();
    let attempt = 0;
    const app = createApp({
      projectRoot,
      runExecutor: async ({ action, emitStage, emitLog }) => {
        emitStage(`${action} started`);
        emitLog(`${action} log`);
        attempt += 1;
        if (attempt === 1) {
          return { summary: "First run completed." };
        }
        throw new Error("Revision failed hard.");
      },
    });

    const successResponse = await app.request("/api/books/jade-city/actions/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chapterNumber: 1 }),
    });
    expect(successResponse.status).toBe(202);
    const successRun = await successResponse.json() as StudioRun;

    const failedResponse = await app.request("/api/books/jade-city/actions/revise", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chapterNumber: 1 }),
    });
    expect(failedResponse.status).toBe(202);
    const failedRun = await failedResponse.json() as StudioRun;

    await waitFor(async () => {
      const response = await app.request("/api/runs");
      const runs = await response.json() as Array<StudioRun>;
      return runs.some((run: { id: string; status: string }) => run.id === successRun.id && run.status === "succeeded")
        && runs.some((run: { id: string; status: string }) => run.id === failedRun.id && run.status === "failed");
    });

    const runsResponse = await app.request("/api/runs");
    const runs = await runsResponse.json() as Array<StudioRun>;
    expect(runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: successRun.id, status: "succeeded", result: { summary: "First run completed." } }),
      expect.objectContaining({ id: failedRun.id, status: "failed", error: "Revision failed hard." }),
    ]));
  });
});
