import type {
  ChapterSummariesState,
  CurrentStateState,
  HooksState,
} from "../models/runtime-state.js";
import {
  localizeHookPayoffTiming,
  resolveHookPayoffTiming,
} from "../utils/hook-lifecycle.js";
import {
  computeHookDiagnostics,
  renderHookDiagnosticMarker,
} from "../utils/hook-stale-detection.js";

export function renderHooksProjection(
  state: HooksState,
  language: "zh" | "en" | "ko" = "zh",
  options?: { readonly currentChapter?: number },
): string {
  const title = language === "ko" ? "# 대기 중인 Hook" : language === "en" ? "# Pending Hooks" : "# 伏笔池";
  // Phase 7 + hotfixes 1 & 2: depends_on / pays_off_in_arc / core_hook / half_life / promoted
  // are visible columns, so writer and reviewer both see the causal chain, planned payoff arc,
  // stale threshold, and promotion flag. stale / blocked diagnostic flags are appended to the
  // status cell.
  const headers = language === "ko"
    ? [
      "| hook_id | 시작 장 | 유형 | 상태 | 최근 진행 장 | 예상 회수 | 회수 리듬 | 선행 조건 | 회수 권 | 핵심 | 반감기 | 승격 | 비고 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    : language === "en"
    ? [
      "| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | payoff_timing | depends_on | pays_off_in_arc | core_hook | half_life | promoted | notes |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    : [
      "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 回收节奏 | 上游依赖 | 回收卷 | 核心 | 半衰期 | 升级 | 备注 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ];

  const currentChapter = options?.currentChapter;
  const diagnostics = typeof currentChapter === "number"
    ? computeHookDiagnostics({ hooks: state.hooks, currentChapter })
    : null;

  const rows = [...state.hooks]
    .sort((left, right) => (
      left.startChapter - right.startChapter
      || left.lastAdvancedChapter - right.lastAdvancedChapter
      || left.hookId.localeCompare(right.hookId)
    ))
    .map((hook) => {
      const diag = diagnostics?.get(hook.hookId);
      const marker = diag ? renderHookDiagnosticMarker(diag, language) : "";
      const statusCell = marker
        ? `${hook.status} (${marker})`
        : hook.status;
      return `| ${
        [
          hook.hookId,
          hook.startChapter,
          hook.type,
          statusCell,
          hook.lastAdvancedChapter,
          hook.expectedPayoff,
          localizeHookPayoffTiming(resolveHookPayoffTiming(hook), language === "ko" ? "en" : language),
          renderDependsOnCell(hook.dependsOn ?? [], language),
          hook.paysOffInArc ?? "",
          renderCoreHookCell(hook.coreHook === true, language),
          renderHalfLifeCell(hook.halfLifeChapters),
          renderPromotedCell(hook.promoted, language),
          hook.notes,
        ].map(escapeTableCell).join(" | ")
      } |`;
    });

  return [title, "", ...headers, ...rows, ""].join("\n");
}

function renderDependsOnCell(ids: ReadonlyArray<string>, language: "zh" | "en" | "ko"): string {
  if (ids.length === 0) return language === "ko" ? "없음" : language === "en" ? "none" : "无";
  return `[${ids.join(", ")}]`;
}

function renderCoreHookCell(isCore: boolean, language: "zh" | "en" | "ko"): string {
  if (language === "ko") return isCore ? "예" : "아니오";
  if (language === "en") return isCore ? "true" : "false";
  return isCore ? "是" : "否";
}

function renderHalfLifeCell(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "";
  return String(Math.trunc(value));
}

function renderPromotedCell(value: boolean | undefined, language: "zh" | "en" | "ko"): string {
  if (value === undefined) return "";
  if (language === "ko") return value ? "예" : "아니오";
  if (language === "en") return value ? "true" : "false";
  return value ? "是" : "否";
}

export function renderChapterSummariesProjection(
  state: ChapterSummariesState,
  language: "zh" | "en" | "ko" = "zh",
): string {
  const title = language === "ko" ? "# 챕터 요약" : language === "en" ? "# Chapter Summaries" : "# 章节摘要";
  const headers = language === "ko"
    ? [
      "| 장 | 제목 | 등장인물 | 핵심 사건 | 상태 변화 | Hook 변화 | 분위기 | 챕터 유형 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    : language === "en"
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
  language: "zh" | "en" | "ko" = "zh",
): string {
  const layout = language === "ko"
    ? {
      title: "# 현재 상태",
      tableHeader: "| 항목 | 값 |",
      labels: {
        chapter: "현재 장",
        location: "현재 위치",
        protagonistState: "주인공 상태",
        goal: "현재 목표",
        constraint: "현재 제약",
        alliances: "현재 관계",
        conflict: "현재 갈등",
      },
      placeholders: "(미설정)",
      additionalTitle: "## 추가 상태",
    }
    : language === "en"
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
      aliases: ["Current Location", "当前位置", "현재 위치"],
    },
    {
      label: layout.labels.protagonistState,
      aliases: ["Protagonist State", "主角状态", "주인공 상태"],
    },
    {
      label: layout.labels.goal,
      aliases: ["Current Goal", "当前目标", "현재 목표"],
    },
    {
      label: layout.labels.constraint,
      aliases: ["Current Constraint", "当前限制", "현재 제약"],
    },
    {
      label: layout.labels.alliances,
      aliases: ["Current Alliances", "Current Relationships", "当前敌我", "현재 관계"],
    },
    {
      label: layout.labels.conflict,
      aliases: ["Current Conflict", "当前冲突", "현재 갈등"],
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
