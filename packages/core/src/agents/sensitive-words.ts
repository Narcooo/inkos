/**
 * Sensitive word detection — rule-based analysis (no LLM).
 *
 * Detects politically sensitive, sexually explicit, and extremely violent terms
 * in Chinese web novel content. Used in audit pipeline to flag or block content.
 */

import type { AuditIssue } from "./continuity.js";

export interface SensitiveWordMatch {
  readonly word: string;
  readonly count: number;
  readonly severity: "block" | "warn";
}

export interface SensitiveWordResult {
  readonly issues: ReadonlyArray<AuditIssue>;
  readonly found: ReadonlyArray<SensitiveWordMatch>;
}

type SensitiveWordLanguage = "zh" | "en";

// Political terms — severity "block"
const POLITICAL_WORDS: ReadonlyArray<string> = [
  "习近平", "习主席", "习总书记", "共产党", "中国共产党", "共青团",
  "六四", "天安门事件", "天安门广场事件", "法轮功", "法轮大法",
  "台独", "藏独", "疆独", "港独",
  "新疆集中营", "再教育营",
  "维吾尔", "达赖喇嘛", "达赖",
  "刘晓波", "艾未未", "赵紫阳",
  "文化大革命", "文革", "大跃进",
  "反右运动", "镇压", "六四屠杀",
  "中南海", "政治局常委",
  "翻墙", "防火长城",
];

// Sexual terms — severity "warn"
const SEXUAL_WORDS: ReadonlyArray<string> = [
  "性交", "做爱", "口交", "肛交", "自慰", "手淫",
  "阴茎", "阴道", "阴蒂", "乳房", "乳头",
  "射精", "高潮", "潮吹",
  "淫荡", "淫乱", "荡妇", "婊子",
  "强奸", "轮奸",
];

// Extreme violence — severity "warn"
const VIOLENCE_EXTREME: ReadonlyArray<string> = [
  "肢解", "碎尸", "挖眼", "剥皮", "开膛破肚",
  "虐杀", "凌迟", "活剥", "活埋", "烹煮活人",
];

interface WordListEntry {
  readonly words: ReadonlyArray<string>;
  readonly severity: "block" | "warn";
  readonly label: string;
  readonly englishLabel: string;
}

const WORD_LISTS: ReadonlyArray<WordListEntry> = [
  { words: POLITICAL_WORDS, severity: "block", label: "政治敏感词", englishLabel: "political sensitive terms" },
  { words: SEXUAL_WORDS, severity: "warn", label: "色情敏感词", englishLabel: "sexual sensitive terms" },
  { words: VIOLENCE_EXTREME, severity: "warn", label: "极端暴力词", englishLabel: "extreme violence terms" },
];

/**
 * Analyze text content for sensitive words.
 * Returns issues that can be merged into audit results.
 */
export function analyzeSensitiveWords(
  content: string,
  customWords?: ReadonlyArray<string>,
  language: SensitiveWordLanguage = "zh",
): SensitiveWordResult {
  const found: SensitiveWordMatch[] = [];
  const issues: AuditIssue[] = [];
  const isEnglish = language === "en";
  const joiner = isEnglish ? ", " : "、";

  // Check built-in word lists
  for (const list of WORD_LISTS) {
    const matches = scanWords(content, list.words, list.severity);
    if (matches.length > 0) {
      found.push(...matches);
      const wordSummary = matches.map((m) => `"${m.word}"×${m.count}`).join(joiner);
      issues.push({
        severity: list.severity === "block" ? "critical" : "warning",
        category: isEnglish ? "Sensitive terms" : "敏感词",
        description: isEnglish
          ? `Detected ${list.englishLabel}: ${wordSummary}`
          : `检测到${list.label}：${wordSummary}`,
        suggestion: isEnglish
          ? (list.severity === "block"
              ? "You must remove or replace these blocked terms before publication"
              : `Replace or soften these ${list.englishLabel} to reduce moderation risk`)
          : (list.severity === "block"
              ? "必须删除或替换政治敏感词，否则无法发布"
              : `建议替换或弱化${list.label}，避免平台审核问题`),
      });
    }
  }

  // Check custom words
  if (customWords && customWords.length > 0) {
    const customMatches = scanWords(content, customWords, "warn");
    if (customMatches.length > 0) {
      found.push(...customMatches);
      const wordSummary = customMatches.map((m) => `"${m.word}"×${m.count}`).join(joiner);
      issues.push({
        severity: "warning",
        category: isEnglish ? "Sensitive terms" : "敏感词",
        description: isEnglish
          ? `Detected custom sensitive term(s): ${wordSummary}`
          : `检测到自定义敏感词：${wordSummary}`,
        suggestion: isEnglish
          ? "Replace or remove these terms according to project rules"
          : "根据项目规则替换或删除这些词语",
      });
    }
  }

  return { issues, found };
}

function scanWords(
  content: string,
  words: ReadonlyArray<string>,
  severity: "block" | "warn",
): ReadonlyArray<SensitiveWordMatch> {
  const matches: SensitiveWordMatch[] = [];
  for (const word of words) {
    const regex = new RegExp(escapeRegExp(word), "g");
    const hits = content.match(regex);
    if (hits && hits.length > 0) {
      matches.push({ word, count: hits.length, severity });
    }
  }
  return matches;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
