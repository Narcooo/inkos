import { useMemo } from "react";
import type { Theme } from "../../hooks/use-theme";
import { InlineField } from "./InlineField";
import { InlinePick } from "./InlinePick";
import { InlineGroup } from "./InlineGroup";

export interface StreamMessageProps {
  readonly content: string;
  readonly onFieldChange: (key: string, value: string) => void;
  readonly fieldValues: Record<string, string>;
  readonly theme: Theme;
}

// ---------------------------------------------------------------------------
// Directive-aware parser — same syntax as core's draft-directive-parser
// but instead of extracting values, it produces a renderable node list.
// ---------------------------------------------------------------------------

const DIRECTIVE_OPEN_RE = /^:::(field|pick|number|group)\{(.+)\}\s*$/;
const DIRECTIVE_CLOSE_RE = /^:::\s*$/;
const CODE_FENCE_RE = /^(`{3,}|~{3,})/;
const LIST_ITEM_RE = /^-\s+(.+)$/;

interface DirectiveAttrs {
  type: string;
  key?: string;
  label?: string;
  fieldType?: string;
}

function parseAttrs(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
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
// Intermediate representation for rendering
// ---------------------------------------------------------------------------

interface TextNode {
  kind: "text";
  text: string;
}

interface FieldNode {
  kind: "field";
  fieldKey: string;
  label: string;
  fieldType: "text" | "textarea" | "number";
}

interface PickNode {
  kind: "pick";
  fieldKey: string;
  label: string;
  options: string[];
}

interface GroupNode {
  kind: "group";
  label: string;
  children: RenderNode[];
}

type RenderNode = TextNode | FieldNode | PickNode | GroupNode;

// ---------------------------------------------------------------------------
// Parse content string into a flat list of render nodes
// ---------------------------------------------------------------------------

function parseContentToNodes(content: string): RenderNode[] {
  const lines = content.split("\n");
  const result: RenderNode[] = [];
  let textBuf: string[] = [];

  type ParserMode = "text" | "directive" | "codeblock";
  let mode: ParserMode = "text";
  let codeFenceMarker = "";

  interface DirectiveFrame {
    attrs: DirectiveAttrs;
    contentLines: string[];
    childNodes: RenderNode[];
  }
  const stack: DirectiveFrame[] = [];

  function flushText() {
    if (textBuf.length > 0) {
      const text = textBuf.join("\n");
      if (text.trim()) {
        result.push({ kind: "text", text });
      }
      textBuf = [];
    }
  }

  function buildNodeFromFrame(frame: DirectiveFrame): RenderNode | null {
    const { attrs, contentLines, childNodes } = frame;

    if (attrs.type === "group") {
      return {
        kind: "group",
        label: attrs.label ?? "",
        children: childNodes,
      };
    }

    if (attrs.type === "pick" && attrs.key) {
      const options: string[] = [];
      for (const line of contentLines) {
        const m = LIST_ITEM_RE.exec(line.trim());
        if (m) options.push(m[1]!.trim());
      }
      return {
        kind: "pick",
        fieldKey: attrs.key,
        label: attrs.label ?? attrs.key,
        options,
      };
    }

    if ((attrs.type === "field" || attrs.type === "number") && attrs.key) {
      let fieldType: "text" | "textarea" | "number" = "text";
      if (attrs.type === "number") fieldType = "number";
      else if (attrs.fieldType === "textarea") fieldType = "textarea";
      else if (attrs.fieldType === "number") fieldType = "number";

      return {
        kind: "field",
        fieldKey: attrs.key,
        label: attrs.label ?? attrs.key,
        fieldType,
      };
    }

    return null;
  }

  for (const line of lines) {
    // --- Code-block handling ---
    if (mode === "codeblock") {
      textBuf.push(line);
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
        textBuf.push(line);
        continue;
      }
    }

    // --- Directive close ---
    if (DIRECTIVE_CLOSE_RE.test(line) && stack.length > 0) {
      const frame = stack.pop()!;
      const node = buildNodeFromFrame(frame);

      if (stack.length > 0) {
        // Nested directive closed — add to parent's children
        if (node) {
          stack[stack.length - 1]!.childNodes.push(node);
        }
      } else {
        // Top-level directive closed
        flushText();
        if (node) result.push(node);
        mode = "text";
      }
      continue;
    }

    // --- Directive open ---
    const directiveOpen = parseDirectiveOpen(line);
    if (directiveOpen) {
      if (mode === "text") {
        flushText();
      }
      stack.push({ attrs: directiveOpen, contentLines: [], childNodes: [] });
      mode = "directive";
      continue;
    }

    // --- Inside directive ---
    if (mode === "directive" && stack.length > 0) {
      stack[stack.length - 1]!.contentLines.push(line);
      continue;
    }

    // --- Normal text ---
    textBuf.push(line);
  }

  flushText();
  return result;
}

// ---------------------------------------------------------------------------
// Render nodes
// ---------------------------------------------------------------------------

/** Minimal markdown → HTML: bold, paragraphs, line breaks. */
function renderMarkdownHtml(text: string): string {
  return text
    // Escape HTML entities
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Bold: **text** (non-greedy, no nested *)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    // Paragraphs: double newline
    .replace(/\n{2,}/g, '</p><p class="mt-3">')
    // Single newline → <br>
    .replace(/\n/g, "<br />");
}

function TextBlock({ text }: { readonly text: string }) {
  const html = renderMarkdownHtml(text);
  return (
    <div
      className="text-sm leading-7 text-foreground"
      dangerouslySetInnerHTML={{ __html: `<p>${html}</p>` }}
    />
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function StreamMessage({ content, onFieldChange, fieldValues, theme }: StreamMessageProps) {
  const nodes = useMemo(() => parseContentToNodes(content), [content]);

  function renderNode(node: RenderNode, index: number): React.ReactNode {
    switch (node.kind) {
      case "text":
        return <TextBlock key={`text-${index}`} text={node.text} />;

      case "field":
        return (
          <InlineField
            key={`field-${node.fieldKey}`}
            fieldKey={node.fieldKey}
            label={node.label}
            value={fieldValues[node.fieldKey] ?? ""}
            type={node.fieldType}
            onChange={onFieldChange}
            theme={theme}
          />
        );

      case "pick":
        return (
          <InlinePick
            key={`pick-${node.fieldKey}`}
            fieldKey={node.fieldKey}
            label={node.label}
            options={node.options}
            selected={fieldValues[node.fieldKey] ?? ""}
            onChange={onFieldChange}
            theme={theme}
          />
        );

      case "group":
        return (
          <InlineGroup key={`group-${index}`} label={node.label}>
            {node.children.map((child, i) => renderNode(child, i))}
          </InlineGroup>
        );

      default:
        return null;
    }
  }

  return (
    <div className="space-y-1">
      {nodes.map((node, i) => renderNode(node, i))}
    </div>
  );
}
