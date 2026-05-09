/**
 * Phase 9-3: hard gate that a chapter draft actually acts on the hook ledger
 * the planner declared in the memo's "## 本章 hook 账" / "## Hook ledger for
 * this chapter" section.
 *
 * The planner commits, per chapter, to:
 *   - advance: <hook_id> "name" → state-change
 *   - resolve: <hook_id> "name" → action
 *
 * The validator parses those two lists and checks that every committed hook
 * has observable evidence in the draft. "Evidence" means the draft mentions
 * at least one keyword from the ledger line's descriptor (hook name, key
 * noun, etc.). We deliberately do NOT require the draft to repeat the raw
 * hook_id like "H007" — writers don't embed IDs in prose.
 */

export interface HookLedgerViolation {
  readonly severity: "critical";
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
}

export interface HookLedgerEntry {
  readonly id: string;
  /** Raw text of the ledger line after the hook_id. */
  readonly descriptor: string;
  /** 2+ char CJK sequences and 3+ letter ASCII words extracted from descriptor. */
  readonly keywords: ReadonlyArray<string>;
}

export interface HookLedger {
  readonly open: ReadonlyArray<HookLedgerEntry>;
  readonly advance: ReadonlyArray<HookLedgerEntry>;
  readonly resolve: ReadonlyArray<HookLedgerEntry>;
  readonly defer: ReadonlyArray<HookLedgerEntry>;
  /**
   * Count of `[new] ...` placeholder lines in the `open:` subsection. These
   * are brand-new hooks declared by the planner that have no pre-existing
   * hook_id (extractLedgerEntry rejects them because they carry no id to
   * match downstream), but they still count as "a new hook opened" for the
   * 揭 1 埋 1 floor check.
   */
  readonly newOpenCount: number;
}

const LEDGER_HEADING_PATTERNS = [
  /^#{2,3}\s*本章\s*hook\s*账\s*$/im,
  /^#{2,3}\s*Hook\s+ledger\s+for\s+this\s+chapter\s*$/im,
  /^#{2,3}\s*이번\s+장\s*hook\s*장부\s*$/im,
];

const SUBSECTION_KEYS: ReadonlyArray<keyof HookLedger> = ["open", "advance", "resolve", "defer"];

/**
 * Tokens that look like hook_ids but are placeholders meaning "no hooks in
 * this slot". Writers sometimes emit "- 无" or "- none" under an empty slot
 * instead of leaving it blank.
 */
const PLACEHOLDER_TOKENS = /^(无|空|none|nil|null|暂无|n\/a|na|n-a|tbd|todo|待定)$/i;

/** Subsection heading words that must not be parsed as hook_ids. */
const SUBSECTION_WORDS = /^(open|advance|resolve|defer|new)$/i;

export function parseHookLedger(memoBody: string): HookLedger {
  const section = extractLedgerSection(memoBody);
  if (!section) {
    return { open: [], advance: [], resolve: [], defer: [], newOpenCount: 0 };
  }

  type Subsection = "open" | "advance" | "resolve" | "defer";
  const result: Record<Subsection, HookLedgerEntry[]> = {
    open: [],
    advance: [],
    resolve: [],
    defer: [],
  };
  let newOpenCount = 0;

  let current: Subsection | null = null;
  for (const rawLine of section.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const subHeadingMatch = line.match(/^(open|advance|resolve|defer)\s*[:：]?\s*$/i);
    if (subHeadingMatch) {
      current = subHeadingMatch[1]!.toLowerCase() as Subsection;
      continue;
    }

    if (!current) continue;
    if (!line.startsWith("-")) continue;

    // `[new]` placeholder lines have no hook_id but still count as a new hook
    // opened (揭 1 埋 1 floor check). extractLedgerEntry filters them out for
    // advance/resolve evidence matching; we tally them separately here.
    const cleaned = line.replace(/^-+\s*/, "").trim();
    if (current === "open" && /^\[new\]/i.test(cleaned)) {
      newOpenCount += 1;
      continue;
    }

    const entry = extractLedgerEntry(line);
    if (entry) result[current].push(entry);
  }

  return { ...result, newOpenCount };
}

/**
 * Enforce: every hook declared under advance / resolve must have observable
 * evidence in the draft text. We do NOT validate `open` (new hooks don't have
 * a pre-existing id/descriptor to echo) or `defer` (deferred = deliberately
 * not touched).
 *
 * Additionally enforces the "揭 1 埋 1" hard floor (Xu Er Jia De Mao, 番茄文章
 * 10): whenever a chapter resolves one or more hooks, it must open at least
 * as many new hooks in the same memo. "Resolve without opening" leaves the
 * reader feeling "解完即索然无味" — the story loses forward pull. The softer
 * "揭 1 埋 2" rule is a planner-prompt recommendation, not a hard gate here,
 * because enforcing ×2 would conflict with the "≤ 2 new hooks per chapter"
 * cap on the planner side when resolve=2.
 */
