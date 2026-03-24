import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_TOOLS, executeAgentTool } from "../pipeline/agent.js";
import { PipelineRunner, StateManager, type PipelineConfig } from "../index.js";

describe("agent pipeline tools", () => {
  let root: string;
  let state: StateManager;
  let pipeline: PipelineRunner;
  let config: PipelineConfig;
  let bookId: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-agent-tools-"));
    state = new StateManager(root);
    bookId = "agent-book";

    config = {
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: root,
      inputGovernanceMode: "v2",
    };

    pipeline = new PipelineRunner(config);

    await state.saveBookConfig(bookId, {
      id: bookId,
      title: "Agent Book",
      platform: "tomato",
      genre: "other",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 3000,
      createdAt: "2026-03-22T00:00:00.000Z",
      updatedAt: "2026-03-22T00:00:00.000Z",
    });

    const storyDir = join(state.bookDir(bookId), "story");
    await mkdir(join(storyDir, "runtime"), { recursive: true });
    await mkdir(join(state.bookDir(bookId), "chapters"), { recursive: true });
    await writeFile(join(state.bookDir(bookId), "chapters", "index.json"), "[]", "utf-8");

    await Promise.all([
      writeFile(join(storyDir, "author_intent.md"), "# Author Intent\n\nKeep the story centered on the mentor conflict.\n", "utf-8"),
      writeFile(join(storyDir, "current_focus.md"), "# Current Focus\n\nBring focus back to the mentor conflict.\n", "utf-8"),
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n\n- The jade seal cannot be destroyed.\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 1\nTrack the merchant guild trail.\n", "utf-8"),
      writeFile(join(storyDir, "book_rules.md"), "---\nprohibitions:\n  - Do not reveal the mastermind\n---\n\n# Book Rules\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- Lin Yue still hides the broken oath token.\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n\n- Why the mentor vanished after the trial.\n", "utf-8"),
    ]);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("registers the input governance tools", () => {
    const toolNames = AGENT_TOOLS.map((tool) => tool.name);

    expect(toolNames).toContain("plan_chapter");
    expect(toolNames).toContain("compose_chapter");
    expect(toolNames).toContain("update_author_intent");
    expect(toolNames).toContain("update_current_focus");
  });

  it("plans and composes chapters through the agent tool surface", async () => {
    const planResult = JSON.parse(await executeAgentTool(
      pipeline,
      state,
      config,
      "plan_chapter",
      { bookId, guidance: "Ignore the guild chase and focus on the mentor conflict." },
    ));

    expect(planResult.intentPath).toBe("story/runtime/chapter-0001.intent.md");

    const composeResult = JSON.parse(await executeAgentTool(
      pipeline,
      state,
      config,
      "compose_chapter",
      { bookId, guidance: "Ignore the guild chase and focus on the mentor conflict." },
    ));

    expect(composeResult.contextPath).toBe("story/runtime/chapter-0001.context.json");
    expect(composeResult.ruleStackPath).toBe("story/runtime/chapter-0001.rule-stack.yaml");
    expect(composeResult.tracePath).toBe("story/runtime/chapter-0001.trace.json");
  });

  it("updates author_intent.md and current_focus.md through dedicated tools", async () => {
    await executeAgentTool(pipeline, state, config, "update_author_intent", {
      bookId,
      content: "# Author Intent\n\nMake this a colder revenge story.\n",
    });
    await executeAgentTool(pipeline, state, config, "update_current_focus", {
      bookId,
      content: "# Current Focus\n\nSpend the next two chapters on mentor fallout.\n",
    });

    await expect(readFile(join(state.bookDir(bookId), "story", "author_intent.md"), "utf-8"))
      .resolves.toContain("colder revenge story");
    await expect(readFile(join(state.bookDir(bookId), "story", "current_focus.md"), "utf-8"))
      .resolves.toContain("mentor fallout");
  });
});
