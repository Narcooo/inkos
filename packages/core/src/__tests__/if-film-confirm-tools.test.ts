import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDraftStructureTool,
  createRemoveNodeTool,
  createConnectChoiceTool,
  type FilmLLMDeps,
} from "../agent/film-authoring-tools.js";
import { loadStoryGraph, saveStoryGraph } from "../interactive-film/graph-store.js";
import { StoryGraphSchema } from "../interactive-film/graph-schema.js";

const structure = StoryGraphSchema.shape.nodes.parse([
  { id: "s", type: "start", choices: [{ id: "c", text: "go", targetNodeId: "e" }] },
  { id: "e", type: "ending", choices: [] },
]);

function filmDeps(overrides: Partial<FilmLLMDeps> = {}): FilmLLMDeps {
  return {
    submitNode: async () => structure[0]!,
    submitStructure: async () => structure,
    ...overrides,
  };
}

describe("confirm-class authoring tools", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "if-cf-")); await mkdir(join(root, "interactive-films", "p"), { recursive: true }); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("draft_structure (stubbed LLM) creates the node skeleton", async () => {
    const tool = createDraftStructureTool(root, "p", filmDeps());
    await tool.execute("call-1", { instruction: "三幕" } as never);
    expect((await loadStoryGraph(root, "p"))?.nodes.map(n => n.id).sort()).toEqual(["e", "s"]);
  });

  it("loads interactive-film story-graph prompt-pack overrides and reports skill details", async () => {
    await mkdir(join(root, "prompt", "interactive-film"), { recursive: true });
    await writeFile(join(root, "prompt", "interactive-film", "story-graph.md"), "PROJECT STORY GRAPH OVERRIDE: every branch needs a visible flag.");
    let systemPrompt = "";
    const tool = createDraftStructureTool(root, "p", filmDeps({
      submitStructure: async (system) => {
        systemPrompt = system;
        return structure;
      },
    }));

    const result = await tool.execute("call-1", { instruction: "三幕" } as never);

    expect(systemPrompt).toContain("Prompt Pack Guidance");
    expect(systemPrompt).toContain("PROJECT STORY GRAPH OVERRIDE");
    expect(result.details).not.toHaveProperty("usedSkills");
    expect((result.details as any).promptPacks).toContain("interactive-film.story-graph");
  });

  it("remove_node deletes the node", async () => {
    await saveStoryGraph(root, "p", StoryGraphSchema.parse({ schemaVersion: 1, projectId: "p", title: "T", variables: [], nodes: [{ id: "s", type: "start", choices: [] }, { id: "x", type: "normal", choices: [] }], endings: [] }));
    const tool = createRemoveNodeTool(root, "p");
    await tool.execute("call-2", { nodeId: "x" } as never);
    expect((await loadStoryGraph(root, "p"))?.nodes.map(n => n.id)).toEqual(["s"]);
  });
});

describe("connect_choice tool", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "if-cc-"));
    await mkdir(join(root, "interactive-films", "p"), { recursive: true });
    await saveStoryGraph(root, "p", StoryGraphSchema.parse({
      schemaVersion: 1, projectId: "p", title: "T", variables: [],
      nodes: [
        { id: "s", type: "branch", choices: [] },
        { id: "e", type: "ending", choices: [] },
      ],
      endings: [],
    }));
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("happy path: connects a choice from node s to node e and persists it", async () => {
    const tool = createConnectChoiceTool(root, "p");
    await tool.execute("call-3", { node: { id: "s", type: "branch", choices: [{ id: "c1", text: "go", targetNodeId: "e" }] } } as never);
    const g = await loadStoryGraph(root, "p");
    const s = g?.nodes.find(n => n.id === "s");
    expect(s?.choices).toHaveLength(1);
    expect(s?.choices[0].targetNodeId).toBe("e");
  });

  it("rejection path: throws when node is missing required id", async () => {
    const tool = createConnectChoiceTool(root, "p");
    await expect(tool.execute("call-4", { node: { type: "branch" } } as never)).rejects.toThrow();
  });
});
