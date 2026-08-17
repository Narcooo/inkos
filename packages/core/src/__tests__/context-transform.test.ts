import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createBookContextTransform,
  createInteractiveFilmContextTransform,
} from "../agent/context-transform.js";
import { saveStoryGraph } from "../interactive-film/graph-store.js";
import { StoryGraphSchema } from "../interactive-film/graph-schema.js";

describe("createBookContextTransform", () => {
  let projectRoot: string;
  const bookId = "test-book";

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "ctx-test-"));
    const storyDir = join(projectRoot, "books", bookId, "story");
    await mkdir(storyDir, { recursive: true });
    await writeFile(join(storyDir, "story_bible.md"), "# Story Bible\nA hero's journey.");
    await writeFile(join(storyDir, "current_focus.md"), "Focus on chapter 3.");
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("returns messages unchanged when bookId is null", async () => {
    const transform = createBookContextTransform(null, projectRoot);
    const messages = [
      { role: "user" as const, content: "hello", timestamp: Date.now() },
    ];
    const result = await transform(messages);
    expect(result).toBe(messages);
  });

  it("prepends a user message with truth file contents", async () => {
    const transform = createBookContextTransform(bookId, projectRoot);
    const original = [
      { role: "user" as const, content: "写下一章", timestamp: Date.now() },
    ];
    const result = await transform(original);

    expect(original).toHaveLength(1);
    expect(result).toHaveLength(2);
    const injected = result[0] as { role: string; content: string };
    expect(injected.role).toBe("user");
    expect(injected.content).toContain("story_bible.md");
    expect(injected.content).toContain("A hero's journey.");
    expect(injected.content).toContain("current_focus.md");
    expect(injected.content).toContain("Focus on chapter 3.");
    expect(result[1]).toBe(original[0]);
  });

  it("indexes large truth files structurally instead of selecting semantic keyword rows", async () => {
    const storyDir = join(projectRoot, "books", bookId, "story");
    await writeFile(
      join(storyDir, "story_bible.md"),
      [
        "# Story Bible",
        "## 关键设定",
        "| 状态 | 条目 |",
        "| active | 主角正在追查码头旧案 |",
        "UNBOUNDED_BODY_SHOULD_NOT_BE_INJECTED ".repeat(500),
      ].join("\n"),
    );

    const transform = createBookContextTransform(bookId, projectRoot);
    const result = await transform([
      { role: "user" as const, content: "讨论下一章", timestamp: Date.now() },
    ]);
    const content = (result[0] as { content: string }).content;

    expect(content).toContain("上下文压缩包");
    expect(content).toContain("story_bible.md");
    expect(content).toContain("## 关键设定");
    expect(content).toContain("Markdown 目录索引");
    expect(content).not.toContain("| active | 主角正在追查码头旧案 |");
    expect(content).toContain("未全文注入");
    expect(content).not.toContain("UNBOUNDED_BODY_SHOULD_NOT_BE_INJECTED");
  });

  it("emits session context compression lifecycle events when compacting truth files", async () => {
    const storyDir = join(projectRoot, "books", bookId, "story");
    await writeFile(
      join(storyDir, "story_bible.md"),
      [
        "# Story Bible",
        "## 活跃设定",
        "当前目标：继续追查旧案。",
        "UNBOUNDED_BODY_SHOULD_NOT_BE_INJECTED ".repeat(500),
      ].join("\n"),
    );
    const events: Array<{ readonly category: string; readonly phase: string; readonly sources?: readonly string[] }> = [];

    const transform = createBookContextTransform(bookId, projectRoot, {
      onContextCompression: (event) => events.push(event),
    });
    await transform([
      { role: "user" as const, content: "讨论下一章", timestamp: Date.now() },
    ]);

    expect(events.map((event) => [event.category, event.phase])).toEqual([
      ["session_context", "start"],
      ["session_context", "end"],
    ]);
    expect(events[0].sources).toContain("story_bible.md");
  });

  it("sorts truth files in priority order", async () => {
    const storyDir = join(projectRoot, "books", bookId, "story");
    await writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline");
    await writeFile(join(storyDir, "book_rules.md"), "# Book Rules");
    await writeFile(join(storyDir, "extra_notes.md"), "# Extra");

    const transform = createBookContextTransform(bookId, projectRoot);
    const result = await transform([
      { role: "user" as const, content: "test", timestamp: Date.now() },
    ]);
    const content = (result[0] as { content: string }).content;

    const bibleIdx = content.indexOf("story_bible.md");
    const outlineIdx = content.indexOf("volume_outline.md");
    const rulesIdx = content.indexOf("book_rules.md");
    const focusIdx = content.indexOf("current_focus.md");
    const extraIdx = content.indexOf("extra_notes.md");

    expect(bibleIdx).toBeLessThan(outlineIdx);
    expect(outlineIdx).toBeLessThan(rulesIdx);
    expect(rulesIdx).toBeLessThan(focusIdx);
    expect(focusIdx).toBeLessThan(extraIdx);
  });

  it("returns original messages when story/ directory does not exist", async () => {
    const transform = createBookContextTransform("nonexistent-book", projectRoot);
    const original = [
      { role: "user" as const, content: "test", timestamp: Date.now() },
    ];
    const result = await transform(original);
    expect(result).toBe(original);
  });

  it("injects upgrade hint when book is legacy layout (no outline/story_frame.md)", async () => {
    const transform = createBookContextTransform(bookId, projectRoot);
    const result = await transform([
      { role: "user" as const, content: "写下一章", timestamp: Date.now() },
    ]);

    const injected = result[0] as { role: string; content: string };
    expect(injected.content).toContain("旧的条目式格式");
    expect(injected.content).toContain("sub_agent(architect, { revise: true");
  });

  it("does NOT inject upgrade hint when book is Phase 5 layout", async () => {
    const outlineDir = join(projectRoot, "books", bookId, "story", "outline");
    await mkdir(outlineDir, { recursive: true });
    await writeFile(join(outlineDir, "story_frame.md"), "## 主题\n段落式内容");

    const transform = createBookContextTransform(bookId, projectRoot);
    const result = await transform([
      { role: "user" as const, content: "写下一章", timestamp: Date.now() },
    ]);

    const injected = result[0] as { role: string; content: string };
    expect(injected.content).not.toContain("旧的条目式格式");
    expect(injected.content).not.toContain("revise: true");
  });

  it("injects authoritative new-layout outline files into active-book chat context", async () => {
    const outlineDir = join(projectRoot, "books", bookId, "story", "outline");
    await mkdir(outlineDir, { recursive: true });
    await writeFile(join(outlineDir, "story_frame.md"), "## 故事基石\n主角以第一人称调查物业黑账。");
    await writeFile(join(outlineDir, "volume_map.md"), "## 第一卷\n暴雨夜发现电表账单异常。");

    const transform = createBookContextTransform(bookId, projectRoot);
    const result = await transform([
      { role: "user" as const, content: "继续讨论第一章", timestamp: Date.now() },
    ]);

    const injected = result[0] as { role: string; content: string };
    expect(injected.content).toContain("outline/story_frame.md");
    expect(injected.content).toContain("主角以第一人称调查物业黑账。");
    expect(injected.content).toContain("outline/volume_map.md");
    expect(injected.content).toContain("暴雨夜发现电表账单异常。");
  });
});

