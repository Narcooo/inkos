import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPersistedPlan, relativeToBookDir } from "../pipeline/persisted-governed-plan.js";

describe("persisted governed plan helpers", () => {
  it("parses a persisted intent markdown file into a reusable plan", async () => {
    const bookDir = await mkdtemp(join(tmpdir(), "inkos-persisted-plan-"));
    const runtimeDir = join(bookDir, "story", "runtime");
    await mkdir(runtimeDir, { recursive: true });

    const runtimePath = join(runtimeDir, "chapter-0007.intent.md");
    await writeFile(
      runtimePath,
      [
        "# Chapter Intent",
        "",
        "## Goal",
        "Bring the focus back to the mentor oath conflict.",
        "",
        "## Outline Node",
        "Track the mentor oath fallout.",
        "",
        "## Must Keep",
        "- Lin Yue keeps the oath token hidden.",
        "- Mentor debt stays unresolved.",
        "",
        "## Must Avoid",
        "- Open a new guild-route mystery.",
        "",
        "## Style Emphasis",
        "- restrained prose",
        "",
        "## Conflicts",
        "- duty: repay the oath without exposing the token",
        "- trust: keep the mentor debt personal",
        "",
      ].join("\n"),
      "utf-8",
    );

    try {
      const plan = await loadPersistedPlan(bookDir, 7);

      expect(plan).not.toBeNull();
      expect(plan?.runtimePath).toBe(runtimePath);
      expect(plan?.intent.goal).toBe("Bring the focus back to the mentor oath conflict.");
      expect(plan?.intent.outlineNode).toBe("Track the mentor oath fallout.");
      expect(plan?.intent.mustKeep).toEqual([
        "Lin Yue keeps the oath token hidden.",
        "Mentor debt stays unresolved.",
      ]);
      expect(plan?.intent.mustAvoid).toEqual(["Open a new guild-route mystery."]);
      expect(plan?.intent.styleEmphasis).toEqual(["restrained prose"]);
      expect(plan?.intent.conflicts).toEqual([
        { type: "duty", resolution: "repay the oath without exposing the token" },
        { type: "trust", resolution: "keep the mentor debt personal" },
      ]);
      expect(plan?.plannerInputs).toEqual([runtimePath]);
    } finally {
      await rm(bookDir, { recursive: true, force: true });
    }
  });

  it("rejects persisted intents whose goal is still a placeholder", async () => {
    const bookDir = await mkdtemp(join(tmpdir(), "inkos-persisted-plan-invalid-"));
    const runtimeDir = join(bookDir, "story", "runtime");
    await mkdir(runtimeDir, { recursive: true });

    await writeFile(
      join(runtimeDir, "chapter-0003.intent.md"),
      [
        "# Chapter Intent",
        "",
        "## Goal",
        "(describe the goal here)",
        "",
      ].join("\n"),
      "utf-8",
    );

    try {
      await expect(loadPersistedPlan(bookDir, 3)).resolves.toBeNull();
    } finally {
      await rm(bookDir, { recursive: true, force: true });
    }
  });

  it("normalizes persisted artifact paths relative to the book directory", () => {
    expect(relativeToBookDir(
      "/tmp/book",
      "/tmp/book/story/runtime/chapter-0001.intent.md",
    )).toBe("story/runtime/chapter-0001.intent.md");
  });
});
