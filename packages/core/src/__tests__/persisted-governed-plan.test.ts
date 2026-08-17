import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadPersistedPlan,
  savePersistedPlan,
} from "../pipeline/persisted-governed-plan.js";
import type { PlanChapterOutput } from "../agents/planner.js";

const MEMO_BODY = `## 当前任务
林越必须趁守夜人换班的空档，从母亲遗物里取回账册并悄悄离开旧港。

## 场景与篇幅预算
- 茶馆盯梢约 700 字
- 潜入旧宅取回账册约 1200 字
- 码头撤离约 900 字

## 读者此刻在等什么
读者想看账册内容会不会撕开上一章关于母亲身份的悬念，并对账册的下落给出实证。

## 该兑现的 / 暂不掀的
- 兑现：账册现身，与上一章的暗示对上
- 压住：母亲真实身份，等到第 6 章揭

## 日常/过渡承担什么任务
- [开场茶馆段] → 建立旧港潮湿氛围与对手视线，同时铺一个反派眼线的伏笔

## 关键抉择过三连问
林越拿起账册时必须过：为什么是现在？这符合他的当前利益吗？符合他的人设吗？

## 章尾必须发生的改变
- 账册从母亲遗物变为主角私有，主角与旧港江湖关系出现实质裂痕

## 本章 hook 账
advance: H1 账册下落 → planted → pressured（本章被主角拿到）
defer: H4 母亲真实身份 → 第 6 章再揭

## 不要做
- 不要出现母亲真实姓名
- 不要让账册被反派看到`;

function buildPlan(chapter: number): PlanChapterOutput {
  return {
    intent: {
      chapter,
      goal: "取回账册离开旧港",
      outlineNode: "Chapter 1: return",
      arcContext: "卷纲节点：第一卷序章",
      mustKeep: ["林越父亲已死", "母亲遗物"],
      mustAvoid: ["提前揭露母亲身份"],
      styleEmphasis: ["潮湿氛围", "短句交替"],
    },
    memo: {
      chapter,
      goal: "取回账册离开旧港",
      isGoldenOpening: true,
      threadRefs: ["H1"],
      body: MEMO_BODY,
    },
    intentMarkdown: "# Chapter Intent\n\n## Goal\n取回账册离开旧港\n",
    plannerInputs: ["story/volume_outline.md", "story/current_state.md"],
    runtimePath: "unused",
  };
}

describe("persisted-governed-plan round trip", () => {
  it("savePersistedPlan + loadPersistedPlan returns equal memo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "inkos-plan-"));
    await mkdir(join(dir, "story", "runtime"), { recursive: true });
    // Write the sibling intent.md so loader reads it back.
    await writeFile(
      join(dir, "story", "runtime", "chapter-0001.intent.md"),
      "# Chapter Intent\n\n## Goal\n取回账册离开旧港\n",
      "utf-8",
    );

    const plan = buildPlan(1);
    await savePersistedPlan(dir, plan);

    const persisted = await readFile(join(dir, "story", "runtime", "chapter-0001.plan.md"), "utf-8");
    expect(persisted.trimStart()).not.toMatch(/^---\s*\n/);
    expect(persisted).toContain("## 本章目标");
    expect(persisted).toContain("## 关联线索");

    const loaded = await loadPersistedPlan(dir, 1);
    expect(loaded).not.toBeNull();
    expect(loaded!.memo).toEqual(plan.memo);
    expect(loaded!.intent.goal).toBe(plan.intent.goal);
    expect(loaded!.intent.outlineNode).toBe(plan.intent.outlineNode);
    expect(loaded!.intent.arcContext).toBe(plan.intent.arcContext);
    expect(loaded!.intent.mustKeep).toEqual(plan.intent.mustKeep);
    expect(loaded!.intent.mustAvoid).toEqual(plan.intent.mustAvoid);
    expect(loaded!.intent.styleEmphasis).toEqual(plan.intent.styleEmphasis);
    expect(loaded!.plannerInputs).toEqual(plan.plannerInputs);
  });

  it("returns null when plan file does not exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "inkos-plan-"));
    await mkdir(join(dir, "story", "runtime"), { recursive: true });
    const loaded = await loadPersistedPlan(dir, 1);
    expect(loaded).toBeNull();
  });

  it("returns null when memo body is missing required sections", async () => {
    const dir = await mkdtemp(join(tmpdir(), "inkos-plan-"));
    await mkdir(join(dir, "story", "runtime"), { recursive: true });

    // Corrupt memo body: drop the 不要做 heading.
    const corrupt = `---
chapter: 1
goal: 取回账册离开旧港
isGoldenOpening: true
threadRefs: []
intent:
  goal: 取回账册离开旧港
  outlineNode: Chapter 1
  mustKeep: []
  mustAvoid: []
  styleEmphasis: []
plannerInputs: []
---
## 当前任务
只有一段。
`;
    await writeFile(
      join(dir, "story", "runtime", "chapter-0001.plan.md"),
      corrupt,
      "utf-8",
    );

    const loaded = await loadPersistedPlan(dir, 1);
    expect(loaded).toBeNull();
  });

  it("returns null when chapter number does not match", async () => {
    const dir = await mkdtemp(join(tmpdir(), "inkos-plan-"));
    await mkdir(join(dir, "story", "runtime"), { recursive: true });
    const plan = buildPlan(2);
    await savePersistedPlan(dir, plan);
    const loaded = await loadPersistedPlan(dir, 3);
    expect(loaded).toBeNull();
  });
});
