import type {
  ChapterSummariesState,
  CurrentStateState,
  HooksState,
} from "../models/runtime-state.js";

export function renderHooksProjection(
  state: HooksState,
  language: "zh" | "en" = "zh",
): string {
  const title = language === "en" ? "# Pending Hooks" : "# 伏笔池";
  const headers = language === "en"
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
  language: "zh" | "en" = "zh",
): string {
  const title = language === "en" ? "# Chapter Summaries" : "# 章节摘要";
  const headers = language === "en"
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
  language: "zh" | "en" = "zh",
): string {
  const layout = language === "en"
    ? {
      title: "# Current State",
      tableHeader: "| Field | Value |",
      labels: {
        chapter: "Current Chapter",
        location: "Current Location",
        protagonistState: "Protagonist State",
        goal: "Current Goal",
        constraint: "Current Constraint",
        alliances: "Current Alliances",
        conflict: "Current Conflict",
      },
      placeholders: "(not set)",
      additionalTitle: "## Additional State",
    }
    : {
      title: "# 当前状态",
      tableHeader: "| 字段 | 值 |",
      labels: {
        chapter: "当前章节",
        location: "当前位置",
        protagonistState: "主角状态",
        goal: "当前目标",
        constraint: "当前限制",
        alliances: "当前敌我",
        conflict: "当前冲突",
      },
      placeholders: "（未设定）",
      additionalTitle: "## 其他状态",
    };

  const slots = [
    {
      label: layout.labels.location,
      aliases: ["Current Location", "当前位置"],
    },
    {
      label: layout.labels.protagonistState,
      aliases: ["Protagonist State", "主角状态"],
    },
    {
      label: layout.labels.goal,
      aliases: ["Current Goal", "当前目标"],
    },
    {
      label: layout.labels.constraint,
      aliases: ["Current Constraint", "当前限制"],
    },
    {
      label: layout.labels.alliances,
      aliases: ["Current Alliances", "Current Relationships", "当前敌我"],
    },
    {
      label: layout.labels.conflict,
      aliases: ["Current Conflict", "当前冲突"],
    },
  ] as const;

  const knownPredicates = new Set(
    slots.flatMap((slot) => slot.aliases.map(normalizePredicate)),
  );
  const lines = [
    layout.title,
    "",
    layout.tableHeader,
    "| --- | --- |",
    `| ${layout.labels.chapter} | ${escapeTableCell(state.chapter)} |`,
    ...slots.map((slot) => {
      const value = findFactValue(state, slot.aliases) ?? layout.placeholders;
      return `| ${slot.label} | ${escapeTableCell(value)} |`;
    }),
  ];

  const additionalFacts = [...state.facts]
    .filter((fact) => !knownPredicates.has(normalizePredicate(fact.predicate)))
    .sort((left, right) => compareAdditionalFacts(left.predicate, right.predicate));

  if (additionalFacts.length === 0) {
    return [...lines, ""].join("\n");
  }

  return [
    ...lines,
    "",
    layout.additionalTitle,
    ...additionalFacts.map((fact) => renderAdditionalFact(fact.predicate, fact.object)),
    "",
  ].join("\n");
}

function findFactValue(
  state: CurrentStateState,
  aliases: ReadonlyArray<string>,
): string | undefined {
  const aliasSet = new Set(aliases.map(normalizePredicate));
  return state.facts.find((fact) => aliasSet.has(normalizePredicate(fact.predicate)))?.object;
}

function renderAdditionalFact(predicate: string, object: string): string {
  if (/^note_\d+$/i.test(predicate)) {
    return `- ${object}`;
  }
  return `- ${predicate}: ${object}`;
}

function compareAdditionalFacts(left: string, right: string): number {
  const leftNote = left.match(/^note_(\d+)$/i);
  const rightNote = right.match(/^note_(\d+)$/i);
  if (leftNote && rightNote) {
    return Number.parseInt(leftNote[1] ?? "0", 10) - Number.parseInt(rightNote[1] ?? "0", 10);
  }
  if (leftNote) return -1;
  if (rightNote) return 1;
  return left.localeCompare(right);
}

function normalizePredicate(value: string): string {
  return value.trim().toLowerCase();
}

function escapeTableCell(value: string | number): string {
  return String(value).replace(/\|/g, "\\|").trim();
}
