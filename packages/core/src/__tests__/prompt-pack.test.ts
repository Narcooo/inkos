import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  getBuiltinPrompt,
  loadPromptPackPrompt,
  promptOverridePath,
} from "../prompts/index.js";

async function tempProject(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "inkos-prompt-pack-"));
}

async function writePrompt(root: string, promptId: string, content: string): Promise<string> {
  const file = promptOverridePath(root, promptId);
  await mkdir(file.slice(0, file.lastIndexOf("/")), { recursive: true });
  await writeFile(file, content, "utf-8");
  return file;
}

describe("prompt pack loader", () => {
  it("loads built-in prompts without filesystem overrides", async () => {
    const loaded = await loadPromptPackPrompt({ promptId: "longform.writer" });

    expect(loaded.source).toBe("builtin");
    expect(loaded.content).toContain("long-form");
    expect(loaded.promptId).toBe("longform.writer");
    expect(loaded.content).toContain("exact placement");
    expect(loaded.content).toContain("Reuse supplied hook ids");
  });

  it("keeps longform audit and revision focused on binding intent before style", () => {
    expect(getBuiltinPrompt("longform.auditor")?.content).toContain("critical structural failure");
    expect(getBuiltinPrompt("longform.reviser")?.content).toContain("critical author-intent and canon issue");
  });

  it("uses project override before user override and built-in", async () => {
    const projectRoot = await tempProject();
    const userRoot = await tempProject();
    await writePrompt(userRoot, "play.renderer", "USER RENDERER");
    const projectPath = await writePrompt(projectRoot, "play.renderer", "PROJECT RENDERER");

    const loaded = await loadPromptPackPrompt({
      promptId: "play.renderer",
      projectRoot,
      userRoot,
    });

    expect(loaded.source).toBe("project");
    expect(loaded.path).toBe(projectPath);
    expect(loaded.content).toBe("PROJECT RENDERER");
  });

  it("uses user override when project override is absent", async () => {
    const userRoot = await tempProject();
    const userPath = await writePrompt(userRoot, "interactive-film.story-graph", "USER GRAPH PROMPT");

    const loaded = await loadPromptPackPrompt({
      promptId: "interactive-film.story-graph",
      projectRoot: await tempProject(),
      userRoot,
    });

    expect(loaded.source).toBe("user");
    expect(loaded.path).toBe(userPath);
    expect(loaded.content).toBe("USER GRAPH PROMPT");
  });

  it("throws a structured error for unknown prompts", async () => {
    await expect(loadPromptPackPrompt({ promptId: "missing.prompt" }))
      .rejects
      .toMatchObject({
        code: "PROMPT_PACK_PROMPT_NOT_FOUND",
        promptId: "missing.prompt",
      });
  });

  it("can report the built-in default for reset UI", () => {
    const builtin = getBuiltinPrompt("play.mutator");

    expect(builtin?.source).toBe("builtin");
    expect(builtin?.content).toContain("world mutation");
  });
});
