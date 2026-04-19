import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("keeps update_current_focus usable for explicit local overrides through the tool surface", async () => {
    await executeAgentTool(pipeline, state, config, "update_current_focus", {
      bookId,
      content: [
        "# Current Focus",
        "",
        "## Active Focus",
        "",
        "Keep the merchant guild trail visible in the background.",
        "",
        "## Local Override",
        "",
        "Stay inside the mentor debt confrontation first and delay the guild chase by one chapter.",
        "",
      ].join("\n"),
    });

    const planResult = JSON.parse(await executeAgentTool(
      pipeline,
      state,
      config,
      "plan_chapter",
      { bookId },
    ));

    const runtimePath = join(state.bookDir(bookId), planResult.intentPath);
    const intentMarkdown = await readFile(runtimePath, "utf-8");
    expect(intentMarkdown).toContain([
      "## Goal",
      "Stay inside the mentor debt confrontation first and delay the guild chase by one chapter.",
    ].join("\n"));
  });

  it("blocks write_full_pipeline when runtime progress is ahead of the chapter index", async () => {
    const chaptersDir = join(state.bookDir(bookId), "chapters");
    // Create durable chapter files for 1-3 but only index chapter 1.
    // This produces durableChapter=3, nextNum=4 while lastIndexedChapter=1,
    // triggering the sequential write guard.
    await state.saveChapterIndex(bookId, [{
      number: 1,
      title: "Existing Chapter",
      status: "approved",
      wordCount: 120,
      createdAt: "2026-03-22T00:00:00.000Z",
      updatedAt: "2026-03-22T00:00:00.000Z",
      auditIssues: [],
      lengthWarnings: [],
    }]);
    await Promise.all([
      writeFile(join(chaptersDir, "0001_Existing.md"), "# Chapter 1\n", "utf-8"),
      writeFile(join(chaptersDir, "0002_Second.md"), "# Chapter 2\n", "utf-8"),
      writeFile(join(chaptersDir, "0003_Third.md"), "# Chapter 3\n", "utf-8"),
    ]);

    const writeNextChapter = vi.spyOn(pipeline, "writeNextChapter").mockResolvedValue({
      bookId,
      chapterNumber: 4,
      title: "Should Not Run",
      wordCount: 100,
      filePath: "books/agent-book/chapters/0004_Should_Not_Run.md",
      auditResult: { passed: true, issues: [], summary: "ok" },
      revised: false,
      status: "ready-for-review",
    } as Awaited<ReturnType<typeof pipeline.writeNextChapter>>);

    const result = JSON.parse(await executeAgentTool(
      pipeline,
      state,
      config,
      "write_full_pipeline",
      { bookId, count: 1 },
    ));

    expect(result.error).toContain("write_full_pipeline");
    expect(writeNextChapter).not.toHaveBeenCalled();
  });

  it("blocks write_truth_file from hacking chapter progress inside current_state.md", async () => {
    const result = JSON.parse(await executeAgentTool(
      pipeline,
      state,
      config,
      "write_truth_file",
      {
        bookId,
        fileName: "current_state.md",
        content: "# Current State\n\n| Current Chapter | 999 |\n",
      },
    ));

    expect(result.error).toContain("章节进度");
  });
});
