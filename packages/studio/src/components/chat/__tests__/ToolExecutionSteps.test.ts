import { describe, it, expect, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ToolExecution } from "../../../store/chat/types";
import { PipelineResultDetails, ToolExecutionSteps, UtilityExecutionRow, buildPlayRunStatusUrl, buildPlaySceneImageUrl, getChapterContextTraceDetails, getChapterRevisionDetails, getChapterStateResyncDetails, getExecutionSkillIds, getGeneratedArtifactDetails, getPlayEditDetails, getPlayToolDetails, getProposedActionContractRows, getProposedActionDetails, groupToolExecutionsChronologically } from "../ToolExecutionSteps";
import { usePreferencesStore } from "../../../store/preferences";
import { setAppLanguage } from "../../../lib/app-language";

const makeExec = (overrides: Partial<ToolExecution> & { id: string; tool: string }): ToolExecution => ({
  label: "test",
  status: "completed",
  startedAt: Date.now(),
  ...overrides,
});

describe("groupChronologically", () => {
  it("keeps read before pipeline when read happened first", () => {
    const execs: ToolExecution[] = [
      makeExec({ id: "1", tool: "read", label: "读取文件" }),
      makeExec({ id: "2", tool: "sub_agent", agent: "writer", label: "写作" }),
    ];

    const groups = groupToolExecutionsChronologically(execs);

    expect(groups).toHaveLength(2);
    expect(groups[0].type).toBe("utilities");
    expect(groups[1].type).toBe("pipeline");
  });

  it("groups consecutive utility tools together", () => {
    const execs: ToolExecution[] = [
      makeExec({ id: "1", tool: "read", label: "读取文件" }),
      makeExec({ id: "2", tool: "grep", label: "搜索" }),
      makeExec({ id: "3", tool: "read", label: "读取文件" }),
    ];

    const groups = groupToolExecutionsChronologically(execs);

    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe("utilities");
    if (groups[0].type === "utilities") {
      expect(groups[0].execs).toHaveLength(3);
    }
  });

  it("interleaves utility groups around pipeline ops", () => {
    const execs: ToolExecution[] = [
      makeExec({ id: "1", tool: "read", label: "读取文件" }),
      makeExec({ id: "2", tool: "sub_agent", agent: "writer", label: "写作" }),
      makeExec({ id: "3", tool: "read", label: "读取文件" }),
      makeExec({ id: "4", tool: "grep", label: "搜索" }),
    ];

    const groups = groupToolExecutionsChronologically(execs);

    expect(groups).toHaveLength(3);
    expect(groups[0].type).toBe("utilities");
    expect(groups[1].type).toBe("pipeline");
    expect(groups[2].type).toBe("utilities");
    if (groups[2].type === "utilities") {
      expect(groups[2].execs).toHaveLength(2);
    }
  });

  it("handles pipeline-only executions", () => {
    const execs: ToolExecution[] = [
      makeExec({ id: "1", tool: "sub_agent", agent: "writer", label: "写作" }),
    ];

    const groups = groupToolExecutionsChronologically(execs);

    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe("pipeline");
  });

  it("handles empty array", () => {
    expect(groupToolExecutionsChronologically([])).toHaveLength(0);
  });

  it("renders short fiction and cover tools as visible pipeline cards", () => {
    const execs: ToolExecution[] = [
      makeExec({ id: "1", tool: "read", label: "读取文件" }),
      makeExec({ id: "2", tool: "generate_cover", label: "生成封面" }),
      makeExec({ id: "3", tool: "short_fiction_run", label: "短篇生产" }),
      makeExec({ id: "4", tool: "grep", label: "搜索" }),
    ];

    const groups = groupToolExecutionsChronologically(execs);

    expect(groups).toHaveLength(4);
    expect(groups.map((group) => group.type)).toEqual(["utilities", "pipeline", "pipeline", "utilities"]);
    expect(groups[1].type === "pipeline" ? groups[1].exec.tool : "").toBe("generate_cover");
    expect(groups[2].type === "pipeline" ? groups[2].exec.tool : "").toBe("short_fiction_run");
  });

  it("renders play tools as visible pipeline cards", () => {
    const execs: ToolExecution[] = [
      makeExec({ id: "1", tool: "read", label: "读取文件" }),
      makeExec({ id: "2", tool: "play_start", label: "启动互动世界" }),
      makeExec({ id: "3", tool: "play_edit", label: "编辑互动世界" }),
      makeExec({ id: "4", tool: "play_revise", label: "重做互动回合" }),
      makeExec({ id: "5", tool: "play_step", label: "推进互动世界" }),
      makeExec({ id: "6", tool: "grep", label: "搜索" }),
    ];

    const groups = groupToolExecutionsChronologically(execs);

    expect(groups).toHaveLength(6);
    expect(groups.map((group) => group.type)).toEqual(["utilities", "pipeline", "pipeline", "pipeline", "pipeline", "utilities"]);
    expect(groups[1].type === "pipeline" ? groups[1].exec.tool : "").toBe("play_start");
    expect(groups[2].type === "pipeline" ? groups[2].exec.tool : "").toBe("play_edit");
    expect(groups[3].type === "pipeline" ? groups[3].exec.tool : "").toBe("play_revise");
    expect(groups[4].type === "pipeline" ? groups[4].exec.tool : "").toBe("play_step");
  });

  it("renders proposed actions as visible pipeline cards", () => {
    const execs: ToolExecution[] = [
      makeExec({ id: "1", tool: "read", label: "读取文件" }),
      makeExec({ id: "2", tool: "propose_action", label: "确认动作" }),
      makeExec({ id: "3", tool: "grep", label: "搜索" }),
    ];

    const groups = groupToolExecutionsChronologically(execs);

    expect(groups).toHaveLength(3);
    expect(groups.map((group) => group.type)).toEqual(["utilities", "pipeline", "utilities"]);
    expect(groups[1].type === "pipeline" ? groups[1].exec.tool : "").toBe("propose_action");
  });

  it("renders context compression as a visible pipeline card", () => {
    const execs: ToolExecution[] = [
      makeExec({ id: "1", tool: "read", label: "读取文件" }),
      makeExec({ id: "2", tool: "context_compression", label: "整理会话记忆" }),
      makeExec({ id: "3", tool: "grep", label: "搜索" }),
    ];

    const groups = groupToolExecutionsChronologically(execs);

    expect(groups).toHaveLength(3);
    expect(groups.map((group) => group.type)).toEqual(["utilities", "pipeline", "utilities"]);
    expect(groups[1].type === "pipeline" ? groups[1].exec.tool : "").toBe("context_compression");
  });

  it("renders narrative forecast operations as visible pipeline cards", () => {
    const execs: ToolExecution[] = [
      makeExec({ id: "1", tool: "read", label: "读取章节" }),
      makeExec({ id: "2", tool: "create_narrative_forecast", label: "剧情推演" }),
      makeExec({ id: "3", tool: "get_narrative_forecast", label: "核验推演" }),
      makeExec({ id: "4", tool: "select_narrative_branch", label: "采用分支" }),
      makeExec({ id: "5", tool: "grep", label: "搜索" }),
    ];

    const groups = groupToolExecutionsChronologically(execs);

    expect(groups.map((group) => group.type)).toEqual([
      "utilities",
      "pipeline",
      "pipeline",
      "pipeline",
      "utilities",
    ]);
    expect(groups[1].type === "pipeline" ? groups[1].exec.tool : "").toBe("create_narrative_forecast");
    expect(groups[2].type === "pipeline" ? groups[2].exec.tool : "").toBe("get_narrative_forecast");
    expect(groups[3].type === "pipeline" ? groups[3].exec.tool : "").toBe("select_narrative_branch");
  });

  it("renders generic pipeline result text in an expandable details block", () => {
    const exec = makeExec({
      id: "writer-1",
      tool: "sub_agent",
      agent: "writer",
      label: "写下一章",
      result: "已完成第 1 章：雨棚。这里是更详细的操作结果。",
    });

    const html = renderToStaticMarkup(React.createElement(ToolExecutionSteps, { executions: [exec] }));

    expect(html).toContain("查看操作结果");
    expect(html).toContain("已完成第 1 章：雨棚");
  });

  it("renders applied revision audit status and concrete remaining issues", () => {
    const exec = makeExec({
      id: "revision-1",
      tool: "sub_agent",
      agent: "reviser",
      label: "重写第一章",
      result: "Revision complete.",
      details: {
        kind: "chapter_revision",
        chapterNumber: 1,
        applied: true,
        status: "audit-failed",
        auditPassed: false,
        fixedIssues: ["统一了孙玉珍和十一分钟的单元案"],
        auditIssues: [{
          severity: "warning",
          category: "continuity",
          description: "第一句仍未直接落到孙玉珍抱钟进店。",
          suggestion: "把该动作放到首句。",
        }],
      },
    });

    expect(getChapterRevisionDetails(exec)).toEqual(expect.objectContaining({
      chapterNumber: 1,
      applied: true,
      auditPassed: false,
    }));
    const html = renderToStaticMarkup(React.createElement(ToolExecutionSteps, { executions: [exec] }));
    expect(html).toContain("第 1 章修订");
    expect(html).toContain("仍需复核");
    expect(html).toContain("第一句仍未直接落到孙玉珍抱钟进店");
    expect(html).not.toContain("查看操作结果");
  });

  it("renders chapter state resync audit status and concrete issues", () => {
    const exec = makeExec({
      id: "resync-1",
      tool: "resync_chapter_state",
      label: "同步章节状态",
      result: "State resynced.",
      details: {
        kind: "chapter_state_resynced",
        chapterNumber: 1,
        status: "audit-failed",
        auditPassed: false,
        summary: "状态已重建，正文仍有一个连续性问题。",
        auditIssues: [{
          severity: "warning",
          category: "continuity",
          description: "末段还没有体现 H012 的十一分钟证据。",
          suggestion: "让末段与已落盘伏笔保持一致。",
        }],
      },
    });

    expect(getChapterStateResyncDetails(exec)).toEqual(expect.objectContaining({
      chapterNumber: 1,
      auditPassed: false,
    }));
    const html = renderToStaticMarkup(React.createElement(ToolExecutionSteps, { executions: [exec] }));
    expect(html).toContain("第 1 章状态已同步");
    expect(html).toContain("仍需修订");
    expect(html).toContain("末段还没有体现 H012 的十一分钟证据");
    expect(html).not.toContain("查看操作结果");
  });

  it("renders the writer retrieval trace from structured tool details", () => {
    const exec = makeExec({
      id: "writer-trace",
      tool: "sub_agent",
      agent: "writer",
      label: "写下一章",
      details: {
        kind: "chapter_written",
        chapterNumber: 8,
        skillIds: ["longform-pacing"],
        contextTrace: {
          tracePath: "runtime/chapter-0008.trace.json",
          selectedSources: ["story/author_intent.md", "story/pending_hooks.md#H7"],
          protectedSources: ["story/author_intent.md"],
          compressibleSources: ["story/pending_hooks.md#H7"],
          tokenBudget: { protectedTokens: 1200, compressibleTokens: 800, totalSelectedTokens: 2000 },
          retrieval: {
            engine: "sqlite-fts5-bm25",
            query: "第八章 证据反噬",
            candidates: [{ id: "H7", kind: "hook", source: "story/pending_hooks.md#H7", score: 1.4 }],
            semanticSelectedIds: ["H7"],
          },
          compression: {
            compiledSource: "runtime/compiled-compressible-context",
            protectedSources: ["story/author_intent.md"],
            compressedSources: ["story/pending_hooks.md#H7"],
            protectedTokens: 1200,
            compressibleTokens: 800,
            budgetTokens: 1800,
          },
        },
      },
    });

    expect(getChapterContextTraceDetails(exec)).toHaveLength(1);
    const html = renderToStaticMarkup(React.createElement(ToolExecutionSteps, { executions: [exec] }));
    expect(html).toContain("本轮参考依据");
    expect(html).toContain("longform-pacing");
    expect(html).toContain("sqlite-fts5-bm25");
    expect(html).toContain("story/author_intent.md");
    expect(html).toContain("runtime/chapter-0008.trace.json");
    expect(html).toContain("语义压缩");
  });

  it("shows the actual professional Skill for non-chapter production tools", () => {
    const exec = makeExec({
      id: "play-skilled",
      tool: "play_step",
      label: "推进互动世界",
      details: {
        kind: "play_turn_advanced",
        sceneText: "雨雾里的钟声停了一拍。",
        skillIds: ["inkos-play-world"],
      },
    });

    expect(getExecutionSkillIds(exec)).toEqual(["inkos-play-world"]);
    const html = renderToStaticMarkup(React.createElement(ToolExecutionSteps, { executions: [exec] }));
    expect(html).toContain("专业 Skill");
    expect(html).toContain("inkos-play-world");
  });

  it("extracts generated cover details from public short fiction tools", () => {
    const exec = makeExec({
      id: "short-1",
      tool: "short_fiction_run",
      label: "短篇生产",
      details: {
        kind: "short_fiction_created",
        storyId: "demo-story",
        finalMarkdownPath: "shorts/demo-story/final/full.md",
        salesPackagePath: "shorts/demo-story/final/sales-package.md",
        coverImagePath: "shorts/demo-story/final/cover.png",
      },
    });

    expect(getGeneratedArtifactDetails(exec)).toMatchObject({
      kind: "short_fiction_created",
      storyId: "demo-story",
      finalMarkdownPath: "shorts/demo-story/final/full.md",
      salesPackagePath: "shorts/demo-story/final/sales-package.md",
      coverImagePath: "shorts/demo-story/final/cover.png",
    });
  });

  it("extracts and renders interactive-film creation artifacts", () => {
    const exec = makeExec({
      id: "interactive-film-1",
      tool: "interactive_film_create",
      label: "互动影游",
      details: {
        kind: "interactive_film_created",
        title: "盛世天下影游方案",
        projectId: "shengshi-branching",
        storyGraphPath: "interactive-films/shengshi-branching/story-graph.json",
        specPath: "interactive-films/shengshi-branching/interactive-spec.md",
        storyTreePath: "interactive-films/shengshi-branching/story-tree.md",
        flagsPath: "interactive-films/shengshi-branching/flags.md",
        scriptPath: "interactive-films/shengshi-branching/script.md",
        storyboardPath: "interactive-films/shengshi-branching/storyboard.md",
        imagePromptsPath: "interactive-films/shengshi-branching/image-prompts.md",
        assetsManifestPath: "interactive-films/shengshi-branching/assets.json",
      },
    });

    expect(getGeneratedArtifactDetails(exec)).toMatchObject({
      kind: "interactive_film_created",
      projectId: "shengshi-branching",
      storyGraphPath: "interactive-films/shengshi-branching/story-graph.json",
      storyTreePath: "interactive-films/shengshi-branching/story-tree.md",
      flagsPath: "interactive-films/shengshi-branching/flags.md",
      assetsManifestPath: "interactive-films/shengshi-branching/assets.json",
    });

    const html = renderToStaticMarkup(React.createElement(ToolExecutionSteps, { executions: [exec] }));
    expect(html).toContain("互动影游已生成");
    expect(html).toContain("剧情图谱");
    expect(html).toContain("剧情树");
    expect(html).toContain("变量旗标");
    expect(html).toContain("图片资产");
  });

  it("extracts play scene details from play tools", () => {
    const exec = makeExec({
      id: "play-1",
      tool: "play_step",
      label: "推进互动世界",
      details: {
        kind: "play_turn_advanced",
        title: "雨夜茶馆",
        worldId: "rain-teahouse",
        runId: "main",
        sceneText: "你翻开账本，发现一张旧船票。",
        suggestedActions: ["藏起船票", "追问来人"],
        currentState: { turn: 3 },
      },
    });

    expect(getPlayToolDetails(exec)).toMatchObject({
      kind: "play_turn_advanced",
      title: "雨夜茶馆",
      worldId: "rain-teahouse",
      runId: "main",
      turn: 3,
      sceneText: "你翻开账本，发现一张旧船票。",
      suggestedActions: ["藏起船票", "追问来人"],
    });
  });

  it("extracts revised play scene details", () => {
    const exec = makeExec({
      id: "play-revise-1",
      tool: "play_revise",
      label: "重做互动回合",
      details: {
        kind: "play_turn_revised",
        title: "雨夜茶馆",
        worldId: "rain-teahouse",
        runId: "main",
        sceneText: "你重新翻开账本，先看见夹层里的红印。",
        suggestedActions: ["取出红印", "合上账本"],
        variantId: "v-new",
      },
    });

    expect(getPlayToolDetails(exec)).toMatchObject({
      kind: "play_turn_revised",
      title: "雨夜茶馆",
      worldId: "rain-teahouse",
      runId: "main",
      sceneText: "你重新翻开账本，先看见夹层里的红印。",
      suggestedActions: ["取出红印", "合上账本"],
      variantId: "v-new",
    });
  });

  it("does not render suggested play actions as non-clickable text in the result card", () => {
    const html = renderToStaticMarkup(React.createElement(ToolExecutionSteps, {
      executions: [
        makeExec({
          id: "play-choices-1",
          tool: "play_step",
          label: "推进互动世界",
          details: {
            kind: "play_turn_advanced",
            worldId: "rain-teahouse",
            runId: "main",
            sceneText: "你翻开账本，发现一张旧船票。",
            suggestedActions: ["藏起船票", "追问来人"],
            currentState: { turn: 3 },
          },
        }),
      ],
    }));

    expect(html).toContain("你翻开账本");
    expect(html).not.toContain("藏起船票");
    expect(html).not.toContain("追问来人");
  });

  it("does not guess a scene image file path before the run manifest reports it ready", () => {
    const details = {
      kind: "play_turn_advanced" as const,
      worldId: "rain-teahouse",
      runId: "main",
      turn: 3,
      sceneText: "你翻开账本。",
    };

    expect(buildPlaySceneImageUrl(details)).toBeNull();
    expect(buildPlayRunStatusUrl(details)).toBe("/api/v1/play/runs/rain-teahouse/main");
  });

  it("extracts play edit details", () => {
    const exec = makeExec({
      id: "play-edit-1",
      tool: "play_edit",
      label: "编辑互动世界",
      details: {
        kind: "play_world_updated",
        worldId: "rain-flat",
        runId: "main",
        updatedWorldContract: true,
        updatedVisualContract: true,
        updatedPremise: false,
        updatedEntities: 2,
      },
    });

    expect(getPlayEditDetails(exec)).toMatchObject({
      kind: "play_world_updated",
      worldId: "rain-flat",
      runId: "main",
      updatedWorldContract: true,
      updatedVisualContract: true,
      updatedPremise: false,
      updatedEntities: 2,
    });
  });

  it("extracts proposed action details", () => {
    const exec = makeExec({
      id: "proposal-1",
      tool: "propose_action",
      label: "确认动作",
      details: {
        kind: "proposed_action",
        action: "short_run",
        targetSessionKind: "short",
        sameSession: true,
        title: "生成短篇",
        summary: "确认后生成完整短篇。",
        instruction: "写一篇婚姻反杀短篇",
        requestedSkills: ["writer-distillation"],
        actionPayload: {
          shortRun: {
            direction: "婚姻反杀",
            chapters: 12,
            charsPerChapter: 1000,
            cover: true,
          },
        },
      },
    });

    expect(getProposedActionDetails(exec)).toMatchObject({
      kind: "proposed_action",
      execId: "proposal-1",
      action: "short_run",
      targetSessionKind: "short",
      sameSession: true,
      title: "生成短篇",
      instruction: "写一篇婚姻反杀短篇",
      requestedSkills: ["writer-distillation"],
      actionPayload: {
        shortRun: {
          direction: "婚姻反杀",
          chapters: 12,
          charsPerChapter: 1000,
          cover: true,
        },
      },
    });
  });

  it("extracts Play world and visual contracts for confirmation cards", () => {
    const exec = makeExec({
      id: "proposal-play-contract",
      tool: "propose_action",
      label: "确认动作",
      details: {
        kind: "proposed_action",
        action: "play_start",
        targetSessionKind: "play",
        title: "玄照山外门",
        instruction: "启动一个修仙开放世界。",
        actionPayload: {
          playStart: {
            title: "玄照山外门",
            worldContract: "时间是世界同步轴；角色会自主修炼和布局；不要固定 tick 或 RPG 面板。",
            visualContract: "法器珍惜程度通过材质、光泽和旁人反应体现，不要绿蓝紫橙边框。",
          },
        },
      },
    });

    const details = getProposedActionDetails(exec);
    expect(details).not.toBeNull();
    expect(getProposedActionContractRows(details!)).toEqual([
      {
        label: "世界契约",
        value: expect.stringContaining("时间是世界同步轴"),
      },
      {
        label: "视觉契约",
        value: expect.stringContaining("不要绿蓝紫橙边框"),
      },
    ]);
  });

});

