import { Type, type Static } from "@mariozechner/pi-ai";
import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import type { PipelineRunner } from "../pipeline/runner.js";
import type { ReviseMode } from "../agents/reviser.js";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, normalize, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: "text", text }], details: undefined };
}

/**
 * Resolve a user-supplied relative path against the books root and guard
 * against path-traversal (../ etc.).
 */
function safeBooksPath(booksRoot: string, relativePath: string): string {
  const resolved = resolve(booksRoot, normalize(relativePath));
  if (!resolved.startsWith(booksRoot)) {
    throw new Error(`Path traversal blocked: ${relativePath}`);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// 1. SubAgentTool (sub_agent)
// ---------------------------------------------------------------------------

const SubAgentParams = Type.Object({
  agent: Type.Union([
    Type.Literal("architect"),
    Type.Literal("writer"),
    Type.Literal("auditor"),
    Type.Literal("reviser"),
    Type.Literal("exporter"),
  ]),
  instruction: Type.String({ description: "Natural language instruction from the main Agent" }),
  bookId: Type.Optional(Type.String({ description: "Book ID — required for all agents except architect" })),
});

export function createSubAgentTool(pipeline: PipelineRunner, activeBookId: string | null): AgentTool<typeof SubAgentParams> {
  return {
    name: "sub_agent",
    description:
      "Delegate a heavy operation to a specialised sub-agent. " +
      "Use agent='architect' to initialise a new book, 'writer' to write the next chapter, " +
      "'auditor' to audit quality, 'reviser' to revise a chapter, 'exporter' to export.",
    label: "Sub-Agent",
    parameters: SubAgentParams,
    async execute(
      _toolCallId: string,
      params: Static<typeof SubAgentParams>,
      _signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback,
    ): Promise<AgentToolResult<undefined>> {
      const { agent, instruction, bookId } = params;

      const progress = (msg: string) => {
        onUpdate?.(textResult(msg));
      };

      try {
        switch (agent) {
          case "architect": {
            // architect 只在没有书的时候可用（建书流程）
            if (activeBookId) {
              return textResult("当前已有书籍，不需要建书。如果你想创建新书，请先回到首页。");
            }
            const id = bookId || `book-${Date.now().toString(36)}`;
            progress(`Starting architect for book "${id}"...`);
            await pipeline.initBook(
              { id, genre: "general", title: "", language: "zh" } as any,
              { externalContext: instruction },
            );
            progress(`Architect finished — book "${id}" foundation created.`);
            return textResult(`Book "${id}" initialised successfully. Foundation files are ready.`);
          }

          case "writer": {
            if (!bookId) return textResult("Error: bookId is required for the writer agent.");
            progress(`Writing next chapter for "${bookId}"...`);
            const result = await pipeline.writeNextChapter(bookId);
            progress(`Writer finished chapter for "${bookId}".`);
            return textResult(
              `Chapter written for "${bookId}". ` +
              `Word count: ${(result as any).wordCount ?? "unknown"}.`,
            );
          }

          case "auditor": {
            if (!bookId) return textResult("Error: bookId is required for the auditor agent.");
            progress(`Auditing draft for "${bookId}"...`);
            const audit = await pipeline.auditDraft(bookId);
            progress(`Audit complete for "${bookId}".`);
            const issueCount = audit.issues?.length ?? 0;
            return textResult(
              `Audit complete for "${bookId}": ${issueCount} issue(s) found. ` +
              `Chapter ${audit.chapterNumber}.`,
            );
          }

          case "reviser": {
            if (!bookId) return textResult("Error: bookId is required for the reviser agent.");
            // Detect revision mode from instruction keywords
            const mode: ReviseMode = /rewrite|改写|重写/.test(instruction)
              ? "rewrite"
              : /polish|润色/.test(instruction)
                ? "polish"
                : /rework|返工/.test(instruction)
                  ? "rework"
                  : "spot-fix";
            progress(`Revising "${bookId}" in ${mode} mode...`);
            await pipeline.reviseDraft(bookId, undefined, mode);
            progress(`Revision complete for "${bookId}".`);
            return textResult(`Revision (${mode}) complete for "${bookId}".`);
          }

          case "exporter": {
            return textResult("Export is not yet implemented. Coming soon.");
          }

          default:
            return textResult(`Unknown agent: ${agent}`);
        }
      } catch (err: any) {
        console.error(`[sub_agent] "${agent}" failed:`, err);
        return textResult(`Sub-agent "${agent}" failed: ${err?.message ?? String(err)}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Read Tool
// ---------------------------------------------------------------------------

const ReadParams = Type.Object({
  path: Type.String({ description: "File path relative to books/, e.g. {bookId}/story/story_bible.md" }),
});

export function createReadTool(projectRoot: string): AgentTool<typeof ReadParams> {
  const booksRoot = join(projectRoot, "books");

  return {
    name: "read",
    description: "Read a file from the book directory. Path is relative to books/.",
    label: "Read File",
    parameters: ReadParams,
    async execute(
      _toolCallId: string,
      params: Static<typeof ReadParams>,
    ): Promise<AgentToolResult<undefined>> {
      try {
        const filePath = safeBooksPath(booksRoot, params.path);
        let content = await readFile(filePath, "utf-8");
        if (content.length > 10_000) {
          content = content.slice(0, 10_000) + "\n\n... [truncated at 10 000 chars]";
        }
        return textResult(content);
      } catch (err: any) {
        return textResult(`Failed to read "${params.path}": ${err?.message ?? String(err)}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Edit Tool
// ---------------------------------------------------------------------------

const EditParams = Type.Object({
  path: Type.String({ description: "File path relative to books/" }),
  old_string: Type.String({ description: "Exact string to find in the file" }),
  new_string: Type.String({ description: "Replacement string" }),
});

export function createEditTool(projectRoot: string): AgentTool<typeof EditParams> {
  const booksRoot = join(projectRoot, "books");

  return {
    name: "edit",
    description:
      "Edit a file using exact string replacement. " +
      "old_string must appear exactly once in the file. Path is relative to books/.",
    label: "Edit File",
    parameters: EditParams,
    async execute(
      _toolCallId: string,
      params: Static<typeof EditParams>,
    ): Promise<AgentToolResult<undefined>> {
      try {
        const filePath = safeBooksPath(booksRoot, params.path);
        const content = await readFile(filePath, "utf-8");
        const idx = content.indexOf(params.old_string);
        if (idx === -1) {
          return textResult(`old_string not found in "${params.path}".`);
        }
        if (content.indexOf(params.old_string, idx + 1) !== -1) {
          return textResult(`old_string appears more than once in "${params.path}". Provide a more specific match.`);
        }
        const updated = content.slice(0, idx) + params.new_string + content.slice(idx + params.old_string.length);
        await writeFile(filePath, updated, "utf-8");
        return textResult(`File "${params.path}" updated successfully.`);
      } catch (err: any) {
        return textResult(`Failed to edit "${params.path}": ${err?.message ?? String(err)}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 4. Grep Tool
// ---------------------------------------------------------------------------

const GrepParams = Type.Object({
  bookId: Type.String({ description: "Book ID to search within" }),
  pattern: Type.String({ description: "Search pattern (plain text or regex)" }),
});

export function createGrepTool(projectRoot: string): AgentTool<typeof GrepParams> {
  const booksRoot = join(projectRoot, "books");

  return {
    name: "grep",
    description:
      "Search for a text pattern across a book's story/ and chapters/ directories. Returns matching lines.",
    label: "Search",
    parameters: GrepParams,
    async execute(
      _toolCallId: string,
      params: Static<typeof GrepParams>,
    ): Promise<AgentToolResult<undefined>> {
      try {
        const bookDir = safeBooksPath(booksRoot, params.bookId);
        const regex = new RegExp(params.pattern, "gi");
        const results: string[] = [];

        async function searchDir(dir: string, prefix: string) {
          let entries: string[];
          try {
            entries = await readdir(dir);
          } catch {
            return; // directory doesn't exist
          }
          for (const entry of entries) {
            const fullPath = join(dir, entry);
            const entryStat = await stat(fullPath);
            if (entryStat.isDirectory()) {
              await searchDir(fullPath, `${prefix}${entry}/`);
            } else if (entry.endsWith(".md") || entry.endsWith(".txt") || entry.endsWith(".json")) {
              const content = await readFile(fullPath, "utf-8");
              const lines = content.split("\n");
              for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i])) {
                  results.push(`${prefix}${entry}:${i + 1}: ${lines[i]}`);
                  regex.lastIndex = 0; // reset for next test
                }
              }
            }
          }
        }

        await Promise.all([
          searchDir(join(bookDir, "story"), "story/"),
          searchDir(join(bookDir, "chapters"), "chapters/"),
        ]);

        if (results.length === 0) {
          return textResult(`No matches for "${params.pattern}" in book "${params.bookId}".`);
        }

        const truncated = results.length > 100
          ? results.slice(0, 100).join("\n") + `\n\n... [${results.length - 100} more matches]`
          : results.join("\n");

        return textResult(truncated);
      } catch (err: any) {
        return textResult(`Grep failed: ${err?.message ?? String(err)}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 5. Ls Tool
// ---------------------------------------------------------------------------

const LsParams = Type.Object({
  bookId: Type.String({ description: "Book ID" }),
  subdir: Type.Optional(
    Type.String({ description: "Subdirectory within the book, e.g. 'story', 'chapters', 'story/runtime'" }),
  ),
});

export function createLsTool(projectRoot: string): AgentTool<typeof LsParams> {
  const booksRoot = join(projectRoot, "books");

  return {
    name: "ls",
    description: "List files in a book directory. Optionally specify a subdirectory like 'story' or 'chapters'.",
    label: "List Files",
    parameters: LsParams,
    async execute(
      _toolCallId: string,
      params: Static<typeof LsParams>,
    ): Promise<AgentToolResult<undefined>> {
      try {
        const base = safeBooksPath(booksRoot, params.bookId);
        const target = params.subdir ? safeBooksPath(base, params.subdir) : base;

        const entries = await readdir(target);
        const details: string[] = [];

        for (const entry of entries) {
          const fullPath = join(target, entry);
          try {
            const entryStat = await stat(fullPath);
            const suffix = entryStat.isDirectory() ? "/" : ` (${entryStat.size} bytes)`;
            details.push(`${entry}${suffix}`);
          } catch {
            details.push(entry);
          }
        }

        if (details.length === 0) {
          return textResult(`Directory is empty: ${params.bookId}/${params.subdir ?? ""}`);
        }

        return textResult(details.join("\n"));
      } catch (err: any) {
        return textResult(`Failed to list "${params.bookId}/${params.subdir ?? ""}": ${err?.message ?? String(err)}`);
      }
    },
  };
}
