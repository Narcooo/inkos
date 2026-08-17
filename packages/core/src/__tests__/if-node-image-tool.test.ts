import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGenerateNodeImageTool } from "../agent/film-authoring-tools.js";
import { saveStoryGraph, loadStoryGraph } from "../interactive-film/graph-store.js";
import { StoryGraphSchema } from "../interactive-film/graph-schema.js";
import type { NodeImageDeps } from "../interactive-film/node-image.js";

const PNG = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
let generatedSize = "";
const stub: NodeImageDeps = {
  generateImage: async (_prompt, size) => {
    generatedSize = size;
    return { buffer: PNG, extension: "png" };
  },
};

describe("generate_node_image tool", () => {
  let root: string;
  beforeEach(async () => {
    generatedSize = "";
    root = await mkdtemp(join(tmpdir(), "if-imgtool-"));
    await saveStoryGraph(root, "p", StoryGraphSchema.parse({ schemaVersion: 1, projectId: "p", title: "T", variables: [], nodes: [{ id: "s", type: "start", sceneDesc: "宫门前", choices: [] }], endings: [] }));
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("generates an image for a node and writes assetRef back to the graph", async () => {
    const tool = createGenerateNodeImageTool(root, "p", stub);
    await tool.execute("call-1", { nodeId: "s" } as never);
    const g = await loadStoryGraph(root, "p");
    expect(g?.nodes.find(n => n.id === "s")?.imageSlot?.assetRef).toBe("interactive-films/p/assets/nodes/s.png");
    expect(generatedSize).toBe("1536x1024");
  });

  it("passes an explicit portrait or square size through to the image provider", async () => {
    const tool = createGenerateNodeImageTool(root, "p", stub);
    await tool.execute("call-sized", { nodeId: "s", size: "1024x1536" } as never);
    expect(generatedSize).toBe("1024x1536");
  });

  it("throws a clear error when the node id does not exist in the graph", async () => {
    await expect(createGenerateNodeImageTool(root, "p", stub).execute("x", { nodeId: "ghost" } as never)).rejects.toThrow();
  });

  it("throws a clear error when no story graph exists for the project id", async () => {
    await expect(createGenerateNodeImageTool(root, "no-such-project", stub).execute("x", { nodeId: "s" } as never)).rejects.toThrow();
  });
});
