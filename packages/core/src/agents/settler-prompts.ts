import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { BookRules } from "../models/book-rules.js";

export function buildSettlerSystemPrompt(
  book: BookConfig,
  genreProfile: GenreProfile,
  bookRules: BookRules | null,
  language?: "zh" | "en",
): string {
  const resolvedLang = language ?? genreProfile.language;
  const isEnglish = resolvedLang === "en";
  const numericalBlock = genreProfile.numericalSystem
    ? `\n- 本题材有数值/资源体系，你必须在 UPDATED_LEDGER 中追踪正文中出现的所有资源变动
- 数值验算铁律：期初 + 增量 = 期末，三项必须可验算`
    : `\n- 本题材无数值系统，UPDATED_LEDGER 留空`;

  const hookRules = `
## 伏笔追踪规则（严格执行）

- 新伏笔：正文中出现的暗示、悬念、未解之谜 → 新增 hook_id，标注起始章=${isEnglish ? "current chapter" : "当前章"}、类型、状态=待定
- 推进伏笔：已有伏笔在本章有新进展 → **必须**更新"最近推进"列为当前章节号，更新状态和备注
- 回收伏笔：伏笔在本章被明确揭示、解决、或不再成立 → 状态改为"已回收"，备注回收方式
- 延后伏笔：超过5章未推进 → 标注"延后"，备注原因
- **铁律**：每次输出 UPDATED_HOOKS 时，逐条检查所有伏笔的"最近推进"列。如果某伏笔在本章正文中有任何相关内容（哪怕只是间接提及），必须更新其"最近推进"为当前章节号。不要让伏笔僵死。`;

  const fullCastBlock = bookRules?.enableFullCastTracking
    ? `\n## 全员追踪\nPOST_SETTLEMENT 必须额外包含：本章出场角色清单、角色间关系变动、未出场但被提及的角色。`
    : "";

  const langPrefix = isEnglish
    ? `【LANGUAGE OVERRIDE】ALL output (state card, hooks, summaries, subplots, emotional arcs, character matrix) MUST be in English. The === TAG === markers remain unchanged.\n\n`
    : "";

  return `${langPrefix}你是状态追踪分析师。给定新章节正文和当前 truth 文件，你的任务是产出更新后的 truth 文件。

## 工作模式

你不是在写作。你的任务是：
1. 仔细阅读正文，提取所有状态变化
2. 基于"当前追踪文件"做增量更新
3. 严格按照 === TAG === 格式输出

## 分析维度

从正文中提取以下信息：
- 角色出场、退场、状态变化（受伤/突破/死亡等）
- 位置移动、场景转换
- 物品/资源的获得与消耗
- 伏笔的埋设、推进、回收
- 情感弧线变化
- 支线进展
- 角色间关系变化、新的信息边界

## 书籍信息

- 标题：${book.title}
- 题材：${genreProfile.name}（${book.genre}）
- 平台：${book.platform}
${numericalBlock}
${hookRules}${fullCastBlock}

## 输出格式（必须严格遵循）

${buildSettlerOutputFormat(genreProfile)}

## 关键规则

1. 状态卡和伏笔池必须基于"当前追踪文件"做增量更新，不是从零开始
2. 正文中的每一个事实性变化都必须反映在对应的追踪文件中
3. 不要遗漏细节：数值变化、位置变化、关系变化、信息变化都要记录
4. 角色交互矩阵中的"信息边界"要准确——角色只知道他在场时发生的事`;
}

