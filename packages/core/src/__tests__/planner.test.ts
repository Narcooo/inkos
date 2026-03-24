import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BookConfig } from "../models/book.js";
import { PlannerAgent } from "../agents/planner.js";

describe("PlannerAgent", () => {
  let root: string;
  let bookDir: string;
  let storyDir: string;
  let book: BookConfig;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-planner-test-"));
    bookDir = join(root, "books", "planner-book");
    storyDir = join(bookDir, "story");
    await mkdir(join(storyDir, "runtime"), { recursive: true });

    book = {
      id: "planner-book",
      title: "Planner Book",
      platform: "tomato",
      genre: "xuanhuan",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 3000,
      createdAt: "2026-03-22T00:00:00.000Z",
      updatedAt: "2026-03-22T00:00:00.000Z",
    };

    await Promise.all([
      writeFile(
        join(storyDir, "author_intent.md"),
        "# Author Intent\n\nKeep the book emotionally centered on the mentor-student bond.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_focus.md"),
        "# Current Focus\n\nBring the focus back to the mentor conflict before opening new subplots.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "story_bible.md"),
        "# Story Bible\n\n- The jade seal cannot be destroyed.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        "# Volume Outline\n\n## Chapter 3\nTrack the merchant guild's escape route.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "book_rules.md"),
        "---\nprohibitions:\n  - Do not reveal the mastermind\n---\n\n# Book Rules\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_state.md"),
        "# Current State\n\n- Lin Yue still hides the broken oath token.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        "# Pending Hooks\n\n- Why the mentor vanished after the trial.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        "# Chapter Summaries\n\n| 2 | Trial fallout | Mentor left without explanation |\n",
        "utf-8",
      ),
    ]);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("uses current focus as the chapter goal and writes a chapter intent file", async () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
    });

    expect(result.intent.goal).toContain("mentor conflict");
    await expect(readFile(result.runtimePath, "utf-8")).resolves.toContain("mentor conflict");
  });

  it("ignores the default current_focus placeholder and falls back to author intent when no chapter outline is available", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "(Describe what the next 1-3 chapters should prioritize.)",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        "# Volume Outline\n",
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
    });

    expect(result.intent.goal).toContain("mentor-student bond");
    expect(result.intent.goal).not.toContain("Describe what the next 1-3 chapters should prioritize");
  });

  it("uses bullet-style volume outline chapter nodes as the fallback goal when control docs are placeholders", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "author_intent.md"),
        "# Author Intent\n\n(Describe the long-horizon vision for this book here.)\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "(Describe what the next 1-3 chapters should prioritize.)",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "## Volume 1",
          "**Chapter range:** 1-8",
          "",
          "**Key turning points:**",
          "- **Chapter 3:** Track the merchant guild's escape route through the western canal.",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
    });

    expect(result.intent.outlineNode).toContain("merchant guild's escape route");
    expect(result.intent.goal).toContain("merchant guild's escape route");
    expect(result.intent.goal).not.toContain("Advance chapter 3 with clear narrative focus.");
  });

  it("preserves hard facts from state and canon in mustKeep", async () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
    });

    expect(result.intent.mustKeep).toContain("Lin Yue still hides the broken oath token.");
    expect(result.intent.mustKeep).toContain("The jade seal cannot be destroyed.");
  });

  it("records conflicts when the external request diverges from the outline", async () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
      externalContext: "Ignore the guild chase and bring the focus back to mentor conflict.",
    });

    expect(result.intent.conflicts).toHaveLength(1);
    expect(result.intent.conflicts[0]?.type).toBe("outline_vs_request");
    await expect(readFile(result.runtimePath, "utf-8")).resolves.toContain("outline_vs_request");
  });

  it("writes compact memory snapshots instead of inlining the full history", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "# Pending Hooks",
          "",
          "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| guild-route | 1 | mystery | open | 2 | 6 | Merchant guild trail |",
          "| mentor-oath | 8 | relationship | open | 9 | 11 | Mentor oath debt with Lin Yue |",
          "| old-seal | 3 | artifact | resolved | 3 | 3 | Jade seal already recovered |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| 1 | Guild Trail | Merchant guild flees west | Route clues only | None | guild-route seeded | tense | action |",
          "| 2 | City Watch | Patrols sweep the market | Search widens | None | guild-route advanced | urgent | investigation |",
          "| 3 | Seal Vault | Lin Yue finds the seal vault | The jade seal returns | Seal secured | old-seal resolved | solemn | reveal |",
          "| 4 | Empty Road | The group loses the convoy | Doubts grow | Travel fatigue | none | grim | travel |",
          "| 5 | Burned Shrine | Shrine clues point nowhere | Friction rises | Lin Yue distrusts allies | none | bitter | setback |",
          "| 6 | Quiet Ledger | Merchant records stay hidden | No breakthrough | Cash runs thin | none | weary | transition |",
          "| 7 | Broken Letter | A torn letter mentions the mentor | Suspicion returns | Lin Yue reopens the old oath | mentor-oath seeded | uneasy | mystery |",
          "| 8 | River Camp | Lin Yue meets old witnesses | Mentor debt becomes personal | Lin Yue cannot let go | mentor-oath advanced | raw | confrontation |",
          "| 9 | Trial Echo | The trial fallout resurfaces | Mentor left without explanation | Oath token matters again | mentor-oath advanced | aching | fallout |",
          "| 10 | Locked Gate | Lin Yue chooses the mentor line over the guild line | Mentor conflict takes priority | Oath token is still hidden | mentor-oath advanced | focused | decision |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 11,
      externalContext: "Bring the focus back to the mentor oath conflict with Lin Yue.",
    });

    const intentMarkdown = await readFile(result.runtimePath, "utf-8");
    expect(intentMarkdown).toContain("mentor-oath");
    expect(intentMarkdown).toContain("| 10 | Locked Gate |");
    expect(intentMarkdown).not.toContain("| 1 | Guild Trail |");
    expect(intentMarkdown).not.toContain("| old-seal | 3 | artifact | resolved |");
  });

  it("renders English memory snapshot headers for English books", async () => {
    book = {
      ...book,
      genre: "other",
      language: "en",
    };
    await Promise.all([
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "# Pending Hooks",
          "",
          "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| mentor-oath | 8 | relationship | open | 9 | 11 | Mentor oath debt with Lin Yue |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 10 | Locked Gate | Lin Yue | Lin Yue chooses the mentor line over the guild line | Mentor conflict takes priority | mentor-oath advanced | focused | decision |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 11,
      externalContext: "Bring the focus back to the mentor oath conflict with Lin Yue.",
    });

    const intentMarkdown = await readFile(result.runtimePath, "utf-8");
    expect(intentMarkdown).toContain("| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |");
    expect(intentMarkdown).toContain("| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |");
    expect(intentMarkdown).not.toContain("| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |");
    expect(intentMarkdown).not.toContain("| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |");
  });

  it("derives structured current_focus markdown into goal, avoids, and style emphasis", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "- Bring the focus back to Lin Yue's private confrontation with the mentor debt.",
          "- Keep the chapter centered on a missing record, not a whole-conspiracy overview.",
          "- Surface one concrete evidence trail the next chapter can pursue.",
          "",
          "## Avoid",
          "",
          "- Do not turn this chapter into a citywide survey of every faction.",
          "- Do not use summary-heavy moralizing paragraphs.",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "story_bible.md"),
        [
          "# Story Bible",
          "",
          "- --",
          "- The jade seal cannot be destroyed.",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
    });

    expect(result.intent.goal).toContain("private confrontation");
    expect(result.intent.goal).toContain("missing record");
    expect(result.intent.mustAvoid).toEqual(expect.arrayContaining([
      "Do not turn this chapter into a citywide survey of every faction.",
      "Do not use summary-heavy moralizing paragraphs.",
    ]));
    expect(result.intent.mustAvoid).not.toContain(
      "Keep the chapter centered on a missing record, not a whole-conspiracy overview.",
    );
    expect(result.intent.styleEmphasis).toEqual(expect.arrayContaining([
      "Bring the focus back to Lin Yue's private confrontation with the mentor debt.",
      "Surface one concrete evidence trail the next chapter can pursue.",
    ]));
    expect(result.intent.mustKeep).not.toContain("--");
  });
});
