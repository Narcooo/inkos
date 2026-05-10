import type {
  HighlighterCore,
  LanguageRegistration,
  ThemedToken,
} from "shiki";

export interface TokenizedCode {
  tokens: ThemedToken[][];
  fg: string;
  bg: string;
}

type ShikiLanguageLoader = () => Promise<{ default: LanguageRegistration[] }>;

const LANGUAGE_LOADERS: Record<string, ShikiLanguageLoader> = {
  bash: () => import("shiki/langs/shellscript.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  javascript: () => import("shiki/langs/js.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  markdown: () => import("shiki/langs/md.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/ts.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
};

const LANGUAGE_ALIASES: Record<string, string> = {
  cjs: "javascript",
  htm: "html",
  js: "javascript",
  md: "markdown",
  mjs: "javascript",
  py: "python",
  sh: "shellscript",
  ts: "typescript",
  yml: "yaml",
};

const normalizeLanguage = (language: string): string => {
  const normalized = language.trim().toLowerCase();
  return LANGUAGE_ALIASES[normalized] ?? normalized;
};

const highlighterPromise = Promise.all([
  import("shiki/core"),
  import("shiki/engine/javascript"),
  import("shiki/themes/github-dark.mjs"),
  import("shiki/themes/github-light.mjs"),
]).then(([core, engine, githubDark, githubLight]) =>
  core.createHighlighterCore({
    engine: engine.createJavaScriptRegexEngine(),
    themes: [githubLight.default, githubDark.default],
    langs: [],
  }),
);

const languageLoadCache = new Map<string, Promise<void>>();
const tokensCache = new Map<string, TokenizedCode>();
const subscribers = new Map<string, Set<(result: TokenizedCode) => void>>();

const getTokensCacheKey = (code: string, language: string) => {
  const start = code.slice(0, 100);
  const end = code.length > 100 ? code.slice(-100) : "";
  return `${language}:${code.length}:${start}:${end}`;
};

const ensureLanguageLoaded = (highlighter: HighlighterCore, language: string): Promise<void> => {
  const normalized = normalizeLanguage(language);
  if (!LANGUAGE_LOADERS[normalized] || highlighter.getLoadedLanguages().includes(normalized)) {
    return Promise.resolve();
  }

  const cached = languageLoadCache.get(normalized);
  if (cached) return cached;

  const promise = LANGUAGE_LOADERS[normalized]().then((module) => highlighter.loadLanguage(...module.default));
  languageLoadCache.set(normalized, promise);
  return promise;
};

const getHighlighter = async (language: string): Promise<HighlighterCore> => {
  const highlighter = await highlighterPromise;
  await ensureLanguageLoaded(highlighter, language);
  return highlighter;
};

export const createRawTokens = (code: string): TokenizedCode => ({
  bg: "transparent",
  fg: "inherit",
  tokens: code.split("\n").map((line) =>
    line === ""
      ? []
      : [
          {
            color: "inherit",
            content: line,
          } as ThemedToken,
        ]
  ),
});

export const highlightCode = (
  code: string,
  language: string,
  // oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-callbacks)
  callback?: (result: TokenizedCode) => void
): TokenizedCode | null => {
  const tokensCacheKey = getTokensCacheKey(code, language);
  const cached = tokensCache.get(tokensCacheKey);
  if (cached) {
    return cached;
  }

  if (callback) {
    if (!subscribers.has(tokensCacheKey)) {
      subscribers.set(tokensCacheKey, new Set());
    }
    subscribers.get(tokensCacheKey)?.add(callback);
  }

  getHighlighter(language)
    // oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-then)
    .then((highlighter) => {
      const availableLangs = highlighter.getLoadedLanguages();
      const normalizedLanguage = normalizeLanguage(language);
      const langToUse = availableLangs.includes(normalizedLanguage) ? normalizedLanguage : "text";

      const result = highlighter.codeToTokens(code, {
        lang: langToUse,
        themes: {
          dark: "github-dark",
          light: "github-light",
        },
      });

      const tokenized: TokenizedCode = {
        bg: result.bg ?? "transparent",
        fg: result.fg ?? "inherit",
        tokens: result.tokens,
      };

      tokensCache.set(tokensCacheKey, tokenized);

      const subs = subscribers.get(tokensCacheKey);
      if (subs) {
        for (const sub of subs) {
          sub(tokenized);
        }
        subscribers.delete(tokensCacheKey);
      }
    })
    // oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-then), eslint-plugin-promise(prefer-await-to-callbacks)
    .catch((error) => {
      console.error("Failed to highlight code:", error);
      subscribers.delete(tokensCacheKey);
    });

  return null;
};
