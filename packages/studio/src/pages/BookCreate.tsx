import { useEffect, useMemo, useState } from "react";
import type { BookCreationDraft } from "@actalk/inkos-core";
import { BookPlus, CheckCircle2, RotateCcw, Sparkles } from "lucide-react";
import { fetchJson, useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useI18n } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import {
  filterGenresForLanguage,
  resolveBookCreateLanguage,
  type GenreListItem,
} from "./genre-language";
import {
  clearBookCreateSessionId,
  getBookCreateSessionId,
  setBookCreateSessionId,
} from "./chat-page-state";
import {
  CUSTOM_STYLE_TEMPLATE_EVENT,
  buildStyleCreationBrief,
  findStyleRevisionTemplate,
  getAllStyleRevisionTemplates,
  type StyleRevisionTemplate,
  type StyleTemplateLanguage,
} from "./style-revision-templates";

interface Nav {
  toDashboard: () => void;
  toBook: (id: string) => void;
}

interface PlatformOption {
  readonly value: string;
  readonly label: string;
}

export interface BookCreateFormState {
  readonly title: string;
  readonly genre: string;
  readonly platform: string;
  readonly targetChapters: string;
  readonly chapterWordCount: string;
  readonly brief: string;
  readonly styleGuide: string;
}

export interface BookCreatePayload {
  readonly title: string;
  readonly genre: string;
  readonly platform: string;
  readonly language: "zh" | "en" | "ko";
  readonly targetChapters: number;
  readonly chapterWordCount: number;
  readonly blurb: string;
  readonly styleGuide?: string;
}

export interface DraftSummaryRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

interface InteractionSessionResponse {
  readonly session?: {
    readonly activeBookId?: string;
    readonly creationDraft?: BookCreationDraft;
  };
  readonly activeBookId?: string;
}

interface AgentResponse {
  readonly response?: string;
  readonly error?: string;
  readonly session?: {
    readonly sessionId?: string;
    readonly activeBookId?: string;
    readonly creationDraft?: BookCreationDraft;
  };
}

interface SessionResponse {
  readonly session?: {
    readonly sessionId?: string;
    readonly bookId?: string | null;
  };
}

interface PlatformCopy {
  readonly idleTitle: string;
  readonly idleBody: string;
  readonly formHeading: string;
  readonly formHint: string;
  readonly titleLabel: string;
  readonly titlePlaceholder: string;
  readonly genreLabel: string;
  readonly genrePlaceholder: string;
  readonly platformLabel: string;
  readonly targetChaptersLabel: string;
  readonly chapterWordCountLabel: string;
  readonly briefLabel: string;
  readonly briefPlaceholder: string;
  readonly styleGuideLabel: string;
  readonly styleGuidePlaceholder: string;
  readonly styleTemplateLabel: string;
  readonly customStyleTemplate: string;
  readonly createBook: string;
  readonly creatingBook: string;
  readonly creationStatus: string;
  readonly creationSteps: ReadonlyArray<string>;
  readonly assistantHeading: string;
  readonly assistantHint: string;
  readonly applyDraft: string;
  readonly promptLabel: string;
  readonly promptPlaceholder: string;
  readonly promptPlaceholderFollowup: string;
  readonly submit: string;
  readonly submitting: string;
  readonly create: string;
  readonly creating: string;
  readonly discard: string;
  readonly draftHeading: string;
  readonly missingHeading: string;
  readonly missingHint: string;
  readonly syncedHint: string;
  readonly helperTitle: string;
  readonly helperBody: string;
}

const PLATFORMS_ZH: ReadonlyArray<PlatformOption> = [
  { value: "tomato", label: "番茄小说" },
  { value: "qidian", label: "起点中文网" },
  { value: "feilu", label: "飞卢" },
  { value: "other", label: "其他" },
];

const PLATFORMS_EN: ReadonlyArray<PlatformOption> = [
  { value: "royal-road", label: "Royal Road" },
  { value: "kindle-unlimited", label: "Kindle Unlimited" },
  { value: "scribble-hub", label: "Scribble Hub" },
  { value: "other", label: "Other" },
];

const PLATFORMS_KO: ReadonlyArray<PlatformOption> = [
  { value: "kakao-page", label: "카카오페이지" },
  { value: "naver-series", label: "네이버 시리즈" },
  { value: "munpia", label: "문피아" },
  { value: "joara", label: "조아라" },
  { value: "other", label: "기타" },
];

