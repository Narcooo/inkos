/**
 * Post-write rule-based validator.
 *
 * Deterministic, zero-LLM-cost checks that run after every chapter generation.
 * Catches violations that prompt-only rules cannot guarantee.
 * Supports both Chinese and English language modes.
 */

import type { BookRules } from "../models/book-rules.js";
import type { GenreProfile } from "../models/genre-profile.js";

export interface PostWriteViolation {
  readonly rule: string;
  readonly severity: "error" | "warning";
  readonly description: string;
  readonly suggestion: string;
}

// ---------------------------------------------------------------------------
// Chinese marker word lists
// ---------------------------------------------------------------------------

/** AI转折/惊讶标记词 */
const ZH_SURPRISE_MARKERS = ["仿佛", "忽然", "竟然", "猛地", "猛然", "不禁", "宛如"];

/** 元叙事/编剧旁白模式 */
const ZH_META_NARRATION_PATTERNS = [
  /到这里[，,]?算是/,
  /接下来[，,]?(?:就是|将会|即将)/,
  /(?:后面|之后)[，,]?(?:会|将|还会)/,
  /(?:故事|剧情)(?:发展)?到了/,
  /读者[，,]?(?:可能|应该|也许)/,
  /我们[，,]?(?:可以|不妨|来看)/,
];

/** 分析报告式术语（禁止出现在正文中） */
const ZH_REPORT_TERMS = [
  "核心动机", "信息边界", "信息落差", "核心风险", "利益最大化",
  "当前处境", "行为约束", "性格过滤", "情绪外化", "锚定效应",
  "沉没成本", "认知共鸣",
];

/** 作者说教词 */
const ZH_SERMON_WORDS = ["显然", "毋庸置疑", "不言而喻", "众所周知", "不难看出"];

/** 全场震惊类集体反应 */
const ZH_COLLECTIVE_SHOCK_PATTERNS = [
  /(?:全场|众人|所有人|在场的人)[，,]?(?:都|全|齐齐|纷纷)?(?:震惊|惊呆|倒吸凉气|目瞪口呆|哗然|惊呼)/,
  /(?:全场|一片)[，,]?(?:寂静|哗然|沸腾|震动)/,
];

// ---------------------------------------------------------------------------
// English marker word lists
// ---------------------------------------------------------------------------

/** Common AI filler / purple prose markers */
const EN_FILLER_MARKERS = [
  "couldn't help but", "a sense of", "it was as if",
  "a wave of", "a surge of", "a flicker of",
  "in that moment", "at this moment", "needless to say",
];

