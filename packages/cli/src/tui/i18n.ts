import type { ChatDepth } from "./chat-depth.js";

export type TuiLocale = "zh-CN" | "en";

export interface TuiCopy {
  readonly locale: TuiLocale;
  readonly labels: {
    readonly project: string;
    readonly book: string;
    readonly depth: string;
    readonly session: string;
    readonly messageCount: (count: number) => string;
    readonly stage: string;
    readonly mode: string;
    readonly model: string;
    readonly error: string;
    readonly recent: string;
    readonly pending: string;
    readonly draft: string;
    readonly ready: string;
    readonly none: string;
    readonly notConfigured: string;
    readonly unknown: string;
  };
  readonly modeLabels: Record<string, string>;
  readonly composer: {
    readonly placeholder: string;
    readonly emptyConversation: string;
    readonly helper: string;
    readonly submitting: string;
    readonly failed: string;
    readonly ready: string;
  };
  readonly notes: {
    readonly help: string;
    readonly status: (stage: string, mode: string) => string;
    readonly config: string;
    readonly depthSet: (depthLabel: string) => string;
    readonly newBookGuide: string;
    readonly noLlmConfig: string;
    readonly setupProvider: string;
    readonly toolInitFailed: (message: string) => string;
    readonly toolInitHint: string;
  };
  readonly roles: {
    readonly user: string;
    readonly assistant: string;
    readonly system: string;
  };
  readonly activity: Record<"thinking" | "checking" | "writing" | "reviewing" | "updating", string>;
  readonly stageLabels: {
    readonly completed: string;
    readonly failed: string;
    readonly blocked: string;
    readonly waitingHuman: string;
    readonly pausedByUser: string;
    readonly readyToContinue: string;
  };
  readonly depthLabels: Record<ChatDepth, string>;
  readonly results: {
    readonly modeSwitched: (mode: string) => string;
    readonly booksListed: string;
    readonly activeBook: (bookId: string) => string;
    readonly completed: (intent: string) => string;
    readonly intentLabels: Partial<Record<string, string>>;
  };
}

const ZH_CN: TuiCopy = {
  locale: "zh-CN",
  labels: {
    project: "项目",
    book: "作品",
    depth: "深度",
    session: "会话",
    messageCount: (count) => `${count} 条消息`,
    stage: "阶段",
    mode: "模式",
    model: "模型",
    error: "错误",
    recent: "最近",
    pending: "待确认",
    draft: "草稿",
    ready: "就绪",
    none: "无",
    notConfigured: "未配置",
    unknown: "未知",
  },
  modeLabels: {
    auto: "自动",
    semi: "半自动",
    manual: "手动",
  },
  composer: {
    placeholder: "告诉 InkOS 要写什么、修改什么，或解释什么…",
    emptyConversation: "先告诉 InkOS 你要做什么。",
    helper: "回车发送 • /new 输入你的想法，自动构建新书 • /draft • /create • /write • /books • /open • /mode • /depth • /help",
    submitting: "处理中…",
    failed: "上次请求失败",
    ready: "就绪",
  },
  notes: {
    help: "可用命令：/new（输入想法，自动构建新书）、/draft、/create、/discard、/write、/books、/open、/mode、/rewrite、/focus、/truth、/rename、/replace、/export、/status、/clear、/depth、/quit。也支持直接输入自然语言。",
    status: (stage, mode) => `当前状态：${stage}（${mode}）。`,
    config: "当前 Ink 仪表盘里还不支持交互式 /config。请使用 inkos config set-global。",
    depthSet: (depthLabel) => `思考深度已切换为 ${depthLabel}。`,
    newBookGuide: "开始构思新书。直接描述你的想法——题材、世界观、主角、核心冲突都可以。AI 会逐步引导你完善草案，随时用 /draft 查看进度，/create 建书。",
    noLlmConfig: "未发现 LLM 配置。",
    setupProvider: "先配置 API 提供方。",
    toolInitFailed: (message) => `初始化 TUI 工具失败：${message}`,
    toolInitHint: "请检查 .env，或运行：inkos config set-global",
  },
  roles: {
    user: "你",
    assistant: "InkOS",
    system: "系统",
  },
  activity: {
    thinking: "思考中",
    checking: "检查中",
    writing: "写作中",
    reviewing: "审阅中",
    updating: "更新中",
  },
  stageLabels: {
    completed: "已完成",
    failed: "失败",
    blocked: "已阻塞",
    waitingHuman: "等待你的决定",
    pausedByUser: "已由用户暂停",
    readyToContinue: "可继续执行",
  },
  depthLabels: {
    light: "轻量",
    normal: "标准",
    deep: "深入",
  },
  results: {
    modeSwitched: (mode) => `已切换到 ${mode} 模式。`,
    booksListed: "已列出作品。",
    activeBook: (bookId) => `当前作品：${bookId}`,
    completed: (intent) => `已完成 ${intent}`,
    intentLabels: {
      write_next: "已写完下一章",
      revise_chapter: "已修订章节",
      rewrite_chapter: "已重写章节",
      update_focus: "已更新焦点",
      explain_status: "状态说明",
      explain_failure: "失败说明",
      pause_book: "已暂停作品",
      rename_entity: "已重命名实体",
      patch_chapter_text: "已修补正文",
      edit_truth: "已更新真相文件",
    },
  },
};

