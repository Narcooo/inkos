/**
 * Style Modules — módulos de estilo estructurados para carga bajo demanda.
 *
 * Cada módulo de estilo sigue la interfaz unificada de seis secciones:
 * - Cuándo aplicar
 * - Responsabilidad estructural
 * - Operaciones a nivel de capítulo
 * - Verificaciones de revisión
 * - Errores comunes
 * - Reglas de mezcla con otros módulos
 *
 * El style-router selecciona 1-2 módulos principales + máximo 1 auxiliar
 * según el tipo de capítulo y el perfil de género.
 */

// ===========================
// Style Module Interface
// ===========================

export interface StyleModule {
  /** Identificador único del módulo */
  readonly id: string;
  /** Nombre legible */
  readonly name: string;
  /** Idioma del módulo */
  readonly language: "zh" | "en";
  /** Tipos de capítulo para los que este módulo es aplicable */
  readonly applicableTypes: readonly string[];
  /** Cuándo aplicar este módulo */
  readonly applicableTiming: string;
  /** Responsabilidad estructural del módulo */
  readonly structuralRole: string;
  /** Operaciones a nivel de capítulo (reglas core inyectadas en el prompt) */
  readonly chapterOps: string;
  /** Verificaciones de revisión (inyectadas en el prompt de auditoría) */
  readonly revisionChecks: string;
  /** Errores comunes a evitar */
  readonly commonMistakes: string;
  /** Reglas de mezcla con otros módulos */
  readonly mixRules: string;
  /** Ejemplos Few-Shot de alta calidad (opcional) */
  readonly examples?: string;
}

// ===========================
// Chinese Style Modules
// ===========================

const ZH_TENSION_MODULE: StyleModule = {
  id: "zh-tension",
  name: "张力与冲突",
  language: "zh",
  applicableTypes: ["冲突", "对抗"],
  applicableTiming: "角色之间发生正面对抗、利益碰撞或信息不对称博弈的章节",
  structuralRole: "推动局面发生不可逆变化，制造有效余压",
  chapterOps: `## 张力写法核心
- 冲突必须可感知：通过行动、对话、物理变化体现，不通过阐释
- 信息落差驱动：至少一方掌握对方不知道的关键信息
- 代价可见：冲突的每个选择都有可见代价
- 当前章必须让至少一个重要变量发生不可逆变化
- 人物反应必须基于其已知信息和个性，不允许全知视角反应`,
  revisionChecks: `- 冲突是否通过行动而非解释推进
- 是否有至少一个不可逆变化
- 人物信息边界是否被尊重
- 代价是否可见而非被暗示`,
  commonMistakes: `- 用心理分析代替现场动作
- 冲突结果太快揭晓，没有余压
- 全知视角旁白解释双方心态
- "他知道这是一场赌博"式概括代替具体行为`,
  mixRules: "可与「节奏」模块混用（先紧张后喘息），不建议同时启用「收束」模块",
  examples: `### 示例：[紧张对抗]
> “你真以为那五百万还在卡里？”林远把玩着那个空掉的烟盒，目光始终没有离开陈默那双微微颤抖的手。
> 陈默没说话，指甲几乎要深深陷入大腿的肌肉里。
> “密码没变，但账户昨天下午就被冻结了。”林远猛地站起，烟盒在桌上发出一声闷响，“现在，告诉我，谁才是那个蠢货？”`,
};

const ZH_PACING_MODULE: StyleModule = {
  id: "zh-pacing",
  name: "节奏与过渡",
  language: "zh",
  applicableTypes: ["过渡", "铺垫"],
  applicableTiming: "高潮后的喘息章、场景转换章、新冲突积蓄前的铺垫章",
  structuralRole: "降低叙事密度，植入下一阶段所需的信息或伏笔，保持读者不脱出",
  chapterOps: `## 过渡写法核心
- 过渡章不等于没事发生：必须有至少一个微型钩子或信息增量
- 降速但不停速：保持至少一条暗线在推进
- 用日常细节建立可信度，为下一次高强度叙事蓄势
- 对话和互动服务于关系发展或信息传递，不是闲聊
- 环境描写限制在1-2句，服务于气氛而非装饰`,
  revisionChecks: `- 过渡章是否有至少一个钩子
- 是否有信息增量（读者学到了什么新东西）
- 日常场景是否服务叙事而非纯粹填充
- 是否有暗线在推进`,
  commonMistakes: `- 纯粹日常闲聊没有任何推进
- 大段环境描写当作过渡内容
- 反复回顾之前发生的事（读者已经知道了）
- 角色之间的关系原地踏步`,
  mixRules: "可与「对话」模块混用（过渡章常以对话为主），不建议同时启用「高潮」模块",
  examples: `### 示例：[过渡铺垫]
> 这个下午难得安静，窗外的蝉鸣反而衬托出了医务室里的冷清。
> “伤口别沾水，这药一天抹两次。”苏青低着头拆开一卷崭新的纱布，动作利索得像是在处理一件精密的仪器。
> 陆野看着她专注的侧脸，手机在他兜里震动了一下，是一个没有备注的号码发来的：[货已到，老地方见]。`,
};