/** English meta-narration patterns */
const EN_META_NARRATION_PATTERNS = [
  /\b(?:the reader|readers?)\s+(?:might|may|should|would|will)\b/i,
  /\b(?:our|the)\s+(?:story|narrative|tale)\s+(?:continues|moves|shifts|turns)\b/i,
  /\b(?:as we|let us|let's)\s+(?:see|look|turn|move)\b/i,
  /\b(?:little did|unbeknownst to)\b/i,
];

/** English report/analytical terms forbidden in prose */
const EN_REPORT_TERMS = [
  "core motivation", "information boundary", "information gap",
  "behavioral constraint", "personality filter", "emotional externalization",
  "anchoring effect", "sunk cost", "cognitive resonance",
  "character arc", "narrative tension", "plot device",
  "thematic resonance", "dramatic irony",
];

/** English sermon / telling-not-showing words */
const EN_SERMON_WORDS = [
  "obviously", "needless to say", "it goes without saying",
  "clearly", "undoubtedly", "without a doubt",
];

/** English collective shock clichés */
const EN_COLLECTIVE_SHOCK_PATTERNS = [
  /\beveryone\s+(?:in the room\s+)?(?:gasped|froze|stared|went silent|held their breath)\b/i,
  /\bthe (?:entire|whole)\s+(?:room|crowd|audience|group)\s+(?:fell silent|gasped|erupted|froze)\b/i,
  /\bjaws?\s+dropped\b/i,
];

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export function validatePostWrite(
  content: string,
  genreProfile: GenreProfile,
  bookRules: BookRules | null,
  language?: string,
): ReadonlyArray<PostWriteViolation> {
  const lang = language ?? genreProfile.language ?? "zh";

  if (lang === "en") {
    return validateEnglish(content, genreProfile, bookRules);
  }
  return validateChinese(content, genreProfile, bookRules);
}

// ---------------------------------------------------------------------------
// Chinese validator
// ---------------------------------------------------------------------------

function validateChinese(
  content: string,
  genreProfile: GenreProfile,
  bookRules: BookRules | null,
): PostWriteViolation[] {
  const violations: PostWriteViolation[] = [];

  // 1. 硬性禁令: "不是…而是…" 句式
  if (/不是[^，。！？\n]{0,30}[，,]?\s*而是/.test(content)) {
    violations.push({
      rule: "禁止句式",
      severity: "error",
      description: "出现了「不是……而是……」句式",
      suggestion: "改用直述句",
    });
  }

  // 2. 硬性禁令: 破折号
  if (content.includes("——")) {
    violations.push({
      rule: "禁止破折号",
      severity: "error",
      description: "出现了破折号「——」",
      suggestion: "用逗号或句号断句",
    });
  }

  // 3. 转折/惊讶标记词密度 ≤ 1次/3000字
  checkMarkerDensity(violations, content, ZH_SURPRISE_MARKERS, 3000, "转折词密度",
    "转折/惊讶标记词", "改用具体动作或感官描写传递突然性");

  // 4. 高疲劳词检查
  checkFatigueWords(violations, content, genreProfile, bookRules, "zh");

  // 5. 元叙事检查
  checkPatternList(violations, content, ZH_META_NARRATION_PATTERNS, "元叙事",
    "出现编剧旁白式表述", "删除元叙事，让剧情自然展开");

  // 6. 分析报告式术语
  checkTermList(violations, content, ZH_REPORT_TERMS, "报告术语", "error",
    "正文中出现分析报告术语", "这些术语只能用于 PRE_WRITE_CHECK 内部推理，正文中用口语化表达替代");

  // 7. 作者说教词
  checkTermList(violations, content, ZH_SERMON_WORDS, "作者说教", "warning",
    "出现说教词", "删除说教词，让读者自己从情节中判断");

  // 8. 全场震惊类集体反应
  checkPatternList(violations, content, ZH_COLLECTIVE_SHOCK_PATTERNS, "集体反应",
    "出现集体反应套话", "改写成1-2个具体角色的身体反应");

  // 9. 连续"了"字检查（6句以上连续含"了"）
  const zhSentences = content
    .split(/[。！？]/)
    .map(s => s.trim())
    .filter(s => s.length > 2);

  let consecutiveLe = 0;
  let maxConsecutiveLe = 0;
  for (const sentence of zhSentences) {
    if (sentence.includes("了")) {
      consecutiveLe++;
      maxConsecutiveLe = Math.max(maxConsecutiveLe, consecutiveLe);
    } else {
      consecutiveLe = 0;
    }
  }
  if (maxConsecutiveLe >= 6) {
    violations.push({
      rule: "连续了字",
      severity: "warning",
      description: `检测到${maxConsecutiveLe}句连续包含"了"字，节奏拖沓`,
      suggestion: "保留最有力的一个「了」，其余改为无「了」句式",
    });
  }

  // 10. 段落长度检查（手机阅读适配：50-250字/段为宜）
  checkParagraphLength(violations, content, 300, 2, "zh");

  // 11. Book-level prohibitions
  checkProhibitions(violations, content, bookRules, "zh");

  return violations;
}

// ---------------------------------------------------------------------------
// English validator
// ---------------------------------------------------------------------------

function validateEnglish(
  content: string,
  genreProfile: GenreProfile,
  bookRules: BookRules | null,
): PostWriteViolation[] {
  const violations: PostWriteViolation[] = [];

  // 1. AI filler phrase density ≤ 1 per 1000 words
  const wordCount = content.split(/\s+/).length;
  checkMarkerDensity(violations, content, EN_FILLER_MARKERS, 1000, "filler_density",
    "AI filler phrases", "Replace with specific action, sensation, or concrete detail",
    wordCount);

  // 2. Fatigue words (from genre profile)
  checkFatigueWords(violations, content, genreProfile, bookRules, "en");

  // 3. Meta-narration
  checkPatternList(violations, content, EN_META_NARRATION_PATTERNS, "meta_narration",
    "Meta-narration detected", "Remove narrator commentary; show through character action and dialogue");

  // 4. Report / analytical terms
  checkTermList(violations, content, EN_REPORT_TERMS, "report_terms", "error",
    "Analytical terms found in prose", "These terms belong in planning notes only; use natural language in prose");

  // 5. Author sermon / telling words
  checkTermList(violations, content, EN_SERMON_WORDS, "author_sermon", "warning",
    "Telling-not-showing words found", "Cut authorial commentary; let the reader draw conclusions from the scene");

  // 6. Collective shock clichés
  checkPatternList(violations, content, EN_COLLECTIVE_SHOCK_PATTERNS, "collective_shock",
    "Collective reaction cliché detected", "Show 1-2 individual characters' specific physical reactions instead");

  // 7. Consecutive sentence-start repetition (≥4 sentences starting with same word)
  const enSentences = content
    .split(/[.!?]/)
    .map(s => s.trim())
    .filter(s => s.length > 5);

  let consecutiveStart = 1;
  let maxConsecutiveStart = 1;
  for (let i = 1; i < enSentences.length; i++) {
    const prevFirst = enSentences[i - 1]!.split(/\s/)[0]?.toLowerCase();
    const currFirst = enSentences[i]!.split(/\s/)[0]?.toLowerCase();
    if (prevFirst && currFirst && prevFirst === currFirst) {
      consecutiveStart++;
      maxConsecutiveStart = Math.max(maxConsecutiveStart, consecutiveStart);
    } else {
      consecutiveStart = 1;
    }
  }
  if (maxConsecutiveStart >= 4) {
    violations.push({
      rule: "repetitive_starts",
      severity: "warning",
      description: `${maxConsecutiveStart} consecutive sentences start with the same word`,
      suggestion: "Vary sentence openings to improve rhythm and readability",
    });
  }

  // 8. Paragraph length check (>500 words per paragraph for EN)
  checkParagraphLength(violations, content, 2500, 2, "en");

  // 9. Book-level prohibitions
  checkProhibitions(violations, content, bookRules, "en");

  return violations;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function checkMarkerDensity(
  violations: PostWriteViolation[],
  content: string,
  markers: readonly string[],
  charsPerAllowed: number,
  rule: string,
  label: string,
  suggestion: string,
  lengthOverride?: number,
): void {
  const markerCounts: Record<string, number> = {};
  let total = 0;
  for (const word of markers) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = content.match(new RegExp(escaped, "gi"));
    const count = matches?.length ?? 0;
    if (count > 0) {
      markerCounts[word] = count;
      total += count;
    }
  }
  const length = lengthOverride ?? content.length;
  const limit = Math.max(1, Math.floor(length / charsPerAllowed));
  if (total > limit) {
    const detail = Object.entries(markerCounts)
      .map(([w, c]) => `"${w}"×${c}`)
      .join(", ");
    violations.push({
      rule,
      severity: "warning",
      description: `${label}: ${total} occurrences (limit ${limit} per ${length} chars). Detail: ${detail}`,
      suggestion,
    });
  }
}

function checkFatigueWords(
  violations: PostWriteViolation[],
  content: string,
  genreProfile: GenreProfile,
  bookRules: BookRules | null,
  lang: string,
): void {
  const fatigueWords = bookRules?.fatigueWordsOverride && bookRules.fatigueWordsOverride.length > 0
    ? bookRules.fatigueWordsOverride
    : genreProfile.fatigueWords;
  for (const word of fatigueWords) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const flags = lang === "en" ? "gi" : "g";
    const matches = content.match(new RegExp(escaped, flags));
    const count = matches?.length ?? 0;
    if (count > 1) {
      const desc = lang === "en"
        ? `Fatigue word "${word}" appears ${count} times (limit 1 per chapter)`
        : `高疲劳词"${word}"出现${count}次（上限1次/章）`;
      const sug = lang === "en"
        ? `Replace extra occurrences of "${word}" with varied expressions`
        : `替换多余的"${word}"为同义但不同形式的表达`;
      violations.push({
        rule: lang === "en" ? "fatigue_word" : "高疲劳词",
        severity: "warning",
        description: desc,
        suggestion: sug,
      });
    }
  }
}

