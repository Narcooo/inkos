import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LLMClient } from "../llm/provider.js";
import { generateStoryGraph } from "../interactive-film/generate.js";

const runWorkerAgentToolMock = vi.hoisted(() => vi.fn());

vi.mock("../agent/worker-agent.js", () => ({
  runWorkerAgentTool: runWorkerAgentToolMock,
}));

const client = {} as LLMClient;

function playableGraphContent() {
  return {
    projectId: "model-must-not-own-this",
    title: "model-must-not-own-this",
    variables: [{ name: "trust", type: "relationship", default: 0, desc: "Trust" }],
    nodes: [
      { id: "s", type: "start", choices: [{ id: "s-b1", text: "enter", targetNodeId: "b1" }] },
      {
        id: "b1",
        type: "branch",
        choices: [
          { id: "b1-b2", text: "investigate", targetNodeId: "b2", effects: [{ var: "trust", op: "add", value: 1 }] },
          { id: "b1-e1", text: "leave", targetNodeId: "e1" },
        ],
      },
      {
        id: "b2",
        type: "branch",
        choices: [
          { id: "b2-e1", text: "trust", targetNodeId: "e1" },
          { id: "b2-e2", text: "expose", targetNodeId: "e2" },
        ],
      },
      { id: "e1", type: "ending", choices: [] },
      { id: "e2", type: "ending", choices: [] },
    ],
    endings: [
      { id: "ending-1", nodeId: "e1", title: "Trust", type: "good" },
      { id: "ending-2", nodeId: "e2", title: "Exposure", type: "secret" },
    ],
  };
}

describe("generateStoryGraph structured worker", () => {
  beforeEach(() => {
    runWorkerAgentToolMock.mockReset();
    runWorkerAgentToolMock.mockResolvedValue(playableGraphContent());
  });

  it("uses a typed Pi result tool and keeps host-owned identity authoritative", async () => {
    const graph = await generateStoryGraph(client, "m", {
      projectId: "real-id",
      title: "Real title",
      premise: "A branching mystery",
    }, { language: "en" });

    expect(graph.projectId).toBe("real-id");
    expect(graph.title).toBe("Real title");
    expect(graph.nodes).toHaveLength(5);
    expect(runWorkerAgentToolMock).toHaveBeenCalledTimes(1);
    const [, , messages, tool] = runWorkerAgentToolMock.mock.calls[0];
    expect(messages[0].content).toContain("interactive film scriptwriter");
    expect(messages[0].content).not.toContain("Output strictly JSON");
    expect(tool.name).toBe("submit_story_graph");
    expect(tool.parameters.type).toBe("object");
  });

  it("rejects a structurally valid but unplayable graph instead of writing a generic fallback", async () => {
    runWorkerAgentToolMock.mockResolvedValue({
      nodes: [
        { id: "s", type: "start", choices: [] },
        { id: "b1", type: "branch", choices: [] },
        { id: "b2", type: "branch", choices: [] },
        { id: "e1", type: "ending", choices: [] },
        { id: "e2", type: "ending", choices: [] },
      ],
      endings: [
        { id: "one", nodeId: "e1", title: "One", type: "good" },
        { id: "two", nodeId: "e2", title: "Two", type: "bad" },
      ],
    });

    await expect(generateStoryGraph(client, "m", {
      projectId: "p",
      title: "T",
      premise: "P",
    })).rejects.toThrow("Generated story graph is not playable");
  });
});