describe("createInteractiveFilmContextTransform", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "film-ctx-test-"));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("injects the complete authoritative graph and refreshes it from disk every turn", async () => {
    const base = StoryGraphSchema.parse({
      schemaVersion: 1,
      projectId: "storm-radio",
      title: "风眼旧频率",
      variables: [{ name: "团伙已警觉", type: "flag", default: false }],
      nodes: [
        {
          id: "node_1",
          type: "branch",
          title: "公开呼叫",
          choices: [{ id: "choice_signal", text: "用暗号试探", targetNodeId: "node_6" }],
        },
        { id: "node_6", type: "ending", title: "风眼之外", choices: [] },
      ],
      endings: [{ id: "ending_c", nodeId: "node_6", title: "风眼之外", type: "secret" }],
    });
    await saveStoryGraph(projectRoot, "storm-radio", base);

    const transform = createInteractiveFilmContextTransform("storm-radio", projectRoot);
    const original = [{ role: "user" as const, content: "讨论节点1", timestamp: Date.now() }];
    const first = await transform(original);
    const firstContext = (first[0] as { content: string }).content;

    expect(firstContext).toContain("完整权威剧情图谱");
    expect(firstContext).toContain('"id":"node_1"');
    expect(firstContext).toContain('"targetNodeId":"node_6"');
    expect(firstContext).toContain('"name":"团伙已警觉"');
    expect(firstContext).not.toContain("旧的条目式格式");
    expect(first[1]).toBe(original[0]);

    await saveStoryGraph(projectRoot, "storm-radio", StoryGraphSchema.parse({
      ...base,
      nodes: base.nodes.map((node) => node.id === "node_1"
        ? { ...node, title: "暗号试探" }
        : node),
    }));
    const second = await transform(original);
    expect((second[0] as { content: string }).content).toContain('"title":"暗号试探"');
  });

  it("leaves messages unchanged before a graph has been created", async () => {
    const transform = createInteractiveFilmContextTransform("missing-film", projectRoot);
    const original = [{ role: "user" as const, content: "hello", timestamp: Date.now() }];
    expect(await transform(original)).toBe(original);
  });
});
