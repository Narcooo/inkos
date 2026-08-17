import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { findProjectRoot, log, logError, GLOBAL_ENV_PATH } from "../utils.js";
import { fetchWithProxy } from "@actalk/inkos-core";
import {
  ensureNodeRuntimePinFiles,
  evaluateNodeRuntimeSupport,
  inspectNodeRuntimePinFiles,
} from "../runtime-requirements.js";
import {
  formatDoctorHintBaseUrl,
  formatDoctorHintInvalidApiKey,
  formatDoctorHintModelName,
  formatDoctorHintOpenAiProbeExhausted,
  formatDoctorHintQuota,
  formatDoctorHintStreamRequirement,
  resolveCliLanguage,
} from "../localization.js";

function buildDoctorProbePlans(
  preferredApiFormat: "chat" | "responses" | undefined,
  preferredStream: boolean | undefined,
): Array<{ apiFormat: "chat" | "responses"; stream: boolean }> {
  const plans: Array<{ apiFormat: "chat" | "responses"; stream: boolean }> = [];
  const seen = new Set<string>();
  const push = (apiFormat: "chat" | "responses", stream: boolean) => {
    const key = `${apiFormat}:${stream ? "1" : "0"}`;
    if (seen.has(key)) return;
    seen.add(key);
    plans.push({ apiFormat, stream });
  };

  if (preferredApiFormat) {
    push(preferredApiFormat, preferredStream ?? false);
    push(preferredApiFormat, !(preferredStream ?? false));
  }
  const alternate = preferredApiFormat === "responses" ? "chat" : "responses";
  push(alternate, false);
  push(alternate, true);
  push("chat", false);
  push("chat", true);
  push("responses", false);
  push("responses", true);
  return plans;
}

export function buildDoctorModelCandidates(
  preferredModel: string | undefined,
  discoveredModels: Array<{ id: string; name: string }>,
): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  const push = (value: string | undefined | null) => {
    if (!value || value.trim().length === 0) return;
    const model = value.trim();
    if (seen.has(model)) return;
    seen.add(model);
    candidates.push(model);
  };

  push(preferredModel);
  for (const model of discoveredModels) push(model.id);
  push("gpt-5.4");
  push("gpt-4o");
  push("claude-sonnet-4-6");
  push("MiniMax-M2.7");
  push("kimi-k2.5");
  push("gemini-2.5-flash");
  return candidates;
}

export function resolveDoctorModelsBaseUrl(
  service: string | undefined,
  baseUrl: string,
  resolveServiceModelsBaseUrl: (service: string) => string | undefined,
): string {
  if (!service || service.length === 0) {
    return baseUrl;
  }
  return resolveServiceModelsBaseUrl(service) ?? baseUrl;
}

async function fetchDoctorModels(
  modelsBaseUrl: string,
  apiKey: string,
  proxyUrl?: string,
): Promise<Array<{ id: string; name: string }>> {
  const modelsUrl = modelsBaseUrl.replace(/\/$/, "") + "/models";
  try {
    const res = await fetchWithProxy(modelsUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    }, proxyUrl);
    if (!res.ok) return [];
    const json = await res.json() as { data?: Array<{ id: string }> };
    return (json.data ?? []).map((model) => ({ id: model.id, name: model.id }));
  } catch {
    return [];
  }
}

