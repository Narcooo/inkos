import {readFile} from "node:fs/promises";
import {homedir} from "node:os";
import {join, resolve} from "node:path";
import {config as loadEnv} from "dotenv";
import {createLLMClient, StateManager, type ProjectConfig, ProjectConfigSchema} from "@actalk/inkos-core";

export const GLOBAL_CONFIG_DIR = join(homedir(), ".inkos");
export const GLOBAL_ENV_PATH = join(GLOBAL_CONFIG_DIR, ".env");

export async function resolveContext(opts: {
    readonly context?: string;
    readonly contextFile?: string;
}): Promise<string | undefined> {
    if (opts.context) return opts.context;
    if (opts.contextFile) {
        return readFile(resolve(opts.contextFile), "utf-8");
    }
    // Read from stdin if piped (non-TTY)
    if (!process.stdin.isTTY) {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
            chunks.push(chunk as Buffer);
        }
        const text = Buffer.concat(chunks).toString("utf-8").trim();
        if (text.length > 0) return text;
    }
    return undefined;
}

export function findProjectRoot(): string {
    return process.cwd();
}

export async function loadConfig(): Promise<ProjectConfig> {
    const root = findProjectRoot();

    // Load global ~/.inkos/.env first, then project .env overrides
    loadEnv({path: GLOBAL_ENV_PATH});
    loadEnv({path: join(root, ".env"), override: true});

    const configPath = join(root, "inkos.json");
    try {
        const raw = await readFile(configPath, "utf-8");
        const config = JSON.parse(raw);

        // .env overrides inkos.json for LLM settings
        const env = process.env;
        if (env.INKOS_LLM_PROVIDER) config.llm.provider = env.INKOS_LLM_PROVIDER;
        if (env.INKOS_LLM_BASE_URL) config.llm.baseUrl = env.INKOS_LLM_BASE_URL;
        if (env.INKOS_LLM_MODEL) config.llm.model = env.INKOS_LLM_MODEL;
        if (env.INKOS_LLM_TEMPERATURE) config.llm.temperature = parseFloat(env.INKOS_LLM_TEMPERATURE);
        if (env.INKOS_LLM_MAX_TOKENS) config.llm.maxTokens = parseInt(env.INKOS_LLM_MAX_TOKENS, 10);
        if (env.INKOS_LLM_THINKING_BUDGET) config.llm.thinkingBudget = parseInt(env.INKOS_LLM_THINKING_BUDGET, 10);
        if (env.INKOS_LLM_API_FORMAT) config.llm.apiFormat = env.INKOS_LLM_API_FORMAT;

        // API key ONLY from env — never stored in inkos.json
        const apiKey = env.INKOS_LLM_API_KEY;
        if (!apiKey) {
            throw new Error(
                "INKOS_LLM_API_KEY not set. Run 'inkos config set-global' or add it to project .env file.",
            );
        }
        config.llm.apiKey = apiKey;

        return ProjectConfigSchema.parse(config);
    } catch (e) {
        console.error("DEBUG - Real Config Error:", e);
        throw new Error(`inkos.json not found in ${root}...`);
    }
}

export function createClient(config: ProjectConfig) {
    return createLLMClient(config.llm);
}

export function log(message: string): void {
    process.stdout.write(`${message}\n`);
}

export function logError(message: string): void {
    process.stderr.write(`[ERROR] ${message}\n`);
}

/**
 * Resolve book-id: if provided use it, otherwise auto-detect when exactly one book exists.
 * Validates that the book actually exists.
 */
export async function resolveBookId(
    bookIdArg: string | undefined,
    root: string,
): Promise<string> {
    const state = new StateManager(root);
    const books = await state.listBooks();

    if (bookIdArg) {
        if (!books.includes(bookIdArg)) {
            const available = books.length > 0 ? books.join(", ") : "(none)";
            throw new Error(
                `Book "${bookIdArg}" not found. Available books: ${available}`,
            );
        }
        return bookIdArg;
    }

    if (books.length === 0) {
        throw new Error(
            "No books found. Create one first:\n  inkos book create --title '...' --genre xuanhuan",
        );
    }
    if (books.length === 1) {
        return books[0]!;
    }
    throw new Error(
        `Multiple books found: ${books.join(", ")}\nPlease specify a book-id.`,
    );
}
