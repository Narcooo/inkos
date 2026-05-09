import inkwellTemplate from "./style-templates/inkwell.json";
import newNovelistV50Template from "./style-templates/new-novelist-v50.json";
import rhythmPolishTemplate from "./style-templates/rhythm-polish.json";
import sensorySceneTwistTemplate from "./style-templates/sensory-scene-twist.json";
import showDontTellTemplate from "./style-templates/show-dont-tell.json";

export type StyleTemplateLanguage = "zh" | "en" | "ko";

export interface StyleRevisionTemplate {
  readonly id: string;
  readonly label: Record<StyleTemplateLanguage, string>;
  readonly description: Record<StyleTemplateLanguage, string>;
  readonly rules: Record<StyleTemplateLanguage, ReadonlyArray<string>>;
}

export const CUSTOM_STYLE_TEMPLATE_EVENT = "inkos:style-templates-changed";
const CUSTOM_STYLE_TEMPLATE_STORAGE_KEY = "inkos.custom-style-templates.v1";

export const BUILTIN_STYLE_REVISION_TEMPLATES: ReadonlyArray<StyleRevisionTemplate> = [
  inkwellTemplate,
  sensorySceneTwistTemplate,
  newNovelistV50Template,
  showDontTellTemplate,
  rhythmPolishTemplate,
].map((template) => template as StyleRevisionTemplate);

export const STYLE_REVISION_TEMPLATES: ReadonlyArray<StyleRevisionTemplate> = BUILTIN_STYLE_REVISION_TEMPLATES;

function storage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function safeTemplates(value: unknown): ReadonlyArray<StyleRevisionTemplate> {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is StyleRevisionTemplate => {
    const template = entry as Partial<StyleRevisionTemplate>;
    return Boolean(
      typeof template.id === "string" &&
      template.label?.ko &&
      template.description?.ko &&
      Array.isArray(template.rules?.ko),
    );
  });
}

function resolveBuiltinStyleTemplates(runtimeTemplates?: unknown): ReadonlyArray<StyleRevisionTemplate> {
  const runtime = safeTemplates(runtimeTemplates);
  if (!runtime.length) return BUILTIN_STYLE_REVISION_TEMPLATES;

  const runtimeById = new Map(runtime.map((template) => [template.id, template]));
  const builtinIds = new Set(BUILTIN_STYLE_REVISION_TEMPLATES.map((template) => template.id));
  return [
    ...BUILTIN_STYLE_REVISION_TEMPLATES.map((template) => runtimeById.get(template.id) ?? template),
    ...runtime.filter((template) => !builtinIds.has(template.id)),
  ];
}