export const doctorCommand = new Command("doctor")
  .description("Check environment and project health")
  .option("--repair-node-runtime", "Write .nvmrc and .node-version pinned to Node 22 for this project")
  .action(async (opts: { repairNodeRuntime?: boolean }) => {
    const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
    const root = findProjectRoot();
    // doctor is not scoped to a book, so the language comes from the environment
    // (INKOS_LOCALE -> LC_ALL/LC_MESSAGES/LANG, default zh).
    const language = resolveCliLanguage();

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
    checks.push({
      name: "Node.js >= 22",
      ...evaluateNodeRuntimeSupport({ nodeVersion }),
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

    // 5. Check effective LLM config (Studio project base + env/CLI overlay, or legacy env)
    {
      const { loadConfigWithDiagnostics } = await import("../utils.js");
      const { isApiKeyOptionalForEndpoint } = await import("@actalk/inkos-core");
      let configResult: Awaited<ReturnType<typeof loadConfigWithDiagnostics>> | undefined;
      try {
        configResult = await loadConfigWithDiagnostics({ requireApiKey: false });
        checks.push({
          name: "LLM Config Mode",
          ok: true,
          detail: `${configResult.diagnostics.configMode} (service=${configResult.diagnostics.serviceSource}, model=${configResult.diagnostics.modelSource}, key=${configResult.diagnostics.apiKeySource})`,
        });
        for (const warning of configResult.diagnostics.warnings) {
          checks.push({ name: "  Config Hint", ok: true, detail: warning });
        }
      } catch {
        // The API connectivity check below will report the concrete config failure.
      }
      const provider = configResult?.llm.provider;
      const baseUrl = configResult?.llm.baseUrl;
      const apiKey = configResult?.llm.apiKey;
      const apiKeyOptional = isApiKeyOptionalForEndpoint({ provider, baseUrl });
      const hasKey = apiKeyOptional || (!!apiKey && apiKey.length > 10 && apiKey !== "your-api-key-here");
      checks.push({
        name: "LLM API Key",
        ok: hasKey,
        detail: apiKeyOptional
          ? "Optional for local/self-hosted endpoint"
          : hasKey
            ? "Configured"
            : "Missing — save a Studio service key or set env for CLI/daemon/deploy",
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

    // 5b. Check version migration status
    {
      const { existsSync } = await import("node:fs");
      const hasStructuredState = existsSync(join(root, "books"));
      if (hasStructuredState) {
        const { StateManager } = await import("@actalk/inkos-core");
        const sm = new StateManager(root);
        const bookIds = await sm.listBooks();
        let legacyCount = 0;
        for (const bid of bookIds) {
          const stateDir = join(sm.bookDir(bid), "story", "state");
          const hasNewState = existsSync(stateDir);
          if (!hasNewState) legacyCount++;
        }
        if (legacyCount > 0) {
          checks.push({
            name: "Version Migration",
            ok: false,
            detail: `${legacyCount} book(s) using legacy format (pre-v0.6). Run 'inkos write next' on each to auto-migrate, or re-init with 'inkos init'.`,
          });
        } else if (bookIds.length > 0) {
          checks.push({
            name: "Version Migration",
            ok: true,
            detail: "All books use current format",
          });
        }
      }
    }

    // 6. API connectivity test
    try {
      const { createLLMClient, chatCompletion, LLMConfigSchema, isApiKeyOptionalForEndpoint, resolveServiceModelsBaseUrl } = await import("@actalk/inkos-core");
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
        const apiKeyOptional = isApiKeyOptionalForEndpoint({
          provider: env.INKOS_LLM_PROVIDER,
          baseUrl: env.INKOS_LLM_BASE_URL,
        });
        if ((env.INKOS_LLM_API_KEY || apiKeyOptional) && env.INKOS_LLM_BASE_URL && env.INKOS_LLM_MODEL) {
          llmConfig = LLMConfigSchema.parse({
            provider: env.INKOS_LLM_PROVIDER ?? "custom",
            baseUrl: env.INKOS_LLM_BASE_URL,
            apiKey: env.INKOS_LLM_API_KEY ?? "",
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
        checks.push({
          name: "  Hint",
          ok: false,
          detail: "Run `inkos setup`, `inkos config set-global`, or add LLM settings to the project .env file.",
        });
      } else {
        checks.push({
          name: "LLM Config",
          ok: true,
          detail: `provider=${llmConfig.provider} model=${llmConfig.model} stream=${llmConfig.stream ?? true} baseUrl=${llmConfig.baseUrl}`,
        });

        log("\n  [..] Testing API connectivity...");

        let connected = false;
        let detectedDetail = "";
        let lastError = "Unknown error";
        const modelsBaseUrl = resolveDoctorModelsBaseUrl(
          typeof llmConfig.service === "string" ? llmConfig.service : undefined,
          llmConfig.baseUrl,
          resolveServiceModelsBaseUrl,
        );
        const discoveredModels = (llmConfig.apiKey && modelsBaseUrl)
          ? await fetchDoctorModels(modelsBaseUrl, llmConfig.apiKey, llmConfig.proxyUrl)
          : [];
        const modelCandidates = (llmConfig.provider === "openai" || discoveredModels.length > 0)
          ? buildDoctorModelCandidates(llmConfig.model, discoveredModels)
          : [llmConfig.model];
        const plans = llmConfig.provider === "openai"
          ? buildDoctorProbePlans(llmConfig.apiFormat, llmConfig.stream)
          : [{ apiFormat: (llmConfig.apiFormat ?? "chat") as "chat" | "responses", stream: llmConfig.stream ?? true }];

        for (const model of modelCandidates) {
          for (const plan of plans) {
            try {
              const client = createLLMClient({
                ...llmConfig,
                model,
                apiFormat: plan.apiFormat,
                stream: plan.stream,
              });
              const response = await chatCompletion(client, model, [
                { role: "user", content: "Say OK" },
              ], { maxTokens: 16 });

              connected = true;
              detectedDetail = `OK (model: ${model}, apiFormat=${plan.apiFormat}, stream=${plan.stream}, tokens: ${response.usage.totalTokens})`;
              break;
            } catch (error) {
              lastError = error instanceof Error ? error.message : String(error);
            }
          }
          if (connected) {
            break;
          }
        }

        checks.push({
          name: "API Connectivity",
          ok: connected,
          detail: connected ? detectedDetail : lastError.split("\n")[0]!,
        });

        if (!connected && /\b(?:401|403|429)\b|unauthorized|forbidden|quota|balance|insufficient|exceeded|额度|余额|配额/i.test(lastError)) {
          checks.push({
            name: "  Hint",
            ok: false,
            detail: formatDoctorHintQuota(language),
          });
        }

        if (!connected && llmConfig.provider === "openai") {
          checks.push({
            name: "  Hint",
            ok: false,
            detail: formatDoctorHintOpenAiProbeExhausted(language),
          });
        }
      }
    } catch (e) {
      const errMsg = String(e);
      const hints: string[] = [];

      if (errMsg.includes("Connection error") || errMsg.includes("ECONNREFUSED") || errMsg.includes("fetch failed")) {
        hints.push(formatDoctorHintBaseUrl(language));
      }
      if (errMsg.includes("400")) {
        hints.push(formatDoctorHintStreamRequirement(language));
        hints.push(formatDoctorHintModelName(language));
      }
      if (errMsg.includes("401")) {
        hints.push(formatDoctorHintInvalidApiKey(language));
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
