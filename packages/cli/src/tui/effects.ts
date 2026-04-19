/* ── TUI animation effects ── */

import {
  c, bold, dim, italic,
  cyan, green, yellow, blue, magenta, red, gray, white,
  brightCyan, brightGreen, brightYellow, brightBlue, brightMagenta, brightWhite,
  bgCyan, bgBlue, bgMagenta, bgGreen, bgYellow, bgRed, bgGray,
  clearLine, hideCursor, showCursor, reset,
  badge, sleep, stripAnsi, box,
} from "./ansi.js";
import { formatModeLabel, getTuiCopy, normalizeStageLabel, resolveTuiLocale, type TuiLocale } from "./i18n.js";

/* ── Operation themes ── */

export interface OperationTheme {
  readonly icon: string;
  readonly color: string;
  readonly brightColor: string;
  readonly bg: string;
  readonly label: string;
  readonly frames: ReadonlyArray<string>;
}

export interface StyledHelpSection {
  readonly title: string;
  readonly commands: ReadonlyArray<readonly [string, string]>;
}

const WAVE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const PULSE_FRAMES = ["◜", "◠", "◝", "◞", "◡", "◟"];
const DOTS_FRAMES = ["·  ", "·· ", "···", " ··", "  ·", "   "];
const SCAN_FRAMES = ["▱▱▱▱▱", "▰▱▱▱▱", "▰▰▱▱▱", "▰▰▰▱▱", "▰▰▰▰▱", "▰▰▰▰▰", "▱▰▰▰▰", "▱▱▰▰▰", "▱▱▱▰▰", "▱▱▱▱▰"];
const WRITE_FRAMES = ["✎", "✎·", "✎··", "✎···", "✎····", "✎···", "✎··", "✎·"];

export const THEMES: Record<string, OperationTheme> = {
  thinking: {
    icon: "◇",
    color: cyan,
    brightColor: brightCyan,
    bg: bgCyan,
    label: "thinking",
    frames: DOTS_FRAMES,
  },
  writing: {
    icon: "✎",
    color: magenta,
    brightColor: brightMagenta,
    bg: bgMagenta,
    label: "writing",
    frames: WRITE_FRAMES,
  },
  auditing: {
    icon: "◉",
    color: yellow,
    brightColor: brightYellow,
    bg: bgYellow,
    label: "auditing",
    frames: SCAN_FRAMES,
  },
  revising: {
    icon: "✂",
    color: blue,
    brightColor: brightBlue,
    bg: bgBlue,
    label: "revising",
    frames: WAVE_FRAMES,
  },
  planning: {
    icon: "◈",
    color: cyan,
    brightColor: brightCyan,
    bg: bgCyan,
    label: "planning",
    frames: PULSE_FRAMES,
  },
  composing: {
    icon: "❖",
    color: green,
    brightColor: brightGreen,
    bg: bgGreen,
    label: "composing",
    frames: PULSE_FRAMES,
  },
  loading: {
    icon: "◌",
    color: gray,
    brightColor: white,
    bg: bgGray,
    label: "loading",
    frames: WAVE_FRAMES,
  },
};

/* ── Animated spinner with themed operations ── */

export class ThemedSpinner {
  private interval: ReturnType<typeof setInterval> | undefined;
  private frame = 0;
  private elapsed = 0;
  private theme: OperationTheme;

  constructor(themeName = "thinking") {
    this.theme = THEMES[themeName] ?? THEMES["thinking"]!;
  }

  start(label?: string): void {
    const displayLabel = label ?? localizeThemeLabel(this.theme.label, resolveTuiLocale());
    this.frame = 0;
    this.elapsed = 0;
    process.stdout.write(hideCursor);

    this.interval = setInterval(() => {
      this.elapsed += 120;
      const f = this.theme.frames[this.frame % this.theme.frames.length]!;
      const icon = c(this.theme.icon, this.theme.color);
      const anim = c(f, this.theme.brightColor);
      const text = c(displayLabel, dim);
      const time = this.elapsed >= 3000
        ? c(` ${formatElapsed(this.elapsed)}`, gray)
        : "";
      process.stdout.write(`${clearLine}  ${icon} ${text} ${anim}${time}`);
      this.frame++;
    }, 120);
  }

