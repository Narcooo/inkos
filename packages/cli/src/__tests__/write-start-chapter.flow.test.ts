import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateManager, createInitialRuntimeState, createWorkManifest, saveWorkManifest } from "@actalk/inkos-core";

const execFileAsync = promisify(execFile);
const testDir = dirname(fileURLToPath(import.meta.url));
const cliEntry = resolve(testDir, "..", "..", "dist", "index.js");

// The writing action requires an explicit startChapterNumber. These commands always continue from a known
// chapter, so they must supply it; a missing value fails parameter validation before any model call.
describe("CLI chapter writing commands", () => {
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
    root = await mkdtemp(join(tmpdir(), "inkos-cli-write-"));
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

  it.each([
    ["write next", ["write", "next", "fixture"]],
    ["auto", ["auto", "fixture", "1"]],
    ["write rewrite", ["write", "rewrite", "fixture", "1", "--force"]],
  ])("%s passes parameter validation and reaches the model", async (_name, args) => {
    const output = await runCli(args);

    expect(output).not.toMatch(/does not match the expected schema/);
    expect(modelCalls).toBeGreaterThan(0);
  }, 40_000);

  async function runCli(args: string[]): Promise<string> {
    const options = {
      cwd: root,
      encoding: "utf-8" as const,
      timeout: 30_000,
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("INKOS_"))),
        HOME: root,
      },
    };
    // `write next` reads guidance from a piped stdin, so close it like an empty pipe.
    const run = execFileAsync("node", [cliEntry, ...args], options);
    run.child.stdin?.end();
    try {
      const { stdout, stderr } = await run;
      return stdout + stderr;
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string };
      return (failed.stdout ?? "") + (failed.stderr ?? "");
    }
  }
});

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
  await state.snapshotState(id, 0);
}
