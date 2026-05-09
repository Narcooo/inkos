export type StyleTemplateLanguage = "zh" | "en" | "ko";

export interface StyleRevisionTemplate {
  readonly id: string;
  readonly label: Record<StyleTemplateLanguage, string>;
  readonly description: Record<StyleTemplateLanguage, string>;
  readonly rules: Record<StyleTemplateLanguage, ReadonlyArray<string>>;
}

export const STYLE_REVISION_TEMPLATES: ReadonlyArray<StyleRevisionTemplate> = [
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

export function findStyleRevisionTemplate(templateId: string): StyleRevisionTemplate | undefined {
  return STYLE_REVISION_TEMPLATES.find((template) => template.id === templateId);
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