const ZH_CLIMAX_MODULE: StyleModule = {
  id: "zh-climax",
  name: "高潮与爽点",
  language: "zh",
  applicableTypes: ["高潮", "爽点"],
  applicableTiming: "多线汇聚的决胜章、长期伏笔兑现章、关键战斗/对决章",
  structuralRole: "释放积累的叙事压力，兑现前期承诺，制造最强读者满足",
  chapterOps: `## 高潮写法核心
- 节奏前紧后松：最关键的事件用短句密集推进
- 伏笔兑现必须明确：读者能感知到"原来如此"
- 情绪曲线要有拐点：不能从头爽到尾
- 代价和收获并存：单纯胜利是平庸的，付出代价的胜利才震撼
- 感官密度最高：此处允许更多物理细节（声音、温度、疼痛）`,
  revisionChecks: `- 高潮是否有情绪拐点
- 伏笔兑现是否让读者可感知
- 胜利是否伴随代价
- 感官描写是否比日常章节更密集`,
  commonMistakes: `- 高潮章反而开始大段心理分析
- 战斗场面变成回合制描述
- 一切都太顺利没有波折
- 伏笔兑现过于隐晦读者注意不到`,
  mixRules: "可与「张力」模块混用（高潮本身就是张力的释放），不建议搭配「过渡」模块",
  examples: `### 示例：[决胜高潮]
> 剑光如虹，瞬间撕裂了笼罩在荒原上的黑雾。
> “就是现在！”林远怒喝一声，这是他等了整整三个月的机会。体内最后三丝灵力被榨取一空，汇聚成不可逆的致命一击。
> 噗嗤。
> 冰冷的锋刃穿透了那黑袍人的胸膛，但在同一秒，对方的反击也重重轰在了林远的肩上。骨裂声清脆得让人心惊，但林远只是狞笑，死死攥住对方的衣领，不让其后退半分。`,
};

const ZH_CLOSURE_MODULE: StyleModule = {
  id: "zh-closure",
  name: "收束与展望",
  language: "zh",
  applicableTypes: ["收束", "卷末"],
  applicableTiming: "卷末收束章、阶段性结局章、离开场景/告别章",
  structuralRole: "消化前章冲击，为下一阶段铺设期待，留下有效余压",
  chapterOps: `## 收束写法核心
- 不是所有线都要收：只收当前阶段的主线，保留至少一条未解之线
- 收束不等于总结：通过场景和行动完成收束，不通过旁白总结
- 留下一个指向未来的钩子：可以是新问题、新发现或新威胁
- 角色状态要有变化：收束前和收束后的角色不能完全一样
- 适当的呼吸空间：允许比平时更慢的节奏`,
  revisionChecks: `- 是否有未收的线（有意保留）
- 收束是否通过场景而非旁白完成
- 是否有指向未来的钩子
- 角色状态是否有变化`,
  commonMistakes: `- 用旁白式总结"这一切终于结束了"
- 把所有线全收了没有悬念
- 收束章变成纯粹的庆祝/休息场景
- 遗忘了之前种下的重要伏笔`,
  mixRules: "可与「节奏」模块混用（收束章本身节奏偏慢），不建议搭配「高潮」模块",
  examples: `### 示例：[卷末收束]
> 城门外的车辙已被积雪覆盖了大半。
> “真的不打算带他一起走？”苏青把围脖裹得紧了些，看着远处那座在寒风中渐渐缩小的旧城。
> 林远摇了摇头，把那个染血的玉佩塞进怀里：“他有他的路。而且，这上面的裂痕还没补好。”
> 马车缓缓启动，留下一串孤独的印记。谁也没注意到，旧城最高的塔楼上，一个黑影正默默注视着这里。`,
};

