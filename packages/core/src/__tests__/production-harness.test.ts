import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  commitProductionArtifacts,
  createProductionRunSnapshot,
  createRangeObservation,
} from "../production/harness.js";

describe("production harness", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("commits artifacts before the authoritative completion snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-production-"));
    roots.push(root);
    const run = createProductionRunSnapshot({
      kind: "script",
      id: "night-shift",
      status: "complete",
      stage: "commit",
      artifacts: ["script.md"],
      observations: [],
    });

    await commitProductionArtifacts({
      rootDir: root,
      artifacts: [{ relativePath: "script.md", content: "# Night Shift" }],
      runPath: "status.json",
      run,
      validate: () => {
        expect(run.artifacts).toEqual(["script.md"]);
      },
    });

    await expect(readFile(join(root, "script.md"), "utf-8")).resolves.toBe("# Night Shift");
    await expect(readFile(join(root, "status.json"), "utf-8")).resolves.toContain('"status": "complete"');
  });

  it("expresses measurable failures without guessing creative intent", () => {
    expect(createRangeObservation({
      metric: "chapter-length",
      actual: 730,
      target: 1000,
      min: 900,
      max: 1200,
      unit: "zh_chars",
      evidence: "chapter 4",
    })).toMatchObject({
      severity: "blocking",
      repairable: true,
      actual: { value: 730, unit: "zh_chars" },
    });
  });
});
