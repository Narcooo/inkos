import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const AGENT_FILES = [
  "../agents/architect.ts",
  "../agents/planner.ts",
  "../agents/polisher.ts",
  "../agents/reviser.ts",
  "../agents/writer.ts",
] as const;

describe("creative agent maxTokens policy", () => {
  it("lets modelCard defaults own generation output budgets", async () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const offenders: string[] = [];

    for (const relativePath of AGENT_FILES) {
      const source = await readFile(join(testDir, relativePath), "utf-8");
      if (/\bmaxTokens\s*:/.test(source)) {
        offenders.push(relativePath);
      }
    }

    expect(offenders).toEqual([]);
  });
});