const ZH_DIALOGUE_MODULE: StyleModule = {
  id: "zh-dialogue",
  name: "对话与交锋",
  language: "zh",
  applicableTypes: ["冲突", "过渡", "高潮", "收束"],
  applicableTiming: "以对话为主要叙事手段的章节（对话占比 > 40%）",
  structuralRole: "通过对话推进信息交换、关系变化或冲突升级",
  chapterOps: `## 对话写法核心
- 不同角色必须有不同的说话方式（用词、句长、口头禅）
- 对话必须携带信息增量：每轮对话至少推进一个维度
- 行为节拍代替"他说"标签：穿插动作描写揭示心理
- 潜台词比明文更重要：角色不会直接说出所有想法
- 群戏对话时标记清晰，确保读者能辨识说话者`,
  revisionChecks: `- 不同角色的台词是否有可辨别的声音差异
- 对话是否每轮携带信息增量
- 是否用行为节拍代替了过多"说道"标签
- 对话中是否有有效的潜台词`,
  commonMistakes: `- 所有角色用同一种语气说话
- 对话变成两个角色轮流解释世界观
- "他冷冷地说""她不满地说"等标签堆砌
- 角色把心里话直接说出来没有保留`,
  mixRules: "作为辅助模块可与任何主模块混用（最多选1个主模块+对话辅助）",
  examples: `### 示例：[对话交锋]
> “我出五倍。”林远伸出五根指头，那是他最后的老本，但他脸上甚至带着一丝玩世不恭。
> 陈默嗤笑一声，指节在暗红的实木桌面上哒哒地敲着：“五倍？林远，你是不是忘了，这里是青州，不是你那个连路灯都没有的老家。”
> “但我手里有这个。”
> 林远推开一张泛黄的收据。
> 敲击声戛然而止。陈默死死盯着那张纸条，脸上的肉跳动了一下，原本傲慢的姿态微微向前倾了三寸。`,
};

// ===========================
// English Style Modules
// ===========================

const EN_TENSION_MODULE: StyleModule = {
  id: "en-tension",
  name: "Tension & Conflict",
  language: "en",
  applicableTypes: ["conflict", "confrontation"],
  applicableTiming: "Chapters with direct confrontation, competing interests, or information asymmetry between characters",
  structuralRole: "Drive irreversible change in at least one major variable; create effective residual pressure",
  chapterOps: `## Tension Core Rules
- Conflict must be perceivable: through action, dialogue, physical change — not exposition
- Information gap drives tension: at least one party knows something critical the other doesn't
- Cost is visible: every choice in the conflict has visible consequences
- This chapter must cause at least one irreversible change
- Character reactions must be based on what they know, not omniscient perspective`,
  revisionChecks: `- Is conflict advanced through action, not explanation?
- Is there at least one irreversible change?
- Are character information boundaries respected?
- Are costs visible rather than merely implied?`,
  commonMistakes: `- Psychological analysis substituting for on-scene action
- Conflict resolved too quickly with no residual pressure
- Omniscient narrator explaining both sides' mental states
- Generic "he knew this was a gamble" instead of specific behavior`,
  mixRules: "Can mix with Pacing module (tension→relief). Avoid combining with Closure module.",
  examples: `### Example: [Direct Conflict]
> "You really think that information is still worth anything?" Marcus toyed with the lighter, his gaze fixed on Sela's trembling fingers.
> Sela remained silent, her nails digging deep into the leather of her handbag.
> "The safe was emptied at 2 AM," Marcus stood up abruptly, the lighter clicking shut with a sharp metallic snap. "Now, tell me, who's the real fool?"`,
};

const EN_PACING_MODULE: StyleModule = {
  id: "en-pacing",
  name: "Pacing & Transition",
  language: "en",
  applicableTypes: ["transition", "setup"],
  applicableTiming: "Post-climax breathing room, scene transitions, setup chapters before new conflicts",
  structuralRole: "Lower narrative density, plant information or hooks for next phase, keep reader engaged",
  chapterOps: `## Transition Core Rules
- Transition ≠ nothing happens: must contain at least one micro-hook or information increment
- Slow down but don't stop: at least one subplot must be advancing
- Use daily details to build credibility and store energy for the next high-intensity sequence
- Dialogue serves relationship development or information transfer, not idle chat
- Environment descriptions limited to 1-2 sentences, serving mood not decoration`,
  revisionChecks: `- Does the transition chapter have at least one hook?
- Is there an information increment (reader learns something new)?
- Do daily scenes serve narrative rather than pure filler?
- Is at least one subplot advancing?`,
  commonMistakes: `- Pure idle chat without any narrative advancement
- Long environment descriptions as filler
- Repeatedly recapping events the reader already knows
- Character relationships remaining completely static`,
  mixRules: "Can mix with Dialogue module. Avoid combining with Climax module.",
  examples: `### Example: [Pacing/Setup]
> The afternoon was unusually quiet, the distant hum of traffic only emphasizing the stillness in the library.
> "Don't touch the old manuscripts with bare hands," Elias said, his voice hushed as he pulled out a fresh pair of white gloves.
> Sarah watched him, her hand brushing against a folded note in her pocket: [The archive has been compromised. Trust no one.]`,
};

