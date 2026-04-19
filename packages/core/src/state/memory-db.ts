/**
 * Temporal memory database for InkOS truth files.
 *
 * Uses Node.js built-in SQLite (node:sqlite, Node 22+).
 * Stores facts with temporal validity (valid_from/valid_until chapter numbers),
 * enabling precise queries like "what did character X know in chapter 5?"
 *
 * Backward compatible: existing markdown truth files are still the primary
 * persistence layer. MemoryDB is an acceleration index built alongside them.
 */

import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);

const FACT_SELECT_COLUMNS = `
  id,
  subject,
  predicate,
  object,
  valid_from_chapter AS validFromChapter,
  valid_until_chapter AS validUntilChapter,
  source_chapter AS sourceChapter
`;

export interface Fact {
  readonly id?: number;
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
  readonly validFromChapter: number;
  readonly validUntilChapter: number | null;
  readonly sourceChapter: number;
}

export interface StoredSummary {
  readonly chapter: number;
  readonly title: string;
  readonly characters: string;
  readonly events: string;
  readonly stateChanges: string;
  readonly hookActivity: string;
  readonly mood: string;
  readonly chapterType: string;
}

export interface StoredHook {
  readonly hookId: string;
  readonly startChapter: number;
  readonly type: string;
  readonly status: string;
  readonly lastAdvancedChapter: number;
  readonly expectedPayoff: string;
  readonly payoffTiming?: string;
  readonly notes: string;
}

export class MemoryDB {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any;

  constructor(bookDir: string) {
    // node:sqlite requires Node 22+; require() via createRequire for ESM compat
    const { DatabaseSync } = require("node:sqlite");
    const dbPath = join(bookDir, "story", "memory.db");
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        valid_from_chapter INTEGER NOT NULL,
        valid_until_chapter INTEGER,
        source_chapter INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS chapter_summaries (
        chapter INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        characters TEXT NOT NULL DEFAULT '',
        events TEXT NOT NULL DEFAULT '',
        state_changes TEXT NOT NULL DEFAULT '',
        hook_activity TEXT NOT NULL DEFAULT '',
        mood TEXT NOT NULL DEFAULT '',
        chapter_type TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS hooks (
        hook_id TEXT PRIMARY KEY,
        start_chapter INTEGER NOT NULL DEFAULT 0,
        type TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        last_advanced_chapter INTEGER NOT NULL DEFAULT 0,
        expected_payoff TEXT NOT NULL DEFAULT '',
        payoff_timing TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject);
      CREATE INDEX IF NOT EXISTS idx_facts_valid ON facts(valid_from_chapter, valid_until_chapter);
      CREATE INDEX IF NOT EXISTS idx_facts_source ON facts(source_chapter);
      CREATE INDEX IF NOT EXISTS idx_hooks_status ON hooks(status);
      CREATE INDEX IF NOT EXISTS idx_hooks_last_advanced ON hooks(last_advanced_chapter);
    `);

    this.ensureColumn("hooks", "payoff_timing", "TEXT NOT NULL DEFAULT ''");
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    try {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch {
      // Column already exists on existing databases.
    }
  }

  // ---------------------------------------------------------------------------
  // Facts (temporal)
  // ---------------------------------------------------------------------------

  /** Add a new fact. */
  addFact(fact: Omit<Fact, "id">): number {
    const stmt = this.db.prepare(
      `INSERT INTO facts (subject, predicate, object, valid_from_chapter, valid_until_chapter, source_chapter)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const result = stmt.run(
      fact.subject, fact.predicate, fact.object,
      fact.validFromChapter, fact.validUntilChapter ?? null, fact.sourceChapter,
    );
    return Number(result.lastInsertRowid);
  }

  /** Invalidate a fact (set valid_until). */
  invalidateFact(id: number, untilChapter: number): void {
    this.db.prepare(
      "UPDATE facts SET valid_until_chapter = ? WHERE id = ?",
    ).run(untilChapter, id);
  }

  /** Get all currently valid facts (valid_until is null). */
  getCurrentFacts(): ReadonlyArray<Fact> {
    return this.db.prepare(
      `SELECT ${FACT_SELECT_COLUMNS}
       FROM facts
       WHERE valid_until_chapter IS NULL
       ORDER BY subject, predicate`,
    ).all() as unknown as Fact[];
  }

  /** Get facts about a specific subject that are valid at a given chapter. */
  getFactsAt(subject: string, chapter: number): ReadonlyArray<Fact> {
    return this.db.prepare(
      `SELECT ${FACT_SELECT_COLUMNS}
       FROM facts
       WHERE subject = ? AND valid_from_chapter <= ?
       AND (valid_until_chapter IS NULL OR valid_until_chapter > ?)
       ORDER BY predicate`,
    ).all(subject, chapter, chapter) as unknown as Fact[];
  }

  /** Get all facts about a subject (including historical). */
  getFactHistory(subject: string): ReadonlyArray<Fact> {
    return this.db.prepare(
      `SELECT ${FACT_SELECT_COLUMNS}
       FROM facts
       WHERE subject = ?
       ORDER BY valid_from_chapter`,
    ).all(subject) as unknown as Fact[];
  }

  /** Search facts by predicate (e.g., all "location" facts). */
  getFactsByPredicate(predicate: string): ReadonlyArray<Fact> {
    return this.db.prepare(
      `SELECT ${FACT_SELECT_COLUMNS}
       FROM facts
       WHERE predicate = ? AND valid_until_chapter IS NULL
       ORDER BY subject`,
    ).all(predicate) as unknown as Fact[];
  }

  /** Get facts relevant to a set of character names. */
  getFactsForCharacters(names: ReadonlyArray<string>): ReadonlyArray<Fact> {
    if (names.length === 0) return [];
    const placeholders = names.map(() => "?").join(",");
    return this.db.prepare(
      `SELECT ${FACT_SELECT_COLUMNS}
       FROM facts
       WHERE subject IN (${placeholders}) AND valid_until_chapter IS NULL
       ORDER BY subject, predicate`,
    ).all(...names) as unknown as Fact[];
  }

  replaceCurrentFacts(facts: ReadonlyArray<Omit<Fact, "id">>): void {
    this.db.exec("DELETE FROM facts WHERE valid_until_chapter IS NULL");
    for (const fact of facts) {
      this.addFact(fact);
    }
  }

  resetFacts(): void {
    this.db.exec("DELETE FROM facts");
  }

  // ---------------------------------------------------------------------------
  // Chapter summaries
  // ---------------------------------------------------------------------------

  /** Upsert a chapter summary. */
  upsertSummary(summary: StoredSummary): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO chapter_summaries (chapter, title, characters, events, state_changes, hook_activity, mood, chapter_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      summary.chapter, summary.title, summary.characters, summary.events,
      summary.stateChanges, summary.hookActivity, summary.mood, summary.chapterType,
    );
  }

