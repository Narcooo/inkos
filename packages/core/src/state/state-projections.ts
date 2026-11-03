import type { WritingLanguage } from "../models/book.js";
import type {
  ChapterSummariesState,
  CurrentStateState,
  HooksState,
} from "../models/runtime-state.js";

export function renderHooksProjection(
  state: HooksState,
  language: WritingLanguage = "zh",
  options?: { readonly currentChapter?: number },
): string {
  void options;
  const title = language !== "zh" ? "# Pending Hooks" : "# 伏笔池";
  const headers = language !== "zh"
    ? [
      "| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | notes |",
      "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    : [
      "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
      "| --- | --- | --- | --- | --- | --- | --- |",
    ];

  const rows = [...state.hooks]
    .sort((left, right) => (
      left.startChapter - right.startChapter
      || left.lastAdvancedChapter - right.lastAdvancedChapter
      || left.hookId.localeCompare(right.hookId)
    ))
    .map((hook) => `| ${
        [
          hook.hookId,
          hook.startChapter,
          hook.type,
          hook.status,
          hook.lastAdvancedChapter,
          hook.expectedPayoff,
          hook.notes,
        ].map(escapeTableCell).join(" | ")
      } |`);

  return [title, "", ...headers, ...rows, ""].join("\n");
}

export function renderChapterSummariesProjection(
  state: ChapterSummariesState,
  language: WritingLanguage = "zh",
): string {
  const title = language !== "zh" ? "# Chapter Summaries" : "# 章节摘要";
  const headers = language !== "zh"
    ? [
      "| Chapter | Title | Characters | Key Events | State Changes | Hook Activity | Mood | Chapter Type |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    : [
      "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ];

  const rows = [...state.rows]
    .sort((left, right) => left.chapter - right.chapter)
    .map((summary) => `| ${
      [
        summary.chapter,
        summary.title,
        summary.characters,
        summary.events,
        summary.stateChanges,
        summary.hookActivity,
        summary.mood,
        summary.chapterType,
      ].map(escapeTableCell).join(" | ")
    } |`);

  return [title, "", ...headers, ...rows, ""].join("\n");
}

export function renderCurrentStateProjection(
  state: CurrentStateState,
  language: WritingLanguage = "zh",
): string {
  const title = language !== "zh" ? "# Current State" : "# 当前状态";
  const chapterLabel = language !== "zh" ? "Current chapter" : "当前章节";
  const headers = language !== "zh"
    ? [
        "| Subject | Predicate | Object | Valid from | Source chapter |",
        "| --- | --- | --- | --- | --- |",
      ]
    : [
        "| 主体 | 关系 / 属性 | 当前事实 | 生效章节 | 来源章节 |",
        "| --- | --- | --- | --- | --- |",
      ];
  const facts = state.facts
    .filter((fact) => fact.validUntilChapter === null || fact.validUntilChapter >= state.chapter)
    .sort((left, right) => (
      left.subject.localeCompare(right.subject)
      || left.predicate.localeCompare(right.predicate)
      || left.object.localeCompare(right.object)
    ))
    .map((fact) => `| ${[
      fact.subject,
      fact.predicate,
      fact.object,
      fact.validFromChapter,
      fact.sourceChapter,
    ].map(escapeTableCell).join(" | ")} |`);

  return [
    title,
    "",
    `> ${chapterLabel}: ${state.chapter}`,
    "",
    ...headers,
    ...facts,
    "",
  ].join("\n");
}

function escapeTableCell(value: string | number): string {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>").trim();
}