const EN_CLIMAX_MODULE: StyleModule = {
  id: "en-climax",
  name: "Climax & Payoff",
  language: "en",
  applicableTypes: ["climax", "payoff"],
  applicableTiming: "Multi-thread convergence, long-term hook resolution, key battles or confrontations",
  structuralRole: "Release accumulated narrative pressure, fulfill earlier promises, create peak reader satisfaction",
  chapterOps: `## Climax Core Rules
- Pace tight then release: key events use short, dense sentences
- Hook payoff must be explicit: reader should feel "so that's why"
- Emotional curve needs a turning point: can't be all triumph from start to finish
- Cost and reward coexist: pure victory is mediocre; victory with sacrifice resonates
- Peak sensory density: more physical detail here (sound, temperature, pain)`,
  revisionChecks: `- Does the climax have an emotional turning point?
- Is hook payoff perceptible to the reader?
- Does victory come with meaningful cost?
- Is sensory description denser than in ordinary chapters?`,
  commonMistakes: `- Climax chapter devolves into psychological analysis
- Combat becomes turn-based play-by-play
- Everything goes too smoothly without setbacks
- Hook payoff is too subtle for readers to notice`,
  mixRules: "Can mix with Tension module. Avoid combining with Transition module.",
  examples: `### Example: [Peak Climax]
> A flash of steel tore through the darkness that had clung to the wasteland.
> "Now!" Kael roared. This was the moment he had sacrificed months for. He felt the last of his energy surge into a single, final strike. 
> The blade found its mark, but a counter-strike sent Kael reeling, blood blurring his vision. He didn't let go. He grabbed the figure's collar with a grin, holding firm as the shadow finally dissipated into the wind.`,
};

const EN_CLOSURE_MODULE: StyleModule = {
  id: "en-closure",
  name: "Closure & Outlook",
  language: "en",
  applicableTypes: ["closure", "arc-end"],
  applicableTiming: "Arc endings, phase conclusions, departure or farewell chapters",
  structuralRole: "Process aftermath of previous climax, set expectations for next phase, leave effective residual pressure",
  chapterOps: `## Closure Core Rules
- Don't close everything: only resolve the current arc's main thread, keep at least one unresolved
- Closure ≠ summary: close through scenes and action, not narrator recap
- Leave a forward-pointing hook: new question, new discovery, or new threat
- Character state must change: characters before and after closure can't be identical
- Allow breathing room: slower pace than usual is appropriate here`,
  revisionChecks: `- Are there intentionally unresolved threads?
- Is closure achieved through scenes, not narrator summary?
- Is there a forward-pointing hook?
- Have character states changed?`,
  commonMistakes: `- Narrator summary: "And so it was all finally over"
- Closing every thread leaving no suspense
- Closure chapter becomes pure celebration/rest scene
- Forgetting important previously-planted hooks`,
  mixRules: "Can mix with Pacing module. Avoid combining with Climax module.",
  examples: `### Example: [Arc Closure]
> The tracks outside the city were already half-hidden by the falling snow.
> "You're really not going back for him?" Elena tightened her scarf, looking at the distant spires of the city they left behind.
> Jax shook his head, tucked the fractured crystal deep into his coat. "He chose his path. Besides, this debt isn't settled yet."
> The carriage lurched forward, leaving a lone trail. High above on the clock tower, a single observer watched them fade into the white.`,
};

