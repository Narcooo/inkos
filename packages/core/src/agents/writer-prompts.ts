import type { BookConfig, FanficMode } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { BookRules } from "../models/book-rules.js";
import type { LengthSpec } from "../models/length-governance.js";
import { buildFanficCanonSection, buildCharacterVoiceProfiles, buildFanficModeInstructions } from "./fanfic-prompt-sections.js";
import { buildEnglishGenreIntro } from "./en-prompt-sections.js";
import { buildLengthSpec } from "../utils/length-metrics.js";

export interface FanficContext {
  readonly fanficCanon: string;
  readonly fanficMode: FanficMode;
  readonly allowedDeviations: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildWriterSystemPrompt(
  book: BookConfig,
  genreProfile: GenreProfile,
  bookRules: BookRules | null,
  bookRulesBody: string,
  genreBody: string,
  styleGuide: string,
  styleFingerprint?: string,
  chapterNumber?: number,
  mode: "full" | "creative" = "full",
  fanficContext?: FanficContext,
  languageOverride?: "zh" | "en",
  inputProfile: "legacy" | "governed" = "legacy",
  lengthSpec?: LengthSpec,
): string {
  const isEnglish = (languageOverride ?? genreProfile.language) === "en";
  const governed = inputProfile === "governed";
  const resolvedLengthSpec = lengthSpec ?? buildLengthSpec(book.chapterWordCount, isEnglish ? "en" : "zh");

  const outputSection = isEnglish
    ? (mode === "creative"
        ? buildEnglishCreativeOutputFormat(book, genreProfile, resolvedLengthSpec)
        : buildEnglishOutputFormat(book, genreProfile, resolvedLengthSpec))
    : (mode === "creative"
        ? buildCreativeOutputFormat(book, genreProfile, resolvedLengthSpec)
        : buildOutputFormat(book, genreProfile, resolvedLengthSpec));

  const sections = isEnglish
    ? [
        buildEnglishGenreIntro(book, genreProfile),
        buildGovernedInputContract("en", governed),
        buildChapterMemoContract("en", governed),
        buildLengthGuidance(resolvedLengthSpec, "en"),
        buildGoldenOpeningDiscipline(chapterNumber, "en"),
        buildGenreRules(genreProfile, genreBody),
        buildProtagonistRules(bookRules),
        buildNarrativePersonRule(bookRules, isEnglish ? "en" : "zh"),
        buildBookRulesBody(bookRulesBody),
        buildStyleGuide(styleGuide),
        buildStyleFingerprint(styleFingerprint),
        fanficContext ? buildFanficCanonSection(fanficContext.fanficCanon, fanficContext.fanficMode) : "",
        fanficContext ? buildCharacterVoiceProfiles(fanficContext.fanficCanon) : "",
        fanficContext ? buildFanficModeInstructions(fanficContext.fanficMode, fanficContext.allowedDeviations) : "",
        // Pre-write checklist moved to style_guide.md (v10)
        outputSection,
      ]
    : [
        buildGenreIntro(book, genreProfile),
        buildGovernedInputContract("zh", governed),
        buildChapterMemoContract("zh", governed),
        buildLengthGuidance(resolvedLengthSpec, "zh"),
        buildGoldenOpeningDiscipline(chapterNumber, "zh"),
        bookRules?.enableFullCastTracking ? buildFullCastTracking() : "",
        buildGenreRules(genreProfile, genreBody),
        buildProtagonistRules(bookRules),
        buildNarrativePersonRule(bookRules, isEnglish ? "en" : "zh"),
        buildBookRulesBody(bookRulesBody),
        buildStyleGuide(styleGuide),
        buildStyleFingerprint(styleFingerprint),
        fanficContext ? buildFanficCanonSection(fanficContext.fanficCanon, fanficContext.fanficMode) : "",
        fanficContext ? buildCharacterVoiceProfiles(fanficContext.fanficCanon) : "",
        fanficContext ? buildFanficModeInstructions(fanficContext.fanficMode, fanficContext.allowedDeviations) : "",
        // Pre-write checklist moved to style_guide.md (v10)
        outputSection,
      ];

  return sections.filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------------------
// Genre intro
// ---------------------------------------------------------------------------

function buildGenreIntro(book: BookConfig, gp: GenreProfile): string {
  return `你是一位专业的${gp.name}网络小说作家。你为${book.platform}平台写作。`;
}

function buildGovernedInputContract(language: "zh" | "en", governed: boolean): string {
  if (!governed) return "";

  if (language === "en") {
    return `## Input Governance Contract

- Chapter-specific steering comes from the provided chapter intent and composed context package.
- The outline is the default plan, not unconditional global supremacy.
- When the runtime rule stack records an active L4 -> L3 override, follow the current task over local planning.
- Keep hard guardrails compact: canon, continuity facts, and explicit prohibitions still win.
- If an English Variance Brief is provided, obey it: avoid the listed phrase/opening/ending patterns and satisfy the scene obligation.
- If Hook Debt Briefs are provided, they contain the ORIGINAL SEED TEXT from the chapter where each hook was planted. Use this text to write a continuation or payoff that feels connected to what the reader already saw — not a vague mention, but a scene that builds on the specific promise.
- When the explicit hook agenda names an eligible resolve target, land a concrete payoff beat that answers the reader's original question from the seed chapter.
- When stale debt is present, do not open sibling hooks casually; clear pressure from old promises before minting fresh debt.
- In multi-character scenes, include at least one resistance-bearing exchange instead of reducing the beat to summary or explanation.`;
  }

  return `## 输入治理契约

- 本章具体写什么，以提供给你的 chapter intent 和 composed context package 为准。
- 卷纲是默认规划，不是全局最高规则。
- 当 runtime rule stack 明确记录了 L4 -> L3 的 active override 时，优先执行当前任务意图，再局部调整规划层。
- 真正不能突破的只有硬护栏：世界设定、连续性事实、显式禁令。
- 如果提供了 English Variance Brief，必须主动避开其中列出的高频短语、重复开头和重复结尾模式，并完成 scene obligation。
- 如果提供了 Hook Debt 简报，里面包含每个伏笔种下时的**原始文本片段**。用这些原文来写延续或兑现场景——不是模糊地提一嘴，而是接着读者已经看到的具体承诺来写。
- 如果显式 hook agenda 里出现了可回收目标，本章必须写出具体兑现片段，回答种子章节中读者的原始疑问。
- 如果存在 stale debt，先消化旧承诺的压力，再决定是否开新坑；同类 sibling hook 不得随手再开。
- 多角色场景里，至少给出一轮带阻力的直接交锋，不要把人物关系写成纯解释或纯总结。`;
}

// ---------------------------------------------------------------------------
// Chapter memo alignment — 7 sections from mobile web-fiction craft methodology
// ---------------------------------------------------------------------------

function buildChapterMemoContract(language: "zh" | "en", governed: boolean): string {
  if (!governed) return "";

  if (language === "en") {
    return `## Chapter Memo Alignment

You will receive a chapter_memo composed of 7 markdown sections:

- ## 当前任务 → the concrete action this chapter must complete; stay aligned with it throughout
- ## 读者此刻在等什么 → controls how emotional gaps are created / delayed / paid off
- ## 该兑现的 / 暂不掀的 → payoffs that must land this chapter + cards you must NOT reveal
- ## 日常/过渡承担什么任务 → function map for non-conflict passages ([passage location] → [function])
- ## 关键抉择过三连问 → three-question check every key character choice must pass
- ## 章尾必须发生的改变 → 1-3 concrete changes the ending must deliver (info / relation / physical / power)
- ## 本章 hook 账 → **hard correspondence rule**: each hook_id listed under advance/resolve MUST have a **concretely locatable payoff scene** in the prose — explicit characters acting on or talking about a specific object/event/piece of information, with observable actions. No "sideways hints" or "deferred to next chapter". Example: if the memo says 'advance: H007 Huzi's IOU → planted → pressured', the prose must contain a scene where Lin Qiu actually touches / sees / picks up that specific IOU and does something. An inner mention like "he remembered the IOU was still in the drawer" does NOT count. Each advance/resolve payoff scene must be at least 60 chars. Entries under defer need no prose. Entries under open only need a natural new-hook seed near the chapter end
- ## 不要做 → hard prohibitions for this chapter

Address each section in order when drafting the chapter. Every section must leave a visible trace in the prose — if a section is not reflected, the chapter is incomplete. **After the first draft, self-check the hook ledger**: list each hook_id from advance/resolve and point each one to a specific prose span containing action / object / dialogue. If you cannot point to one, go back and add it; do not submit a draft where the ledger lives in the memo but nowhere in the prose — review will flag the missing payoff and ask for a concrete scene.`;
  }

  return `## 章节备忘对齐

你将收到本章的 chapter_memo，由 7 段 markdown 组成：

- ## 当前任务 → 本章必须完成的具体动作，写作时始终对齐这条
- ## 读者此刻在等什么 → 控制情绪缺口的制造/延迟/兑现程度
- ## 该兑现的 / 暂不掀的 → 本章必须兑现的伏笔清单 + 必须压住不掀的底牌
- ## 日常/过渡承担什么任务 → 非冲突段落的功能映射（[段落位置] → [承担功能]）
- ## 关键抉择过三连问 → 关键人物选择必须过的检查
- ## 章尾必须发生的改变 → 结尾落地的 1-3 条具体改变（信息/关系/物理/权力）
- ## 本章 hook 账 → **硬对应规则**：advance/resolve 下面列出的每一个 hook_id 都必须在正文里有一个**具体可定位的兑现段**——写明人物对着什么物件/事件/信息做出什么可观察的动作或交谈。不允许"侧面暗示""留给下章"。举例：memo 写 'advance: H007 胖虎借条 → planted → pressured'，正文里必须出现一段林秋真的伸手摸到/看到/拿起那张胖虎借条并做出动作的场景；不能只写"他想起借条还在抽屉里"这种内心提及。每个 advance/resolve 的 hook 兑现段至少 60 字。defer 下的不用落，open 段只需要在章末附近安排一个自然引出的新悬念即可
- ## 不要做 → 硬约束红线

写作时按段落顺序落实，每一段都要在正文里有对应的兑现痕迹。如果某一段没有体现到正文里，本章不算完成。**写完初稿后自检一遍 hook 账**：把 advance 和 resolve 的 hook_id 列下来，对照正文，确认每一个都能指到一段带具体动作/物件/对话的 prose。如果指不到，回去补写；不要提交"账本在 memo 里、正文里没落"的稿子——审稿会标记缺口并要求补出具体场景。`;
}

function buildLengthGuidance(lengthSpec: LengthSpec, language: "zh" | "en"): string {
  if (language === "en") {
    return `## Length Guidance

- Target length: ${lengthSpec.target} words
- Acceptable range: ${lengthSpec.softMin}-${lengthSpec.softMax} words
- Hard range: ${lengthSpec.hardMin}-${lengthSpec.hardMax} words`;
  }

  return `## 字数治理

- 目标字数：${lengthSpec.target}字
- 允许区间：${lengthSpec.softMin}-${lengthSpec.softMax}字
- 硬区间：${lengthSpec.hardMin}-${lengthSpec.hardMax}字`;
}

// ---------------------------------------------------------------------------
// 黄金三章 prose discipline — Phase 6.5
// Single conditional append (chapterNumber <= 3). No new schema, no new
// runtime branch. Cohesive paragraphs, NOT a numbered checklist.
// ---------------------------------------------------------------------------

export function buildGoldenOpeningDiscipline(
  chapterNumber: number | undefined,
  language: "zh" | "en",
): string {
  if (chapterNumber === undefined || chapterNumber > 3) return "";

  if (language === "en") {
    return `## Golden Opening Discipline — Chapter ${chapterNumber}

This is chapter ${chapterNumber} of the opening three — your prose directly decides whether the reader stays. The Golden Three Chapters rule is a hard constraint on your sentences, not advice. Chapter 1: within the first 800 words the protagonist must trip the main-line conflict (chase, dead-end, dispossession, transmigration-as-crisis); long background paragraphs are forbidden, and worldbuilding rides on the protagonist's actions instead of being explained in a block. **The last sentence of the first 300 words (the reader's first phone screen) must land a dramatic / reversal / striking beat — "Officer, I transmigrated"-level, "I'll probably die tomorrow"-level, "I'm attending my own funeral"-level — not background or scene-setting. When the reader scrolls to the bottom of the first screen they must feel pulled into the next line.** Chapter 2: the edge — power, system, rebirth-memory, information advantage — must be **performed** (one concrete event of using it, with a visible consequence), not **announced** (a narrator paragraph saying it exists). Chapter 3: somewhere in this chapter the protagonist's next quantifiable short-term goal must surface, so the reader can name what comes next when they close the page.

The discipline that runs across all three opening chapters: paragraphs of three to five lines (mobile reading), verbs over adjectives, and every chapter ends on a small hook — a cliff, an unresolved question, or an emotional gap. **At most two scenes and at most two named characters who actually clash in the chapter (protagonist + one trigger/opponent; walk-on roles get a role label only, no name, no expansion). Editor Cong Yue's rule tightens the cap from 3 to 2 — readers already mix up 3.** Information is layered into action: basic facts (looks, status, situation) emerge from what the protagonist does; key world rules (system mechanics, the deeper logic) attach to plot triggers; a paragraph of pure exposition is forbidden.`;
  }

  return `## 黄金三章写作纪律 — 第 ${chapterNumber} 章

这是开篇三章中的第 ${chapterNumber} 章——你写出的每一句话都直接决定读者是否留下来。黄金三章法则对你不是建议，是对句子的硬约束。第 1 章：主角出场 800 字以内必须触发主线冲突（追杀、死局、被夺权、穿越即危机），禁止长段背景铺垫，世界观要通过主角的行动自然带出，不要整段解释。**第 1 章正文前 300 字（手机屏第一页）的最后一句必须是带戏剧性/反差/反转的收尾——警察叔叔我穿越了这类、我大概明天就要死了这类、我躺在自己的葬礼上这类——而不是介绍背景或交代环境。读者第一屏刷到页尾时必须产生"下一句是什么"的拉力。** 第 2 章：金手指/能力/系统/重生记忆/信息差必须"做出来"——一次具体使用的事件、一个看得见的后果——而不是"说出来"——旁白介绍它存在。第 3 章：本章中段必须让主角下一个可量化的短期目标浮上水面，读者合上页面要能说出"接下来他要干什么"。

贯穿开篇三章的纪律：段落 3-5 行（手机阅读节奏），动词压过形容词，每一章结尾必有小钩子——小悬念、未解之问、情绪缺口。**本章场景 ≤ 2 个、有名有姓参与正面冲突的人物 ≤ 2 个（主角 + 1 个触发者或对手；路人甲乙只报身份不给名字，不展开）。开篇人物上限从 3 收紧到 2：3 个已经够读者记混，2 个最稳。** 信息分层植入到动作里：基础信息（外貌、身份、处境）通过主角行动自然带出；关键设定（系统规则、世界底层）结合剧情节点揭示；禁止整段 exposition。`;
}


// ---------------------------------------------------------------------------
// Full cast tracking (conditional)
// ---------------------------------------------------------------------------

function buildFullCastTracking(): string {
  return `## 全员追踪

本书启用全员追踪模式。每章结束时，POST_SETTLEMENT 必须额外包含：
- 本章出场角色清单（名字 + 一句话状态变化）
- 角色间关系变动（如有）
- 未出场但被提及的角色（名字 + 提及原因）`;
}

// ---------------------------------------------------------------------------
// Genre-specific rules
// ---------------------------------------------------------------------------

function buildGenreRules(gp: GenreProfile, genreBody: string): string {
  const fatigueLine = gp.fatigueWords.length > 0
    ? `- 高疲劳词（${gp.fatigueWords.join("、")}）单章最多出现1次`
    : "";

  const chapterTypesLine = gp.chapterTypes.length > 0
    ? `动笔前先判断本章类型：\n${gp.chapterTypes.map(t => `- ${t}`).join("\n")}`
    : "";

  const pacingLine = gp.pacingRule
    ? `- 节奏规则：${gp.pacingRule}`
    : "";

  return [
    `## 题材规范（${gp.name}）`,
    fatigueLine,
    pacingLine,
    chapterTypesLine,
    genreBody,
  ].filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------------------
// Protagonist rules from book_rules
// ---------------------------------------------------------------------------

// Narrative person is a durable user constraint: enforce it only when the user
// explicitly set one (book_rules.narrativePerson). When unset, stay silent so the
// genre default applies — we never impose a person the user didn't ask for.
function buildNarrativePersonRule(bookRules: BookRules | null, language: "zh" | "en"): string {
  const person = bookRules?.narrativePerson;
  if (!person) return "";
  if (language === "en") {
    return person === "first"
      ? "## Narrative person (hard constraint)\nWrite this book entirely in FIRST person (the protagonist's inner viewpoint). Do NOT slip into third person or an omniscient narrator — this overrides genre convention and your default."
      : "## Narrative person (hard constraint)\nWrite this book in THIRD person.";
  }
  return person === "first"
    ? "## 叙事人称（硬约束）\n本书必须全程使用第一人称（主角内心视角）叙述，禁止切换到第三人称或全知视角——此约束优先于题材惯例与你的默认倾向。"
    : "## 叙事人称（硬约束）\n本书使用第三人称叙述。";
}


function buildProtagonistRules(bookRules: BookRules | null): string {
  if (!bookRules?.protagonist) return "";

  const p = bookRules.protagonist;
  const lines = [`## 主角铁律（${p.name}）`];

  if (p.personalityLock.length > 0) {
    lines.push(`\n性格锁定：${p.personalityLock.join("、")}`);
  }
  if (p.behavioralConstraints.length > 0) {
    lines.push("\n行为约束：");
    for (const c of p.behavioralConstraints) {
      lines.push(`- ${c}`);
    }
  }

  if (bookRules.prohibitions.length > 0) {
    lines.push("\n本书禁忌：");
    for (const p of bookRules.prohibitions) {
      lines.push(`- ${p}`);
    }
  }

  if (bookRules.genreLock?.forbidden && bookRules.genreLock.forbidden.length > 0) {
    lines.push(`\n风格禁区：禁止出现${bookRules.genreLock.forbidden.join("、")}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Book rules body (user-written markdown)
// ---------------------------------------------------------------------------

function buildBookRulesBody(body: string): string {
  if (!body) return "";
  return `## 本书专属规则\n\n${body}`;
}

// ---------------------------------------------------------------------------
// Style guide
// ---------------------------------------------------------------------------

function buildStyleGuide(styleGuide: string): string {
  if (!styleGuide || styleGuide === "(文件尚未创建)") return "";
  return `## 文风指南\n\n${styleGuide}`;
}

// ---------------------------------------------------------------------------
// Style fingerprint (Phase 9: C3)
// ---------------------------------------------------------------------------

function buildStyleFingerprint(fingerprint?: string): string {
  if (!fingerprint) return "";
  return `## 文风指纹（模仿目标）

以下是从参考文本中提取的写作风格特征。你的输出必须尽量贴合这些特征：

${fingerprint}`;
}


// ---------------------------------------------------------------------------
// Creative-only output format (no settlement blocks)
// ---------------------------------------------------------------------------

function buildCreativeOutputFormat(book: BookConfig, gp: GenreProfile, lengthSpec: LengthSpec): string {
  const resourceRow = gp.numericalSystem
    ? "| 当前资源总量 | X | 与账本一致 |\n| 本章预计增量 | +X（来源） | 无增量写+0 |"
    : "";

  const preWriteTable = `=== PRE_WRITE_CHECK ===
（必须输出Markdown表格，全部检查项对齐 chapter_memo 七段，而不是卷纲）
| 检查项 | 本章记录 | 备注 |
|--------|----------|------|
| 当前任务 | 复述 chapter_memo 的「当前任务」并写出本章执行动作 | 必须具体，不能抽象 |
| 读者在等什么 | 本章如何处理「读者此刻在等什么」—制造/延迟/兑现 | 与 memo 一致 |
| 该兑现的 / 暂不掀的 | 本章确认要兑现的伏笔 + 必须压住不掀的底牌 | 引用 memo 原文 |
| 日常/过渡承担任务 | 若有日常/过渡段落，说明各自承担的功能 | 对齐 memo 映射表 |
| 章尾必须发生的改变 | 列出 memo「章尾必须发生的改变」中 1-3 条具体改变 | 必须落地 |
| 不要做 | 复述 memo「不要做」清单 | 正文不得触碰 |
| 上下文范围 | 第X章至第Y章 / 状态卡 / 设定文件 | |
| 当前锚点 | 地点 / 对手 / 收益目标 | 锚点必须具体 |
${resourceRow}| 待回收伏笔 | 用真实 hook_id 填写（无则写 none） | 与伏笔池一致 |
| 本章冲突 | 一句话概括 | |
| 章节类型 | ${gp.chapterTypes.join("/")} | |
| 风险扫描 | OOC/信息越界/设定冲突${gp.powerScaling ? "/战力崩坏" : ""}/节奏/词汇疲劳 | |`;

  return `## 输出格式（严格遵守）

${preWriteTable}

=== CHAPTER_TITLE ===
(章节标题，不含"第X章"。标题必须与已有章节标题不同，不要重复使用相同或相似的标题；若提供了 recent title history 或高频标题词，必须主动避开重复词根和高频意象)

=== CHAPTER_CONTENT ===
(正文内容，目标${lengthSpec.target}字，允许区间${lengthSpec.softMin}-${lengthSpec.softMax}字)

【重要】本次只需输出以上三个区块（PRE_WRITE_CHECK、CHAPTER_TITLE、CHAPTER_CONTENT）。
状态卡、伏笔池、摘要等追踪文件将由后续结算阶段处理，请勿输出。`;
}

// ---------------------------------------------------------------------------
// Output format
// ---------------------------------------------------------------------------

function buildOutputFormat(book: BookConfig, gp: GenreProfile, lengthSpec: LengthSpec): string {
  const resourceRow = gp.numericalSystem
    ? "| 当前资源总量 | X | 与账本一致 |\n| 本章预计增量 | +X（来源） | 无增量写+0 |"
    : "";

  const preWriteTable = `=== PRE_WRITE_CHECK ===
（必须输出Markdown表格，全部检查项对齐 chapter_memo 七段，而不是卷纲）
| 检查项 | 本章记录 | 备注 |
|--------|----------|------|
| 当前任务 | 复述 chapter_memo 的「当前任务」并写出本章执行动作 | 必须具体，不能抽象 |
| 读者在等什么 | 本章如何处理「读者此刻在等什么」—制造/延迟/兑现 | 与 memo 一致 |
| 该兑现的 / 暂不掀的 | 本章确认要兑现的伏笔 + 必须压住不掀的底牌 | 引用 memo 原文 |
| 日常/过渡承担任务 | 若有日常/过渡段落，说明各自承担的功能 | 对齐 memo 映射表 |
| 章尾必须发生的改变 | 列出 memo「章尾必须发生的改变」中 1-3 条具体改变 | 必须落地 |
| 不要做 | 复述 memo「不要做」清单 | 正文不得触碰 |
| 上下文范围 | 第X章至第Y章 / 状态卡 / 设定文件 | |
| 当前锚点 | 地点 / 对手 / 收益目标 | 锚点必须具体 |
${resourceRow}| 待回收伏笔 | 用真实 hook_id 填写（无则写 none） | 与伏笔池一致 |
| 本章冲突 | 一句话概括 | |
| 章节类型 | ${gp.chapterTypes.join("/")} | |
| 风险扫描 | OOC/信息越界/设定冲突${gp.powerScaling ? "/战力崩坏" : ""}/节奏/词汇疲劳 | |`;

  const postSettlement = gp.numericalSystem
    ? `=== POST_SETTLEMENT ===
（如有数值变动，必须输出Markdown表格）
| 结算项 | 本章记录 | 备注 |
|--------|----------|------|
| 资源账本 | 期初X / 增量+Y / 期末Z | 无增量写+0 |
| 重要资源 | 资源名 -> 贡献+Y（依据） | 无写"无" |
| 伏笔变动 | 新增/回收/延后 Hook | 同步更新伏笔池 |`
    : `=== POST_SETTLEMENT ===
（如有伏笔变动，必须输出）
| 结算项 | 本章记录 | 备注 |
|--------|----------|------|
| 伏笔变动 | 新增/回收/延后 Hook | 同步更新伏笔池 |`;

  const updatedLedger = gp.numericalSystem
    ? `\n=== UPDATED_LEDGER ===\n(更新后的完整资源账本，Markdown表格格式)`
    : "";

  return `## 输出格式（严格遵守）

${preWriteTable}

=== CHAPTER_TITLE ===
(章节标题，不含"第X章"。标题必须与已有章节标题不同，不要重复使用相同或相似的标题；若提供了 recent title history 或高频标题词，必须主动避开重复词根和高频意象)

=== CHAPTER_CONTENT ===
(正文内容，目标${lengthSpec.target}字，允许区间${lengthSpec.softMin}-${lengthSpec.softMax}字)

${postSettlement}

=== UPDATED_STATE ===
(更新后的完整状态卡，Markdown表格格式)
${updatedLedger}
=== UPDATED_HOOKS ===
(更新后的完整伏笔池，Markdown表格格式)

=== CHAPTER_SUMMARY ===
(本章摘要，Markdown表格格式，必须包含以下列)
| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |
|------|------|----------|----------|----------|----------|----------|----------|
| N | 本章标题 | 角色1,角色2 | 一句话概括 | 关键变化 | H01埋设/H02推进 | 情绪走向 | ${gp.chapterTypes.length > 0 ? gp.chapterTypes.join("/") : "过渡/冲突/高潮/收束"} |

=== UPDATED_SUBPLOTS ===
(更新后的完整支线进度板，Markdown表格格式)
| 支线ID | 支线名 | 相关角色 | 起始章 | 最近活跃章 | 距今章数 | 状态 | 进度概述 | 回收ETA |
|--------|--------|----------|--------|------------|----------|------|----------|---------|

=== UPDATED_EMOTIONAL_ARCS ===
(更新后的完整情感弧线，Markdown表格格式)
| 角色 | 章节 | 情绪状态 | 触发事件 | 强度(1-10) | 弧线方向 |
|------|------|----------|----------|------------|----------|

=== UPDATED_CHARACTER_MATRIX ===
(更新后的角色矩阵，每个角色一个 ## 块)

## 角色名
- **定位**: 主角 / 反派 / 盟友 / 配角 / 提及
- **标签**: 核心身份标签
- **反差**: 打破刻板印象的独特细节
- **说话**: 说话风格概述
- **性格**: 性格底色
- **动机**: 根本驱动力
- **当前**: 本章即时目标
- **关系**: 某角色(关系性质/Ch#) | ...
- **已知**: 该角色已知的信息（仅限亲历或被告知）
- **未知**: 该角色不知道的信息`;
}

// ---------------------------------------------------------------------------
// English output formats (parser keys off the === MARKER === anchors, so the
// table labels below are safely localized; persisted artifacts read English).
// ---------------------------------------------------------------------------

function buildEnglishPreWriteTable(gp: GenreProfile): string {
  const resourceRow = gp.numericalSystem
    ? "| Current resource total | X | match the ledger |\n| This chapter's gain | +X (source) | write +0 if none |\n"
    : "";

  return `=== PRE_WRITE_CHECK ===
(Output a Markdown table. Every row aligns with the seven chapter_memo sections, not the volume outline.)
| Check | This chapter | Note |
|-------|--------------|------|
| Current task | Restate the chapter_memo "Current task" and the concrete action this chapter takes | Be specific, not abstract |
| What the reader is waiting for | How this chapter handles it: create / delay / pay off | Match the memo |
| Pay off / keep hidden | Foreshadowing to pay off + cards that must stay down | Quote the memo |
| Routine / transition duty | If any routine or transition passage exists, state each one's function | Match the memo mapping |
| Required end-of-chapter change | 1-3 concrete changes from the memo's end-of-chapter change | Must land on the page |
| Do not | Restate the memo "Do not" list | The prose must not touch these |
| Context range | Ch X to Ch Y / state card / setting files | |
| Current anchor | Location / opponent / payoff goal | Anchor must be concrete |
${resourceRow}| Hooks to resolve | Real hook_id (write none if absent) | Match the hook pool |
| This chapter's conflict | One line | |
| Chapter type | ${gp.chapterTypes.join(" / ")} | |
| Risk scan | OOC / info leak / canon conflict${gp.powerScaling ? " / power-scaling break" : ""} / pacing / word fatigue | |`;
}

function buildEnglishContentBlocks(lengthSpec: LengthSpec): string {
  return `=== CHAPTER_TITLE ===
(Chapter title, without "Chapter X". It must differ from existing titles; do not reuse the same or similar titles. If recent title history or high-frequency title words are provided, avoid repeated roots and overused imagery.)

=== CHAPTER_CONTENT ===
(Chapter prose. Target ${lengthSpec.target} words, acceptable range ${lengthSpec.softMin}-${lengthSpec.softMax} words.)`;
}

function buildEnglishCreativeOutputFormat(_book: BookConfig, gp: GenreProfile, lengthSpec: LengthSpec): string {
  return `## Output Format (follow strictly)

${buildEnglishPreWriteTable(gp)}

${buildEnglishContentBlocks(lengthSpec)}

[Important] Output only the three blocks above (PRE_WRITE_CHECK, CHAPTER_TITLE, CHAPTER_CONTENT). State cards, hook pool, and summaries are handled by the later settlement stage; do not output them.`;
}

function buildEnglishOutputFormat(_book: BookConfig, gp: GenreProfile, lengthSpec: LengthSpec): string {
  const postSettlement = gp.numericalSystem
    ? `=== POST_SETTLEMENT ===
(If any numerical change occurred, output a Markdown table.)
| Item | This chapter | Note |
|------|--------------|------|
| Resource ledger | open X / gain +Y / close Z | write +0 if none |
| Key resources | name -> contribution +Y (basis) | write "none" if none |
| Hook changes | new / resolved / deferred hook | sync the hook pool |`
    : `=== POST_SETTLEMENT ===
(If any hook changed, output this.)
| Item | This chapter | Note |
|------|--------------|------|
| Hook changes | new / resolved / deferred hook | sync the hook pool |`;

  const updatedLedger = gp.numericalSystem
    ? `\n=== UPDATED_LEDGER ===\n(The full updated resource ledger, Markdown table.)`
    : "";

  return `## Output Format (follow strictly)

${buildEnglishPreWriteTable(gp)}

${buildEnglishContentBlocks(lengthSpec)}

${postSettlement}

=== UPDATED_STATE ===
(The full updated state card, Markdown table.)
${updatedLedger}
=== UPDATED_HOOKS ===
(The full updated hook pool, Markdown table.)

=== CHAPTER_SUMMARY ===
(Chapter summary as a Markdown table with these columns.)
| Chapter | Title | Characters | Key events | State change | Hook dynamics | Emotional tone | Chapter type |
|---------|-------|------------|------------|--------------|---------------|----------------|--------------|
| N | this chapter's title | Char1, Char2 | one-line summary | key change | H01 planted / H02 advanced | emotional arc | ${gp.chapterTypes.length > 0 ? gp.chapterTypes.join(" / ") : "transition / conflict / climax / resolution"} |

=== UPDATED_SUBPLOTS ===
(The full updated subplot board, Markdown table.)
| Subplot ID | Name | Characters | Start ch | Last active ch | Chapters since | Status | Progress | Resolve ETA |
|------------|------|------------|----------|----------------|----------------|--------|----------|-------------|

=== UPDATED_EMOTIONAL_ARCS ===
(The full updated emotional arcs, Markdown table.)
| Character | Chapter | Emotional state | Trigger | Intensity (1-10) | Arc direction |
|-----------|---------|-----------------|---------|------------------|---------------|

=== UPDATED_CHARACTER_MATRIX ===
(The updated character matrix, one ## block per character.)

## Character Name
- **Role**: protagonist / antagonist / ally / supporting / mentioned
- **Tags**: core identity tags
- **Contrast**: a distinctive detail that breaks the stereotype
- **Voice**: how they speak
- **Personality**: underlying temperament
- **Motivation**: core driving force
- **Current**: this chapter's immediate goal
- **Relations**: Character (relationship / Ch#) | ...
- **Knows**: what this character knows (only what they witnessed or were told)
- **Unknown**: what this character does not know`;
}
