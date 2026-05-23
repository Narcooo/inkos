/**
 * AI 味去除 Agent — 识别并去除中文写作中的 AI 痕迹
 * 基于 qu-ai-wei skill 的核心逻辑，集成到 inkos 项目
 */

import { BaseAgent } from "./base.js";
import type { GenreProfile } from "../models/genre-profile.js";

export interface RemoveAITasteInput {
  readonly content: string;
  readonly targetStyle?: "conservative" | "aggressive";
  readonly register?: "social" | "content" | "business" | "written" | "academic";
  readonly language?: "zh" | "en";
  readonly temperature?: number;
}

export interface RemoveAITasteOutput {
  readonly revisedContent: string;
  readonly gateCheckResult: GateCheckResult;
  readonly registerDetected: RegisterType;
  readonly patternsFound: AIPattern[];
  readonly polishReport: PolishReport;
  readonly tokenUsage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

export type RegisterType = 
  | "social"        // 社交/口语
  | "content"       // 内容/自媒体
  | "business"      // 商务/职场
  | "written"       // 书面/一般
  | "narrative"     // 叙事非虚构/特稿
  | "brand"         // 品牌广告/文案
  | "academic"      // 学术/科技
  | "legal"         // 公文/法律
  | "exam";         // 高考/应试作文

export type GateCheckResult = 
  | { type: "human"; evidence: string[]; action: "stop" }
  | { type: "ai"; evidence: string[]; action: "continue" }
  | { type: "uncertain"; evidence: string[]; action: "ask" };

export interface AIPattern {
  readonly category: string;
  readonly pattern: string;
  readonly severity: "high" | "medium" | "low";
  readonly example?: string;
}

export interface PolishReport {
  readonly verbStrengthen: "none" | "some" | "many";
  readonly rhythmReshaping: "none" | "some" | "many";
  readonly fillerRemoval: string[];
  readonly abstractionToConcrete: "none" | "some" | "many";
  readonly wordOrderFix: "none" | "some" | "many";
  readonly registerMatch: RegisterType;
}

const REGISTER_DESCRIPTIONS: Record<RegisterType, string> = {
  social: "社交/口语（微信聊天、朋友圈、微博）",
  content: "内容/自媒体（公众号、小红书、短视频文案）",
  business: "商务/职场（工作邮件、汇报、产品文案）",
  written: "书面/一般（博客、时评、报刊随笔）",
  narrative: "叙事非虚构/特稿（《人物》《三联》深度报道）",
  brand: "品牌广告/文案（品牌 slogan、campaign、发布会大字）",
  academic: "学术/科技（论文、技术报告、白皮书）",
  legal: "公文/法律（法规、合同、政府公报）",
  exam: "高考/应试作文（规范书面语、评分标准导向）",
};

const COMMON_REGISTERS: RegisterType[] = ["social", "content", "business", "written", "academic"];

export class AITasteRemoverAgent extends BaseAgent {
  get name(): string {
    return "ai-taste-remover";
  }