const PAGE_COPY: Record<"zh" | "en", PlatformCopy> = {
  zh: {
    idleTitle: "从一句模糊想法开始",
    idleBody: "先填清楚书名、题材和故事核心，系统会生成基础设定并进入新书工作台。",
    formHeading: "书籍基础信息",
    formHint: "这些字段会直接进入建书流程。简介写得越具体，后续基础设定越稳定。",
    titleLabel: "书名",
    titlePlaceholder: "例如：夜港账本",
    genreLabel: "题材 / 类型",
    genrePlaceholder: "例如：都市悬疑、玄幻、科幻、女频情感",
    platformLabel: "目标平台",
    targetChaptersLabel: "目标章数",
    chapterWordCountLabel: "每章字数",
    briefLabel: "故事简介 / 核心设定",
    briefPlaceholder: "写清世界观、主角、目标、核心冲突和第一阶段方向。例如：近未来港口城，主角是水货账房，想洗白却被旧账拖回港口旧案。",
    styleGuideLabel: "文风要求",
    styleGuidePlaceholder: "可选。例：短句推进，强对白，少旁白，多动作细节。",
    styleTemplateLabel: "文风模板",
    customStyleTemplate: "自定义 / 不使用模板",
    createBook: "创建书籍",
    creatingBook: "创建中…",
    creationStatus: "正在创建书籍，完成后会自动进入工作台。",
    creationSteps: ["写入书籍配置", "生成基础设定", "准备工作台"],
    assistantHeading: "需要先让 AI 帮你补设定？",
    assistantHint: "这块是辅助草案，不是必须步骤。已有草案可以一键套用到左侧表单。",
    applyDraft: "套用草案",
    promptLabel: "继续打磨这本书",
    promptPlaceholder: "例如：我想写个港风商战悬疑，主角先做灰产再洗白。",
    promptPlaceholderFollowup: "例如：世界观改成近未来港口城；女主不要太早出场；卷一先查账再砸场。",
    submit: "更新草案",
    submitting: "处理中…",
    create: "按当前草案建书",
    creating: "创建中…",
    discard: "丢弃草案",
    draftHeading: "当前基础设定草案",
    missingHeading: "还缺这些关键信息",
    missingHint: "这些字段未必都要一次填满，但缺得太多时不要急着建书。",
    syncedHint: "这份草案和 TUI / Studio Chat 共享。",
    helperTitle: "建议这样推进",
    helperBody: "先定世界观和主角，再定核心冲突、简介和卷一方向。想看当前草案时，可以在 TUI 里用 /draft。",
  },
  en: {
    idleTitle: "Start from a rough idea",
    idleBody: "Fill in the title, genre, and story core first. InkOS will generate the foundation and open the new workspace.",
    formHeading: "Book basics",
    formHint: "These fields go straight into creation. A concrete brief gives the foundation generator better material.",
    titleLabel: "Title",
    titlePlaceholder: "Example: Ledger of the Night Port",
    genreLabel: "Genre",
    genrePlaceholder: "Example: mystery, urban fantasy, sci-fi, romance",
    platformLabel: "Target platform",
    targetChaptersLabel: "Target chapters",
    chapterWordCountLabel: "Words per chapter",
    briefLabel: "Story brief / core premise",
    briefPlaceholder: "Include the world, protagonist, goal, core conflict, and first arc direction.",
    styleGuideLabel: "Style direction",
    styleGuidePlaceholder: "Optional. Example: tight third-person POV, restrained lyricism, vivid sensory detail, quick dialogue.",
    styleTemplateLabel: "Style template",
    customStyleTemplate: "Custom / no template",
    createBook: "Create book",
    creatingBook: "Creating…",
    creationStatus: "Creating the book. The workspace will open automatically when it is ready.",
    creationSteps: ["Saving config", "Generating foundation", "Preparing workspace"],
    assistantHeading: "Want AI to shape the idea first?",
    assistantHint: "This draft area is optional. If a draft looks useful, apply it to the form.",
    applyDraft: "Apply draft",
    promptLabel: "Refine this book",
    promptPlaceholder: "Example: I want a harbor-noir business thriller about a fixer trying to go legit.",
    promptPlaceholderFollowup: "Example: move the world to a near-future port city; delay the heroine; make volume one about chasing ledgers first.",
    submit: "Update draft",
    submitting: "Working…",
    create: "Create book from draft",
    creating: "Creating…",
    discard: "Discard draft",
    draftHeading: "Current foundation draft",
    missingHeading: "Still missing",
    missingHint: "You do not need every field immediately, but do not create the book while the foundation is still vague.",
    syncedHint: "This draft is shared with TUI and Studio Chat.",
    helperTitle: "Recommended flow",
    helperBody: "Lock the world and protagonist first, then settle the conflict, blurb, and volume-one direction. In TUI, use /draft to inspect the same draft.",
  },
};

const KOREAN_PAGE_COPY: PlatformCopy = {
  idleTitle: "거친 아이디어에서 시작하기",
  idleBody: "제목, 장르, 이야기 핵심을 먼저 정하세요. InkOS가 기초 설정을 만들고 새 작업실을 엽니다.",
  formHeading: "작품 기본 정보",
  formHint: "이 항목들은 작품 생성 과정에 바로 들어갑니다. 소개가 구체적일수록 이후 기초 설정이 안정적입니다.",
  titleLabel: "제목",
  titlePlaceholder: "예: 밤항구 장부",
  genreLabel: "장르",
  genrePlaceholder: "장르 템플릿 선택",
  platformLabel: "목표 플랫폼",
  targetChaptersLabel: "목표 장수",
  chapterWordCountLabel: "장당 분량",
  briefLabel: "이야기 소개 / 핵심 설정",
  briefPlaceholder: "세계관, 주인공, 목표, 핵심 갈등, 1부 방향을 적어주세요.",
  styleGuideLabel: "문체 지시",
  styleGuidePlaceholder: "선택 사항. 예: 담백한 3인칭, 짧은 문단, 대화는 자연스럽게, 감정은 행동과 감각으로 보여주기.",
  styleTemplateLabel: "문체 양식",
  customStyleTemplate: "사용자 지정 / 양식 없음",
  createBook: "작품 만들기",
  creatingBook: "생성 중...",
  creationStatus: "작품을 생성하는 중입니다. 완료되면 작업실로 자동 이동합니다.",
  creationSteps: ["작품 설정 저장", "기초 설정 생성", "작업실 준비"],
  assistantHeading: "AI가 설정을 먼저 다듬게 할까요?",
  assistantHint: "이 초안 영역은 선택 사항입니다. 쓸 만한 초안이 있으면 왼쪽 폼에 적용할 수 있습니다.",
  applyDraft: "초안 적용",
  promptLabel: "이 작품 더 다듬기",
  promptPlaceholder: "예: 코지 판타지로, 은퇴한 마법사가 작은 찻집을 열고 마을 문제를 해결하는 이야기.",
  promptPlaceholderFollowup: "예: 1부는 찻집 개업과 첫 손님, 주인공의 상처 회복을 중심으로.",
  submit: "초안 업데이트",
  submitting: "처리 중...",
  create: "현재 초안으로 작품 만들기",
  creating: "생성 중...",
  discard: "초안 버리기",
  draftHeading: "현재 기초 설정 초안",
  missingHeading: "아직 부족한 정보",
  missingHint: "모든 항목을 한 번에 채울 필요는 없지만, 너무 모호하면 작품 생성을 서두르지 않는 편이 좋습니다.",
  syncedHint: "이 초안은 TUI / Studio Chat과 공유됩니다.",
  helperTitle: "추천 진행 방식",
  helperBody: "세계관과 주인공을 먼저 정하고, 그다음 핵심 갈등, 소개, 1부 방향을 정하세요.",
};

export function pickValidValue(current: string, available: ReadonlyArray<string>): string {
  if (current && available.includes(current)) {
    return current;
  }
  return available[0] ?? "";
}

export function defaultChapterWordsForLanguage(language: "zh" | "en" | "ko"): string {
  return language === "en" ? "2000" : "3000";
}

