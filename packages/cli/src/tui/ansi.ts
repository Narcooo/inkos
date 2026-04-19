/* ── ANSI terminal helpers ── zero dependencies ── */

export const reset = "\x1b[0m";
export const bold = "\x1b[1m";
export const dim = "\x1b[2m";
export const italic = "\x1b[3m";

export const red = "\x1b[31m";
export const green = "\x1b[32m";
export const yellow = "\x1b[33m";
export const blue = "\x1b[34m";
export const magenta = "\x1b[35m";
export const cyan = "\x1b[36m";
export const white = "\x1b[37m";
export const gray = "\x1b[90m";
export const brightRed = "\x1b[91m";
export const brightGreen = "\x1b[92m";
export const brightYellow = "\x1b[93m";
export const brightBlue = "\x1b[94m";
export const brightMagenta = "\x1b[95m";
export const brightCyan = "\x1b[96m";
export const brightWhite = "\x1b[97m";

export const bgCyan = "\x1b[46m";
export const bgBlue = "\x1b[44m";
export const bgMagenta = "\x1b[45m";
export const bgGreen = "\x1b[42m";
export const bgYellow = "\x1b[43m";
export const bgRed = "\x1b[41m";
export const bgGray = "\x1b[100m";

export const clearScreen = "\x1b[2J\x1b[H";
export const showCursor = "\x1b[?25h";
export const hideCursor = "\x1b[?25l";
export const clearLine = "\x1b[2K\r";
export const saveCursor = "\x1b[s";
export const restoreCursor = "\x1b[u";

export function c(text: string, ...codes: string[]): string {
  return `${codes.join("")}${text}${reset}`;
}

export function termWidth(): number {
  return process.stdout.columns ?? 80;
}

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export function hr(char = "─"): string {
  return char.repeat(Math.min(termWidth(), 60));
}

export function box(lines: string[], width = 56): string {
  const top = `╭${"─".repeat(width - 2)}╮`;
  const bot = `╰${"─".repeat(width - 2)}╯`;
  const rows = lines.map((line) => {
    const visible = stripAnsi(line);
    const pad = Math.max(0, width - 2 - visible.length);
    return `│${line}${" ".repeat(pad)}│`;
  });
  return [top, ...rows, bot].join("\n");
}

export function badge(text: string, bg: string, fg: string = brightWhite): string {
  return `${bg}${fg}${bold} ${text} ${reset}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
