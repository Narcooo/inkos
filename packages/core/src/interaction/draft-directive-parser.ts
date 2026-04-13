/**
 * Draft directive parser — extracts structured form data from LLM output
 * that uses markdown directive syntax (:::type{attrs}...:::).
 *
 * Used by both TUI (textContent) and Studio (raw + fields).
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ParsedDraftResponse {
  /** key → value extracted from directive blocks */
  fields: Record<string, string>;
  /** Raw text with all ::: directive blocks stripped (for TUI display) */
  textContent: string;
  /** Auto-generated turn summary, e.g. "确立了书名、世界观和主角" */
  summary: string;
  /** Original LLM output, untouched */
  raw: string;
}

// ---------------------------------------------------------------------------
// Attribute parsing
// ---------------------------------------------------------------------------

interface DirectiveAttrs {
  type: string; // "field" | "pick" | "number" | "group"
  key?: string;
  label?: string;
  fieldType?: string; // the `type` attribute on field directives
}

const DIRECTIVE_OPEN_RE = /^:::(field|pick|number|group)\{(.+)\}\s*$/;
const DIRECTIVE_CLOSE_RE = /^:::\s*$/;
const CODE_FENCE_RE = /^(`{3,}|~{3,})/;
const LIST_ITEM_RE = /^-\s+(.+)$/;

function parseAttrs(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  // Match key="value" or key='value'
  const re = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrStr)) !== null) {
    attrs[m[1]!] = m[2] ?? m[3] ?? "";
  }
  return attrs;
}

function parseDirectiveOpen(line: string): DirectiveAttrs | null {
  const m = DIRECTIVE_OPEN_RE.exec(line);
  if (!m) return null;
  const type = m[1]!;
  const rawAttrs = parseAttrs(m[2]!);
  return {
    type,
    key: rawAttrs["key"],
    label: rawAttrs["label"],
    fieldType: rawAttrs["type"],
  };
}

// ---------------------------------------------------------------------------
// State machine for full-text parsing
// ---------------------------------------------------------------------------

type ParserMode = "text" | "directive" | "codeblock";

interface DirectiveFrame {
  attrs: DirectiveAttrs;
  contentLines: string[];
}

/**
 * Parse raw LLM output containing markdown directive blocks.
 *
 * State machine:
 *   text → directive (on :::type{...})
 *   text → codeblock (on ``` or ~~~)
 *   directive → text (on standalone :::)
 *   directive → directive (on nested :::type{...} inside group)
 *   codeblock → text (on matching fence close)
 */
export function parseDraftDirectives(raw: string): ParsedDraftResponse {
  const lines = raw.split("\n");
  const fields: Record<string, string> = {};
  const labels: string[] = [];
  const textLines: string[] = [];

  let mode: ParserMode = "text";
  let codeFenceMarker = "";
  // Stack of open directives — supports nesting (group > field/number).
  const stack: DirectiveFrame[] = [];

  for (const line of lines) {
    // --- Code-block handling (highest priority) ---
    if (mode === "codeblock") {
      textLines.push(line);
      if (CODE_FENCE_RE.test(line) && line.trimStart().startsWith(codeFenceMarker)) {
        mode = "text";
        codeFenceMarker = "";
      }
      continue;
    }

    if (mode === "text") {
      const fenceMatch = CODE_FENCE_RE.exec(line);
      if (fenceMatch) {
        codeFenceMarker = fenceMatch[1]!;
        mode = "codeblock";
        textLines.push(line);
        continue;
      }
    }

    // --- Directive close (standalone :::) ---
    if (DIRECTIVE_CLOSE_RE.test(line) && stack.length > 0) {
      const frame = stack.pop()!;
      const { attrs, contentLines } = frame;

      if (attrs.type !== "group" && attrs.key) {
        const value = extractValue(attrs.type, contentLines);
        fields[attrs.key] = value;
        if (attrs.label) {
          labels.push(attrs.label);
        }
      }

      // If we just closed the last frame, we're back in text mode
      if (stack.length === 0) {
        mode = "text";
      }
      continue;
    }

    // --- Directive open ---
    const directiveOpen = parseDirectiveOpen(line);
    if (directiveOpen) {
      stack.push({ attrs: directiveOpen, contentLines: [] });
      mode = "directive";
      continue;
    }

    // --- Inside a directive: collect content ---
    if (mode === "directive" && stack.length > 0) {
      stack[stack.length - 1]!.contentLines.push(line);
      continue;
    }

    // --- Normal text ---
    textLines.push(line);
  }

  return {
    fields,
    textContent: textLines.join("\n"),
    summary: buildSummary(labels),
    raw,
  };
}

// ---------------------------------------------------------------------------
// Value extraction per directive type
// ---------------------------------------------------------------------------

function extractValue(type: string, contentLines: string[]): string {
  if (type === "pick") {
    // Extract first list item value
    for (const line of contentLines) {
      const m = LIST_ITEM_RE.exec(line.trim());
      if (m) return m[1]!.trim();
    }
    return "";
  }

  // field, number — join all content lines, trim surrounding whitespace
  return contentLines.join("\n").trim();
}

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

function buildSummary(labels: string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return `确立了${labels[0]}`;
  if (labels.length === 2) return `确立了${labels[0]}和${labels[1]}`;
  // 3+: 确立了A、B和C
  const allButLast = labels.slice(0, -1).join("、");
  return `确立了${allButLast}和${labels[labels.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Streaming filter
// ---------------------------------------------------------------------------

/**
 * Creates a stateful filter function for streaming LLM output.
 * Text portions pass through immediately; directive blocks (:::...:::)
 * are buffered and suppressed.
 *
 * Usage:
 *   const filter = createDirectiveStreamFilter();
 *   onChunk(chunk => { const visible = filter(chunk); display(visible); });
 */
export function createDirectiveStreamFilter(): (chunk: string) => string {
  let depth = 0; // nesting depth of open directives
  let inCodeBlock = false;
  let codeFenceMarker = "";

  return (chunk: string): string => {
    const lines = chunk.split("\n");
    const outputParts: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const isLastLine = i === lines.length - 1;

      // --- Code-block toggle ---
      if (inCodeBlock) {
        if (CODE_FENCE_RE.test(line) && line.trimStart().startsWith(codeFenceMarker)) {
          inCodeBlock = false;
          codeFenceMarker = "";
        }
        outputParts.push(line);
        if (!isLastLine) outputParts.push("\n");
        continue;
      }

      // Detect code-fence opening (only outside directives)
      if (depth === 0) {
        const fenceMatch = CODE_FENCE_RE.exec(line);
        if (fenceMatch) {
          inCodeBlock = true;
          codeFenceMarker = fenceMatch[1]!;
          outputParts.push(line);
          if (!isLastLine) outputParts.push("\n");
          continue;
        }
      }

      // --- Directive open ---
      if (parseDirectiveOpen(line)) {
        depth++;
        continue;
      }

      // --- Directive close ---
      if (DIRECTIVE_CLOSE_RE.test(line) && depth > 0) {
        depth--;
        continue;
      }

      // --- Inside directive: suppress ---
      if (depth > 0) {
        continue;
      }

      // --- Normal text: pass through ---
      outputParts.push(line);
      if (!isLastLine) outputParts.push("\n");
    }

    return outputParts.join("");
  };
}
