import { Command } from "commander";
import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { log, logError, GLOBAL_ENV_PATH } from "../utils.js";

async function hasGlobalConfig(): Promise<boolean> {
  try {
    const content = await readFile(GLOBAL_ENV_PATH, "utf-8");
    return content.includes("INKOS_LLM_API_KEY=") && !content.includes("your-api-key-here");
  } catch {
    return false;
  }
}

export const initCommand = new Command("init")
  .description("Initialize an InkOS project (current directory by default)")
  .argument("[name]", "Project name (creates subdirectory). Omit to init current directory.")
  .option("--lang <language>", "Default writing language: zh (Chinese) or en (English)", "zh")
  .action(async (name: string | undefined, opts: { lang?: string }) => {
    const projectDir = name ? join(process.cwd(), name) : process.cwd();
    const projectName = name ?? basename(projectDir);

    try {
      await mkdir(projectDir, { recursive: true });

      // Check if inkos.json already exists
      const configPath = join(projectDir, "inkos.json");
      try {
        await access(configPath);
        throw new Error(`inkos.json already exists in ${projectDir}. Use a different directory or delete the existing project.`);
      } catch (e) {
        if (e instanceof Error && e.message.includes("already exists")) throw e;
        // File doesn't exist, good
      }

      await mkdir(join(projectDir, "books"), { recursive: true });
      await mkdir(join(projectDir, "radar"), { recursive: true });

      const config = {
        name: projectName,
        version: "0.1.0",
        language: opts.lang ?? "zh",
        llm: {
          provider: process.env.INKOS_LLM_PROVIDER ?? "openai",
          baseUrl: process.env.INKOS_LLM_BASE_URL ?? "",
          model: process.env.INKOS_LLM_MODEL ?? "",
        },
        notify: [],
        daemon: {
          schedule: {
            radarCron: "0 */6 * * *",
            writeCron: "*/15 * * * *",
          },
          maxConcurrentBooks: 3,
        },
      };

      await writeFile(
        join(projectDir, "inkos.json"),
        JSON.stringify(config, null, 2),
        "utf-8",
      );

      const global = await hasGlobalConfig();

      if (global) {
        await writeFile(
          join(projectDir, ".env"),
          [
            "# Project-level LLM overrides (optional)",
            "# Global config at ~/.inkos/.env will be used by default.",
            "# Uncomment below to override for this project only:",
            "# INKOS_LLM_PROVIDER=openai",
            "# INKOS_LLM_BASE_URL=",
            "# INKOS_LLM_API_KEY=",
            "# INKOS_LLM_MODEL=",
            "",
            "# Web search (optional):",
            "# TAVILY_API_KEY=tvly-xxxxx",
          ].join("\n"),
          "utf-8",
        );
      } else {
        await writeFile(
          join(projectDir, ".env"),
          [
            "# LLM Configuration",
            "# Tip: Run 'inkos config set-global' to set once for all projects.",
            "# Provider: openai (OpenAI / compatible proxy), anthropic (Anthropic native)",
            "INKOS_LLM_PROVIDER=openai",
            "INKOS_LLM_BASE_URL=",
            "INKOS_LLM_API_KEY=",
            "INKOS_LLM_MODEL=",
            "",
            "# Optional parameters (defaults shown):",
            "# INKOS_LLM_TEMPERATURE=0.7",
            "# INKOS_LLM_MAX_TOKENS=8192",
            "# INKOS_LLM_THINKING_BUDGET=0          # Anthropic extended thinking budget",
            "# INKOS_LLM_REASONING_EFFORT=        # Reasoning effort: low / medium / high",
            "# INKOS_LLM_API_FORMAT=chat             # chat (default) or responses (OpenAI Responses API)",
            "",
            "# Web search (optional, for auditor era-research):",
            "# TAVILY_API_KEY=tvly-xxxxx              # Free at tavily.com (1000 searches/month)",
            "",
            "# Anthropic example:",
            "# INKOS_LLM_PROVIDER=anthropic",
            "# INKOS_LLM_PROVIDER=anthropic",
            "# INKOS_LLM_BASE_URL=",
            "# INKOS_LLM_MODEL=",
          ].join("\n"),
          "utf-8",
        );
      }

      await writeFile(
        join(projectDir, ".gitignore"),
        [".env", "node_modules/", ".DS_Store"].join("\n"),
        "utf-8",
      );

      log(`Project initialized at ${projectDir}`);
      log("");
      if (global) {
        log("Global LLM config detected. Ready to go!");
        log("");
        log("Next steps:");
        if (name) log(`  cd ${name}`);
        log("  inkos book create --title '我的小说' --genre xuanhuan --platform tomato");
      } else {
        log("Next steps:");
        if (name) log(`  cd ${name}`);
        log("  # Option 1: Set global config (recommended, one-time):");
        log("  inkos config set-global --provider openai --base-url <your-api-url> --api-key <your-key> --model <your-model>");
        log("  # Option 2: Edit .env for this project only");
        log("");
        log("  inkos book create --title '我的小说' --genre xuanhuan --platform tomato");
      }
      log("  inkos write next <book-id>");
    } catch (e) {
      logError(`Failed to initialize project: ${e}`);
      process.exit(1);
    }
  });