export function defaultBookCreateForm(language: "zh" | "en" | "ko"): BookCreateFormState {
  return {
    title: "",
    genre: "",
    platform: platformOptionsForLanguage(language)[0]?.value ?? "other",
    targetChapters: "200",
    chapterWordCount: defaultChapterWordsForLanguage(language),
    brief: "",
    styleGuide: "",
  };
}

export function platformOptionsForLanguage(language: "zh" | "en" | "ko"): ReadonlyArray<PlatformOption> {
  return language === "ko" ? PLATFORMS_KO : language === "en" ? PLATFORMS_EN : PLATFORMS_ZH;
}

function resolveStyleTemplateLanguage(language: string): StyleTemplateLanguage {
  return language === "ko" ? "ko" : language === "en" ? "en" : "zh";
}

function parsePositiveInteger(value: string): number | null {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function isBookCreateFormReady(form: BookCreateFormState): boolean {
  return Boolean(
    form.title.trim()
      && form.genre.trim()
      && form.brief.trim()
      && parsePositiveInteger(form.targetChapters)
      && parsePositiveInteger(form.chapterWordCount),
  );
}

export function buildBookCreatePayload(
  form: BookCreateFormState,
  language: "zh" | "en" | "ko",
): BookCreatePayload {
  const targetChapters = parsePositiveInteger(form.targetChapters);
  const chapterWordCount = parsePositiveInteger(form.chapterWordCount);
  if (!targetChapters || !chapterWordCount || !isBookCreateFormReady(form)) {
    throw new Error(language === "ko" ? "작품 만들기 양식을 먼저 채워주세요." : language === "zh" ? "请先补齐建书表单。" : "Complete the book creation form first.");
  }
  return {
    title: form.title.trim(),
    genre: form.genre.trim(),
    platform: form.platform,
    language,
    targetChapters,
    chapterWordCount,
    blurb: form.brief.trim(),
    ...(form.styleGuide.trim() ? { styleGuide: form.styleGuide.trim() } : {}),
  };
}

export function resolveDraftInstruction(input: string, hasDraft: boolean): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }
  return hasDraft ? trimmed : `/new ${trimmed}`;
}

interface DraftInstructionFromFormOptions {
  readonly input: string;
  readonly form: BookCreateFormState;
  readonly hasDraft: boolean;
  readonly uiLanguage: "zh" | "en" | "ko";
  readonly genreLabel?: string;
  readonly fallbackGenreId?: string;
  readonly fallbackGenreLabel?: string;
  readonly platformLabel?: string;
}

export function hasEnoughFormForDraft(form: BookCreateFormState): boolean {
  return Boolean(form.title.trim() || form.genre.trim() || form.brief.trim() || form.styleGuide.trim());
}

export function buildDraftInstructionFromForm(options: DraftInstructionFromFormOptions): string {
  const typedInput = options.input.trim();
  if (typedInput) {
    return resolveDraftInstruction(typedInput, options.hasDraft);
  }

  const selectedGenreId = options.form.genre.trim() || options.fallbackGenreId?.trim() || "";
  const selectedGenreLabel = options.genreLabel?.trim() || options.fallbackGenreLabel?.trim() || "";
  const genreText = selectedGenreId
    ? selectedGenreLabel
      ? `${selectedGenreLabel} (${selectedGenreId})`
      : selectedGenreId
    : "";
  const appendOptional = (lines: string[], label: string, value: string | undefined) => {
    if (value?.trim()) {
      lines.push(`${label}: ${value.trim()}`);
    }
  };
  const appendBrief = (lines: string[], label: string, value: string) => {
    if (value.trim()) {
      lines.push("", `${label}:`, value.trim());
    }
  };
  const lines = options.uiLanguage === "ko"
    ? (() => {
        const result = [
        "아래 작품 기본 정보를 바탕으로 장르에 맞는 기초 설정 초안을 만들어줘.",
        "비어 있는 항목은 직접 창작해서 채워줘. 장르가 선택되어 있으면 반드시 그 장르를 참고하고, 장르가 없으면 웹소설에 어울리는 장르를 하나 무작위로 선택해줘.",
        "초안이 없더라도 바로 제목 후보, 세계관, 주인공, 핵심 갈등, 1부 방향, 소개문을 생성해줘.",
        "",
      ];
        appendOptional(result, "제목", options.form.title);
        appendOptional(result, "장르", genreText);
        appendOptional(result, "목표 플랫폼", options.platformLabel ?? options.form.platform);
        appendOptional(result, "목표 장수", options.form.targetChapters);
        appendOptional(result, "장당 분량", options.form.chapterWordCount);
        appendBrief(result, "이야기 소개 / 핵심 설정", options.form.brief);
        appendBrief(result, "문체 지시", options.form.styleGuide);
        result.push("", "결과에는 제목 후보가 필요하면 다듬은 제목, 세계관, 주인공, 핵심 갈등, 1부 방향, 소개문, 부족한 질문을 포함해줘.");
        return result;
      })()
    : options.uiLanguage === "en"
      ? (() => {
          const result = [
          "Use the book basics below to generate a genre-aware foundation draft.",
          "Invent any missing fields. If a genre is selected, use it; if not, randomly choose a fitting web-novel genre.",
          "Even when there is no existing draft, generate title candidates, world premise, protagonist, core conflict, volume-one direction, and blurb immediately.",
          "",
        ];
          appendOptional(result, "Title", options.form.title);
          appendOptional(result, "Genre", genreText);
          appendOptional(result, "Target platform", options.platformLabel ?? options.form.platform);
          appendOptional(result, "Target chapters", options.form.targetChapters);
          appendOptional(result, "Words per chapter", options.form.chapterWordCount);
          appendBrief(result, "Story brief / core premise", options.form.brief);
          appendBrief(result, "Style direction", options.form.styleGuide);
          result.push("", "Include a refined title if helpful, world premise, protagonist, core conflict, volume-one direction, blurb, and remaining questions.");
          return result;
        })()
      : (() => {
          const result = [
          "请基于下面的建书表单，生成符合所选题材模板的基础设定草案。",
          "空缺字段请直接创作补齐。若已选择题材，必须参考该题材；若未选择题材，请随机选择一个适合网文的题材。",
          "即使还没有草案，也要立刻生成书名候选、世界观、主角、核心冲突、卷一方向和简介。",
          "",
        ];
          appendOptional(result, "书名", options.form.title);
          appendOptional(result, "题材", genreText);
          appendOptional(result, "目标平台", options.platformLabel ?? options.form.platform);
          appendOptional(result, "目标章数", options.form.targetChapters);
          appendOptional(result, "每章字数", options.form.chapterWordCount);
          appendBrief(result, "故事简介 / 核心设定", options.form.brief);
          appendBrief(result, "文风要求", options.form.styleGuide);
          result.push("", "结果请包含可优化书名、世界观、主角、核心冲突、卷一方向、简介，以及仍需补充的问题。");
          return result;
        })();

  return resolveDraftInstruction(lines.join("\n"), options.hasDraft);
}