describe("tool details default-open preference", () => {
  beforeEach(() => {
    usePreferencesStore.setState({ toolDetailsDefaultOpen: true });
  });

  it("the preferences store defaults to expanded, keeping today's behavior", () => {
    expect(usePreferencesStore.getState().toolDetailsDefaultOpen).toBe(true);
  });

  it("renders the pipeline result details expanded when the preference is on (default)", () => {
    const exec = makeExec({
      id: "writer-1",
      tool: "sub_agent",
      agent: "writer",
      label: "写下一章",
      result: "已完成第 1 章：雨棚。这里是更详细的操作结果。",
    });

    const html = renderToStaticMarkup(React.createElement(ToolExecutionSteps, { executions: [exec] }));

    expect(html).toContain("查看操作结果");
    expect(html).toContain("<details open");
  });

  it("renders the pipeline result details collapsed when the preference is off", () => {
    const html = renderToStaticMarkup(React.createElement(PipelineResultDetails, {
      result: "已完成第 1 章：雨棚。这里是更详细的操作结果。",
      defaultOpen: false,
    }));

    // The block is still there (manually expandable), just not open by default.
    expect(html).toContain("查看操作结果");
    expect(html).toContain("已完成第 1 章：雨棚");
    expect(html).not.toContain("<details open");
  });

  it("renders the pipeline result details expanded when defaultOpen is true", () => {
    const html = renderToStaticMarkup(React.createElement(PipelineResultDetails, {
      result: "已完成第 1 章：雨棚。",
      defaultOpen: true,
    }));

    expect(html).toContain("<details open");
  });
});

