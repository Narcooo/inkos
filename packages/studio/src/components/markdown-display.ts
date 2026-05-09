const YAML_KEY_PATTERN = /^\s{0,4}[A-Za-z_][\w.-]*\s*:/;
const YAML_LIST_PATTERN = /^\s{0,6}-\s+\S/;

export const MARKDOWN_DOCUMENT_CLASS =
  "text-sm leading-7 text-foreground/85 " +
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 " +
  "[&_h1]:text-lg [&_h1]:font-semibold [&_h1]:text-foreground [&_h1]:mb-3 " +
  "[&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mt-5 [&_h2]:mb-2 " +
  "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-foreground [&_h3]:mt-4 [&_h3]:mb-1.5 " +
  "[&_p]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/30 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground " +
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 " +
  "[&_strong]:text-foreground [&_strong]:font-semibold " +
  "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border/40 [&_pre]:bg-muted/30 [&_pre]:p-3 " +
  "[&_pre_code]:whitespace-pre [&_pre_code]:font-mono [&_pre_code]:text-xs [&_pre_code]:leading-5 " +
  "[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-secondary/70 [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:text-xs";

function looksLikeYamlBlock(lines: ReadonlyArray<string>): boolean {
  return lines.some((line) => YAML_KEY_PATTERN.test(line) || YAML_LIST_PATTERN.test(line));
}

export function normalizeMarkdownForDisplay(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const result: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() !== "---") {
      result.push(line);
      continue;
    }

    let closingIndex = -1;
    for (let scan = index + 1; scan < lines.length; scan += 1) {
      if (lines[scan].trim() === "---") {
        closingIndex = scan;
        break;
      }
    }

    if (closingIndex === -1) {
      result.push(line);
      continue;
    }

    const body = lines.slice(index + 1, closingIndex);
    if (!looksLikeYamlBlock(body)) {
      result.push(line);
      continue;
    }

    result.push("```yaml", ...body, "```");
    index = closingIndex;
  }

  return result.join("\n");
}