const EN_DIALOGUE_MODULE: StyleModule = {
  id: "en-dialogue",
  name: "Dialogue & Exchange",
  language: "en",
  applicableTypes: ["conflict", "transition", "climax", "closure"],
  applicableTiming: "Dialogue-heavy chapters (dialogue ratio > 40%)",
  structuralRole: "Advance information exchange, relationship change, or conflict escalation through dialogue",
  chapterOps: `## Dialogue Core Rules
- Different characters must speak differently (vocabulary, sentence length, slang, verbal tics)
- Dialogue must carry information increment: each exchange advances at least one dimension
- Action beats replace "he said" tags: intersperse physical action revealing psychology
- Subtext trumps text: characters don't say everything they think
- In group scenes, tag clearly so readers can identify speakers`,
  revisionChecks: `- Do different characters have distinguishable voices?
- Does each dialogue exchange carry information increment?
- Are action beats used instead of excessive dialogue tags?
- Is there effective subtext in the dialogue?`,
  commonMistakes: `- All characters speak with the same voice
- Dialogue becomes two characters taking turns explaining worldbuilding
- "He said coldly" / "she said angrily" tag accumulation
- Characters saying their inner thoughts out loud without reservation`,
  mixRules: "As auxiliary module, can mix with any primary module (max 1 primary + dialogue auxiliary).",
  examples: `### Example: [Character Dialogue]
> "How much?" 
> "More than you can afford, stranger," Silas scoffed, his fingers rhythmic against the hilt of his sword.
> Thorne leaned in, the candlelight casting long shadows across his scarred face. "Try me. I have exactly what you need to get past those gates."
> Silas stopped tapping. His gaze dropped to the coin Thorne had slid across the table, his posture shifting from defensive to curious.`,
};

// ===========================
// Module Registry
// ===========================

/** Todos los módulos de estilo disponibles, indexados por ID */
const MODULE_REGISTRY = new Map<string, StyleModule>();

// Registrar módulos chinos
for (const mod of [ZH_TENSION_MODULE, ZH_PACING_MODULE, ZH_CLIMAX_MODULE, ZH_CLOSURE_MODULE, ZH_DIALOGUE_MODULE]) {
  MODULE_REGISTRY.set(mod.id, mod);
}

// Registrar módulos ingleses
for (const mod of [EN_TENSION_MODULE, EN_PACING_MODULE, EN_CLIMAX_MODULE, EN_CLOSURE_MODULE, EN_DIALOGUE_MODULE]) {
  MODULE_REGISTRY.set(mod.id, mod);
}

/**
 * Obtiene un módulo por ID. Devuelve undefined si no existe.
 */
export function getStyleModule(id: string): StyleModule | undefined {
  return MODULE_REGISTRY.get(id);
}

/**
 * Lista todos los módulos disponibles para un idioma.
 */
export function listModules(language: "zh" | "en"): readonly StyleModule[] {
  return [...MODULE_REGISTRY.values()].filter((m) => m.language === language);
}

/**
 * Selecciona los módulos aplicables a un tipo de capítulo.
 * Devuelve los IDs de los módulos primarios + opcionalmente el de diálogo como auxiliar.
 */
export function selectModulesForChapterType(
  chapterType: string,
  language: "zh" | "en",
  includeDialogue = false,
): readonly string[] {
  const modules = listModules(language);
  const primary = modules.filter(
    (m) => m.applicableTypes.includes(chapterType) && !m.id.endsWith("-dialogue"),
  );

  const ids = primary.map((m) => m.id);

  // Opcionalmente agregar el módulo de diálogo como auxiliar
  if (includeDialogue) {
    const dialogueModule = modules.find((m) => m.id.endsWith("-dialogue"));
    if (dialogueModule) {
      ids.push(dialogueModule.id);
    }
  }

  return ids;
}

/**
 * Combina el contenido core de varios módulos en un solo bloque de texto
 * para inyección en el prompt de escritura.
 */
export function combineModuleContent(moduleIds: readonly string[]): string {
  const parts: string[] = [];
  for (const id of moduleIds) {
    const mod = MODULE_REGISTRY.get(id);
    if (mod) {
      let content = `### ${mod.name}\n\n${mod.chapterOps}`;
      if (mod.examples) {
        content += `\n\n${mod.examples}`;
      }
      parts.push(content);
    }
  }
  return parts.join("\n\n---\n\n");
}

/**
 * Combina las verificaciones de revisión de varios módulos.
 */
export function combineRevisionChecks(moduleIds: readonly string[]): string {
  const parts: string[] = [];
  for (const id of moduleIds) {
    const mod = MODULE_REGISTRY.get(id);
    if (mod) {
      parts.push(`### ${mod.name}\n${mod.revisionChecks}`);
    }
  }
  return parts.join("\n\n");
}