export function canCreateFromDraft(draft?: BookCreationDraft): boolean {
  if (!draft) {
    return false;
  }
  if (draft.readyToCreate) {
    return true;
  }
  return Boolean(
    draft.title?.trim()
      && draft.genre?.trim()
      && typeof draft.targetChapters === "number"
      && typeof draft.chapterWordCount === "number",
  );
}

export function buildCreationDraftSummary(
  draft: BookCreationDraft,
  language: "zh" | "en" | "ko",
): ReadonlyArray<DraftSummaryRow> {
  const rows = language === "ko"
    ? [
        draft.title ? { key: "title", label: "제목", value: draft.title } : undefined,
        draft.worldPremise ? { key: "worldPremise", label: "세계관", value: draft.worldPremise } : undefined,
        draft.protagonist ? { key: "protagonist", label: "주인공", value: draft.protagonist } : undefined,
        draft.conflictCore ? { key: "conflictCore", label: "핵심 갈등", value: draft.conflictCore } : undefined,
        draft.volumeOutline ? { key: "volumeOutline", label: "1부 방향", value: draft.volumeOutline } : undefined,
        draft.blurb ? { key: "blurb", label: "소개문", value: draft.blurb } : undefined,
        draft.styleGuide ? { key: "styleGuide", label: "문체", value: draft.styleGuide } : undefined,
        draft.nextQuestion ? { key: "nextQuestion", label: "다음 단계", value: draft.nextQuestion } : undefined,
      ]
    : language === "en"
    ? [
        draft.title ? { key: "title", label: "Title", value: draft.title } : undefined,
        draft.worldPremise ? { key: "worldPremise", label: "World", value: draft.worldPremise } : undefined,
        draft.protagonist ? { key: "protagonist", label: "Protagonist", value: draft.protagonist } : undefined,
        draft.conflictCore ? { key: "conflictCore", label: "Core Conflict", value: draft.conflictCore } : undefined,
        draft.volumeOutline ? { key: "volumeOutline", label: "Volume Direction", value: draft.volumeOutline } : undefined,
        draft.blurb ? { key: "blurb", label: "Blurb", value: draft.blurb } : undefined,
        draft.styleGuide ? { key: "styleGuide", label: "Style", value: draft.styleGuide } : undefined,
        draft.nextQuestion ? { key: "nextQuestion", label: "Next", value: draft.nextQuestion } : undefined,
      ]
    : [
        draft.title ? { key: "title", label: "书名", value: draft.title } : undefined,
        draft.worldPremise ? { key: "worldPremise", label: "世界观", value: draft.worldPremise } : undefined,
        draft.protagonist ? { key: "protagonist", label: "主角", value: draft.protagonist } : undefined,
        draft.conflictCore ? { key: "conflictCore", label: "核心冲突", value: draft.conflictCore } : undefined,
        draft.volumeOutline ? { key: "volumeOutline", label: "卷纲方向", value: draft.volumeOutline } : undefined,
        draft.blurb ? { key: "blurb", label: "简介", value: draft.blurb } : undefined,
        draft.styleGuide ? { key: "styleGuide", label: "文风", value: draft.styleGuide } : undefined,
        draft.nextQuestion ? { key: "nextQuestion", label: "下一步", value: draft.nextQuestion } : undefined,
      ];

  return rows.filter((row): row is DraftSummaryRow => Boolean(row));
}

export function applyCreationDraftToFormState(
  current: BookCreateFormState,
  draft: BookCreationDraft,
  platformChoices: ReadonlyArray<PlatformOption>,
): BookCreateFormState {
  const draftBrief = [
    draft.blurb,
    draft.worldPremise,
    draft.protagonist,
    draft.conflictCore,
    draft.volumeOutline,
  ].filter((part): part is string => Boolean(part?.trim())).join("\n\n");
  const platformValues = platformChoices.map((option) => option.value);
  return {
    title: draft.title?.trim() || current.title,
    genre: draft.genre?.trim() || current.genre,
    platform: pickValidValue(draft.platform ?? current.platform, platformValues),
    targetChapters: draft.targetChapters ? String(draft.targetChapters) : current.targetChapters,
    chapterWordCount: draft.chapterWordCount ? String(draft.chapterWordCount) : current.chapterWordCount,
    brief: draftBrief || current.brief,
    styleGuide: draft.styleGuide?.trim() || current.styleGuide,
  };
}

function cleanDraftCell(value: string): string {
  return value.replace(/\*\*/g, "").replace(/<br\s*\/?>/gi, "\n").trim();
}

function firstDraftTitle(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return cleanDraftCell(value)
    .split(/\s*\/\s*|\n|,|，/u)
    .map((part) => part.trim())
    .find(Boolean);
}