describe("English app language", () => {
  beforeEach(() => {
    setAppLanguage("en");
  });

  afterEach(() => {
    setAppLanguage("zh");
  });

  it("renders pipeline status, result summary, and file-operation group in English", () => {
    const execs: ToolExecution[] = [
      makeExec({
        id: "writer-en-1",
        tool: "sub_agent",
        agent: "writer",
        label: "Write",
        result: "Chapter 1 finished.",
      }),
      makeExec({ id: "read-en-1", tool: "read", label: "Read file", args: { path: "books/demo/chapter-1.md" } }),
    ];

    const html = renderToStaticMarkup(React.createElement(ToolExecutionSteps, { executions: execs }));

    expect(html).toContain("Completed");
    expect(html).toContain("View result");
    expect(html).toContain("1 file operation");
    expect(html).not.toContain("已完成");
    expect(html).not.toContain("查看操作结果");
  });

  it("renders interactive-film artifacts and proposal contract rows in English", () => {
    const filmExec = makeExec({
      id: "interactive-film-en-1",
      tool: "interactive_film_create",
      label: "Interactive film",
      details: {
        kind: "interactive_film_created",
        projectId: "demo-branching",
        storyGraphPath: "interactive-films/demo-branching/story-graph.json",
        storyTreePath: "interactive-films/demo-branching/story-tree.md",
      },
    });

    const html = renderToStaticMarkup(React.createElement(ToolExecutionSteps, { executions: [filmExec] }));
    expect(html).toContain("Interactive film generated");
    expect(html).toContain("Story graph");
    expect(html).toContain("Story tree");
    expect(html).not.toContain("互动影游已生成");

    const proposalExec = makeExec({
      id: "proposal-en-1",
      tool: "propose_action",
      label: "Confirm action",
      details: {
        kind: "proposed_action",
        action: "play_start",
        targetSessionKind: "play",
        instruction: "Start a cultivation open world.",
        actionPayload: {
          playStart: {
            title: "Outer Gate",
            worldContract: "Time is the shared world axis.",
            visualContract: "No colored rarity borders.",
          },
        },
      },
    });

    const details = getProposedActionDetails(proposalExec);
    expect(details).not.toBeNull();
    expect(getProposedActionContractRows(details!).map((row) => row.label)).toEqual([
      "World contract",
      "Visual contract",
    ]);
  });

  it("does not repeat raw results when a structured Play preview is available", () => {
    const exec = makeExec({
      id: "play-start-structured",
      tool: "play_start",
      label: "启动互动世界",
      status: "completed",
      result: "雨夜开场正文",
      details: {
        kind: "play_world_started",
        worldId: "rain-world",
        runId: "run-1",
        sceneText: "雨夜开场正文",
      },
    });

    const html = renderToStaticMarkup(React.createElement(ToolExecutionSteps, { executions: [exec] }));
    expect(html).toContain("Interactive world started");
    expect(html).not.toContain("View result");
  });
});

