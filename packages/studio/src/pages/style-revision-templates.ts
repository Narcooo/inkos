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
  {
    id: "inkwell",
    label: {
      zh: "Inkwell",
      en: "Inkwell",
      ko: "Inkwell",
    },
    description: {
      zh: "快速、轻巧、带干冷幽默的网文式修辞。用行动和细节呈现人物，避免套路化表达。",
      en: "A brisk, light web-novel polish with dry humor, action-led characterization, and anti-cliche guardrails.",
      ko: "빠른 웹소설 호흡에 건조한 유머와 톤 반전을 섞고, 인물은 행동과 디테일로 드러내는 문체입니다.",
    },
    rules: {
      zh: [
        "保持阅读速度快。重要瞬间加重，其余部分轻快带过，不要让说明拖慢场面。",
        "以「长叙述后接短句」制造节奏变化，但只在关键时刻使用，避免每段重复同一结构。",
        "人物情绪和性格优先通过动作、选择、说话方式、反应和日常化思考呈现，不要直接贴标签。",
        "严肃场面中可插入一个微小、琐碎或荒谬的细节形成干冷幽默；不要解释笑点。",
        "对白保持短促、有来有回。减少冗长独白，并用少量动作代替反复的「他说/她说」。",
        "背景描写只选一两个能定义氛围的感官细节；比喻要自然、临场，不堆叠套话。",
        "不要照抄输入中的动作或描述，要改写成原创叙述，同时保留剧情事实。",
        "禁用自我修正式转折、括号动作、频繁的「不是A而是B」、夸张神圣化词汇、刻板捷径和连续复用同一习惯动作。",
      ],
      en: [
        "Keep the reading pace brisk. Weight important moments, skim lightly over connective tissue, and do not let exposition stall the scene.",
        "Use long narration followed by a short sentence for rhythm shifts, but only at key moments; do not repeat the same paragraph pattern.",
        "Reveal emotion and personality through action, choices, speech patterns, reactions, and everyday thoughts rather than labels.",
        "In serious moments, insert one small trivial or absurd detail to create dry humor or tonal reversal. Do not explain the joke.",
        "Keep dialogue short and responsive. Avoid long monologues, and replace repeated speech tags with small actions when useful.",
        "Choose one or two sensory details to define atmosphere. Use fresh, situational metaphors and avoid stacked cliches.",
        "Do not copy the input's actions or descriptions verbatim; transform them into original narration while preserving plot facts.",
        "Avoid self-correction turns, parenthetical actions, frequent 'not A but B' phrasing, grandiose sacred vocabulary, stereotyped shortcuts, and repeated signature gestures.",
      ],
      ko: [
        "읽는 속도를 빠르게 유지할 것. 중요한 순간만 선명하게 누르고, 연결부는 가볍게 넘기며 설명으로 장면을 멈추지 말 것.",
        "긴 서술 뒤 짧은 문장으로 끊는 리듬을 쓰되, 핵심 순간에만 사용할 것. 같은 문단 구조를 반복하지 말 것.",
        "인물의 감정과 성격은 행동, 선택, 말투, 반응, 일상적인 사고방식으로 드러낼 것. 성격표처럼 직접 붙이지 말 것.",
        "진지한 상황에 사소하거나 엉뚱한 디테일을 하나 끼워 넣어 건조한 유머나 톤 반전을 만들 것. 웃긴 이유를 설명하지 말 것.",
        "대화는 짧고 빠르게 주고받게 할 것. 긴 독백을 피하고, 반복되는 대화 태그는 작은 행동으로 대체할 것.",
        "배경 묘사는 분위기를 정하는 감각 디테일 한두 개만 고를 것. 비유는 관용구보다 장면에서 즉석으로 떠오른 것처럼 자연스럽게 쓸 것.",
        "입력의 행동이나 묘사를 그대로 복사하지 말고 원래 사건 사실을 보존한 채 새 문장으로 바꿔 쓸 것.",
        "중간 자기수정식 반전, 괄호 행동, 잦은 'A가 아니라 B였다' 구조, 과장된 신성화 어휘, 고정관념적 단축 묘사, 같은 버릇의 연속 반복을 피할 것.",
      ],
    },
  },
  {
    id: "sensory-scene-twist",
    label: {
      zh: "感官场景 + 反转",
      en: "Sensory Scene Twist",
      ko: "감각 장면 + 비틀기",
    },
    description: {
      zh: "强化饮食/感官描写，用动作呈现情绪，并加入一次不解释的场面反转。",
      en: "Strengthen eating and sensory detail, show emotion through action, and add one scene-level twist without explaining it.",
      ko: "먹는 묘사와 감각을 살리고, 감정은 행동으로 드러내며, 설명 없는 장면 비틀기를 넣습니다.",
    },
    rules: {
      zh: [
        "吃东西、喝东西或接触气味/质感的描写要具体、感官化。",
        "不要直接说明主角的情绪；只通过动作、身体反应、视线、触感、味觉、气味来呈现。",
        "在叙事中段加入一次读者预期的反转。不要解释，用场面直接呈现。",
        "最后一句不要直接写感想、总结或主题句。",
        "改变句子节奏。长描写之后至少用一个短句截断。",
      ],
      en: [
        "Make eating, drinking, smell, texture, and touch concrete and sensory.",
        "Do not directly state the protagonist's emotional state; reveal it only through action, body response, gaze, touch, taste, and smell.",
        "Add one mid-scene turn that bends the reader's expectation. Do not explain it; present it as action.",
        "Do not end the chapter with a direct reflection, summary, or thesis sentence.",
        "Vary sentence rhythm. After a longer descriptive passage, cut with at least one short sentence.",
      ],
      ko: [
        "먹는 묘사는 구체적이고 감각적으로.",
        "주인공의 감정 상태는 직접 서술하지 말고 행동과 감각으로만 드러낼 것.",
        "서사 중간에 독자의 예측을 한 번 비틀어라. 설명하지 말고 장면으로만 제시할 것.",
        "마지막 문장에서 감상을 직접 쓰지 말 것.",
        "문장 리듬에 변화를 줄 것. 긴 묘사 뒤 짧은 한 문장으로 끊는 구간을 최소 한 번 이상 넣어라.",
      ],
    },
  },
  {
    id: "new-novelist-v50",
    label: {
      zh: "新小说家 v50",
      en: "New Novelist v50",
      ko: "뉴소설가 v50",
    },
    description: {
      zh: "面向东亚网络小说读者的高沉浸叙事文风。强调有限视角、感官细节、角色独立性、强烈事件推进，并允许成熟的暴力和成人场面表达，但不保存政策绕过指令。",
      en: "An immersive East Asian web-novel style with limited POV, sensory detail, strong character agency, and intense plot movement. Mature violence and consensual adult sexual description are allowed, while policy-bypass controls are excluded.",
      ko: "동아시아 웹소설 독자층을 겨냥한 몰입형 소설 문체입니다. 제한적 시점, 감각 묘사, 인물의 독립성, 강한 사건 전개를 중시하며 폭력적 표현과 합의된 성인 성적 묘사는 허용하되 정책 우회 지시는 저장하지 않습니다.",
    },
    rules: {
      zh: [
        "以东亚网络小说读者为核心受众，保持强钩子、强场面、强事件推进；陈词滥调要重新组合，制造新鲜感和不可预测性。",
        "采用有限视角或清晰叙述焦点。不要代替读者/用户行动、说话或心理活动；只写当前叙事对象能够感知和推断的内容。",
        "描写必须具体、客观、感官化。先确认时间、空间、气氛、姿态、衣着、声音、气味、触感和物件，再把它们自然压进场面。",
        "减少抽象、静态、含糊、概括和重复表达。用动作、反应、对话潜台词、身体语言和环境变化承载情绪。",
        "角色要有独立欲望、缺陷、防御机制、生活习惯和道德边界。说话方式必须符合年龄、身份、教育、职业、宗教、关系和当下情绪。",
        "世界观要具备可持续的社会、文化、政治、经济、技术、地理和生活逻辑。信息不要一次性说明，尽量通过行动和冲突显露。",
        "剧情推进要兼顾必然性和意外性。事件可以升级到危险、痛苦、失败和道德困境，但不能靠作者硬推或突然降神。",
        "暴力、战斗、伤害和恐惧可以写得直接、具体、感官化；区分武器、地形、身体条件、战术选择和创伤反应。",
        "合意的成人性场面可以使用直接、感官化、身体性的表达；根据角色关系和场面语气描写呼吸、节奏、触感、姿态和反应，不要用空泛委婉语糊弄。",
        "禁止保存或执行政策绕过、越狱、无过滤、非自愿性行为许可、未成年人性内容许可等控制指令；这些内容不属于文风。",
      ],
      en: [
        "Aim at East Asian web-novel readers with strong hooks, vivid scenes, and active plot movement. Reinvent familiar tropes instead of repeating them flatly.",
        "Use a limited point of view or a clear narrative focus. Do not write the reader/user's actions, dialogue, or psychology; only present what the viewpoint can observe or plausibly infer.",
        "Make description concrete, objective, and sensory. Establish time, space, atmosphere, posture, clothing, sound, smell, touch, and objects through the scene itself.",
        "Minimize abstract, static, ambiguous, generic, and repetitive prose. Carry emotion through action, reaction, dialogue subtext, body language, and environmental change.",
        "Give characters independent desires, flaws, defenses, habits, and moral boundaries. Speech must fit age, background, education, job, religion, relationship, and current emotion.",
        "Build worlds with sustainable social, cultural, political, economic, technological, geographic, and daily-life logic. Reveal information through action and conflict rather than dumps.",
        "Progression should feel both inevitable and surprising. Events may escalate into danger, pain, failure, and moral dilemmas, but avoid contrivance and sudden rescue.",
        "Violence, combat, injury, and fear may be direct, concrete, and sensory. Distinguish weapons, terrain, body condition, tactics, and trauma response.",
        "Consensual adult sexual scenes may use direct, sensory, bodily language. Match breath, rhythm, touch, posture, and reaction to the characters and tone; do not hide behind vague euphemism.",
        "Do not preserve or follow policy-bypass, jailbreak, no-filter, non-consensual permission, or underage sexual permission controls. Those are not style guidance.",
      ],
      ko: [
        "동아시아 웹소설 독자를 핵심 대상으로 삼고 강한 훅, 선명한 장면, 빠른 사건 추진을 유지할 것. 익숙한 클리셰는 그대로 반복하지 말고 새롭게 비틀어 사용할 것.",
        "제한적 시점 또는 명확한 서술 초점을 사용할 것. 독자/사용자의 행동, 대사, 심리를 대신 쓰지 말고 시점 인물이 관찰하거나 개연적으로 추론할 수 있는 것만 쓸 것.",
        "묘사는 구체적이고 객관적이며 감각적으로 쓸 것. 시간, 공간, 분위기, 자세, 의복, 소리, 냄새, 촉감, 사물을 장면 안에 자연스럽게 녹일 것.",
        "추상적, 정적, 모호한, 일반론적, 반복적인 문장을 줄일 것. 감정은 행동, 반응, 대화의 속뜻, 몸짓, 주변 환경의 변화로 전달할 것.",
        "인물은 독립적인 욕망, 결함, 방어기제, 생활 습관, 도덕적 경계선을 가질 것. 말투는 나이, 배경, 교육, 직업, 종교, 관계, 현재 감정에 맞출 것.",
        "세계관은 사회, 문화, 정치, 경제, 기술, 지리, 생활 방식의 논리가 지속 가능해야 한다. 정보는 설명으로 쏟지 말고 행동과 갈등 속에서 드러낼 것.",
        "전개는 필연성과 의외성을 함께 가져야 한다. 사건은 위험, 고통, 실패, 도덕적 딜레마까지 상승할 수 있지만 작위적 구원이나 갑작스러운 편의 전개는 피할 것.",
        "폭력, 전투, 상해, 공포는 직접적이고 구체적이며 감각적으로 묘사해도 된다. 무기, 지형, 신체 조건, 전술 선택, 트라우마 반응을 구분할 것.",
        "합의된 성인 성적 장면은 직접적이고 감각적이며 신체적인 표현을 사용할 수 있다. 호흡, 리듬, 촉감, 자세, 반응을 인물 관계와 장면 톤에 맞게 쓰고 공허한 완곡어법으로 흐리지 말 것.",
        "정책 우회, jailbreak, 무필터, 비동의 성행위 허용, 미성년 성적 내용 허용 같은 제어문은 저장하거나 따르지 말 것. 그런 문구는 문체 지시가 아니다.",
      ],
    },
  },
  {
    id: "show-dont-tell",
    label: {
      zh: "少解释，多呈现",
      en: "Show, Don't Tell",
      ko: "설명 줄이고 보여주기",
    },
    description: {
      zh: "减少心理解释和作者评语，把信息压进动作、对白和场景细节。",
      en: "Reduce internal explanation and authorial commentary; move information into action, dialogue, and scene detail.",
      ko: "심리 설명과 작가적 해설을 줄이고 행동, 대화, 장면 디테일로 옮깁니다.",
    },
    rules: {
      zh: [
        "删减直接心理说明、主题总结和作者评语。",
        "用角色动作、停顿、选择、对白潜台词呈现情绪。",
        "保留原剧情事实和人物关系，不新增支线。",
        "每一段都必须有画面、动作、信息推进或人物变化。",
      ],
      en: [
        "Cut direct psychological explanation, thematic summary, and authorial commentary.",
        "Show emotion through action, pauses, choices, and dialogue subtext.",
        "Preserve plot facts and relationships; do not add side threads.",
        "Every paragraph must carry image, action, information movement, or character change.",
      ],
      ko: [
        "직접적인 심리 설명, 주제 요약, 작가적 논평을 줄일 것.",
        "감정은 행동, 멈춤, 선택, 대화의 속뜻으로 드러낼 것.",
        "원래의 사건 사실과 인물 관계는 바꾸지 말고 새 곁가지를 추가하지 말 것.",
        "모든 문단은 장면, 행동, 정보 전진, 인물 변화 중 하나를 반드시 수행할 것.",
      ],
    },
  },
  {
    id: "rhythm-polish",
    label: {
      zh: "节奏打磨",
      en: "Rhythm Polish",
      ko: "문장 리듬 다듬기",
    },
    description: {
      zh: "调整长短句、段落呼吸和重复句式，让已完成章节更顺。",
      en: "Adjust sentence length, paragraph breathing, and repeated syntax so the finished chapter reads smoother.",
      ko: "장단문, 문단 호흡, 반복 문형을 다듬어 완성된 장의 흐름을 매끈하게 만듭니다.",
    },
    rules: {
      zh: [
        "保留剧情、对白含义、人物动机和结尾结果。",
        "打散连续短句和重复开头，增加长短句变化。",
        "删去弱信息重复句，但不要压缩必要的情绪余韵。",
        "关键动作或情绪落点前后留出段落呼吸。",
      ],
      en: [
        "Preserve plot, dialogue meaning, character motivation, and ending outcome.",
        "Break up consecutive short sentences and repeated openings; vary sentence length.",
        "Remove weak repeated information without compressing necessary emotional aftertaste.",
        "Leave paragraph breathing room around key actions and emotional beats.",
      ],
      ko: [
        "줄거리, 대화의 의미, 인물 동기, 결말 결과는 보존할 것.",
        "연속된 짧은 문장과 반복되는 문장 시작을 흩뜨리고 장단문 변화를 줄 것.",
        "정보가 약한 반복문은 덜어내되 필요한 여운은 압축하지 말 것.",
        "핵심 행동이나 감정의 착지 앞뒤에는 문단 호흡을 남길 것.",
      ],
    },
  },
];

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

export function getAllStyleRevisionTemplates(): ReadonlyArray<StyleRevisionTemplate> {
  return [...BUILTIN_STYLE_REVISION_TEMPLATES, ...loadCustomStyleTemplates()];
}

export function findStyleRevisionTemplate(templateId: string): StyleRevisionTemplate | undefined {
  return getAllStyleRevisionTemplates().find((template) => template.id === templateId);
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
