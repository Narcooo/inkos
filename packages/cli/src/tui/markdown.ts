import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";
import { isAppleTerminal } from "./theme.js";

const marked = new Marked();
marked.use(markedTerminal({
  // Terminal width minus paddingX(2*2) + prefix(2) + margin(2) = 8, plus extra 2 for safety
  width: Math.min(process.stdout.columns ?? 80, 100) - 10,
  reflowText: true,
  showSectionPrefix: false,
  tab: 2,
  // Preserve inline formatting through reflow: keep ** markers as plain text
  // so reflowText won't split ANSI codes across lines. Post-process converts them.
  listitem: (text: string) => text,
  strong: (text: string) => `**${text}**`,
  // cli-table3 defaults table headers to red; disable to inherit parent color
  tableOptions: { style: { head: [] } },
}) as never);

const BOLD_ON = "\x1b[1m";
const BOLD_OFF = "\x1b[22m";

/** Strip ALL ANSI escape sequences from a string. */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

/**
 * Full post-processing for terminals with ANSI support (iTerm2, etc.):
 * 1. Strip \x1b[0m (full reset) that overrides Ink's <Text color>
 * 2. Replace `* ` bullets with `· `
 * 3. Convert `**text**` markers to ANSI bold
 */
function postProcess(text: string): string {
  return text
    .replace(/\x1b\[0m/g, "")
    .replace(/^(\s*)\* /gm, "$1· ")
    .replace(/\*\*(.+?)\*\*/g, `${BOLD_ON}$1${BOLD_OFF}`);
}

/**
 * Terminal.app post-processing: use marked-terminal for layout (tables,
 * lists, indentation) but strip ALL ANSI codes. Box-drawing characters
 * (┌─┐│└┘) are plain Unicode and survive the strip.
 */
function postProcessPlain(text: string): string {
  return stripAnsi(text)
    .replace(/^(\s*)\* /gm, "$1· ")
    .replace(/\*\*(.+?)\*\*/g, "$1");
}

export function renderMarkdown(text: string): string {
  try {
    const rendered = marked.parse(text);
    if (typeof rendered !== "string") {
      return text;
    }
    const trimmed = rendered.replace(/\n+$/, "");
    return isAppleTerminal ? postProcessPlain(trimmed) : postProcess(trimmed);
  } catch {
    return text;
  }
}