const EN: TuiCopy = {
  locale: "en",
  labels: {
    project: "Project",
    book: "Book",
    depth: "Depth",
    session: "Session",
    messageCount: (count) => `${count} msgs`,
    stage: "Stage",
    mode: "Mode",
    model: "Model",
    error: "Error",
    recent: "Recent",
    pending: "Pending",
    draft: "Draft",
    ready: "Ready",
    none: "none",
    notConfigured: "not configured",
    unknown: "unknown",
  },
  modeLabels: {
    auto: "auto",
    semi: "semi",
    manual: "manual",
  },
  composer: {
    placeholder: "Ask InkOS to write, revise, or explain…",
    emptyConversation: "Start by asking InkOS what to do.",
    helper: "Enter to send • /new describe your idea to start a book • /draft • /create • /write • /books • /open • /mode • /depth • /help",
    submitting: "Submitting…",
    failed: "Last request failed",
    ready: "Ready",
  },
  notes: {
    help: "Commands: /new (describe your idea to start a book), /draft, /create, /discard, /write, /books, /open, /mode, /rewrite, /focus, /truth, /rename, /replace, /export, /status, /clear, /depth, /quit. Natural language still works.",
    status: (stage, mode) => `Status: ${stage} (${mode}).`,
    config: "Interactive /config is not available inside the Ink dashboard yet. Use inkos config set-global.",
    depthSet: (depthLabel) => `Thinking depth set to ${depthLabel}.`,
    newBookGuide: "Starting a new book. Describe your idea — genre, world, protagonist, core conflict, anything. The AI will guide you step by step. Use /draft to check progress, /create to finalize.",
    noLlmConfig: "No LLM configuration found.",
    setupProvider: "Let's set up your API provider first.",
    toolInitFailed: (message) => `Failed to initialize TUI tools: ${message}`,
    toolInitHint: "Check your .env or run: inkos config set-global",
  },
  roles: {
    user: "You",
    assistant: "InkOS",
    system: "System",
  },
  activity: {
    thinking: "thinking",
    checking: "checking",
    writing: "writing",
    reviewing: "reviewing",
    updating: "updating",
  },
  stageLabels: {
    completed: "completed",
    failed: "failed",
    blocked: "blocked",
    waitingHuman: "waiting for your decision",
    pausedByUser: "paused by user",
    readyToContinue: "ready to continue",
  },
  depthLabels: {
    light: "light",
    normal: "normal",
    deep: "deep",
  },
  results: {
    modeSwitched: (mode) => `Mode switched to ${mode}.`,
    booksListed: "Books listed.",
    activeBook: (bookId) => `Active book: ${bookId}`,
    completed: (intent) => `Completed ${intent}`,
    intentLabels: {
      write_next: "Chapter written",
      revise_chapter: "Chapter revised",
      rewrite_chapter: "Chapter rewritten",
      update_focus: "Focus updated",
      explain_status: "Status",
      explain_failure: "Explanation",
      pause_book: "Book paused",
      rename_entity: "Entity renamed",
      patch_chapter_text: "Text patched",
      edit_truth: "Truth file updated",
    },
  },
};

export function resolveTuiLocale(
  env: NodeJS.ProcessEnv = process.env,
  preferredLanguage?: string,
): TuiLocale {
  const requested = normalizeLocale(env.INKOS_TUI_LOCALE ?? env.INKOS_LOCALE);
  if (requested) {
    return requested;
  }

  const preferred = normalizeLocale(preferredLanguage);
  if (preferred) {
    return preferred;
  }

  const detected = normalizeLocale(env.LC_ALL ?? env.LC_MESSAGES ?? env.LANG);
  return detected ?? "zh-CN";
}

export function getTuiCopy(locale: TuiLocale): TuiCopy {
  return locale === "en" ? EN : ZH_CN;
}

export function normalizeStageLabel(label: string, copy: TuiCopy): string {
  const normalized = label.trim().toLowerCase();
  if (!normalized) {
    return label;
  }

  const replacements: Array<[RegExp, string]> = [
    [/^thinking\b/i, copy.activity.thinking],
    [/^checking\b/i, copy.activity.checking],
    [/^writing\b/i, copy.activity.writing],
    [/^reviewing\b/i, copy.activity.reviewing],
    [/^updating\b/i, copy.activity.updating],
    [/^completed\b/i, copy.stageLabels.completed],
    [/^failed\b/i, copy.stageLabels.failed],
    [/^blocked\b/i, copy.stageLabels.blocked],
    [/^waiting_human\b/i, copy.stageLabels.waitingHuman],
    [/^paused by user\b/i, copy.stageLabels.pausedByUser],
    [/^ready to continue\b/i, copy.stageLabels.readyToContinue],
  ];

  for (const [pattern, value] of replacements) {
    if (pattern.test(label)) {
      // For English, keep the original label (already in English);
      // for other locales, use the translated value
      return copy.locale === "en" ? label : value;
    }
  }

  if (normalized === "idle") {
    return copy.labels.ready;
  }

  return label;
}

export function formatModeLabel(mode: string, copy: TuiCopy): string {
  return copy.modeLabels[mode] ?? mode;
}

function normalizeLocale(value: string | undefined): TuiLocale | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "auto") {
    return undefined;
  }

  if (normalized.startsWith("zh")) {
    return "zh-CN";
  }

  if (normalized.startsWith("en")) {
    return "en";
  }

  return undefined;
}