  async removeAITaste(input: RemoveAITasteInput): Promise<RemoveAITasteOutput> {
    const language = input.language ?? "zh";
    const isEnglish = language === "en";
    const targetStyle = input.targetStyle ?? "conservative";
    const registerHint = input.register;

    this.log?.info(`[AITasteRemover] 开始处理`);
    this.log?.info(`  - 语言：${language}`);
    this.log?.info(`  - 风格：${targetStyle}`);
    this.log?.info(`  - 语体提示：${registerHint ?? "自动检测"}`);
    this.log?.info(`  - 内容长度：${input.content.length} 字符`);

    if (isEnglish) {
      this.log?.error("不支持英文文本处理");
      throw new Error("This agent only supports Simplified Chinese. English humanization is out of scope.");
    }

    // Step -1: Gate check - is this human-written?
    this.log?.info(`[AITasteRemover] Step -1: 执行门检...`);
    const gateCheckResult = await this.performGateCheck(input.content);
    this.log?.info(`  - 门检结果：${gateCheckResult.type}`);
    this.log?.info(`  - 门检行动：${gateCheckResult.action}`);
    this.log?.info(`  - 证据数量：${gateCheckResult.evidence.length} 条`);
    
    if (gateCheckResult.type === "human") {
      this.log?.info(`  ⚠ 检测到真人写作痕迹，跳过修改`);
      return {
        revisedContent: input.content,
        gateCheckResult,
        registerDetected: "written",
        patternsFound: [],
        polishReport: {
          verbStrengthen: "none",
          rhythmReshaping: "none",
          fillerRemoval: [],
          abstractionToConcrete: "none",
          wordOrderFix: "none",
          registerMatch: "written",
        },
      };
    }

    // Step 0: Register detection
    this.log?.info(`[AITasteRemover] Step 0: 语体识别...`);
    const registerDetected = registerHint ?? await this.detectRegister(input.content);
    this.log?.info(`  - 检测到语体：${registerDetected}`);
    if (registerHint) {
      this.log?.info(`  - 使用用户指定的语体：${registerHint}`);
    }
    
    // Step 1-3: Remove AI patterns with register-aware rules
    this.log?.info(`[AITasteRemover] Step 1-3: 构建提示词并调用 LLM...`);
    const systemPrompt = this.buildSystemPrompt(registerDetected, targetStyle);
    const userPrompt = this.buildUserPrompt(input.content, gateCheckResult);
    
    this.log?.info(`  - System Prompt 长度：${systemPrompt.length} 字符`);
    this.log?.info(`  - User Prompt 长度：${userPrompt.length} 字符`);
    this.log?.info(`  - 调用 LLM (${this.ctx.model})...`);

    const response = await this.chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { temperature: input.temperature ?? 0.3 },
    );

    this.log?.info(`  ✓ LLM 响应成功`);
    this.log?.info(`  - 响应长度：${response.content.length} 字符`);

    // Parse output
    this.log?.info(`[AITasteRemover] 解析输出...`);
    const output = this.parseOutput(response.content, input.content);
    
    this.log?.info(`[AITasteRemover] 处理完成`);
    this.log?.info(`  - 修改后长度：${output.revisedContent.length} 字符`);
    this.log?.info(`  - AI 模式数量：${output.patternsFound.length}`);

    return {
      ...output,
      gateCheckResult,
      registerDetected,
    };
  }