export function extractCreationDraftFromAssistantText(args: {
  readonly responseText?: string;
  readonly concept: string;
  readonly genreId?: string;
  readonly language?: "zh" | "en" | "ko";
  readonly platform?: string;
  readonly targetChapters?: string;
  readonly chapterWordCount?: string;
}): BookCreationDraft | undefined {
  const raw = args.responseText?.trim();
  if (!raw) return undefined;

  const table: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const match = /^\s*\|\s*(?:\*\*)?([^|*]+?)(?:\*\*)?\s*\|\s*([^|]+?)\s*\|\s*$/u.exec(line);
    if (!match) continue;
    const key = cleanDraftCell(match[1] ?? "");
    const value = cleanDraftCell(match[2] ?? "");
    if (!key || !value || /^:?-+:?$/u.test(key) || /^:?-+:?$/u.test(value)) continue;
    table[key] = value;
  }

  const get = (...keys: string[]) => {
    for (const key of keys) {
      const value = table[key];
      if (value?.trim()) return value.trim();
    }
    return undefined;
  };

  const title = firstDraftTitle(get("제목 후보", "제목", "Title candidates", "Title", "书名候选", "书名"));
  const worldPremise = get("세계관", "World", "世界观");
  const protagonist = get("주인공", "Protagonist", "主角");
  const conflictCore = get("핵심 갈등", "Core Conflict", "核心冲突");
  const volumeOutline = get("1부 방향", "Volume Direction", "卷一方向", "卷纲方向");
  const blurb = get("소개문", "Blurb", "简介", "介绍文");
  const styleGuide = get("문체", "문체 지시", "Style", "Style direction", "文风", "文风要求");
  if (!title && !worldPremise && !protagonist && !conflictCore && !volumeOutline && !blurb && !styleGuide) {
    return undefined;
  }

  const parseNumber = (value: string | undefined) => {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };

  return {
    concept: args.concept,
    ...(title ? { title } : {}),
    ...(args.genreId ? { genre: args.genreId } : {}),
    ...(args.platform ? { platform: args.platform } : {}),
    language: args.language ?? (args.genreId?.startsWith("ko-") ? "ko" : "en"),
    targetChapters: parseNumber(args.targetChapters) ?? 200,
    chapterWordCount: parseNumber(args.chapterWordCount) ?? 2000,
    ...(blurb ? { blurb } : {}),
    ...(worldPremise ? { worldPremise } : {}),
    ...(protagonist ? { protagonist } : {}),
    ...(conflictCore ? { conflictCore } : {}),
    ...(volumeOutline ? { volumeOutline } : {}),
    ...(styleGuide ? { styleGuide } : {}),
    missingFields: [],
    readyToCreate: Boolean(title && (args.genreId || table["장르"] || table["Genre"]) && (blurb || worldPremise)),
  };
}

interface WaitForBookReadyOptions {
  readonly fetchBook?: (bookId: string) => Promise<unknown>;
  readonly fetchStatus?: (bookId: string) => Promise<{ status: string; error?: string }>;
  readonly maxAttempts?: number;
  readonly delayMs?: number;
  readonly waitImpl?: (ms: number) => Promise<void>;
  readonly language?: "zh" | "en" | "ko";
}

const DEFAULT_BOOK_READY_MAX_ATTEMPTS = 120;
const DEFAULT_BOOK_READY_DELAY_MS = 250;
const CREATION_DRAFT_SYNC_INTERVAL_MS = 2500;
const DRAFT_REQUEST_TIMEOUT_MS = 180_000;

interface BookCreateSessionOptions {
  readonly fetchSession?: (sessionId: string) => Promise<SessionResponse>;
  readonly createSession?: () => Promise<SessionResponse>;
  readonly getStoredSessionId?: () => string | null;
  readonly setStoredSessionId?: (sessionId: string) => void;
  readonly clearStoredSessionId?: () => void;
}

interface DraftResponse {
  readonly response?: string;
  readonly session?: {
    readonly activeBookId?: string;
    readonly creationDraft?: BookCreationDraft;
  };
}

let pendingDefaultBookCreateSessionId: Promise<string> | null = null;

function readSessionId(response: SessionResponse): string | null {
  const sessionId = response.session?.sessionId?.trim();
  return sessionId || null;
}

export function buildBookCreateAgentRequest(
  instruction: string,
  sessionId: string,
  language: "zh" | "en" | "ko" = "en",
): { instruction: string; sessionId: string } {
  const trimmedSessionId = sessionId.trim();
  if (!trimmedSessionId) {
    throw new Error(language === "ko" ? "작품 만들기 세션이 아직 준비되지 않았습니다." : language === "zh" ? "建书会话尚未就绪。" : "Book create session is not ready.");
  }
  return { instruction, sessionId: trimmedSessionId };
}

export async function ensureBookCreateSessionId(
  options: BookCreateSessionOptions = {},
): Promise<string> {
  const usesDefaultDeps = Object.keys(options).length === 0;
  if (usesDefaultDeps && pendingDefaultBookCreateSessionId) {
    return pendingDefaultBookCreateSessionId;
  }

  const fetchSession = options.fetchSession
    ?? ((sessionId: string) => fetchJson<SessionResponse>(`/sessions/${encodeURIComponent(sessionId)}`));
  const createSession = options.createSession
    ?? (() => fetchJson<SessionResponse>("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId: null }),
    }));
  const getStoredSessionId = options.getStoredSessionId ?? getBookCreateSessionId;
  const setStoredSessionId = options.setStoredSessionId ?? setBookCreateSessionId;
  const clearStoredSessionId = options.clearStoredSessionId ?? clearBookCreateSessionId;

  const resolveSessionId = async (): Promise<string> => {
    const storedSessionId = getStoredSessionId()?.trim();
    if (storedSessionId) {
      try {
        const existing = await fetchSession(storedSessionId);
        if (existing.session?.bookId === null) {
          return storedSessionId;
        }
      } catch {
        // Stale localStorage entry; fall through and create a fresh orphan session.
      }
      clearStoredSessionId();
    }

    const createdSessionId = readSessionId(await createSession());
    if (!createdSessionId) {
      throw new Error("Failed to create book session");
    }
    setStoredSessionId(createdSessionId);
    return createdSessionId;
  };

  if (!usesDefaultDeps) {
    return resolveSessionId();
  }

  pendingDefaultBookCreateSessionId = resolveSessionId().finally(() => {
    pendingDefaultBookCreateSessionId = null;
  });
  return pendingDefaultBookCreateSessionId;
}

