import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { createReadTool } from "../agent/agent-tools.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

it("blocks project credential files from agent reads, including absolute paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "inkos-read-credentials-"));
  roots.push(root);
  await mkdir(join(root, ".inkos"), { recursive: true });
  await writeFile(join(root, ".inkos", "secrets.json"), '{"apiKey":"fixture-secret"}');
  await writeFile(join(root, ".env"), "API_KEY=fixture-secret");
  await writeFile(join(root, ".env.local"), "API_KEY=fixture-secret");
  await writeFile(join(root, "credentials.json"), '{"token":"fixture-secret"}');
  await writeFile(join(root, "README.md"), "Public project notes.");

  const tool = createReadTool(root, { scope: "project", allowSystemPaths: true });
  for (const path of [
    ".inkos/secrets.json",
    ".env",
    ".env.local",
    "credentials.json",
    join(root, ".env.local"),
  ]) {
    await expect(tool.execute("read", { path })).rejects.toMatchObject({
      code: "READ_CREDENTIAL_FILE_BLOCKED",
    });
  }
  await expect(tool.execute("read", { path: "README.md" })).resolves.toMatchObject({
    content: [{ type: "text", text: "Public project notes." }],
  });
});
