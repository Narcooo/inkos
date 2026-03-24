import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { findProjectRoot, log, logError, GLOBAL_ENV_PATH } from "../utils.js";
import {
  ensureNodeRuntimePinFiles,
  evaluateSqliteMemorySupport,
  inspectNodeRuntimePinFiles,
} from "../runtime-requirements.js";

export const doctorCommand = new Command("doctor")
  .description("Check environment and project health")
  .option("--repair-node-runtime", "Write .nvmrc and .node-version pinned to Node 22 for this project")
  .action(async (opts: { repairNodeRuntime?: boolean }) => {
    const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
    const root = findProjectRoot();

    if (opts.repairNodeRuntime) {
      const repair = await ensureNodeRuntimePinFiles(root);
      checks.push({
        name: "Node runtime pin files repaired",
        ok: true,
        detail: repair.updated
          ? `Wrote ${repair.written.join(", ")} -> Node 22`
          : "Already pinned to Node 22",
      });
    }

    // 1. Check Node.js version
    const nodeVersion = process.version;
    const major = parseInt(nodeVersion.slice(1).split(".")[0]!, 10);
    checks.push({
      name: "Node.js >= 20",
      ok: major >= 20,
      detail: nodeVersion,
    });
    checks.push({
      name: "SQLite memory index (Node 22+)",
      ...evaluateSqliteMemorySupport({ nodeVersion }),
    });
    checks.push({
      name: "Node runtime pin files",
      ...await inspectNodeRuntimePinFiles(root),
    });

    // 2. Check inkos.json exists
    try {
      await readFile(join(root, "inkos.json"), "utf-8");
      checks.push({ name: "inkos.json", ok: true, detail: "Found" });
    } catch {
      checks.push({ name: "inkos.json", ok: false, detail: "Not found. Run 'inkos init'" });
    }

    // 3. Check .env exists
    try {
      await readFile(join(root, ".env"), "utf-8");
      checks.push({ name: ".env", ok: true, detail: "Found" });
    } catch {
      checks.push({ name: ".env", ok: false, detail: "Not found" });
    }

    // 4. Check global config
    {
      let hasGlobal = false;
      try {
        const globalContent = await readFile(GLOBAL_ENV_PATH, "utf-8");
        hasGlobal = globalContent.includes("INKOS_LLM_API_KEY=") && !globalContent.includes("your-api-key-here");
      } catch { /* no global config */ }
      checks.push({
        name: "Global Config",
        ok: hasGlobal,
        detail: hasGlobal ? `Found (${GLOBAL_ENV_PATH})` : "Not set. Run 'inkos config set-global'",
      });
    }

    // 5. Check LLM API key (global + project .env)
    {
      const { config: loadDotenv } = await import("dotenv");
      loadDotenv({ path: GLOBAL_ENV_PATH });
      loadDotenv({ path: join(root, ".env"), override: true });
      const apiKey = process.env.INKOS_LLM_API_KEY;
      const hasKey = !!apiKey && apiKey.length > 10 && apiKey !== "your-api-key-here";
      checks.push({
        name: "LLM API Key",
        ok: hasKey,
        detail: hasKey ? "Configured" : "Missing — run 'inkos config set-global' or add to project .env",
      });
    }

    // 5. Check books directory
    try {
      const { StateManager } = await import("@actalk/inkos-core");
      const state = new StateManager(root);
      const books = await state.listBooks();
      checks.push({
        name: "Books",
        ok: true,
        detail: `${books.length} book(s) found`,
      });
    } catch {
      checks.push({ name: "Books", ok: true, detail: "0 books" });
    }

    // 6. API connectivity test
    try {
      const { createLLMClient, chatCompletion, LLMConfigSchema } = await import("@actalk/inkos-core");
      const { loadConfig } = await import("../utils.js");

      let llmConfig;
      try {
        const config = await loadConfig();
        llmConfig = config.llm;
      } catch {
        // No project config — try building from global env
        const { config: loadDotenv } = await import("dotenv");
        loadDotenv({ path: GLOBAL_ENV_PATH });
        const env = process.env;
        if (env.INKOS_LLM_API_KEY && env.INKOS_LLM_BASE_URL && env.INKOS_LLM_MODEL) {
          llmConfig = LLMConfigSchema.parse({
            provider: env.INKOS_LLM_PROVIDER ?? "custom",
            baseUrl: env.INKOS_LLM_BASE_URL,
            apiKey: env.INKOS_LLM_API_KEY,
            model: env.INKOS_LLM_MODEL,
          });
        }
      }

      if (!llmConfig) {
        checks.push({
          name: "API Connectivity",
          ok: false,
          detail: "No LLM config available (no project config or global .env)",
        });
      } else {
        checks.push({
          name: "LLM Config",
          ok: true,
          detail: `provider=${llmConfig.provider} model=${llmConfig.model} stream=${llmConfig.stream ?? true} baseUrl=${llmConfig.baseUrl}`,
        });

        const client = createLLMClient(llmConfig);
        log("\n  [..] Testing API connectivity...");
        const response = await chatCompletion(client, llmConfig.model, [
          { role: "user", content: "Say OK" },
        ], { maxTokens: 16 });

        checks.push({
          name: "API Connectivity",
          ok: true,
          detail: `OK (model: ${llmConfig.model}, tokens: ${response.usage.totalTokens})`,
        });
      }
    } catch (e) {
      const errMsg = String(e);
      const hints: string[] = [];

      if (errMsg.includes("Connection error") || errMsg.includes("ECONNREFUSED") || errMsg.includes("fetch failed")) {
        hints.push("baseUrl 可能不正确，检查 INKOS_LLM_BASE_URL 是否包含完整路径（如 /v1）");
      }
      if (errMsg.includes("400")) {
        hints.push("尝试在 inkos.json 中设置 \"stream\": false");
        hints.push("检查模型名称是否正确（INKOS_LLM_MODEL）");
      }
      if (errMsg.includes("401")) {
        hints.push("API Key 无效，检查 INKOS_LLM_API_KEY");
      }

      checks.push({
        name: "API Connectivity",
        ok: false,
        detail: errMsg.split("\n")[0]!,
      });

      if (hints.length > 0) {
        for (const hint of hints) {
          checks.push({ name: "  Hint", ok: false, detail: hint });
        }
      }
    }

    // Output
    log("\nInkOS Doctor\n");
    for (const check of checks) {
      const icon = check.ok ? "[OK]" : "[!!]";
      log(`  ${icon} ${check.name}: ${check.detail}`);
    }

    const failed = checks.filter((c) => !c.ok);
    if (failed.length > 0) {
      log(`\n${failed.length} issue(s) found.`);
    } else {
      log("\nAll checks passed.");
    }
  });