  update(label: string): void {
    if (!this.interval) return;
    this.stop();
    this.start(label);
  }

  succeed(message?: string): void {
    this.clear();
    if (message) {
      console.log(`  ${c("✓", brightGreen, bold)} ${message}`);
    }
  }

  fail(message?: string): void {
    this.clear();
    if (message) {
      console.log(`  ${c("✗", red, bold)} ${message}`);
    }
  }

  stop(): void {
    this.clear();
  }

  private clear(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    process.stdout.write(`${clearLine}${showCursor}`);
  }
}

/* ── ASCII Art Logo ── */

const ASCII_LOGO = [
  " ██╗███╗   ██╗██╗  ██╗ ██████╗ ███████╗",
  " ██║████╗  ██║██║ ██╔╝██╔═══██╗██╔════╝",
  " ██║██╔██╗ ██║█████╔╝ ██║   ██║███████╗",
  " ██║██║╚██╗██║██╔═██╗ ██║   ██║╚════██║",
  " ██║██║ ╚████║██║  ██╗╚██████╔╝███████║",
  " ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝",
];

/* ── Input area ── */

/* ── Input chrome ── */

export function inputPromptPrefix(): string {
  return `  ${c("›", cyan)} `;
}

export function drawInputHint(): void {
  // Keep the prompt anchored to the next line; extra blank lines confuse
  // terminal UIs that render readline prompts inside a framed input block.
}

export function printInputSeparator(): void {
  const w = Math.min(process.stdout.columns ?? 60, 60);
  console.log(c("  " + "─".repeat(w - 4), gray));
}

/* ── Startup animation ── */

export interface StartupModelInfo {
  readonly provider: string;
  readonly model: string;
}

export async function animateStartup(version: string, projectName: string, bookTitle?: string, modelInfo?: StartupModelInfo): Promise<void> {
  const isTTY = process.stdout.isTTY;

  if (isTTY) {
    console.log();
    process.stdout.write(hideCursor);

    // Animate ASCII logo line by line
    for (let i = 0; i < ASCII_LOGO.length; i++) {
      const line = ASCII_LOGO[i]!;
      const shade = i < 2 ? brightCyan : i < 4 ? cyan : dim + cyan;
      process.stdout.write(`  ${c(line, shade)}\n`);
      await sleep(40);
    }

    // Version line
    console.log(c(`  v${version}`, dim));
    await sleep(100);

    // Project info strip
    const infoParts = [
      c("◇", cyan) + " " + c(projectName, white, bold),
    ];
    if (bookTitle) {
      infoParts.push(c("◇", cyan) + " " + c(bookTitle, brightCyan));
    }
    if (modelInfo?.model && modelInfo.model !== "unknown") {
      infoParts.push(c("◇", cyan) + " " + c(`${modelInfo.model} (${modelInfo.provider})`, dim));
    }
    console.log();
    for (const part of infoParts) {
      console.log(`  ${part}`);
      await sleep(60);
    }

    process.stdout.write(showCursor);
  } else {
    console.log();
    for (const line of ASCII_LOGO) {
      console.log(`  ${c(line, brightCyan)}`);
    }
    console.log(c(`  v${version}`, dim));
  }
  console.log();
}

/* ── Typewriter effect ── */

async function typewrite(text: string, charDelay = 12): Promise<void> {
  const chars = text.split("");
  let i = 0;
  let insideEscape = false;

  for (const ch of chars) {
    process.stdout.write(ch);
    if (ch === "\x1b") insideEscape = true;
    if (insideEscape) {
      if (ch === "m") insideEscape = false;
      continue;
    }
    i++;
    if (i % 2 === 0) await sleep(charDelay);
  }
  process.stdout.write("\n");
}

/* ── Result display ── */

export function formatResultCard(content: string, intent?: string): string {
  const lines: string[] = [];

  if (intent) {
    const intentBadge = intentToBadge(intent);
    lines.push(`  ${intentBadge}`);
    lines.push("");
  }

  for (const line of content.split("\n")) {
    lines.push(`  ${line}`);
  }

  return lines.join("\n");
}