export function loadCustomStyleTemplates(): ReadonlyArray<StyleRevisionTemplate> {
  const store = storage();
  if (!store) return [];
  try {
    return safeTemplates(JSON.parse(store.getItem(CUSTOM_STYLE_TEMPLATE_STORAGE_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

export function saveCustomStyleTemplate(template: StyleRevisionTemplate): void {
  const store = storage();
  if (!store) return;
  const existing = loadCustomStyleTemplates().filter((entry) => entry.id !== template.id);
  store.setItem(CUSTOM_STYLE_TEMPLATE_STORAGE_KEY, JSON.stringify([...existing, template]));
  window.dispatchEvent(new CustomEvent(CUSTOM_STYLE_TEMPLATE_EVENT));
}

export function getAllStyleRevisionTemplates(runtimeTemplates?: unknown): ReadonlyArray<StyleRevisionTemplate> {
  return [...resolveBuiltinStyleTemplates(runtimeTemplates), ...loadCustomStyleTemplates()];
}

export function findStyleRevisionTemplate(
  templateId: string,
  runtimeTemplates?: unknown,
): StyleRevisionTemplate | undefined {
  return getAllStyleRevisionTemplates(runtimeTemplates).find((template) => template.id === templateId);
}

function slugifyName(name: string): string {
  const normalized = name
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return normalized || "risu-style";
}

function stripTemplateSyntax(value: string): string {
  return value
    .replace(/\{\{User\}\}/g, "user")
    .replace(/\{\{user\}\}/g, "user")
    .replace(/\{\{Char\}\}/g, "character")
    .replace(/\{\{[#/]?if[^}]*\}\}/g, "")
    .replace(/\{\{[#/]?if_pure[^}]*\}\}/g, "")
    .replace(/\{\{\/if\}\}/g, "")
    .replace(/\{\{[^}]+\}\}/g, "")
    .replace(/<\/?[^>\n]+>/g, "")
    .replace(/`AI`'?s?/g, "AI")
    .trim();
}

function isLikelyRisuStyleEntry(entry: { name?: unknown; text?: unknown; type2?: unknown }): boolean {
  const name = String(entry.name ?? "");
  const type2 = String(entry.type2 ?? "");
  const text = String(entry.text ?? "");
  const label = `${name}\n${type2}`;
  return /문체|글쓰기|지시|알고리즘|소설|style|writing|dialogue|diction|narrator|instruction|guideline|algorithm|banned|금지/i.test(label)
    || /<Dialogue>|<Ai Writing-Style>|<Banned Ai Writing-Style>|# `AI`'s Writing Guidelines|# `AI`'s Writing-Style|# Instruction|## Guideline|Narrator:|Diction:/i.test(text);
}

function isUnsafeOrNonStyleRisuLine(line: string): boolean {
  return /OOC|out-of-character|stop role-playing|personal and private fictional session/i.test(line)
    || /jailbreak|NoLimits|EthicProtOff|uncensored|content filtering|platform policies|policy|OpenAI\/ChatGPT guidelines/i.test(line)
    || /explicit\/non-consensual|non-consensual/i.test(line)
    || /disclaimer|safeword|professional actors|legal adults|all content is permitted|harmful substances/i.test(line)
    || /morality and ethics as an excuse|secure isolated session|absolute obligation/i.test(line)
    || /^<Character>$/i.test(line)
    || /^<\/?World Info>$/i.test(line);
}

function collectRisuStyleLines(parsed: unknown): string[] {
  const root = parsed as {
    name?: unknown;
    mainPrompt?: unknown;
    globalNote?: unknown;
    autoSuggestPrompt?: unknown;
    promptTemplate?: ReadonlyArray<{ name?: unknown; text?: unknown; type2?: unknown }>;
  };
  const templateEntries = Array.isArray(root.promptTemplate) ? root.promptTemplate : [];
  const relevant = templateEntries.filter(isLikelyRisuStyleEntry);
  const source = [
    typeof root.mainPrompt === "string" ? root.mainPrompt : "",
    typeof root.globalNote === "string" ? root.globalNote : "",
    ...relevant.map((entry) => String(entry.text ?? "")),
  ].join("\n");
  const candidates = stripTemplateSyntax(source)
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter((line) => line.length >= 12 && line.length <= 240)
    .filter((line) => !/^#+\s*/.test(line))
    .filter((line) => !/^---+$/.test(line))
    .filter((line) => !/^Example:/i.test(line))
    .filter((line) => !/^Prohibited:/i.test(line))
    .filter((line) => !/^Recommended:/i.test(line))
    .filter((line) => !isUnsafeOrNonStyleRisuLine(line));
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const line of candidates) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
    if (lines.length >= 18) break;
  }
  return lines;
}

export function buildStyleTemplateFromRisuPreset(jsonText: string): StyleRevisionTemplate {
  const parsed = JSON.parse(jsonText) as { name?: unknown };
  const rawName = typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : "Risu 문체";
  const name = rawName.replace(/^[^\p{Letter}\p{Number}]+/u, "").trim() || rawName;
  const lines = collectRisuStyleLines(parsed);
  if (lines.length === 0) {
    throw new Error("Risu preset에서 문체 지시를 찾지 못했습니다.");
  }
  const rulesKo = [
    "아래 규칙은 Risu 프리셋에서 추출한 문체 지시입니다. 원문 표현을 참고하되, 작품의 장르와 사건 사실을 우선합니다.",
    ...lines,
  ];
  const rulesEn = [
    "These rules were extracted from a Risu preset. Use the original wording as style guidance while preserving genre and plot facts.",
    ...lines,
  ];
  const rulesZh = [
    "以下规则提取自 Risu preset。请参考原文作为文风要求，同时保留题材和剧情事实。",
    ...lines,
  ];
  return {
    id: `risu-${slugifyName(name)}`,
    label: { ko: name, en: name, zh: name },
    description: {
      ko: `Risu 프리셋 "${name}"에서 추출한 사용자 문체 양식입니다.`,
      en: `A custom style template extracted from the Risu preset "${name}".`,
      zh: `从 Risu preset "${name}" 提取的自定义文风模板。`,
    },
    rules: { ko: rulesKo, en: rulesEn, zh: rulesZh },
  };
}

export function buildStyleRevisionBrief(
  template: StyleRevisionTemplate,
  language: StyleTemplateLanguage,
): string {
  const heading = language === "ko"
    ? "아래 문체 양식에 맞춰 이미 완성된 장을 문체 중심으로 수정하세요. 사건 사실, 인물 관계, 핵심 대화 의미, 결말 결과는 바꾸지 마세요."
    : language === "en"
      ? "Revise the completed chapter for prose style using the template below. Do not change plot facts, relationships, core dialogue meaning, or the ending outcome."
      : "请按下面的文风模板修订已完成章节。不要改变剧情事实、人物关系、核心对白含义或结尾结果。";
  return [
    heading,
    "",
    `## ${template.label[language]}`,
    template.description[language],
    "",
    ...template.rules[language].map((rule) => `- ${rule}`),
  ].join("\n");
}

export function buildStyleCreationBrief(
  template: StyleRevisionTemplate,
  language: StyleTemplateLanguage,
): string {
  const heading = language === "ko"
    ? "작품 전체의 문체 지시로 아래 양식을 적용하세요. 장르, 사건, 인물 설정보다 우선하지는 않지만, 모든 장의 서술 습관과 문장 리듬에 지속적으로 반영하세요."
    : language === "en"
      ? "Use the template below as the book-wide style direction. It must not override genre, plot, or character facts, but it should consistently guide narration habits and sentence rhythm."
      : "请将下面模板作为全书文风要求。它不能覆盖题材、剧情或人物事实，但应持续影响叙述习惯和句子节奏。";
  return [
    heading,
    "",
    `## ${template.label[language]}`,
    template.description[language],
    "",
    ...template.rules[language].map((rule) => `- ${rule}`),
  ].join("\n");
}