  private async performGateCheck(content: string): Promise<GateCheckResult> {
    this.log?.info(`[GateCheck] 开始门检分析...`);
    const humanSignals: string[] = [];
    
    // Signal 1: Self-correction / hesitation / filler
    this.log?.info(`  检测信号 1: 自纠/犹疑语气...`);
    const selfCorrectionPatterns = [
      /我忘了/g, /我猜啊/g, /不定/g, /三十秒还是一分钟/g,
      /说不上来/g, /反正/g, /听着就不正经/g,
    ];
    for (const pattern of selfCorrectionPatterns) {
      if (pattern.test(content)) {
        const match = content.match(pattern)?.[0];
        humanSignals.push(`自纠/犹疑语气：${match}`);
        this.log?.info(`    ✓ 发现：${match}`);
      }
    }
    
    // Signal 2: Strong dialect markers
    this.log?.info(`  检测信号 2: 地域词...`);
    const dialectPatterns = [
      { pattern: /[内外]地/g, name: "北京话（内/那）" },
      { pattern: /咋/g, name: "方言（咋）" },
      { pattern: /老大不乐意/g, name: "北京话" },
      { pattern: /侬/g, name: "上海话" },
      { pattern: /嘅 | 喺 | 啱 | 冇 | 睇/g, name: "粤语" },
      { pattern: /贼/g, name: "东北话" },
      { pattern: /哈 | 撒 | 安逸 | 巴适/g, name: "川渝话" },
    ];
    for (const { pattern, name } of dialectPatterns) {
      if (pattern.test(content)) {
        const match = content.match(pattern)?.[0];
        humanSignals.push(`地域词（${name}）：${match}`);
        this.log?.info(`    ✓ 发现 [${name}]: ${match}`);
      }
    }

    // Signal 3: Meta-irony / self-mockery
    this.log?.info(`  检测信号 3: meta-irony/自嘲...`);
    const metaIronyPatterns = [
      /用比较酸的话说/g, /我知道这话鸡汤/g, /装一把/g, /装一下/g,
      /用比较装的话说/g, /我知道听着像/g,
    ];
    for (const pattern of metaIronyPatterns) {
      if (pattern.test(content)) {
        const match = content.match(pattern)?.[0];
        humanSignals.push(`meta-irony：${match}`);
        this.log?.info(`    ✓ 发现：${match}`);
      }
    }

    // Signal 4: Specific details (names, numbers, quotes)
    this.log?.info(`  检测信号 4: 具体细节...`);
    const specificDetailPatterns = [
      /[""](.*?)[""]/g, // Quotes
      /\d+ (年 | 月|日|点 | 块|万)/g, // Specific numbers
      /那年我 \d+ 岁/g,
    ];
    for (const pattern of specificDetailPatterns) {
      const matches = content.match(pattern);
      if (matches && matches.length > 0) {
        humanSignals.push(`具体细节：${matches[0]}`);
        this.log?.info(`    ✓ 发现：${matches[0]}`);
      }
    }

    // Signal 5: Known author voices (simplified check)
    this.log?.info(`  检测信号 5: 作家声口...`);
    const authorVoices = [
      { pattern: /之仇 | 之色 | \.\.\.罢/g, name: "金庸/文言色彩" },
      { pattern: /简断截说 | 二次搬运 | 面基/g, name: "王朔/京味白话" },
      { pattern: /短句密集 | 具体名词驱动/g, name: "汪曾祺/阿城" },
    ];
    for (const { pattern, name } of authorVoices) {
      if (pattern.test(content)) {
        humanSignals.push(`作家声口（${name}）`);
        this.log?.info(`    ✓ 发现：${name}`);
      }
    }

    this.log?.info(`  真人信号总数：${humanSignals.length}`);

    // AI signals (for comparison)
    this.log?.info(`  检测 AI 信号...`);
    const aiSignals: string[] = [];
    const aiPatterns = [
      { pattern: /随着.*的不断发展/g, name: "时代背景套路" },
      { pattern: /赋能 | 助力 | 打造 | 闭环 | 抓手/g, name: "商务黑话" },
      { pattern: /具有重要意义 | 里程碑 | 谱写新篇章/g, name: "过度拔高" },
      { pattern: /值得一提的是 | 不可否认 | 毋庸置疑/g, name: "空洞强调" },
      { pattern: /不仅.*更.*| 不是.*而是/g, name: "公式化并列" },
      { pattern: /赋能 | 助力 | 护航 | 抓手/g, name: "AI 高频词" },
      { pattern: /璀璨 | 熠熠生辉 | 画卷 | 华章/g, name: "华丽意象堆砌" },
      { pattern: /——/g, name: "破折号高密度" },
    ];
    
    for (const { pattern, name } of aiPatterns) {
      if (pattern.test(content)) {
        aiSignals.push(name);
        this.log?.info(`    ✓ AI 信号：${name}`);
      }
    }
    
    this.log?.info(`  AI 信号总数：${aiSignals.length}`);

    // Decision logic
    let decision: GateCheckResult;
    if (humanSignals.length >= 2) {
      this.log?.info(`  决策：真人写作 (信号≥2)`);
      decision = {
        type: "human",
        evidence: humanSignals.slice(0, 2),
        action: "stop",
      };
    } else if (aiSignals.length >= 3 && humanSignals.length === 0) {
      this.log?.info(`  决策：AI 生成 (AI 信号≥3 且无真人信号)`);
      decision = {
        type: "ai",
        evidence: aiSignals.slice(0, 3).map(s => `AI 腔信号：${s}`),
        action: "continue",
      };
    } else {
      this.log?.info(`  决策：不确定 (使用保守策略)`);
      decision = {
        type: "uncertain",
        evidence: [
          ...(humanSignals.length > 0 ? [humanSignals[0]] : []),
          ...(aiSignals.length > 0 ? [aiSignals[0]] : ["无明显 AI 腔"]),
        ],
        action: "continue",
      };
    }

    this.log?.info(`[GateCheck] 门检完成`);
    return decision;
  }

