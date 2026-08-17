import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  SHORT_FICTION_DEFAULT_CHAPTERS,
  SHORT_FICTION_DEFAULT_CHARS_PER_CHAPTER,
  SHORT_FICTION_EN_DEFAULT_WORDS_PER_CHAPTER,
  SHORT_FICTION_EN_MAX_WORDS_PER_CHAPTER,
  SHORT_FICTION_EN_MIN_WORDS_PER_CHAPTER,
  SHORT_FICTION_MAX_CHAPTERS,
  SHORT_FICTION_MAX_CHARS_PER_CHAPTER,
  SHORT_FICTION_MIN_CHAPTERS,
  SHORT_FICTION_MIN_CHARS_PER_CHAPTER,
  activatedSkillIds,
  createLLMClient,
  loadAvailableAgentSkills,
  resolveProductionSkillActivations,
  runShortFictionProduction,
  type LLMConfig,
  type Logger,
  type OnStreamProgress,
  type ShortFictionReference,
  type ShortFictionLanguage,
} from "@actalk/inkos-core";
import { buildPipelineConfig, findProjectRoot, loadConfig, log, logError } from "../utils.js";

export { extractResponsesImageBase64, resolveCoverApiKey } from "@actalk/inkos-core";

export const shortCommand = new Command("short")
  .description("Short fiction production workflow");

