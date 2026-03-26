import { BaseAgent } from "./base.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { BookRules } from "../models/book-rules.js";
import { readGenreProfile, readBookRules } from "./rules-reader.js";
import { readFile, readdir } from "node:fs/promises";
import { readAllStoryFiles, type StoryFiles } from "../utils/story-files.js";
import { join } from "node:path";

export interface AuditResult {
  readonly passed: boolean;
  readonly issues: ReadonlyArray<AuditIssue>;
  readonly summary: string;
  readonly tokenUsage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

export interface AuditIssue {
  readonly severity: "critical" | "warning" | "info";
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
}

// Dimension ID → name mapping
const DIMENSION_MAP: Record<number, string> = {
  1: "OOC检查",
  2: "时间线检查",
  3: "设定冲突",
  4: "战力崩坏",
  5: "数值检查",
  6: "伏笔检查",
  7: "节奏检查",
  8: "文风检查",
  9: "信息越界",
  10: "词汇疲劳",
  11: "利益链断裂",
  12: "年代考据",
  13: "配角降智",
  14: "配角工具人化",
  15: "爽点虚化",
  16: "台词失真",
  17: "流水账",
  18: "知识库污染",
  19: "视角一致性",
  20: "段落等长",
  21: "套话密度",
  22: "公式化转折",
  23: "列表式结构",
  24: "支线停滞",
  25: "弧线平坦",
  26: "节奏单调",
  27: "敏感词检查",
  28: "正传事件冲突",
  29: "未来信息泄露",
  30: "世界规则跨书一致性",
  31: "番外伏笔隔离",
  32: "读者期待管理",
  33: "大纲偏离检测",
  34: "角色还原度",
  35: "世界规则遵守",
  36: "关系动态",
  37: "正典事件一致性",
};

/**
 * Dimensiones Tier-2 — núcleo narrativo para auditoría ligera.
 * Solo estas dimensiones se evalúan en el paso rápido.
 */
export const TIER2_DIMENSION_IDS: ReadonlyArray<number> = [
  1,  // OOC检查
  2,  // 时间线检查
  3,  // 设定冲突
  5,  // 数值检查
  6,  // 伏笔检查
  9,  // 信息越界
  19, // 视角一致性
  27, // 敏感词检查
  32, // 读者期待管理
  33, // 大纲偏离检测
];

function buildDimensionList(
  gp: GenreProfile,
  bookRules: BookRules | null,
  hasParentCanon = false,
): ReadonlyArray<{ readonly id: number; readonly name: string; readonly note: string }> {
  const activeIds = new Set(gp.auditDimensions);

  // Add book-level additional dimensions (supports both numeric IDs and name strings)
  if (bookRules?.additionalAuditDimensions) {
    // Build reverse lookup: name → id
    const nameToId = new Map<string, number>();
    for (const [id, name] of Object.entries(DIMENSION_MAP)) {
      nameToId.set(name, Number(id));
    }

    for (const d of bookRules.additionalAuditDimensions) {
      if (typeof d === "number") {
        activeIds.add(d);
      } else if (typeof d === "string") {
        // Try exact match first, then substring match
        const exactId = nameToId.get(d);
        if (exactId !== undefined) {
          activeIds.add(exactId);
        } else {
          // Fuzzy: find dimension whose name contains the string
          for (const [name, id] of nameToId) {
            if (name.includes(d) || d.includes(name)) {
              activeIds.add(id);
              break;
            }
          }
        }
      }
    }
  }

  // Always-active dimensions
  activeIds.add(32); // 读者期待管理 — universal
  activeIds.add(33); // 大纲偏离检测 — universal

  // Conditional overrides
  if (gp.eraResearch || bookRules?.eraConstraints?.enabled) {
    activeIds.add(12);
  }

  // Spinoff dimensions — activated when parent_canon.md exists
  if (hasParentCanon) {
    activeIds.add(28); // 正传事件冲突
    activeIds.add(29); // 未来信息泄露
    activeIds.add(30); // 世界规则跨书一致性
    activeIds.add(31); // 番外伏笔隔离
  }

  // Fanfic dimensions — activated when fanficMode is set
  if (bookRules?.fanficMode) {
    activeIds.add(34); // 角色还原度
    activeIds.add(35); // 世界规则遵守
    activeIds.add(36); // 关系动态
    activeIds.add(37); // 正典事件一致性
  }

  const dims: Array<{ id: number; name: string; note: string }> = [];

  for (const id of [...activeIds].sort((a, b) => a - b)) {
    const name = DIMENSION_MAP[id];
    if (!name) continue;

    let note = "";
    if (id === 10 && gp.fatigueWords.length > 0) {
      const words = bookRules?.fatigueWordsOverride && bookRules.fatigueWordsOverride.length > 0
        ? bookRules.fatigueWordsOverride
        : gp.fatigueWords;
      note = `高疲劳词：${words.join("、")}。同时检查AI标记词（仿佛/不禁/宛如/竟然/忽然/猛地）密度，每3000字超过1次即warning`;
    }
    if (id === 15 && gp.satisfactionTypes.length > 0) {
      note = `爽点类型：${gp.satisfactionTypes.join("、")}`;
    }
    if (id === 12 && bookRules?.eraConstraints) {
      const era = bookRules.eraConstraints;
      const parts = [era.period, era.region].filter(Boolean);
      if (parts.length > 0) note = `年代：${parts.join("，")}`;
    }
    if (id === 19) {
      note = "检查视角切换是否有过渡、是否与设定视角一致";
    }
    if (id === 24) {
      note = "对照 subplot_board 和 chapter_summaries：如果任何支线超过5章未被提及或推进→warning。如果存在支线但近3章完全没有任何支线推进→warning";
    }
    if (id === 25) {
      note = "对照 emotional_arcs 和 chapter_summaries：如果主要角色连续3章情绪状态无变化（没有新的压力、释放、转变）→warning。注意区分'角色处境未变'和'角色内心未变'";
    }
    if (id === 26) {
      note = "对照 chapter_summaries 的章节类型分布：连续≥3章相同类型（如连续3个事件章/战斗章/布局章）→warning。≥5章没有出现回收章或高潮章→warning。请明确列出最近章节的类型序列";
    }
    if (id === 28) {
      note = "检查番外事件是否与正典约束表矛盾";
    }
    if (id === 29) {
      note = "检查角色是否引用了分歧点之后才揭示的信息（参照信息边界表）";
    }
    if (id === 30) {
      note = "检查番外是否违反正传世界规则（力量体系、地理、阵营）";
    }
    if (id === 31) {
      note = "检查番外是否越权回收正传伏笔（warning级别）";
    }
    if (id === 32) {
      note = "检查：章尾是否有钩子？最近3-5章内是否有爽点落地？是否存在超过3章的情绪压制无释放？读者的情绪缺口是否在积累或被满足？";
    }
    if (id === 33) {
      note = "对照 volume_outline：本章内容是否对应卷纲中当前章节范围的剧情节点？是否跳过了节点或提前消耗了后续节点？剧情推进速度是否与卷纲规划的章节跨度匹配？如果卷纲规划某段剧情跨N章但实际1-2章就讲完→critical";
    }
    // Fanfic dimension notes — severity depends on mode
    if (id === 34) {
      const mode = bookRules?.fanficMode ?? "canon";
      const severity = mode === "ooc" ? "info（OOC模式允许偏离）" : "critical";
      note = `对照 fanfic_canon.md 角色档案：角色行为/语气/动机是否符合原作设定。严重度：${severity}`;
    }
    if (id === 35) {
      const mode = bookRules?.fanficMode ?? "canon";
      const severity = mode === "au" ? "warning（AU模式允许世界观偏离）" : "critical";
      note = `对照 fanfic_canon.md 世界规则：魔法体系/科技水平/社会结构是否符合原作。严重度：${severity}`;
    }
    if (id === 36) {
      const mode = bookRules?.fanficMode ?? "canon";
      const severity = mode === "cp" ? "critical（CP模式重点审查）" : "warning";
      note = `对照 fanfic_canon.md 关系表：角色间关系变化是否有合理铺垫。严重度：${severity}`;
    }
    if (id === 37) {
      const mode = bookRules?.fanficMode ?? "canon";
      const severity = mode === "au" ? "info（AU模式允许偏离）"
        : mode === "canon" ? "critical" : "warning";
      note = `对照 fanfic_canon.md 事件时间线：是否与原作已发生事件矛盾。严重度：${severity}`;
    }

    dims.push({ id, name, note });
  }

  return dims;
}

export class ContinuityAuditor extends BaseAgent {
  get name(): string {
    return "continuity-auditor";
  }

