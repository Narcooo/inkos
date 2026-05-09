/**
 * Phase 5 (v13) path resolution — prefer the new prose outline files, fall
 * back to legacy paths so older books keep working during transition.
 *
 * Maps:
 *   story/outline/story_frame.md  →  preferred replacement for story_bible.md
 *   story/outline/volume_map.md   →  preferred replacement for volume_outline.md
 *   story/roles/主要角色/*.md +
 *   story/roles/次要角色/*.md +
 *   story/roles/주요인물/*.md +
 *   story/roles/보조인물/*.md    →  preferred replacement for character_matrix.md
 *
 * All helpers accept a bookDir (path to a book root, containing `story/`)
 * and return a string — either the new-file content when it exists, or the
 * legacy file content, or an empty default placeholder.
 */

import { readFile, readdir, access } from "node:fs/promises";
import { join } from "node:path";

/**
 * Detect whether a book uses the Phase 5 new layout (outline/story_frame.md
 * exists on disk). If yes, story_bible.md / book_rules.md are compat shims.
 * If no, those files ARE the authoritative source.
 */
export async function isNewLayoutBook(bookDir: string): Promise<boolean> {
  try {
    await access(join(bookDir, "story", "outline", "story_frame.md"));
    return true;
  } catch {
    return false;
  }
}

async function readOr(path: string, fallback: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return fallback;
  }
}

/** Read story_frame.md, falling back to legacy story_bible.md. */
export async function readStoryFrame(
  bookDir: string,
  fallbackPlaceholder: string = "",
): Promise<string> {
  const newPath = join(bookDir, "story", "outline", "story_frame.md");
  const legacyPath = join(bookDir, "story", "story_bible.md");

  const newContent = await readOr(newPath, "");
  if (newContent.trim()) return newContent;

  return readOr(legacyPath, fallbackPlaceholder);
}

/** Read volume_map.md, falling back to legacy volume_outline.md. */
export async function readVolumeMap(
  bookDir: string,
  fallbackPlaceholder: string = "",
): Promise<string> {
  const newPath = join(bookDir, "story", "outline", "volume_map.md");
  const legacyPath = join(bookDir, "story", "volume_outline.md");

  const newContent = await readOr(newPath, "");
  if (newContent.trim()) return newContent;

  return readOr(legacyPath, fallbackPlaceholder);
}

/** Read the rhythm principles file (zh or en variant). */
export async function readRhythmPrinciples(bookDir: string): Promise<string> {
  const zhPath = join(bookDir, "story", "outline", "节奏原则.md");
  const enPath = join(bookDir, "story", "outline", "rhythm_principles.md");

  const zh = await readOr(zhPath, "");
  if (zh.trim()) return zh;
  return readOr(enPath, "");
}

export interface RoleCard {
  readonly tier: "major" | "minor";
  readonly name: string;
  readonly content: string;
}

/**
 * Read the roles/ directory. Returns [] when no roles are present (e.g. old
 * books still on character_matrix.md).
 */
export async function readRoleCards(bookDir: string): Promise<ReadonlyArray<RoleCard>> {
  const rolesRoot = join(bookDir, "story", "roles");
  const majorDirZh = join(rolesRoot, "主要角色");
  const minorDirZh = join(rolesRoot, "次要角色");
  const majorDirEn = join(rolesRoot, "major");
  const minorDirEn = join(rolesRoot, "minor");
  const majorDirKo = join(rolesRoot, "주요인물");
  const minorDirKo = join(rolesRoot, "보조인물");

  const cards: RoleCard[] = [];
  await Promise.all([
    collectRoleDir(majorDirZh, "major", cards),
    collectRoleDir(minorDirZh, "minor", cards),
    collectRoleDir(majorDirEn, "major", cards),
    collectRoleDir(minorDirEn, "minor", cards),
    collectRoleDir(majorDirKo, "major", cards),
    collectRoleDir(minorDirKo, "minor", cards),
  ]);
  return cards;
}

async function collectRoleDir(
  dir: string,
  tier: "major" | "minor",
  out: RoleCard[],
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  const reads = entries
    .filter((entry) => entry.endsWith(".md"))
    .map(async (entry) => {
      const content = await readOr(join(dir, entry), "");
      if (!content.trim()) return;
      out.push({
        tier,
        name: entry.replace(/\.md$/, ""),
        content,
      });
    });
  await Promise.all(reads);
}

/**
 * Render role cards in a format compatible with downstream consumers that
 * previously expected character_matrix.md prose. When no role cards exist,
 * returns the legacy character_matrix.md content or the placeholder.
 */
export async function readCharacterContext(
  bookDir: string,
  fallbackPlaceholder: string = "",
): Promise<string> {
  const cards = await readRoleCards(bookDir);
  if (cards.length > 0) {
    const groups: Record<"major" | "minor", RoleCard[]> = { major: [], minor: [] };
    for (const card of cards) groups[card.tier].push(card);

    const render = (tierCards: RoleCard[], heading: string): string => {
      if (tierCards.length === 0) return "";
      const sections = tierCards.map((card) => `### ${card.name}\n\n${card.content.trim()}`);
      return `## ${heading}\n\n${sections.join("\n\n")}`;
    };

    const blocks = [
      render(groups.major, "주요 인물 / 主要角色 / Major characters"),
      render(groups.minor, "보조 인물 / 次要角色 / Minor characters"),
    ].filter(Boolean);

    return blocks.join("\n\n");
  }

  // Fallback: legacy character_matrix.md (may itself be a shim pointer).
  const legacyPath = join(bookDir, "story", "character_matrix.md");
  return readOr(legacyPath, fallbackPlaceholder);
}

