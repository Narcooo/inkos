import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFillNodeTool,
  createReviseNodeTool,
  createDraftStructureTool,
  type FilmLLMDeps,
} from "../agent/film-authoring-tools.js";
import { saveStoryGraph } from "../interactive-film/graph-store.js";
import { StoryGraphSchema, StoryNodeSchema } from "../interactive-film/graph-schema.js";

const node = StoryNodeSchema.parse({
  id: "n1", type: "branch", title: "Choice", sceneDesc: "At the gate",
  dialogue: [{ speaker: "Mei", text: "The ledger cannot lie", emotion: "resolute" }],
  choices: [{ id: "a", text: "Go public", targetNodeId: "e" }],
});

const structureNodes = StoryGraphSchema.shape.nodes.parse([
  { id: "s", type: "start", choices: [{ id: "c", text: "go", targetNodeId: "e" }] },
  { id: "e", type: "ending", choices: [] },
]);

function filmDeps(overrides: Partial<FilmLLMDeps> = {}): FilmLLMDeps {
  return {
    submitNode: async (_system, _user, nodeId) => ({ ...node, id: nodeId }),
    submitStructure: async () => structureNodes,
    ...overrides,
  };
}

describe("film authoring LLM tools language switch", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "if-en-"));
    await mkdir(join(root, "interactive-films", "p"), { recursive: true });
    await saveStoryGraph(root, "p", StoryGraphSchema.parse({
      schemaVersion: 1, projectId: "p", title: "T", variables: [],
      nodes: [{ id: "n1", type: "branch", choices: [] }, { id: "e", type: "ending", choices: [] }],
      endings: [],
    }));
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("fill_node with language en sends the English node system prompt and user prompt", async () => {
    let systemPrompt = "";
    let userPrompt = "";
    const tool = createFillNodeTool(root, "p", filmDeps({
      submitNode: async (system, user, nodeId) => {
        systemPrompt = system;
        userPrompt = user;
        return { ...node, id: nodeId };
      },
    }), "en");

    await tool.execute("call-1", { nodeId: "n1", instruction: "Write the decision scene" } as never);

    expect(systemPrompt).toContain("You are an interactive film scriptwriter");
    expect(systemPrompt).not.toContain("你是互动影游编剧");
    expect(userPrompt).toContain("Node id to fill: n1");
    expect(userPrompt).toContain("Instruction: Write the decision scene");
  });

  it("fill_node defaults to the Chinese system prompt when language is omitted", async () => {
    let systemPrompt = "";
    let userPrompt = "";
    const tool = createFillNodeTool(root, "p", filmDeps({
      submitNode: async (system, user, nodeId) => {
        systemPrompt = system;
        userPrompt = user;
        return { ...node, id: nodeId };
      },
    }));

    await tool.execute("call-2", { nodeId: "n1", instruction: "写抉择场景" } as never);

    expect(systemPrompt).toContain("你是互动影游编剧");
    expect(userPrompt).toContain("要填的节点 id：n1");
  });

  it("revise_node with language en sends the English node system prompt and user prompt", async () => {
    let systemPrompt = "";
    let userPrompt = "";
    const tool = createReviseNodeTool(root, "p", filmDeps({
      submitNode: async (system, user, nodeId) => {
        systemPrompt = system;
        userPrompt = user;
        return { ...node, id: nodeId };
      },
    }), "en");

    await tool.execute("call-3", { nodeId: "n1", instruction: "Tighten the dialogue" } as never);

    expect(systemPrompt).toContain("You are an interactive film scriptwriter");
    expect(userPrompt).toContain("Node id to revise: n1");
    expect(userPrompt).toContain("Revision instruction: Tighten the dialogue");
  });

  it("draft_structure with language en sends the English structure system prompt and user prompt", async () => {
    let systemPrompt = "";
    let userPrompt = "";
    const tool = createDraftStructureTool(root, "p", filmDeps({
      submitStructure: async (system, user) => {
        systemPrompt = system;
        userPrompt = user;
        return structureNodes;
      },
    }), "en");

    await tool.execute("call-4", { instruction: "Three acts" } as never);

    expect(systemPrompt).toContain("You are an interactive film scriptwriter");
    expect(systemPrompt).toContain("branching skeleton");
    expect(systemPrompt).not.toContain("你是互动影游编剧");
    expect(userPrompt).toContain("Skeleton instruction: Three acts");
  });

  it("draft_structure defaults to the Chinese structure system prompt when language is omitted", async () => {
    let systemPrompt = "";
    let userPrompt = "";
    const tool = createDraftStructureTool(root, "p", filmDeps({
      submitStructure: async (system, user) => {
        systemPrompt = system;
        userPrompt = user;
        return structureNodes;
      },
    }));

    await tool.execute("call-5", { instruction: "三幕" } as never);

    expect(systemPrompt).toContain("你是互动影游编剧");
    expect(userPrompt).toContain("骨架指令：三幕");
  });
});