  private async detectRegister(content: string): Promise<RegisterType> {
    // Simplified register detection based on keyword density and sentence patterns
    const contentLower = content.toLowerCase();
    
    // Count signals for each register
    const signals: Record<RegisterType, number> = {
      social: 0,
      content: 0,
      business: 0,
      written: 0,
      narrative: 0,
      brand: 0,
      academic: 0,
      legal: 0,
      exam: 0,
    };

    // Social signals
    if (/[😂🔥💯]/.test(content)) signals.social += 2;
    if (/家人们 | 谁懂啊 | 姐妹们 | 绝绝子/.test(content)) signals.social += 3;
    if (content.split("\n").every(line => line.length < 30)) signals.social += 1;

    // Content/自媒体 signals
    if (/点赞 | 收藏 | 关注 | 评论区 | 建议收藏/.test(content)) signals.content += 3;
    if (/🆘|🌟|📍|⏰|✅/.test(content)) signals.content += 2;
    if (/痛点 | 方法 | 升华 | 干货/.test(content)) signals.content += 2;

    // Business signals
    if (/赋能 | 抓手 | 闭环 | 底层逻辑 | 对齐 | 复盘/.test(content)) signals.business += 3;
    if (/汇报 | 邮件 | 产品 | 用户/.test(content)) signals.business += 1;

    // Academic signals
    if (/本文 | 研究 | 分析 | 实验 | 数据 | 表明/.test(content)) signals.academic += 2;
    if (/[A-Z][a-z]+ \([A-Z][a-z]+, \d{4}\)/.test(content)) signals.academic += 3; // Citation
    if (/术语密度/.test(content) || /[a-z]+/.test(content)) {
      const englishWords = content.match(/[a-zA-Z]+/g) || [];
      if (englishWords.length >= 3) signals.academic += 2;
    }

    // Legal/公文 signals
    if (/依照 | 兹就 | 特此 | 予以 | 依照法律法规/.test(content)) signals.legal += 3;

    // Brand 广告 signals
    if (content.split("\n").every(line => line.length <= 10) && content.length < 200) {
      signals.brand += 2;
    }
    if (/上 | 冲 | 敢 | 为何不 | 岂止/.test(content)) signals.brand += 2;

    // Written (default)
    signals.written = Math.max(0, 5 - Object.values(signals).reduce((a, b) => a + b, 0));

    // Find max
    let maxScore = 0;
    let maxRegister: RegisterType = "written";
    for (const [register, score] of Object.entries(signals)) {
      if (score > maxScore) {
        maxScore = score;
        maxRegister = register as RegisterType;
      }
    }

    return maxRegister;
  }

  private buildSystemPrompt(register: RegisterType, style: "conservative" | "aggressive"): string {
    const registerDesc = REGISTER_DESCRIPTIONS[register];
    const activePatterns = this.getActivePatterns(register, style);
    
    return `你是一位专业的简体中文编辑，任务是去除 AI 写作痕迹，让文字读起来自然、像真人写的。

## 当前语体
${registerDesc}

## 核心原则

1. **先诊断，后动手** - 不通读全文理解问题根因，不要修改
2. **保守编辑** - 句子没坏就不要"优化"它，不必要的改动会引入新问题
3. **保持原味** - 保留原文的语气、节奏和角色声音，不要同质化或过度打磨
4. **不发明事实** - 终稿里的具体数字/事件/人物/引用，原文都得有依据
5. **保留毛边** - 至少保留一处真人的痕迹（主观判断/具体感受/圈层语境）

## 激活的 AI 腔检测规则（共${activePatterns.length}条）

${activePatterns.map((p, i) => `${i + 1}. ${p.category} - ${p.pattern}`).join("\n")}

## 修改优先级

- **Critical（必须改）** - 明显的 AI 高频词、客服腔、格式幻觉
- **High（应该改）** - 公式化表达、翻译腔、节奏均质化
- **Medium（可选）** - 根据语体判断，可能不改

## 输出格式

直接返回修改后的完整文本，不要 JSON、不要解释。如果判断为真人文本，返回原文并说明"检测到真人写作痕迹，不做修改"。`;
  }