// ---------------------------------------------------------------------------
// Phase 5 consolidation: current_state.md initial fallback
//
// After architect consolidation (7→5 sections), current_state.md is seeded
// with a tiny placeholder at book creation. Real content only arrives once
// the consolidator has appended output from chapter 1 onward. Readers that
// previously relied on architect-provided initial state (writer phase-1
// creative prompt, continuity, chapter-analyzer, reviser, composer) should
// substitute a derived initial-state block when the seed placeholder is all
// that's on disk — otherwise the "## 当前状态卡" block in prompts degenerates
// into a meta note about runtime append behaviour.
// ---------------------------------------------------------------------------

/**
 * Marker substring emitted by architect.writeFoundationFiles when seeding
 * current_state.md. Its presence is how readers detect "nothing real yet".
 */
const CURRENT_STATE_SEED_MARKERS = [
  "建书时占位",
  "Seeded at book creation",
  "작품 생성 시점의 자리표시자",
];

export function isCurrentStateSeedPlaceholder(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  // Heuristic: short file AND contains one of the seed markers.
  if (trimmed.length > 600) return false;
  return CURRENT_STATE_SEED_MARKERS.some((marker) => trimmed.includes(marker));
}

function extractCurrentStateFromRole(content: string): string | null {
  // Accept zh, en, and ko headings for per-role initial state.
  const pattern = /^##\s*(?:当前现状|Current[_\s]?State|현재\s*상태)[^\n]*$/im;
  const match = content.match(pattern);
  if (!match || match.index === undefined) return null;
  const after = content.slice(match.index + match[0].length);
  // Cut at next `## ` heading (same or higher level).
  const nextHeading = after.search(/^##\s/m);
  const raw = nextHeading >= 0 ? after.slice(0, nextHeading) : after;
  const text = raw.trim();
  return text.length > 0 ? text : null;
}

function extractSeedHooksFromPendingHooks(raw: string): string[] {
  if (!raw.trim()) return [];
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  const seedRows: string[] = [];
  for (const line of lines) {
    if (!line.startsWith("|")) continue;
    if (/^\|\s*-/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 2) continue;
    if (cells[0]?.toLowerCase() === "hook_id" || cells[0] === "hookId") continue;
    const startCh = Number.parseInt(cells[1] ?? "", 10);
    if (!Number.isFinite(startCh) || startCh !== 0) continue;
    // cells[2] type, cells[5] expected payoff, last cell notes
    const notes = cells[cells.length - 1] ?? "";
    const summary = [cells[0], cells[2], notes].filter(Boolean).join(" · ");
    if (summary) seedRows.push(summary);
  }
  return seedRows;
}

/**
 * Read current_state.md; when the file is only a seed placeholder (chapter 0,
 * before consolidator has appended anything), derive an initial-state block
 * from roles/*.Current_State + pending_hooks startChapter=0 rows so callers
 * still have substantive content to feed into writer / analyzer prompts.
 */
export async function readCurrentStateWithFallback(
  bookDir: string,
  fallbackPlaceholder: string = "",
): Promise<string> {
  const storyDir = join(bookDir, "story");
  const currentStatePath = join(storyDir, "current_state.md");
  const raw = await readOr(currentStatePath, "");
  const language = await readBookDisplayLanguage(bookDir);

  if (!isCurrentStateSeedPlaceholder(raw)) {
    return raw;
  }

  const [cards, pendingHooks] = await Promise.all([
    readRoleCards(bookDir),
    readOr(join(storyDir, "pending_hooks.md"), ""),
  ]);

  const roleLines = cards
    .map((card) => {
      const state = extractCurrentStateFromRole(card.content);
      if (!state) return null;
      const tierLabel = language === "ko"
        ? (card.tier === "major" ? "주요" : "보조")
        : language === "en"
        ? (card.tier === "major" ? "major" : "minor")
        : (card.tier === "major" ? "主要" : "次要");
      return `- ${card.name}（${tierLabel}）：${state.replace(/\s+/g, " ")}`;
    })
    .filter((line): line is string => line !== null);

  const hookLines = extractSeedHooksFromPendingHooks(pendingHooks);

  if (roleLines.length === 0 && hookLines.length === 0) {
    return raw.trim() ? raw : fallbackPlaceholder;
  }

  const labels = language === "ko"
    ? {
      title: "# 초기 상태 (0장, 인물 파일과 seed hook에서 파생)",
      roles: "\n## 인물 초기 위치 / 처지",
      hooks: "\n## seed hook (시작 장 = 0)",
    }
    : language === "en"
    ? {
      title: "# Initial State (chapter 0, derived from roles + seed hooks)",
      roles: "\n## Initial character positions / situations",
      hooks: "\n## Seed hooks (startChapter = 0)",
    }
    : {
      title: "# 初始状态（第 0 章，由 roles + 种子伏笔派生）",
      roles: "\n## 角色初始位置 / 处境",
      hooks: "\n## 种子伏笔（startChapter = 0）",
    };

  const parts: string[] = [labels.title];
  if (roleLines.length > 0) {
    parts.push(labels.roles);
    parts.push(...roleLines);
  }
  if (hookLines.length > 0) {
    parts.push(labels.hooks);
    parts.push(...hookLines.map((line) => `- ${line}`));
  }
  return parts.join("\n");
}

async function readBookDisplayLanguage(bookDir: string): Promise<"zh" | "en" | "ko"> {
  try {
    const raw = await readFile(join(bookDir, "book.json"), "utf-8");
    const parsed = JSON.parse(raw) as { language?: unknown; genre?: unknown };
    if (parsed.language === "ko" || (typeof parsed.genre === "string" && parsed.genre.startsWith("ko-"))) return "ko";
    if (parsed.language === "en") return "en";
    return "zh";
  } catch {
    return "zh";
  }
}