shortCommand
  .command("run")
  .description("Run a short fiction chain from a direction")
  .requiredOption("--direction <text>", "Story direction, e.g. \"女频短篇 婚姻背叛 证据反杀\" or \"female-lead short: marriage betrayal, evidence payback\"")
  .option("--reference <path>", "Optional reference notes/text")
  .option("--story-id <id>", "Output story id under shorts/")
  .option("--out-dir <path>", "Output directory", "shorts")
  .option("--lang <language>", "Writing language: zh or en", "zh")
  .option("--chapters <n>", "Complete short chapter count (12-18)", String(SHORT_FICTION_DEFAULT_CHAPTERS))
  .option("--chars <n>", "Per-chapter length: zh characters (900-1200) or en words (600-800)")
  .option("--llm-base-url <url>", "Override LLM base URL")
  .option("--model <model>", "Fallback model for all short stages")
  .option("--planner-model <model>", "Model for outline creation/revision")
  .option("--outline-review-model <model>", "Model for outline review")
  .option("--writer-model <model>", "Model for first full draft")
  .option("--draft-review-model <model>", "Model for draft review")
  .option("--revise-model <model>", "Model for second full draft")
  .option("--package-model <model>", "Model for synopsis and cover prompt packaging")
  .option("--cover-base-url <url>", "OpenAI-compatible Responses API base URL for cover generation, e.g. https://api.openai.com/v1")
  .option("--cover-endpoint <url>", "Exact Responses endpoint for cover generation; overrides --cover-base-url")
  .option("--cover-model <model>", "Image-capable Responses model for cover generation", "gpt-5.5")
  .option("--cover-size <size>", "Cover image size", "1024x1360")
  .option("--cover-api-key-env <name>", "Env var containing cover API key", "INKOS_COVER_API_KEY")
  .option("--no-cover", "Skip cover image generation")
  .option("--json", "Output JSON")
  .action(async (opts: ShortRunOptions) => {
    try {
      const root = findProjectRoot();
      const language = parseShortFictionLanguage(opts.lang);
      const chapterCount = parseBoundedInteger(
        opts.chapters,
        SHORT_FICTION_DEFAULT_CHAPTERS,
        "chapters",
        SHORT_FICTION_MIN_CHAPTERS,
        SHORT_FICTION_MAX_CHAPTERS,
      );
      const charsPerChapter = opts.chars === undefined
        ? undefined
        : parseBoundedInteger(
            opts.chars,
            language === "en" ? SHORT_FICTION_EN_DEFAULT_WORDS_PER_CHAPTER : SHORT_FICTION_DEFAULT_CHARS_PER_CHAPTER,
            "chars",
            language === "en" ? SHORT_FICTION_EN_MIN_WORDS_PER_CHAPTER : SHORT_FICTION_MIN_CHARS_PER_CHAPTER,
            language === "en" ? SHORT_FICTION_EN_MAX_WORDS_PER_CHAPTER : SHORT_FICTION_MAX_CHARS_PER_CHAPTER,
          );
      const reference = opts.reference ? await readReference(root, opts.reference) : undefined;
      const models = resolveShortRunModels(opts);
      const configuredSkills = await loadAvailableAgentSkills({ projectRoot: root });
      const activatedSkills = resolveProductionSkillActivations(configuredSkills.skills, "shortWriting");

      const plannerRuntime = await createShortRuntime(root, {
        llmBaseUrl: opts.llmBaseUrl,
        model: models.planner,
        quiet: Boolean(opts.json),
      });
      const outlineReviewRuntime = await createShortRuntime(root, {
        llmBaseUrl: opts.llmBaseUrl,
        model: models.outlineReview,
        quiet: Boolean(opts.json),
      });
      const writerRuntime = await createShortRuntime(root, {
        llmBaseUrl: opts.llmBaseUrl,
        model: models.writer,
        quiet: Boolean(opts.json),
      });
      const draftReviewRuntime = await createShortRuntime(root, {
        llmBaseUrl: opts.llmBaseUrl,
        model: models.draftReview,
        quiet: Boolean(opts.json),
      });
      const reviseRuntime = await createShortRuntime(root, {
        llmBaseUrl: opts.llmBaseUrl,
        model: models.revise,
        quiet: Boolean(opts.json),
      });
      const packageRuntime = await createShortRuntime(root, {
        llmBaseUrl: opts.llmBaseUrl,
        model: models.package,
        quiet: Boolean(opts.json),
      });

      const result = await runShortFictionProduction({
        projectRoot: root,
        direction: opts.direction,
        runtimes: {
          planner: { ...plannerRuntime, projectRoot: root, activatedSkills },
          outlineReview: { ...outlineReviewRuntime, projectRoot: root, activatedSkills },
          writer: { ...writerRuntime, projectRoot: root, activatedSkills },
          draftReview: { ...draftReviewRuntime, projectRoot: root, activatedSkills },
          revise: { ...reviseRuntime, projectRoot: root, activatedSkills },
          package: { ...packageRuntime, projectRoot: root, activatedSkills },
        },
        reference,
        storyId: opts.storyId,
        outDir: opts.outDir,
        chapterCount,
        charsPerChapter,
        language,
        cover: opts.cover,
        coverBaseUrl: opts.coverBaseUrl,
        coverEndpoint: opts.coverEndpoint,
        coverModel: opts.coverModel,
        coverSize: opts.coverSize,
        coverApiKeyEnv: opts.coverApiKeyEnv,
        onProgress: opts.json ? undefined : (message) => log(message),
      });

      const payload = {
        ...result,
        models,
      };

      if (opts.json) {
        log(JSON.stringify(payload, null, 2));
      } else {
        log(`Skills: ${activatedSkillIds(activatedSkills).join(", ")}`);
        log(`Short run complete: ${result.storyId}`);
        log(`Final: ${payload.finalMarkdownPath}`);
        log(`Sales package: ${payload.salesPackagePath}`);
        log(formatCoverStatus(payload.coverImagePath, payload.coverError));
      }
    } catch (e) {
      logCommandError("Short run failed", e, opts.json);
    }
  });

interface ShortRunOptions {
  readonly direction: string;
  readonly reference?: string;
  readonly storyId?: string;
  readonly outDir: string;
  readonly lang: string;
  readonly chapters?: string;
  readonly chars?: string;
  readonly llmBaseUrl?: string;
  readonly model?: string;
  readonly plannerModel?: string;
  readonly outlineReviewModel?: string;
  readonly writerModel?: string;
  readonly draftReviewModel?: string;
  readonly reviseModel?: string;
  readonly packageModel?: string;
  readonly coverBaseUrl?: string;
  readonly coverEndpoint?: string;
  readonly coverModel?: string;
  readonly coverSize?: string;
  readonly coverApiKeyEnv?: string;
  readonly cover?: boolean;
  readonly json?: boolean;
}

