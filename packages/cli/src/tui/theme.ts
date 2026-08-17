/** Whether the terminal is macOS Terminal.app. */
export const isAppleTerminal = process.env.TERM_PROGRAM === "Apple_Terminal";

export type TerminalBackground = "dark" | "light";

export interface TuiTheme {
  readonly accent: string;
  readonly muted: string;
  readonly reply: string;
  readonly border: string;
  readonly success: string;
  readonly error: string;
  readonly active: string;
  readonly idle: string;
  readonly user: string;
  readonly system: string;
}

const DARK_THEME: TuiTheme = {
  accent: "#d49a63",
  muted: "#b8aa99",
  reply: "#f7efe3",
  border: "#8f8173",
  success: "#8fd18f",
  error: "#ff6f6f",
  active: "#e0ad6f",
  idle: "#a79a8c",
  user: "#9bd3ef",
  system: "#c8b1ef",
};

const LIGHT_THEME: TuiTheme = {
  accent: "#8a4f18",
  muted: "#5f554b",
  reply: "#1f1711",
  border: "#7d7165",
  success: "#1b7f3a",
  error: "#b42318",
  active: "#9a5f1f",
  idle: "#6b6156",
  user: "#005f87",
  system: "#6b3fa0",
};

export function detectTerminalBackground(env: Partial<NodeJS.ProcessEnv> = process.env): TerminalBackground {
  const explicit = env.INKOS_TUI_THEME?.trim().toLowerCase();
  if (explicit === "light" || explicit === "dark") return explicit;

  const colorFgBg = env.COLORFGBG?.trim();
  if (colorFgBg) {
    const background = Number(colorFgBg.split(/[;:]/).at(-1));
    if (Number.isFinite(background)) return background === 7 || background === 15 ? "light" : "dark";
  }
  return "dark";
}

export function resolveTuiTheme(env: Partial<NodeJS.ProcessEnv> = process.env): TuiTheme {
  return detectTerminalBackground(env) === "light" ? LIGHT_THEME : DARK_THEME;
}

const CURRENT_THEME = resolveTuiTheme();

export const WARM_ACCENT = CURRENT_THEME.accent;
export const WARM_MUTED = CURRENT_THEME.muted;
export const WARM_REPLY = CURRENT_THEME.reply;
export const WARM_BORDER = CURRENT_THEME.border;
export const STATUS_SUCCESS = CURRENT_THEME.success;
export const STATUS_ERROR = CURRENT_THEME.error;
export const STATUS_ACTIVE = CURRENT_THEME.active;
export const STATUS_IDLE = CURRENT_THEME.idle;
export const ROLE_USER = CURRENT_THEME.user;
export const ROLE_SYSTEM = CURRENT_THEME.system;