export function validateHookLedger(
  memoBody: string,
  draftContent: string,
): ReadonlyArray<HookLedgerViolation> {
  const ledger = parseHookLedger(memoBody);
  const violations: HookLedgerViolation[] = [];

  // Evidence check for everything the memo committed to land in prose.
  const committed = dedupeById([...ledger.advance, ...ledger.resolve]);
  for (const entry of committed) {
    if (!draftEchoesEntry(draftContent, entry)) {
      violations.push({
        severity: "critical",
        category: "hook 账未兑现",
        description: `memo 在 advance/resolve 里声明要处理 ${entry.id}，但正文没有对应的落地动作`,
        suggestion: `在正文中加入对 ${entry.id} 的具体情节推进（动作、对话、环境变化），或把它从 hook 账里移到 defer 并给出理由`,
      });
    }
  }

  // "揭 1 埋 1" hard floor: when anything was resolved, at least the same
  // number of new hooks must have been opened. We count both `[new]`
  // placeholder lines (newOpenCount — the normal way planners declare fresh
  // hooks without an id) and any id-bearing lines under `open:` (rare, but
  // legal if a planner re-opens a previously paused hook).
  const resolvedCount = ledger.resolve.length;
  const openedCount = ledger.open.length + ledger.newOpenCount;
  if (resolvedCount > 0 && openedCount < resolvedCount) {
    violations.push({
      severity: "critical",
      category: "hook 账揭 1 埋 1 违规",
      description: `本章 resolve 了 ${resolvedCount} 个钩子，但 open 只有 ${openedCount} 个新钩子。只揭不埋会让读者豁然开朗后索然无味，本书的前进拉力被削弱。`,
      suggestion: `在 memo 的 open 段下至少再埋 ${resolvedCount - openedCount} 个与本章已揭钩子相关的新钩子（番茄老师徐二家的猫："掀开一个伏笔的同时，再埋两个伏笔"）。新钩子最好与已揭钩子彼此关联，不要凭空冒出来。`,
    });
  }

  return violations;
}

function extractLedgerSection(memoBody: string): string | undefined {
  for (const pattern of LEDGER_HEADING_PATTERNS) {
    const match = memoBody.match(pattern);
    if (!match || match.index === undefined) continue;
    const start = match.index + match[0].length;
    const rest = memoBody.slice(start);
    const nextHeading = rest.match(/\n#{2,3}\s/);
    const end = nextHeading ? nextHeading.index ?? rest.length : rest.length;
    return rest.slice(0, end);
  }
  return undefined;
}

function extractLedgerEntry(line: string): HookLedgerEntry | undefined {
  const cleaned = line.replace(/^-+\s*/, "").trim();
  if (cleaned.startsWith("[new]") || cleaned.startsWith("[NEW]")) return undefined;

  // Reject whole-line placeholders first — "- 无", "- n/a", "- none" etc.
  const firstWord = cleaned.split(/\s+/)[0] ?? "";
  if (PLACEHOLDER_TOKENS.test(firstWord)) return undefined;

  const idMatch = cleaned.match(/^([A-Za-z\u4e00-\u9fff][A-Za-z0-9_\-\u4e00-\u9fff]{0,19})/);
  if (!idMatch) return undefined;

  const candidate = idMatch[1]!;
  if (SUBSECTION_WORDS.test(candidate)) return undefined;
  if (PLACEHOLDER_TOKENS.test(candidate)) return undefined;

  const descriptor = cleaned.slice(candidate.length).trim();
  return { id: candidate, descriptor, keywords: extractKeywords(descriptor) };
}

/**
 * Extract content-matching tokens from a ledger line's descriptor.
 *
 * Priority 1: quoted hook name — `H007 "胖虎借条" → ...` — this is the most
 * informative token the planner attached, and it's what the writer should
 * echo. We split compound CJK names into leading/trailing 2-grams so
 * partial echoes still count.
 *
 * Priority 2: if no quoted name, fall back to the descriptor text UP TO the
 * first state-transition arrow (→ or ->), same CJK/ASCII splitting. Anything
 * AFTER the arrow describes new state, not the hook itself, and risks
 * character-name false positives.
 */
function extractKeywords(descriptor: string): ReadonlyArray<string> {
  if (!descriptor) return [];

  // Try the quoted-name anchor first — matches "..." or "..." quotes.
  const quotedMatch = descriptor.match(/[""]([^""\n]+)[""]/);
  const source = quotedMatch ? quotedMatch[1]! : descriptor.split(/[→]|->/, 1)[0]!;

  const cjkRuns = source.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const cjkTokens: string[] = [];
  for (const run of cjkRuns) {
    cjkTokens.push(run);
    if (run.length >= 3) {
      for (let index = 0; index <= run.length - 2; index++) {
        cjkTokens.push(run.slice(index, index + 2));
      }
    }
    if (run.length >= 4) {
      cjkTokens.push(run.slice(0, 3));
      cjkTokens.push(run.slice(-3));
    }
  }
  const ascii = (source.match(/[A-Za-z]{3,}/g) ?? []).map((w) => w.toLowerCase());
  return dedupeStrings([...cjkTokens, ...ascii].filter((tok) => !ASCII_STOPWORDS.has(tok)));
}

const ASCII_STOPWORDS = new Set([
  "and", "the", "for", "with", "from", "that", "into", "then",
  "open", "close", "advance", "resolve", "defer", "new",
  "planted", "pressured", "near", "payoff", "ready", "stale",
]);

function draftEchoesEntry(draft: string, entry: HookLedgerEntry): boolean {
  if (entry.keywords.length > 0) {
    const draftLower = draft.toLowerCase();
    return entry.keywords.some((kw) => {
      // ASCII keywords are already lowercased; CJK keywords case doesn't matter.
      return /^[a-z]/.test(kw) ? draftLower.includes(kw) : draft.includes(kw);
    });
  }
  // Bare-id ledger line with no descriptor — fall back to ID match.
  if (/^[A-Za-z0-9_-]+$/.test(entry.id)) {
    return new RegExp(`\\b${escapeRegex(entry.id)}\\b`).test(draft);
  }
  return draft.includes(entry.id);
}

function dedupeById(entries: ReadonlyArray<HookLedgerEntry>): HookLedgerEntry[] {
  const seen = new Set<string>();
  const result: HookLedgerEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    result.push(entry);
  }
  return result;
}

function dedupeStrings(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const INTERNAL = {
  SUBSECTION_KEYS,
  extractLedgerSection,
  extractLedgerEntry,
  extractKeywords,
};