  replaceSummaries(summaries: ReadonlyArray<StoredSummary>): void {
    this.db.exec("DELETE FROM chapter_summaries");
    for (const summary of summaries) {
      this.upsertSummary(summary);
    }
  }

  /** Get summaries for a range of chapters. */
  getSummaries(fromChapter: number, toChapter: number): ReadonlyArray<StoredSummary> {
    return this.db.prepare(
      `SELECT
         chapter,
         title,
         characters,
         events,
         state_changes AS stateChanges,
         hook_activity AS hookActivity,
         mood,
         chapter_type AS chapterType
       FROM chapter_summaries
       WHERE chapter >= ? AND chapter <= ?
       ORDER BY chapter`,
    ).all(fromChapter, toChapter) as unknown as StoredSummary[];
  }

  /** Get summaries matching any of the given character names. */
  getSummariesByCharacters(names: ReadonlyArray<string>): ReadonlyArray<StoredSummary> {
    if (names.length === 0) return [];
    const conditions = names.map(() => "characters LIKE ?").join(" OR ");
    const params = names.map((n) => `%${n}%`);
    return this.db.prepare(
      `SELECT
         chapter,
         title,
         characters,
         events,
         state_changes AS stateChanges,
         hook_activity AS hookActivity,
         mood,
         chapter_type AS chapterType
       FROM chapter_summaries
       WHERE ${conditions}
       ORDER BY chapter`,
    ).all(...params) as unknown as StoredSummary[];
  }

  /** Get total chapter count. */
  getChapterCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM chapter_summaries").get() as unknown as { count: number };
    return row.count;
  }

  /** Get the most recent N summaries. */
  getRecentSummaries(count: number): ReadonlyArray<StoredSummary> {
    return this.db.prepare(
      `SELECT
         chapter,
         title,
         characters,
         events,
         state_changes AS stateChanges,
         hook_activity AS hookActivity,
         mood,
         chapter_type AS chapterType
       FROM chapter_summaries
       ORDER BY chapter DESC
       LIMIT ?`,
    ).all(count) as unknown as ReadonlyArray<StoredSummary>;
  }

  // ---------------------------------------------------------------------------
  // Hooks
  // ---------------------------------------------------------------------------

  upsertHook(hook: StoredHook): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO hooks (hook_id, start_chapter, type, status, last_advanced_chapter, expected_payoff, payoff_timing, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      hook.hookId,
      hook.startChapter,
      hook.type,
      hook.status,
      hook.lastAdvancedChapter,
      hook.expectedPayoff,
      hook.payoffTiming ?? "",
      hook.notes,
    );
  }

  replaceHooks(hooks: ReadonlyArray<StoredHook>): void {
    this.db.exec("DELETE FROM hooks");
    for (const hook of hooks) {
      this.upsertHook(hook);
    }
  }

  getActiveHooks(): ReadonlyArray<StoredHook> {
    return this.db.prepare(
      `SELECT
         hook_id AS hookId,
         start_chapter AS startChapter,
         type,
         status,
         last_advanced_chapter AS lastAdvancedChapter,
         expected_payoff AS expectedPayoff,
         payoff_timing AS payoffTiming,
         notes
       FROM hooks
       WHERE lower(status) NOT IN ('resolved', 'closed', '已回收', '已解决')
       ORDER BY last_advanced_chapter DESC, start_chapter DESC, hook_id ASC`,
    ).all() as unknown as ReadonlyArray<StoredHook>;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  close(): void {
    this.db.close();
  }
}