export function intentToBadge(intent: string, locale: TuiLocale = resolveTuiLocale()): string {
  const labels = locale === "en"
    ? {
        write_next: " WRITE ",
        revise_chapter: " REVISE ",
        rewrite_chapter: " REWRITE ",
        update_focus: " FOCUS ",
        explain_status: " STATUS ",
        explain_failure: " DEBUG ",
        pause_book: " PAUSE ",
        list_books: " BOOKS ",
        select_book: " SELECT ",
        switch_mode: " MODE ",
        rename_entity: " RENAME ",
        patch_chapter_text: " PATCH ",
        edit_truth: " TRUTH ",
      }
    : {
        write_next: " 写作 ",
        revise_chapter: " 修订 ",
        rewrite_chapter: " 重写 ",
        update_focus: " 焦点 ",
        explain_status: " 状态 ",
        explain_failure: " 调试 ",
        pause_book: " 暂停 ",
        list_books: " 作品 ",
        select_book: " 选择 ",
        switch_mode: " 模式 ",
        rename_entity: " 改名 ",
        patch_chapter_text: " 修补 ",
        edit_truth: " 真相 ",
      };
  const backgrounds: Record<string, string> = {
    write_next: bgMagenta,
    revise_chapter: bgBlue,
    rewrite_chapter: bgBlue,
    update_focus: bgCyan,
    explain_status: bgGray,
    explain_failure: bgRed,
    pause_book: bgYellow,
    list_books: bgGray,
    select_book: bgGreen,
    switch_mode: bgCyan,
    rename_entity: bgYellow,
    patch_chapter_text: bgBlue,
    edit_truth: bgGreen,
  };
  const label = labels[intent as keyof typeof labels] ?? ` ${intent} `;
  const bg = backgrounds[intent] ?? bgGray;
  return badge(label, bg);
}

/* ── Intent to spinner theme ── */

export function intentToTheme(intent: string): string {
  const map: Record<string, string> = {
    write_next: "writing",
    revise_chapter: "revising",
    rewrite_chapter: "revising",
    update_focus: "composing",
    explain_status: "loading",
    explain_failure: "thinking",
    pause_book: "loading",
    list_books: "loading",
    select_book: "loading",
    switch_mode: "loading",
    rename_entity: "composing",
    patch_chapter_text: "revising",
    edit_truth: "composing",
  };
  return map[intent] ?? "thinking";
}

/* ── Help display ── */

export function printStyledHelp(): void {
  const locale = resolveTuiLocale();
  const sections = buildStyledHelpSections(locale);
  const footer = buildHelpFooter(locale);

  console.log();
  for (const section of sections) {
    console.log(`  ${c(section.title, bold, cyan)}`);
    for (const [cmd, desc] of section.commands) {
      const cmdStr = c(cmd, green);
      const descStr = c(desc, dim);
      const padding = " ".repeat(Math.max(1, 24 - stripAnsi(cmd).length));
      console.log(`    ${cmdStr}${padding}${descStr}`);
    }
    console.log();
  }
  console.log(c(`  ${footer.title}`, dim));
  for (const example of footer.examples) {
    console.log(c(`  ${example}`, dim, italic));
  }
  console.log();
}

/* ── Status display ── */

export function printStyledStatus(params: {
  readonly mode: string;
  readonly bookId?: string;
  readonly status: string;
  readonly events: ReadonlyArray<{ readonly kind: string; readonly detail?: string; readonly status: string }>;
}): void {
  const locale = resolveTuiLocale();
  console.log();
  for (const line of formatStyledStatusLines(locale, params)) {
    console.log(line);
  }
  console.log();
}