export async function waitForBookReady(
  bookId: string,
  options: WaitForBookReadyOptions = {},
): Promise<void> {
  const fetchBook = options.fetchBook ?? ((id: string) => fetchJson(`/books/${id}`));
  const fetchStatus = options.fetchStatus ?? ((id: string) => fetchJson<{ status: string; error?: string }>(`/books/${id}/create-status`));
  const maxAttempts = options.maxAttempts ?? DEFAULT_BOOK_READY_MAX_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_BOOK_READY_DELAY_MS;
  const language = options.language ?? "en";
  const waitImpl = options.waitImpl ?? ((ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  }));

  let lastError: unknown;
  let lastKnownStatus: string | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await fetchBook(bookId);
      return;
    } catch (error) {
      lastError = error;
      try {
        const status = await fetchStatus(bookId);
        lastKnownStatus = status.status;
        if (status.status === "ready") {
          return;
        }
        if (status.status === "error") {
          throw new Error(status.error ?? (language === "ko" ? `작품 "${bookId}" 생성에 실패했습니다.` : language === "zh" ? `Book "${bookId}" 创建失败` : `Book "${bookId}" failed to create`));
        }
      } catch (statusError) {
        if (statusError instanceof Error && statusError.message !== "404 Not Found") {
          throw statusError;
        }
      }
      if (attempt === maxAttempts - 1) {
        if (lastKnownStatus === "creating") {
          break;
        }
        throw error;
      }
      await waitImpl(delayMs);
    }
  }

  if (lastKnownStatus === "creating") {
    throw new Error(language === "ko" ? `작품 "${bookId}" 생성이 아직 진행 중입니다. 잠시 후 새로고침해 주세요.` : language === "zh" ? `Book "${bookId}" 仍在创建中。请稍候并刷新。` : `Book "${bookId}" is still being created. Wait a moment and refresh.`);
  }

  throw lastError instanceof Error ? lastError : new Error(language === "ko" ? `작품 "${bookId}"이 아직 준비되지 않았습니다.` : language === "zh" ? `Book "${bookId}" 尚未就绪` : `Book "${bookId}" was not ready`);
}

