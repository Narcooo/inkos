import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app.js";

describe("createApp", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("mounts the API routes under /api", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "inkos-studio-app-"));
    tempRoots.push(projectRoot);

    const app = createApp({ projectRoot });
    const response = await app.request("/api/health");

    expect(response.status).toBe(200);
  });

  it("returns a readable JSON 404 for unknown routes", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "inkos-studio-app-"));
    tempRoots.push(projectRoot);

    const app = createApp({ projectRoot });
    const response = await app.request("/api/missing");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Route not found.",
      },
    });
  });

  it("serves built web assets when a static root is provided", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "inkos-studio-app-"));
    const staticRoot = await mkdtemp(join(tmpdir(), "inkos-studio-static-"));
    tempRoots.push(projectRoot, staticRoot);
    await writeFile(join(staticRoot, "index.html"), "<html><body>Studio</body></html>", "utf-8");

    const app = createApp({ projectRoot, staticRoot });
    const response = await app.request("/");

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("Studio");
  });
});
