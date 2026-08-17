import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface SearchDocument {
  readonly id: string;
  readonly scope: string;
  readonly kind: string;
  readonly source: string;
  readonly title: string;
  readonly body: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SearchHit extends SearchDocument {
  readonly score: number;
}

export interface MarkdownSearchSegment {
  readonly heading: string;
  readonly body: string;
  readonly charStart: number;
  readonly charEnd: number;
}

/**
 * The single lexical retrieval kernel used by story memory, archived materials,
 * and Skill references. Source files remain authoritative; this database is a
 * rebuildable FTS5 projection.
 */
export class LocalSearchIndex {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  replaceScope(scope: string, documents: ReadonlyArray<SearchDocument>): void {
    const normalized = documents.map((document) => normalizeDocument(document, scope));
    const keepIds = new Set(normalized.map((document) => document.id));
    const existing = this.db.prepare(
      "SELECT document_id AS id, content_hash AS contentHash FROM retrieval_documents WHERE scope = ?",
    ).all(scope) as unknown as ReadonlyArray<{ readonly id: string; readonly contentHash: string }>;
    const existingHashes = new Map(existing.map((row) => [row.id, row.contentHash]));
    const upsert = this.db.prepare(`
      INSERT INTO retrieval_documents (
        document_id, scope, kind, source, title, body,
        title_tokens, body_tokens, metadata_json, content_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, document_id) DO UPDATE SET
        kind = excluded.kind,
        source = excluded.source,
        title = excluded.title,
        body = excluded.body,
        title_tokens = excluded.title_tokens,
        body_tokens = excluded.body_tokens,
        metadata_json = excluded.metadata_json,
        content_hash = excluded.content_hash,
        updated_at = datetime('now')
    `);
    const remove = this.db.prepare(
      "DELETE FROM retrieval_documents WHERE scope = ? AND document_id = ?",
    );

    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const document of normalized) {
        if (existingHashes.get(document.id) === document.contentHash) continue;
        upsert.run(
          document.id,
          document.scope,
          document.kind,
          document.source,
          document.title,
          document.body,
          document.titleTokens,
          document.bodyTokens,
          document.metadataJson,
          document.contentHash,
        );
      }
      for (const row of existing) {
        if (!keepIds.has(row.id)) remove.run(scope, row.id);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  search(query: string, options: {
    readonly scope: string;
    readonly kinds?: ReadonlyArray<string>;
    readonly limit?: number;
  }): SearchHit[] {
    const match = buildMatchQuery(query);
    if (!match) return [];
    const kinds = [...new Set(options.kinds ?? [])];
    const kindFilter = kinds.length > 0
      ? ` AND d.kind IN (${kinds.map(() => "?").join(", ")})`
      : "";
    const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 24)));
    const rows = this.db.prepare(`
      SELECT
        d.document_id AS id,
        d.scope,
        d.kind,
        d.source,
        d.title,
        d.body,
        d.metadata_json AS metadataJson,
        bm25(retrieval_documents_fts, 5.0, 1.0) AS rank
      FROM retrieval_documents_fts
      JOIN retrieval_documents d ON d.rowid = retrieval_documents_fts.rowid
      WHERE retrieval_documents_fts MATCH ?
        AND d.scope = ?${kindFilter}
      ORDER BY rank ASC, d.document_id ASC
      LIMIT ?
    `).all(match, options.scope, ...kinds, limit) as unknown as ReadonlyArray<{
      readonly id: string;
      readonly scope: string;
      readonly kind: string;
      readonly source: string;
      readonly title: string;
      readonly body: string;
      readonly metadataJson: string;
      readonly rank: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      scope: row.scope,
      kind: row.kind,
      source: row.source,
      title: row.title,
      body: row.body,
      metadata: parseMetadata(row.metadataJson),
      // SQLite's FTS5 bm25() returns smaller values for better matches.
      score: -row.rank,
    }));
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS retrieval_documents (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        kind TEXT NOT NULL,
        source TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        title_tokens TEXT NOT NULL,
        body_tokens TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        content_hash TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(scope, document_id)
      );

      CREATE INDEX IF NOT EXISTS idx_retrieval_documents_scope_kind
        ON retrieval_documents(scope, kind);

      CREATE VIRTUAL TABLE IF NOT EXISTS retrieval_documents_fts USING fts5(
        title_tokens,
        body_tokens,
        content='retrieval_documents',
        content_rowid='rowid'
      );

      CREATE TRIGGER IF NOT EXISTS retrieval_documents_ai AFTER INSERT ON retrieval_documents BEGIN
        INSERT INTO retrieval_documents_fts(rowid, title_tokens, body_tokens)
        VALUES (new.rowid, new.title_tokens, new.body_tokens);
      END;

      CREATE TRIGGER IF NOT EXISTS retrieval_documents_ad AFTER DELETE ON retrieval_documents BEGIN
        INSERT INTO retrieval_documents_fts(retrieval_documents_fts, rowid, title_tokens, body_tokens)
        VALUES ('delete', old.rowid, old.title_tokens, old.body_tokens);
      END;

      CREATE TRIGGER IF NOT EXISTS retrieval_documents_au AFTER UPDATE ON retrieval_documents BEGIN
        INSERT INTO retrieval_documents_fts(retrieval_documents_fts, rowid, title_tokens, body_tokens)
        VALUES ('delete', old.rowid, old.title_tokens, old.body_tokens);
        INSERT INTO retrieval_documents_fts(rowid, title_tokens, body_tokens)
        VALUES (new.rowid, new.title_tokens, new.body_tokens);
      END;
    `);
  }
}

export function splitMarkdownForSearch(markdown: string): MarkdownSearchSegment[] {
  const segments: MarkdownSearchSegment[] = [];
  let heading = "";
  const blockPattern = /(?:^|\n)([^\n](?:[\s\S]*?))(?=\n\s*\n|$)/g;
  for (const match of markdown.matchAll(blockPattern)) {
    const raw = match[1] ?? "";
    const leadingOffset = (match[0]?.length ?? raw.length) - raw.length;
    const charStart = (match.index ?? 0) + leadingOffset;
    const body = raw.trim();
    if (!body) continue;
    const headingMatch = body.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      heading = headingMatch[1]?.trim() ?? heading;
      continue;
    }
    segments.push({
      heading,
      body,
      charStart,
      charEnd: charStart + raw.length,
    });
  }
  return segments;
}

export function tokenizeSearchText(text: string): string[] {
  const normalized = text.normalize("NFKC").toLocaleLowerCase();
  const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
  const tokens: string[] = [];
  for (const part of segmenter.segment(normalized)) {
    const token = part.segment.trim();
    if (!part.isWordLike || !token) continue;
    if (/^[\p{Script=Latin}\p{N}_-]+$/u.test(token) && token.length < 2) continue;
    tokens.push(token);
  }
  // ICU can segment short Chinese compounds into individual Han characters.
  // Adjacent Han bigrams preserve those compounds for lexical retrieval; this
  // is tokenizer mechanics, not a semantic intent rule.
  const segmentedTokenCount = tokens.length;
  for (let index = 0; index < segmentedTokenCount - 1; index += 1) {
    const left = tokens[index] ?? "";
    const right = tokens[index + 1] ?? "";
    if (/^\p{Script=Han}$/u.test(left) && /^\p{Script=Han}$/u.test(right)) {
      tokens.push(`${left}${right}`);
    }
  }
  for (const match of normalized.matchAll(/[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)+/gu)) {
    tokens.push(match[0]);
  }
  return tokens;
}

function buildMatchQuery(query: string): string {
  const tokens = [...new Set(tokenizeSearchText(query))].slice(0, 64);
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" OR ");
}

function normalizeDocument(document: SearchDocument, scope: string) {
  const normalized = { ...document, scope };
  const metadataJson = JSON.stringify(document.metadata ?? {});
  const titleTokens = tokenizeSearchText(document.title).join(" ");
  const bodyTokens = tokenizeSearchText(document.body).join(" ");
  const contentHash = createHash("sha256")
    .update([normalized.kind, normalized.source, normalized.title, normalized.body, metadataJson].join("\0"))
    .digest("hex");
  return {
    ...normalized,
    metadataJson,
    titleTokens,
    bodyTokens,
    contentHash,
  };
}

function parseMetadata(value: string): Readonly<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Readonly<Record<string, unknown>>
      : {};
  } catch {
    return {};
  }
}