export function formatStyledStatusLines(
  locale: TuiLocale,
  params: {
    readonly mode: string;
    readonly bookId?: string;
    readonly status: string;
    readonly events: ReadonlyArray<{ readonly kind: string; readonly detail?: string; readonly status: string }>;
  },
): string[] {
  const copy = getTuiCopy(locale);
  const modeColors: Record<string, string> = {
    auto: green,
    semi: yellow,
    manual: blue,
  };
  const modeColor = modeColors[params.mode] ?? gray;
  const statusColors: Record<string, string> = {
    idle: gray,
    running: cyan,
    writing: magenta,
    auditing: yellow,
    completed: green,
    failed: red,
    waiting_human: brightYellow,
  };
  const statusColor = statusColors[params.status] ?? gray;
  const modeLabel = copy.labels.mode;
  const bookLabel = copy.labels.book;
  const statusLabel = copy.labels.stage;
  const recentLabel = copy.labels.recent;
  const lines = [
    `  ${c("◇", cyan)} ${c(modeLabel, gray)}     ${c(formatModeLabel(params.mode, copy), modeColor, bold)}`,
    `  ${c("◇", cyan)} ${c(bookLabel, gray)}     ${params.bookId ? c(params.bookId, brightWhite) : c(copy.labels.none, dim)}`,
    `  ${c("◇", cyan)} ${c(statusLabel, gray)}   ${c(normalizeStageLabel(params.status, copy), statusColor)}`,
  ];
  if (params.events.length > 0) {
    lines.push(`  ${c("◇", cyan)} ${c(recentLabel, gray)}`);
    for (const ev of params.events.slice(-3)) {
      const icon = ev.status === "completed" ? c("✓", green) : c("·", gray);
      lines.push(`        ${icon} ${c(`${ev.kind}`, dim)} ${c(ev.detail ?? "", gray)}`);
    }
  }
  return lines;
}

/* ── Utilities ── */

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${s % 60}s`;
}

export function buildStyledHelpSections(locale: TuiLocale = resolveTuiLocale()): StyledHelpSection[] {
  if (locale === "en") {
    return [
      {
        title: "Writing",
        commands: [
          ["/write", "Write the next chapter (full pipeline)"],
          ["/rewrite <n>", "Rewrite chapter N from scratch"],
        ],
      },
      {
        title: "Navigation",
        commands: [
          ["/books", "List all books"],
          ["/open <book>", "Select active book"],
          ["/status", "Show current status"],
        ],
      },
      {
        title: "Control",
        commands: [
          ["/mode <auto|semi|manual>", "Switch automation mode"],
          ["/focus <text>", "Update current focus"],
        ],
      },
      {
        title: "Session",
        commands: [
          ["/clear", "Clear screen"],
          ["/help", "Show this help"],
          ["/quit", "Exit InkOS TUI"],
        ],
      },
    ];
  }

  return [
    {
      title: "写作",
      commands: [
        ["/write", "完整跑一轮下一章写作"],
        ["/rewrite <n>", "从头重写第 N 章"],
      ],
    },
    {
      title: "导航",
      commands: [
        ["/books", "列出全部作品"],
        ["/open <book>", "切换当前作品"],
        ["/status", "查看当前状态"],
      ],
    },
    {
      title: "控制",
      commands: [
        ["/mode <auto|semi|manual>", "切换自动化模式"],
        ["/focus <text>", "更新当前焦点"],
      ],
    },
    {
      title: "会话",
      commands: [
        ["/clear", "清空当前屏幕"],
        ["/help", "显示帮助"],
        ["/quit", "退出 InkOS TUI"],
      ],
    },
  ];
}

function buildHelpFooter(locale: TuiLocale): { readonly title: string; readonly examples: readonly string[] } {
  if (locale === "en") {
    return {
      title: "Natural language also works:",
      examples: ['"continue writing" "write next chapter" "pause" "rename Lin Jin to Zhang San"'],
    };
  }

  return {
    title: "自然语言同样可用：",
    examples: ['"继续写" "写下一章" "暂停" "把林烬改成张三"'],
  };
}

function localizeThemeLabel(label: string, locale: TuiLocale): string {
  if (locale === "en") {
    return label;
  }

  const labels: Record<string, string> = {
    thinking: "思考中",
    writing: "写作中",
    auditing: "审计中",
    revising: "修订中",
    planning: "规划中",
    composing: "生成中",
    loading: "加载中",
  };
  return labels[label] ?? label;
}