function checkPatternList(
  violations: PostWriteViolation[],
  content: string,
  patterns: readonly RegExp[],
  rule: string,
  descPrefix: string,
  suggestion: string,
): void {
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      violations.push({
        rule,
        severity: "warning",
        description: `${descPrefix}: "${match[0]}"`,
        suggestion,
      });
      break; // Reportar una vez es suficiente
    }
  }
}

function checkTermList(
  violations: PostWriteViolation[],
  content: string,
  terms: readonly string[],
  rule: string,
  severity: "error" | "warning",
  descPrefix: string,
  suggestion: string,
): void {
  const found: string[] = [];
  const lowerContent = content.toLowerCase();
  for (const term of terms) {
    if (lowerContent.includes(term.toLowerCase())) {
      found.push(term);
    }
  }
  if (found.length > 0) {
    violations.push({
      rule,
      severity,
      description: `${descPrefix}: ${found.map(t => `"${t}"`).join(", ")}`,
      suggestion,
    });
  }
}

function checkParagraphLength(
  violations: PostWriteViolation[],
  content: string,
  maxChars: number,
  threshold: number,
  lang: string,
): void {
  const paragraphs = content
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  const longParagraphs = paragraphs.filter(p => p.length > maxChars);
  if (longParagraphs.length >= threshold) {
    const desc = lang === "en"
      ? `${longParagraphs.length} paragraphs exceed ${maxChars} characters`
      : `${longParagraphs.length}个段落超过${maxChars}字，不适合手机阅读`;
    const sug = lang === "en"
      ? "Break long paragraphs at action shifts or emotional beats"
      : "长段落拆分为3-5行的短段落，在动作切换或情绪节点处断开";
    violations.push({
      rule: lang === "en" ? "paragraph_length" : "段落过长",
      severity: "warning",
      description: desc,
      suggestion: sug,
    });
  }
}

function checkProhibitions(
  violations: PostWriteViolation[],
  content: string,
  bookRules: BookRules | null,
  lang: string,
): void {
  if (!bookRules?.prohibitions) return;
  const lowerContent = lang === "en" ? content.toLowerCase() : content;
  for (const prohibition of bookRules.prohibitions) {
    if (prohibition.length < 2 || prohibition.length > 30) continue;
    const needle = lang === "en" ? prohibition.toLowerCase() : prohibition;
    if (lowerContent.includes(needle)) {
      const desc = lang === "en"
        ? `Book prohibition found: "${prohibition}"`
        : `出现了本书禁忌内容："${prohibition}"`;
      const sug = lang === "en"
        ? "Remove or rewrite this content"
        : "删除或改写该内容";
      violations.push({
        rule: lang === "en" ? "book_prohibition" : "本书禁忌",
        severity: "error",
        description: desc,
        suggestion: sug,
      });
    }
  }
}