function parseShortFictionLanguage(value: string): ShortFictionLanguage {
  if (value === "zh" || value === "en") return value;
  throw new Error("lang must be zh or en.");
}

interface ShortRuntime {
  readonly client: ReturnType<typeof createLLMClient>;
  readonly model: string;
  readonly logger?: Logger;
  readonly onStreamProgress?: OnStreamProgress;
}

interface ShortRunModels {
  readonly planner?: string;
  readonly outlineReview?: string;
  readonly writer?: string;
  readonly draftReview?: string;
  readonly revise?: string;
  readonly package?: string;
}

function resolveShortRunModels(options: ShortRunOptions): ShortRunModels {
  return {
    planner: options.plannerModel || options.model,
    outlineReview: options.outlineReviewModel || options.model,
    writer: options.writerModel || options.model,
    draftReview: options.draftReviewModel || options.model,
    revise: options.reviseModel || options.model,
    package: options.packageModel || options.model,
  };
}

async function createShortRuntime(
  root: string,
  options: {
    readonly llmBaseUrl?: string;
    readonly model?: string;
    readonly quiet?: boolean;
  },
): Promise<ShortRuntime> {
  try {
    const config = await loadConfig({ projectRoot: root });
    if (options.llmBaseUrl) config.llm.baseUrl = options.llmBaseUrl;
    if (options.model) config.llm.model = options.model;
    const pipelineConfig = buildPipelineConfig(config, root, { quiet: options.quiet });
    return {
      client: pipelineConfig.client,
      model: pipelineConfig.model,
      logger: pipelineConfig.logger,
      onStreamProgress: pipelineConfig.onStreamProgress,
    };
  } catch (e) {
    if (!String(e).includes("inkos.json not found")) throw e;
    const llmConfig = buildEnvLLMConfig(options);
    return {
      client: createLLMClient(llmConfig),
      model: llmConfig.model,
    };
  }
}

function buildEnvLLMConfig(options: {
  readonly llmBaseUrl?: string;
  readonly model?: string;
}): LLMConfig {
  const baseUrl = options.llmBaseUrl ?? process.env.INKOS_LLM_BASE_URL;
  const model = options.model ?? process.env.INKOS_LLM_MODEL;
  if (!baseUrl) throw new Error("LLM base URL is required. Set INKOS_LLM_BASE_URL or pass --llm-base-url.");
  if (!model) throw new Error("LLM model is required. Set INKOS_LLM_MODEL or pass --model.");
  return {
    provider: "openai",
    service: process.env.INKOS_LLM_SERVICE ?? "custom",
    configSource: "env",
    baseUrl,
    apiKey: process.env.INKOS_LLM_API_KEY ?? "",
    model,
    temperature: parseEnvNumber(process.env.INKOS_LLM_TEMPERATURE, 0.1),
    thinkingBudget: parseEnvInteger(process.env.INKOS_LLM_THINKING_BUDGET, 0),
    apiFormat: process.env.INKOS_LLM_API_FORMAT === "responses" ? "responses" : "chat",
    stream: process.env.INKOS_LLM_STREAM === "false" ? false : true,
  };
}

async function readReference(root: string, path: string): Promise<ShortFictionReference> {
  const resolved = resolve(root, path);
  return {
    path,
    text: await readFile(resolved, "utf-8"),
  };
}

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  min: number,
  max: number,
): number {
  const parsed = value ? Number.parseInt(value, 10) : fallback;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function parseEnvNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseEnvInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatCoverStatus(coverImagePath?: string, coverError?: string): string {
  if (coverImagePath) return `Cover: ${coverImagePath}`;
  if (coverError) return `Cover: skipped (${coverError})`;
  return "Cover: skipped";
}

function logCommandError(prefix: string, error: unknown, json?: boolean): void {
  if (json) {
    log(JSON.stringify({ error: `${prefix}: ${String(error)}` }, null, 2));
    return;
  }
  logError(`${prefix}: ${String(error)}`);
}