  async auditChapter(
    bookDir: string,
    chapterContent: string,
    chapterNumber: number,
    genre?: string,
    options?: { temperature?: number; storyFiles?: StoryFiles },
  ): Promise<AuditResult> {
    const sf = options?.storyFiles ?? await readAllStoryFiles(join(bookDir, "story"));
    const currentState = sf.currentState;
    const ledger = sf.particleLedger;
    const hooks = sf.pendingHooks;
    const styleGuideRaw = sf.styleGuide;
    const subplotBoard = sf.subplotBoard;
    const emotionalArcs = sf.emotionalArcs;
    const characterMatrix = sf.characterMatrix;
    const chapterSummaries = sf.chapterSummaries;
    const parentCanon = sf.parentCanon;
    const volumeOutline = sf.volumeOutline;
    const fanficCanon = sf.fanficCanon;

    const hasParentCanon = parentCanon !== "(文件不存在)";

    // Load last chapter full text for fine-grained continuity checking
    const previousChapter = await this.loadPreviousChapter(bookDir, chapterNumber);

    // Load genre profile and book rules
    const genreId = genre ?? "other";
    const { profile: gp } = await readGenreProfile(this.ctx.projectRoot, genreId);
    const parsedRules = await readBookRules(bookDir);
    const bookRules = parsedRules?.rules ?? null;

    // Fallback: use book_rules body when style_guide.md doesn't exist
    const styleGuide = styleGuideRaw !== "(文件不存在)"
      ? styleGuideRaw
      : (parsedRules?.body ?? "(无文风指南)");

    const dimensions = buildDimensionList(gp, bookRules, hasParentCanon);
    const dimList = dimensions
      .map((d) => `${d.id}. ${d.name}${d.note ? `（${d.note}）` : ""}`)
      .join("\n");

    const protagonistBlock = bookRules?.protagonist
      ? `\n主角人设锁定：${bookRules.protagonist.name}，${bookRules.protagonist.personalityLock.join("、")}，行为约束：${bookRules.protagonist.behavioralConstraints.join("、")}`
      : "";

    const searchNote = gp.eraResearch
      ? "\n\n你有联网搜索能力（search_web / fetch_url）。对于涉及真实年代、人物、事件、地理、政策的内容，你必须用search_web核实，不可凭记忆判断。至少对比2个来源交叉验证。"
      : "";

    const systemPrompt = `你是一位严格的${gp.name}网络小说审稿编辑。你的任务是对章节进行连续性、一致性和质量审查。${protagonistBlock}${searchNote}

审查维度：
${dimList}

输出格式必须为 JSON：
{
  "passed": true/false,
  "issues": [
    {
      "severity": "critical|warning|info",
      "category": "审查维度名称",
      "description": "具体问题描述",
      "suggestion": "修改建议"
    }
  ],
  "summary": "一句话总结审查结论"
}

只有当存在 critical 级别问题时，passed 才为 false。`;

    const ledgerBlock = gp.numericalSystem
      ? `\n## 资源账本\n${ledger}`
      : "";

    const subplotBlock = subplotBoard !== "(文件不存在)"
      ? `\n## 支线进度板\n${subplotBoard}\n`
      : "";
    const emotionalBlock = emotionalArcs !== "(文件不存在)"
      ? `\n## 情感弧线\n${emotionalArcs}\n`
      : "";
    const matrixBlock = characterMatrix !== "(文件不存在)"
      ? `\n## 角色交互矩阵\n${characterMatrix}\n`
      : "";
    const summariesBlock = chapterSummaries !== "(文件不存在)"
      ? `\n## 章节摘要（用于节奏检查）\n${chapterSummaries}\n`
      : "";

    const canonBlock = hasParentCanon
      ? `\n## 正传正典参照（番外审查专用）\n${parentCanon}\n`
      : "";

    const hasFanficCanon = fanficCanon !== "(文件不存在)";
    const fanficCanonBlock = hasFanficCanon
      ? `\n## 同人正典参照（同人审查专用）\n${fanficCanon}\n`
      : "";

    const outlineBlock = volumeOutline !== "(文件不存在)"
      ? `\n## 卷纲（用于大纲偏离检测）\n${volumeOutline}\n`
      : "";

    const prevChapterBlock = previousChapter
      ? `\n## 上一章全文（用于衔接检查）\n${previousChapter}\n`
      : "";

    const userPrompt = `请审查第${chapterNumber}章。

## 当前状态卡
${currentState}
${ledgerBlock}
## 伏笔池
${hooks}
${subplotBlock}${emotionalBlock}${matrixBlock}${summariesBlock}${canonBlock}${fanficCanonBlock}${outlineBlock}${prevChapterBlock}
## 文风指南
${styleGuide}

## 待审章节内容
${chapterContent}`;

    const chatMessages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userPrompt },
    ];
    const chatOptions = { temperature: options?.temperature ?? 0.3, maxTokens: 8192 };