export function BookCreate({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { lang: uiLang } = useI18n();
  const { data: project } = useApi<{ language: string }>("/project");
  const { data: genresData } = useApi<{ genres: ReadonlyArray<GenreListItem> }>("/genres");
  const { data: styleTemplatesData } = useApi<{ templates: ReadonlyArray<StyleRevisionTemplate> }>("/style-templates");
  const projectLang = project?.language === "ko" ? "ko" : project?.language === "en" ? "en" : "zh";
  const copy = uiLang === "ko" ? KOREAN_PAGE_COPY : PAGE_COPY[projectLang === "ko" ? "en" : projectLang];
  const platformChoices = platformOptionsForLanguage(projectLang);
  const styleTemplateLanguage = resolveStyleTemplateLanguage(uiLang);

  const [draft, setDraft] = useState<BookCreationDraft | undefined>();
  const [form, setForm] = useState<BookCreateFormState>(() => defaultBookCreateForm(projectLang));
  const [styleTemplateId, setStyleTemplateId] = useState("custom");
  const [styleTemplateVersion, setStyleTemplateVersion] = useState(0);
  const [input, setInput] = useState("");
  const [loadingDraft, setLoadingDraft] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [bookCreateSessionId, setBookCreateSessionIdState] = useState<string | null>(null);
  const genreChoices = useMemo(
    () => filterGenresForLanguage(genresData?.genres ?? [], uiLang),
    [genresData?.genres, uiLang],
  );
  const currentGenreIsListed = genreChoices.some((genre) => genre.id === form.genre);
  const selectedGenre = genreChoices.find((genre) => genre.id === form.genre);
  const selectedPlatform = platformChoices.find((option) => option.value === form.platform);
  const styleTemplates = useMemo(
    () => getAllStyleRevisionTemplates(styleTemplatesData?.templates),
    [styleTemplateVersion, styleTemplatesData?.templates],
  );

  const summaryRows = useMemo(
    () => (draft ? buildCreationDraftSummary(draft, projectLang === "ko" ? "en" : projectLang) : []),
    [draft, projectLang],
  );
  const canSubmitForm = isBookCreateFormReady(form);
  const canSubmitDraft = true;

  useEffect(() => {
    setForm((current) => ({
      ...current,
      platform: pickValidValue(
        current.platform,
        platformChoices.map((option) => option.value),
      ),
      chapterWordCount: current.chapterWordCount || defaultChapterWordsForLanguage(projectLang),
      targetChapters: current.targetChapters || "200",
    }));
  }, [platformChoices, projectLang]);

  useEffect(() => {
    const onTemplatesChanged = () => setStyleTemplateVersion((version) => version + 1);
    window.addEventListener(CUSTOM_STYLE_TEMPLATE_EVENT, onTemplatesChanged);
    return () => window.removeEventListener(CUSTOM_STYLE_TEMPLATE_EVENT, onTemplatesChanged);
  }, []);

  const updateForm = (patch: Partial<BookCreateFormState>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const handleStyleTemplateChange = (templateId: string) => {
    setStyleTemplateId(templateId);
    if (templateId === "custom") {
      return;
    }
    const template = findStyleRevisionTemplate(templateId, styleTemplatesData?.templates);
    if (!template) {
      return;
    }
    updateForm({ styleGuide: buildStyleCreationBrief(template, styleTemplateLanguage) });
  };

  const applyDraftToForm = () => {
    if (!draft) {
      return;
    }
    setForm((current) => applyCreationDraftToFormState(current, draft, platformChoices));
    setStyleTemplateId("custom");
  };

  const refreshDraft = async (): Promise<BookCreationDraft | undefined> => {
    const data = await fetchJson<InteractionSessionResponse>("/interaction/session");
    const nextDraft = data.session?.creationDraft;
    setDraft(nextDraft);
    return nextDraft;
  };

  useEffect(() => {
    let cancelled = false;
    setLoadingDraft(true);
    void Promise.all([
      ensureBookCreateSessionId(),
      refreshDraft(),
    ])
      .then(([sessionId]) => {
        if (!cancelled) {
          setBookCreateSessionIdState(sessionId);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDraft(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (submitting || creating) {
      return;
    }

    const timer = setInterval(() => {
      void refreshDraft().catch(() => undefined);
    }, CREATION_DRAFT_SYNC_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [submitting, creating]);

  const runAgentInstruction = async (instruction: string): Promise<AgentResponse> => {
    const sessionId = bookCreateSessionId ?? await ensureBookCreateSessionId();
    if (!bookCreateSessionId) {
      setBookCreateSessionIdState(sessionId);
    }
    const koreanModePrompt = "한국어 모드: 모든 응답, 작품 설정, 장르 선택, 제목, 개요, 본문 지시는 자연스러운 한국어로 처리하세요. 새 작품에는 가능한 경우 ko-* 한국어 장르 템플릿을 우선 사용하세요.";
    const localizedInstruction = uiLang !== "ko"
      ? instruction
      : instruction.startsWith("/new ")
        ? `/new ${koreanModePrompt}\n\n${instruction.slice(5)}`
        : `${koreanModePrompt}\n\n${instruction}`;
    return fetchJson<AgentResponse>("/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildBookCreateAgentRequest(localizedInstruction, sessionId, uiLang)),
    });
  };

  const runDraftInstruction = async (instruction: string): Promise<DraftResponse> => {
    const koreanModePrompt = "한국어 모드: 모든 응답, 작품 설정, 장르 선택, 제목, 개요, 본문 지시는 자연스러운 한국어로 처리하세요. 새 작품에는 가능한 경우 ko-* 한국어 장르 템플릿을 우선 사용하세요.";
    const localizedInstruction = uiLang !== "ko"
      ? instruction
      : instruction.startsWith("/new ")
        ? `/new ${koreanModePrompt}\n\n${instruction.slice(5)}`
        : `${koreanModePrompt}\n\n${instruction}`;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), DRAFT_REQUEST_TIMEOUT_MS);
    try {
      return await fetchJson<DraftResponse>("/interaction/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: localizedInstruction }),
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const handleDraftSubmit = async () => {
    const fallbackGenre = !selectedGenre && genreChoices.length > 0
      ? genreChoices[Math.floor(Math.random() * genreChoices.length)]
      : undefined;
    const instruction = buildDraftInstructionFromForm({
      input,
      form,
      hasDraft: Boolean(draft),
      uiLanguage: uiLang,
      genreLabel: selectedGenre?.name,
      fallbackGenreId: fallbackGenre?.id,
      fallbackGenreLabel: fallbackGenre?.name,
      platformLabel: selectedPlatform?.label,
    });
    if (!instruction) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const data = await runDraftInstruction(instruction);
      setInput("");
      setStatus(data.response ?? null);
      const parsedDraft = extractCreationDraftFromAssistantText({
        responseText: data.response,
        concept: instruction,
        genreId: form.genre || fallbackGenre?.id,
        language: resolveBookCreateLanguage(projectLang, form.genre || (fallbackGenre?.id ?? "")),
        platform: form.platform,
        targetChapters: form.targetChapters,
        chapterWordCount: form.chapterWordCount,
      });
      const nextDraft = data.session?.creationDraft ?? parsedDraft;
      setDraft(nextDraft);
      if (nextDraft) {
        setForm((current) => applyCreationDraftToFormState(current, nextDraft, platformChoices));
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(
        cause instanceof DOMException && cause.name === "AbortError"
          ? (projectLang === "ko" ? "초안 작성 요청이 너무 오래 걸려 중단했습니다. 모델 연결 상태를 확인한 뒤 다시 시도해 주세요." : message)
          : message,
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleFormCreate = async () => {
    if (!canSubmitForm) {
      return;
    }

    setCreating(true);
    setError(null);
    setStatus(copy.creationStatus);
    try {
      const payload = buildBookCreatePayload(
        form,
        resolveBookCreateLanguage(projectLang, form.genre),
      );
      const data = await fetchJson<{ status?: string; bookId?: string }>("/books/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!data.bookId) {
        throw new Error(projectLang === "ko" ? "생성 요청에서 작품 ID가 반환되지 않았습니다." : projectLang === "zh" ? "创建请求没有返回书籍 ID。" : "Create request did not return a book id.");
      }
      await waitForBookReady(data.bookId, { language: projectLang });
      nav.toBook(data.bookId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus(null);
    } finally {
      setCreating(false);
    }
  };

  const handleCreate = async () => {
    if (!canCreateFromDraft(draft)) {
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const data = await runAgentInstruction("/create");
      const bookId = data.session?.activeBookId;
      if (!bookId) {
        throw new Error(projectLang === "ko" ? "생성은 완료되었지만 작품 ID가 반환되지 않았습니다." : projectLang === "zh" ? "创建完成后没有返回书籍 ID。" : "Create succeeded but no book id was returned.");
      }
      setStatus(data.response ?? null);
      setDraft(undefined);
      await waitForBookReady(bookId, { language: projectLang });
      nav.toBook(bookId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreating(false);
    }
  };

  const handleDiscard = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const data = await runAgentInstruction("/discard");
      setStatus(data.response ?? null);
      setDraft(undefined);
      setInput("");
      await refreshDraft().catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.books")}</button>
        <span className="text-border">/</span>
        <span>{t("bread.newBook")}</span>
      </div>

      <div className="space-y-3">
        <h1 className="font-serif text-4xl">{t("create.title")}</h1>
        <p className="text-sm text-muted-foreground leading-7 max-w-2xl">{copy.idleBody}</p>
      </div>

      {error && (
        <div className={`border ${c.error} rounded-md px-4 py-3`}>
          {error}
        </div>
      )}

      {status && (
        <div className="border border-primary/20 bg-primary/5 rounded-md px-4 py-3 text-sm text-primary">
          {status}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
        <section className="rounded-lg border border-border/60 bg-card/80 p-5 space-y-5">
          <div className="space-y-1">
            <div className="text-[11px] uppercase text-muted-foreground font-bold">
              {copy.formHeading}
            </div>
            <p className="text-xs text-muted-foreground leading-6">{copy.formHint}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">{copy.titleLabel}</span>
              <input
                value={form.title}
                onChange={(event) => updateForm({ title: event.target.value })}
                className={`w-full ${c.input} rounded-md px-3 py-2.5 focus:outline-none text-sm`}
                placeholder={copy.titlePlaceholder}
              />
            </label>
            <label className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">{copy.genreLabel}</span>
              <select
                value={form.genre}
                onChange={(event) => updateForm({ genre: event.target.value })}
                className={`w-full ${c.input} rounded-md px-3 py-2.5 focus:outline-none text-sm bg-background`}
              >
                <option value="">{copy.genrePlaceholder}</option>
                {!currentGenreIsListed && form.genre.trim() && (
                  <option value={form.genre}>{form.genre}</option>
                )}
                {genreChoices.map((genre) => (
                  <option key={genre.id} value={genre.id}>
                    {genre.name} ({genre.id})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">{copy.platformLabel}</span>
              <select
                value={form.platform}
                onChange={(event) => updateForm({ platform: event.target.value })}
                className={`w-full ${c.input} rounded-md px-3 py-2.5 focus:outline-none text-sm bg-background`}
              >
                {platformChoices.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">{copy.targetChaptersLabel}</span>
              <input
                type="number"
                min={1}
                value={form.targetChapters}
                onChange={(event) => updateForm({ targetChapters: event.target.value })}
                className={`w-full ${c.input} rounded-md px-3 py-2.5 focus:outline-none text-sm`}
              />
            </label>
            <label className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">{copy.chapterWordCountLabel}</span>
              <input
                type="number"
                min={1000}
                value={form.chapterWordCount}
                onChange={(event) => updateForm({ chapterWordCount: event.target.value })}
                className={`w-full ${c.input} rounded-md px-3 py-2.5 focus:outline-none text-sm`}
              />
            </label>
          </div>

          <label className="space-y-2 block">
            <span className="text-xs font-medium text-muted-foreground">{copy.briefLabel}</span>
            <textarea
              value={form.brief}
              onChange={(event) => updateForm({ brief: event.target.value })}
              rows={9}
              className={`w-full ${c.input} rounded-md px-3 py-3 focus:outline-none text-sm leading-7 resize-y`}
              placeholder={copy.briefPlaceholder}
            />
          </label>

          <label className="space-y-2 block">
            <span className="text-xs font-medium text-muted-foreground">{copy.styleGuideLabel}</span>
            <span className="block text-xs text-muted-foreground">{copy.styleTemplateLabel}</span>
            <select
              value={styleTemplateId}
              onChange={(event) => handleStyleTemplateChange(event.target.value)}
              className={`w-full ${c.input} rounded-md px-3 py-2.5 focus:outline-none text-sm bg-background`}
              aria-label={copy.styleTemplateLabel}
            >
              <option value="custom">{copy.customStyleTemplate}</option>
              {styleTemplates.map((template) => (
                <option key={template.id} value={template.id}>{template.label[styleTemplateLanguage]}</option>
              ))}
            </select>
            <textarea
              value={form.styleGuide}
              onChange={(event) => {
                setStyleTemplateId("custom");
                updateForm({ styleGuide: event.target.value });
              }}
              rows={4}
              className={`w-full ${c.input} rounded-md px-3 py-3 focus:outline-none text-sm leading-7 resize-y`}
              placeholder={copy.styleGuidePlaceholder}
            />
          </label>

          {creating && (
            <div className="grid gap-2 sm:grid-cols-3">
              {copy.creationSteps.map((step) => (
                <div key={step} className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
                  <CheckCircle2 size={14} />
                  <span>{step}</span>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={handleFormCreate}
            disabled={!canSubmitForm || creating || submitting}
            className={`inline-flex items-center gap-2 px-5 py-3 ${c.btnPrimary} rounded-md disabled:opacity-50 font-medium text-sm`}
          >
            <BookPlus size={16} />
            {creating ? copy.creatingBook : copy.createBook}
          </button>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-border/60 bg-card/80 p-5 space-y-4">
            <div className="space-y-1">
              <div className="text-[11px] uppercase text-muted-foreground font-bold">
                {copy.assistantHeading}
              </div>
              <p className="text-xs text-muted-foreground leading-6">{copy.assistantHint}</p>
            </div>

            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              rows={7}
              className={`w-full ${c.input} rounded-md px-3 py-3 focus:outline-none text-sm leading-7 resize-y`}
              placeholder={draft ? copy.promptPlaceholderFollowup : copy.promptPlaceholder}
            />

            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleDraftSubmit}
                disabled={submitting || creating || !canSubmitDraft}
                className={`inline-flex items-center gap-2 px-3 py-2 ${c.btnPrimary} rounded-md disabled:opacity-50 font-medium text-xs`}
              >
                <Sparkles size={14} />
                {submitting ? copy.submitting : copy.submit}
              </button>
              <button
                onClick={handleDiscard}
                disabled={!draft || submitting || creating}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 disabled:opacity-50 font-medium text-xs"
              >
                <RotateCcw size={14} />
                {copy.discard}
              </button>
            </div>
          </section>

          <section className="rounded-lg border border-border/60 bg-card/80 p-5 space-y-4">
            <div className="space-y-1">
              <div className="text-[11px] uppercase text-muted-foreground font-bold">
                {copy.draftHeading}
              </div>
              <p className="text-xs text-muted-foreground leading-6">{copy.syncedHint}</p>
            </div>

            {loadingDraft ? (
              <div className="text-sm text-muted-foreground">{projectLang === "ko" ? "초안 불러오는 중..." : projectLang === "zh" ? "读取草案中…" : "Loading draft…"}</div>
            ) : draft ? (
              <div className="space-y-4">
                {summaryRows.length > 0 ? (
                  <div className="space-y-2">
                    {summaryRows.map((row) => (
                      <div key={row.key} className="rounded-md border border-border/50 bg-background/70 px-3 py-2">
                        <div className="text-[10px] uppercase text-muted-foreground font-semibold">{row.label}</div>
                        <div className="mt-1 text-sm leading-6 whitespace-pre-wrap">{row.value}</div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {draft.missingFields.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-foreground">{copy.missingHeading}</div>
                    <div className="flex flex-wrap gap-2">
                      {draft.missingFields.map((field) => (
                        <span
                          key={field}
                          className="rounded-md border border-border/70 bg-secondary/50 px-2 py-1 text-xs text-muted-foreground"
                        >
                          {field}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground leading-6">{copy.missingHint}</p>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={applyDraftToForm}
                    className="px-3 py-2 rounded-md border border-border bg-secondary text-secondary-foreground font-medium text-xs"
                  >
                    {copy.applyDraft}
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={!canCreateFromDraft(draft) || creating || submitting}
                    className="px-3 py-2 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 disabled:opacity-50 font-medium text-xs"
                  >
                    {creating ? copy.creating : copy.create}
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border/70 bg-background/50 px-4 py-5">
                <div className="font-medium">{copy.idleTitle}</div>
                <p className="mt-2 text-sm text-muted-foreground leading-7">
                  {copy.helperBody}
                </p>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
