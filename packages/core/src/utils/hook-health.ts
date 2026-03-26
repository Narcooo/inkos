import type { AuditIssue } from "../agents/continuity.js";
import type { HookRecord, RuntimeStateDelta } from "../models/runtime-state.js";
import { classifyHookDisposition, collectStaleHookDebt } from "./hook-governance.js";

export function analyzeHookHealth(params: {
  readonly language: "zh" | "en";
  readonly chapterNumber: number;
  readonly hooks: ReadonlyArray<HookRecord>;
  readonly delta?: Pick<RuntimeStateDelta, "chapter" | "hookOps">;
  readonly existingHookIds?: ReadonlyArray<string>;
  readonly maxActiveHooks?: number;
  readonly staleAfterChapters?: number;
  readonly noAdvanceWindow?: number;
  readonly newHookBurstThreshold?: number;
}): AuditIssue[] {
  const maxActiveHooks = params.maxActiveHooks ?? 12;
  const staleAfterChapters = params.staleAfterChapters ?? 10;
  const noAdvanceWindow = params.noAdvanceWindow ?? 5;
  const newHookBurstThreshold = params.newHookBurstThreshold ?? 2;
  const issues: AuditIssue[] = [];

  const activeHooks = params.hooks.filter((hook) => hook.status !== "resolved");

  if (activeHooks.length > maxActiveHooks) {
    issues.push(warning(
      params.language,
      params.language === "en"
        ? `There are ${activeHooks.length} active hooks, above the recommended cap of ${maxActiveHooks}.`
        : `当前有 ${activeHooks.length} 个活跃伏笔，已经高于建议上限 ${maxActiveHooks} 个。`,
      params.language === "en"
        ? "Prefer advancing, resolving, or deferring existing debt before opening more hooks."
        : "优先推进、回收或延后已有伏笔，再继续开新伏笔。",
    ));
  }

  const latestRealAdvance = activeHooks.reduce(
    (max, hook) => Math.max(max, hook.lastAdvancedChapter),
    0,
  );
  if (activeHooks.length > 0 && params.chapterNumber - latestRealAdvance >= noAdvanceWindow) {
    issues.push(warning(
      params.language,
      params.language === "en"
        ? `No real hook advancement has landed for ${params.chapterNumber - latestRealAdvance} chapters.`
        : `已经连续 ${params.chapterNumber - latestRealAdvance} 章没有真实伏笔推进。`,
      params.language === "en"
        ? "Schedule one old hook for real movement instead of opening parallel restatements."
        : "下一章优先让一个旧伏笔发生真实推进，而不是继续平行重述。",
    ));
  }

  const staleHooks = collectStaleHookDebt({
    hooks: activeHooks,
    chapterNumber: params.chapterNumber,
    staleAfterChapters,
  });
  if (params.delta && staleHooks.length > 0) {
    const untouchedStale = staleHooks.filter((hook) => {
      const disposition = classifyHookDisposition({
        hookId: hook.hookId,
        delta: params.delta!,
      });
      return disposition === "none" || disposition === "mention";
    });

    if (untouchedStale.length > 0) {
      issues.push(warning(
        params.language,
        params.language === "en"
          ? `Stale hooks received no real disposition this chapter: ${untouchedStale.map((hook) => hook.hookId).join(", ")}.`
          : `本章没有真正处理这些陈旧伏笔：${untouchedStale.map((hook) => hook.hookId).join("、")}。`,
        params.language === "en"
          ? "Advance, resolve, or explicitly defer at least one stale hook."
          : "至少推进、回收或明确延后一个陈旧伏笔。",
      ));
    }
  }

  if (params.delta) {
    const existingHookIds = new Set(params.existingHookIds ?? []);
    const newHookIds = params.delta.hookOps.upsert
      .map((hook) => hook.hookId)
      .filter((hookId) => !existingHookIds.has(hookId));

    if (newHookIds.length >= newHookBurstThreshold && params.delta.hookOps.resolve.length === 0) {
      issues.push(warning(
        params.language,
        params.language === "en"
          ? `Opened ${newHookIds.length} new hooks without resolving any older debt.`
          : `本章新开了 ${newHookIds.length} 个伏笔，但没有回收任何旧债。`,
        params.language === "en"
          ? "Keep the hook table from ballooning by pairing new openings with old payoffs."
          : "控制伏笔膨胀，新开伏笔时尽量配套回收旧伏笔。",
      ));
    }
  }

  return issues;
}

function warning(
  language: "zh" | "en",
  description: string,
  suggestion: string,
): AuditIssue {
  return {
    severity: "warning",
    category: language === "en" ? "Hook Debt" : "伏笔债务",
    description,
    suggestion,
  };
}