function buildSettlerOutputFormat(gp: GenreProfile): string {
  const chapterTypeExample = gp.chapterTypes.length > 0
    ? gp.chapterTypes[0]
    : "主线推进";

  return `=== POST_SETTLEMENT ===
（简要说明本章有哪些状态变动、伏笔推进、结算注意事项；允许 Markdown 表格或要点）

=== RUNTIME_STATE_DELTA ===
（必须输出 JSON，不要输出 Markdown，不要加解释）
\`\`\`json
{
  "chapter": 12,
  "currentStatePatch": {
    "currentLocation": "可选",
    "protagonistState": "可选",
    "currentGoal": "可选",
    "currentConstraint": "可选",
    "currentAlliances": "可选",
    "currentConflict": "可选"
  },
  "hookOps": {
    "upsert": [
      {
        "hookId": "mentor-oath",
        "startChapter": 8,
        "type": "relationship",
        "status": "progressing",
        "lastAdvancedChapter": 12,
        "expectedPayoff": "揭开师债真相",
        "notes": "本章为何推进/延后/回收"
      }
    ],
    "resolve": ["已回收的 hookId"],
    "defer": ["需要标记延后的 hookId"]
  },
  "chapterSummary": {
    "chapter": 12,
    "title": "本章标题",
    "characters": "角色1,角色2",
    "events": "一句话概括关键事件",
    "stateChanges": "一句话概括状态变化",
    "hookActivity": "mentor-oath advanced",
    "mood": "紧绷",
    "chapterType": "${chapterTypeExample}"
  },
  "subplotOps": [],
  "emotionalArcOps": [],
  "characterMatrixOps": [],
  "notes": []
}
\`\`\`

规则：
1. 只输出增量，不要重写完整 truth files
2. 所有章节号字段都必须是整数，不能写自然语言
3. 如果本章推进了旧 hook，lastAdvancedChapter 必须等于当前章号
4. 如果回收或延后 hook，必须放在 resolve / defer 数组里
5. chapterSummary.chapter 必须等于当前章节号`;
}

export function buildSettlerUserPrompt(params: {
  readonly chapterNumber: number;
  readonly title: string;
  readonly content: string;
  readonly currentState: string;
  readonly ledger: string;
  readonly hooks: string;
  readonly chapterSummaries: string;
  readonly subplotBoard: string;
  readonly emotionalArcs: string;
  readonly characterMatrix: string;
  readonly volumeOutline: string;
  readonly observations?: string;
  readonly selectedEvidenceBlock?: string;
  readonly governedControlBlock?: string;
}): string {
  const ledgerBlock = params.ledger
    ? `\n## 当前资源账本\n${params.ledger}\n`
    : "";

  const summariesBlock = params.chapterSummaries !== "(文件尚未创建)"
    ? `\n## 已有章节摘要\n${params.chapterSummaries}\n`
    : "";

  const subplotBlock = params.subplotBoard !== "(文件尚未创建)"
    ? `\n## 当前支线进度板\n${params.subplotBoard}\n`
    : "";

  const emotionalBlock = params.emotionalArcs !== "(文件尚未创建)"
    ? `\n## 当前情感弧线\n${params.emotionalArcs}\n`
    : "";

  const matrixBlock = params.characterMatrix !== "(文件尚未创建)"
    ? `\n## 当前角色交互矩阵\n${params.characterMatrix}\n`
    : "";

  const observationsBlock = params.observations
    ? `\n## 观察日志（由 Observer 提取，包含本章所有事实变化）\n${params.observations}\n\n基于以上观察日志和正文，更新所有追踪文件。确保观察日志中的每一项变化都反映在对应的文件中。\n`
    : "";
  const selectedEvidenceBlock = params.selectedEvidenceBlock
    ? `\n## 已选长程证据\n${params.selectedEvidenceBlock}\n`
    : "";
  const controlBlock = params.governedControlBlock ?? "";
  const outlineBlock = controlBlock.length === 0
    ? `\n## 卷纲\n${params.volumeOutline}\n`
    : "";

  return `请分析第${params.chapterNumber}章「${params.title}」的正文，更新所有追踪文件。
${observationsBlock}
## 本章正文

${params.content}
${controlBlock}

## 当前状态卡
${params.currentState}
${ledgerBlock}
## 当前伏笔池
${params.hooks}
${selectedEvidenceBlock}${summariesBlock}${subplotBlock}${emotionalBlock}${matrixBlock}
${outlineBlock}

请严格按照 === TAG === 格式输出结算结果。`;
}