describe("UtilityExecutionRow", () => {
  it("renders an expandable, default-collapsed result body when the execution has a result", () => {
    const exec = makeExec({
      id: "read-1",
      tool: "read",
      label: "读取文件",
      args: { path: "books/demo/chapter-1.md" },
      result: "第一章正文：雨停了，巷口的灯还亮着。",
    });

    const html = renderToStaticMarkup(React.createElement(UtilityExecutionRow, { exec }));

    expect(html).toContain("read books/demo/chapter-1.md");
    expect(html).toContain("第一章正文：雨停了，巷口的灯还亮着。");
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
  });

  it("renders a plain row without details when the execution has no result", () => {
    const exec = makeExec({
      id: "ls-1",
      tool: "ls",
      label: "列目录",
      args: { path: "books/demo" },
    });

    const html = renderToStaticMarkup(React.createElement(UtilityExecutionRow, { exec }));

    expect(html).toContain("ls books/demo");
    expect(html).not.toContain("<details");
  });

  it("treats a whitespace-only result as no result", () => {
    const exec = makeExec({
      id: "grep-1",
      tool: "grep",
      label: "搜索",
      args: { pattern: "灯" },
      result: "   \n  ",
    });

    const html = renderToStaticMarkup(React.createElement(UtilityExecutionRow, { exec }));

    expect(html).toContain("grep 灯");
    expect(html).not.toContain("<details");
  });
});
