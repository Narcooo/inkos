import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateManager, createInitialRuntimeState, createWorkManifest, saveWorkManifest } from "@actalk/inkos-core";
import { createStudioServer } from "../api/server.js";

// The writing action requires an explicit startChapterNumber. Studio's write-next entry points always
// continue from the next unwritten chapter, so they must supply it; a missing value fails parameter
// validation before any model call.
describe("Studio write-next entry points", () => {
  let root: string;
  let upstream: Server;
  let modelCalls: number;

  beforeEach(async () => {
    modelCalls = 0;
    upstream = createServer(async (req, res) => {
      for await (const _chunk of req) { /* drain */ }
      modelCalls++;
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Fixture model unavailable" } }));
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    root = await mkdtemp(join(tmpdir(), "inkos-studio-write-next-"));
    const baseUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`;
    await writeFile(join(root, "inkos.json"), JSON.stringify({
      name: "fixture", version: "0.1.0", language: "en",
      llm: {
        defaultModel: "fixture-model",
        services: [{ service: "custom", name: "fixture", baseUrl, apiFormat: "chat", stream: false, models: ["fixture-model"] }],
      },
    }));
    await mkdir(join(root, ".inkos"));
    await writeFile(join(root, ".inkos/secrets.json"), JSON.stringify({ services: { "custom:fixture": { apiKey: "fixture" } } }));
    await createLongformBook(root, "fixture");
  });

  afterEach(async () => {
    upstream.closeAllConnections();
    await new Promise<void>((done) => upstream.close(() => done()));
    await rm(root, { recursive: true, force: true });
  });

  const post = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("writes the next chapter from the book write-next endpoint", async () => {
    const app = createStudioServer({} as never, root);

    const response = await app.request("/api/v1/books/fixture/write-next", post({}));

    expect(response.status).toBe(200);
    await waitFor(() => modelCalls > 0);
  }, 20_000);

  it("writes the next chapter from a confirmed write_next action", async () => {
    const app = createStudioServer({} as never, root);
    const { session } = await (await app.request("/api/v1/sessions", post({ sessionKind: "chat", bookId: "fixture" }))).json();

    const response = await app.request("/api/v1/agent", post({
      sessionId: session.sessionId, sessionKind: "chat", activeBookId: "fixture",
      instruction: "Write the next chapter.", actionSource: "button", requestedIntent: "write_next",
      actionPayload: { writeNext: { chapterCount: 1 } }, model: "fixture-model", service: "custom:fixture",
    }));

    expect(JSON.stringify(await response.json())).not.toMatch(/does not match the expected schema/);
    expect(modelCalls).toBeGreaterThan(0);
  }, 20_000);
});

async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not met before timeout");
    await new Promise((done) => setTimeout(done, 50));
  }
}

async function createLongformBook(root: string, id: string): Promise<void> {
  const state = new StateManager(root);
  await saveWorkManifest(root, createWorkManifest({ id, title: "Fixture", profileId: "longform-novel", language: "en" }));
  const bookDir = state.bookDir(id);
  const now = new Date().toISOString();
  await state.saveBookConfig(id, {
    id, title: "Fixture", genre: "general", platform: "other", status: "active",
    targetChapters: 2, chapterWordCount: 100, language: "en", createdAt: now, updatedAt: now,
  });
  await mkdir(join(bookDir, "story/outline"), { recursive: true });
  const files: Record<string, string> = {
    "outline/story_frame.md": "A night guard finds a broken seal.",
    "outline/volume_map.md": "Two scenes.",
    "book_rules.md": "# Rules\nPreserve facts.",
    "book_rules.json": JSON.stringify({ version: "2", prohibitions: [], enableFullCastTracking: false, allowedDeviations: [] }),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(bookDir, "story", name), content);
  await createInitialRuntimeState({ bookDir, language: "en" });
  await state.saveChapterIndex(id, []);
}