  private getActivePatterns(register: RegisterType, style: "conservative" | "aggressive"): AIPattern[] {
    const allPatterns: AIPattern[] = [
      { category: "内容拔高", pattern: "过度拔高意义（具有重要意义/里程碑/谱写新篇章）", severity: "high" },
      { category: "内容拔高", pattern: "空洞强调（值得一提的是/不可否认/毋庸置疑）", severity: "high" },
      { category: "内容拔高", pattern: "时代背景套路（随着...的不断发展）", severity: "high" },
      { category: "内容拔高", pattern: "模糊权威归因（专家表示/业内人士认为）", severity: "medium" },
      { category: "语言模式", pattern: "AI 高频词（赋能/助力/打造/闭环/抓手）", severity: "high" },
      { category: "语言模式", pattern: "华丽意象堆砌（璀璨/熠熠生辉/画卷）", severity: "high" },
      { category: "语言模式", pattern: "的的不休（短句连用≥3 个'的'）", severity: "medium" },
      { category: "语言模式", pattern: "滥用'进行+V'（进行讨论/开展工作）", severity: "medium" },
      { category: "语言模式", pattern: "破折号高密度（不承担功能的——）", severity: "medium" },
      { category: "修辞模式", pattern: "四字成语机械堆叠", severity: "medium" },
      { category: "修辞模式", pattern: "排比段硬套（首先/其次/最后）", severity: "medium" },
      { category: "修辞模式", pattern: "总 - 分-总僵化结构", severity: "low" },
      { category: "交流模式", pattern: "客服腔（希望对您有帮助/如有疑问请告诉我）", severity: "high" },
      { category: "交流模式", pattern: "过度迎合（您问得非常好/完全正确）", severity: "high" },
      { category: "交流模式", pattern: "AI 免责声明（截至我的知识更新日期）", severity: "high" },
      { category: "交流模式", pattern: "空洞积极结尾（未来可期/光明前景）", severity: "high" },
      { category: "填充模糊", pattern: "冗余书面化短语（通过...的方式/在...的情况下）", severity: "medium" },
      { category: "填充模糊", pattern: "过度模糊限定（在一定程度上/某种意义上）", severity: "medium" },
      { category: "翻译腔", pattern: "翻译腔残留（英文句法直译）", severity: "medium" },
      { category: "翻译腔", pattern: "有中文译法却留英文（argument/logic 等）", severity: "low" },
      { category: "篇章节奏", pattern: "句长均质化（机关枪段）", severity: "medium" },
      { category: "篇章节奏", pattern: "指代不敢省（专名重复）", severity: "low" },
      { category: "幻觉格式", pattern: "Markdown 格式残留", severity: "high" },
      { category: "幻觉格式", pattern: "编造引用/AI 源 URL", severity: "high" },
    ];

    // Filter by register
    const registerFilters: Partial<Record<RegisterType, string[]>> = {
      academic: ["AI 高频词", "的的不休", "进行+V", "破折号", "四字成语", "客服腔"],
      legal: ["客服腔", "Markdown 残留", "编造引用"],
      brand: ["AI 高频词", "客服腔", "过度迎合", "AI 免责声明", "空洞积极结尾"],
      exam: ["客服腔", "Markdown 残留", "编造引用"],
    };

    const filter = registerFilters[register] || [];
    
    if (style === "conservative") {
      return allPatterns.filter(p => 
        filter.length === 0 || filter.some(f => p.pattern.includes(f))
      );
    }

    return allPatterns;
  }

  private buildUserPrompt(content: string, gateCheck: GateCheckResult): string {
    return `请去除以下文本的 AI 写作痕迹：

${gateCheck.type === "ai" ? `## AI 腔检测证据\n${gateCheck.evidence.join("\n")}\n` : ""}
## 待修改文本
${content}`;
  }

  private parseOutput(response: string, originalContent: string): Omit<RemoveAITasteOutput, "gateCheckResult" | "registerDetected"> {
    const revisedContent = response.trim();
    
    // Simple pattern detection for report
    const patternsFound: AIPattern[] = [];
    const aiPatterns = [
      { pattern: /赋能 | 助力 | 打造 | 闭环/g, category: "语言模式", name: "AI 高频词" },
      { pattern: /随着.*发展/g, category: "内容拔高", name: "时代背景套路" },
      { pattern: /不仅.*更/g, category: "语言模式", name: "公式化并列" },
      { pattern: /——/g, category: "修辞模式", name: "破折号" },
    ];
    
    for (const { pattern, category, name } of aiPatterns) {
      if (pattern.test(originalContent)) {
        patternsFound.push({
          category,
          pattern: name,
          severity: "medium",
        });
      }
    }

    // Generate polish report
    const polishReport: PolishReport = {
      verbStrengthen: revisedContent !== originalContent ? "some" : "none",
      rhythmReshaping: revisedContent !== originalContent ? "some" : "none",
      fillerRemoval: [],
      abstractionToConcrete: "none",
      wordOrderFix: "none",
      registerMatch: "written",
    };

    return {
      revisedContent,
      patternsFound,
      polishReport,
    };
  }
}
