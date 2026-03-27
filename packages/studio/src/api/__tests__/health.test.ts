import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app.js";

describe("GET /api/health", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("reports local project health and book count", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "inkos-studio-health-"));
    tempRoots.push(projectRoot);

    await mkdir(join(projectRoot, "books", "jade-city"), { recursive: true });
    await writeFile(join(projectRoot, "books", "jade-city", "book.json"), JSON.stringify({
      id: "jade-city",
      title: "Jade City",
      platform: "qidian",
      genre: "urban-fantasy",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 2500,
      language: "en",
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-02T00:00:00.000Z",
    }, null, 2));

    const app = createApp({ projectRoot });
    const response = await app.request("/api/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      projectRoot,
      projectConfigFound: false,
      envFound: expect.any(Boolean),
      projectEnvFound: false,
      globalConfigFound: expect.any(Boolean),
      configReady: false,
      bookCount: 1,
      provider: null,
      model: null,
    });
  });
});