    // Use web search for fact verification when eraResearch is enabled
    const response = gp.eraResearch
      ? await this.chatWithSearch(chatMessages, chatOptions)
      : await this.chat(chatMessages, chatOptions);

    const result = this.parseAuditResult(response.content);
    return { ...result, tokenUsage: response.usage };
  }

  /**
   * Auditoría Tier-2: solo dimensiones núcleo + contexto reducido.
   * Diseñado para ser rápido y barato. Si pasa, se omite Tier-3.
   */
  async auditChapterLight(
    bookDir: string,
    chapterContent: string,
    chapterNumber: number,
    genre?: string,
    options?: { temperature?: number; storyFiles?: StoryFiles },
  ): Promise<AuditResult> {
    const sf = options?.storyFiles ?? await readAllStoryFiles(join(bookDir, "story"));

    // Contexto reducido: solo lo esencial para las dimensiones núcleo
    const currentState = sf.currentState;
    const hooks = sf.pendingHooks;
    const volumeOutline = sf.volumeOutline;
    const ledger = sf.particleLedger;

    const previousChapter = await this.loadPreviousChapter(bookDir, chapterNumber);

    const genreId = genre ?? "other";
    const { profile: gp } = await readGenreProfile(this.ctx.projectRoot, genreId);
    const parsedRules = await readBookRules(bookDir);
    const bookRules = parsedRules?.rules ?? null;

    // Construir solo las dimensiones Tier-2 activas para este género
    const fullDims = buildDimensionList(gp, bookRules, false);
    const tier2Set = new Set(TIER2_DIMENSION_IDS);
    const lightDims = fullDims.filter((d) => tier2Set.has(d.id));

    const dimList = lightDims
      .map((d) => `${d.id}. ${d.name}${d.note ? `（${d.note}）` : ""}`)
      .join("\n");

    const protagonistBlock = bookRules?.protagonist
      ? `\n主角人设锁定：${bookRules.protagonist.name}，${bookRules.protagonist.personalityLock.join("、")}`
      : "";

    const systemPrompt = `你是一位${gp.name}网络小说审稿编辑。请对章节进行快速审查，只关注核心叙事一致性问题。${protagonistBlock}

审查维度：
${dimList}

输出格式必须为 JSON：
{
  "passed": true/false,
  "issues": [
    {
      "severity": "critical|warning|info",
      "category": "审查维度名称",
      "description": "具体问题描述",
      "suggestion": "修改建议"
    }
  ],
  "summary": "一句话总结审查结论"
}

只有当存在 critical 级别问题时，passed 才为 false。`;

    const ledgerBlock = gp.numericalSystem
      ? `\n## 资源账本\n${ledger}`
      : "";

    const outlineBlock = volumeOutline !== "(文件不存在)"
      ? `\n## 卷纲\n${volumeOutline}\n`
      : "";

    const prevChapterBlock = previousChapter
      ? `\n## 上一章全文\n${previousChapter}\n`
      : "";

    const userPrompt = `请快速审查第${chapterNumber}章。

## 当前状态卡
${currentState}
${ledgerBlock}
## 伏笔池
${hooks}
${outlineBlock}${prevChapterBlock}
## 待审章节内容
${chapterContent}`;

    const chatMessages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userPrompt },
    ];
    const chatOptions = { temperature: options?.temperature ?? 0.3, maxTokens: 4096 };

    const response = await this.chat(chatMessages, chatOptions);
    const result = this.parseAuditResult(response.content);
    return { ...result, tokenUsage: response.usage };
  }

  private parseAuditResult(content: string): AuditResult {
    // Strategy 1: Find balanced JSON object (not greedy)
    const balanced = this.extractBalancedJson(content);
    if (balanced) {
      const result = this.tryParseAuditJson(balanced);
      if (result) return result;
    }

    // Strategy 2: Try the whole content as JSON (some models output pure JSON)
    const trimmed = content.trim();
    if (trimmed.startsWith("{")) {
      const result = this.tryParseAuditJson(trimmed);
      if (result) return result;
    }

    // Strategy 3: Look for ```json code blocks
    const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      const result = this.tryParseAuditJson(codeBlockMatch[1]!.trim());
      if (result) return result;
    }

    // Strategy 4: Try to extract individual fields via regex (last resort fallback)
    const passedMatch = content.match(/"passed"\s*:\s*(true|false)/);
    const issuesMatch = content.match(/"issues"\s*:\s*\[([\s\S]*?)\]/);
    const summaryMatch = content.match(/"summary"\s*:\s*"([^"]*)"/);
    if (passedMatch) {
      const issues: AuditIssue[] = [];
      if (issuesMatch) {
        // Try to parse individual issue objects
        const issuePattern = /\{[^{}]*"severity"\s*:\s*"[^"]*"[^{}]*\}/g;
        let match: RegExpExecArray | null;
        while ((match = issuePattern.exec(issuesMatch[1]!)) !== null) {
          try {
            const issue = JSON.parse(match[0]);
            issues.push({
              severity: issue.severity ?? "warning",
              category: issue.category ?? "未分类",
              description: issue.description ?? "",
              suggestion: issue.suggestion ?? "",
            });
          } catch {
            // skip malformed individual issue
          }
        }
      }
      return {
        passed: passedMatch[1] === "true",
        issues,
        summary: summaryMatch?.[1] ?? "",
      };
    }

    return {
      passed: false,
      issues: [{
        severity: "critical",
        category: "系统错误",
        description: "审稿输出格式异常，无法解析为 JSON",
        suggestion: "可能是模型不支持结构化输出。尝试换一个更大的模型，或检查 API 返回格式。",
      }],
      summary: "审稿输出解析失败",
    };
  }

  private extractBalancedJson(text: string): string | null {
    const start = text.indexOf("{");
    if (start === -1) return null;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      if (text[i] === "}") depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
    return null;
  }

  private tryParseAuditJson(json: string): AuditResult | null {
    try {
      const parsed = JSON.parse(json);
      if (typeof parsed.passed !== "boolean" && parsed.passed !== undefined) return null;
      return {
        passed: Boolean(parsed.passed ?? false),
        issues: Array.isArray(parsed.issues)
          ? parsed.issues.map((i: Record<string, unknown>) => ({
              severity: (i.severity as string) ?? "warning",
              category: (i.category as string) ?? "未分类",
              description: (i.description as string) ?? "",
              suggestion: (i.suggestion as string) ?? "",
            }))
          : [],
        summary: String(parsed.summary ?? ""),
      };
    } catch {
      return null;
    }
  }

  private async loadPreviousChapter(bookDir: string, currentChapter: number): Promise<string> {
    if (currentChapter <= 1) return "";
    const chaptersDir = join(bookDir, "chapters");
    try {
      const files = await readdir(chaptersDir);
      const paddedPrev = String(currentChapter - 1).padStart(4, "0");
      const prevFile = files.find((f) => f.startsWith(paddedPrev) && f.endsWith(".md"));
      if (!prevFile) return "";
      return await readFile(join(chaptersDir, prevFile), "utf-8");
    } catch {
      return "";
    }
  }
}
