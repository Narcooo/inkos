# Service Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic ConfigView with a multi-service-provider management system: secrets isolation, temperature constraints, service card grid, detail pages, and PromptInputSelect model picker in the chat input bar.

**Architecture:** Core layer gains three new modules (secrets, service-resolver, config-migration) that handle multi-service config, API key isolation, and pi-ai model resolution. Studio gains two new pages (ServiceListPage, ServiceDetailPage), route extensions, and a PromptInputSelect-based model picker. The old ConfigView and single-provider `llm.*` config format are replaced.

**Tech Stack:** TypeScript, Vitest, Zustand (LobeHub slice pattern), Hono, pi-ai (@mariozechner/pi-ai), ai-elements (PromptInputSelect), React

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/core/src/llm/secrets.ts` | Load/save `.inkos/secrets.json`, API key lookup (secrets → env → null) |
| `packages/core/src/llm/service-resolver.ts` | Resolve service + modelId → pi-ai Model + apiKey + temperature |
| `packages/core/src/llm/config-migration.ts` | Migrate old `llm.provider+model+apiKey` → `llm.services[]` + secrets |
| `packages/core/src/__tests__/secrets.test.ts` | Unit tests for secrets module |
| `packages/core/src/__tests__/service-resolver.test.ts` | Unit tests for service resolver |
| `packages/core/src/__tests__/config-migration.test.ts` | Unit tests for migration |
| `packages/core/src/__tests__/temperature-constraints.test.ts` | Regression tests for temperature clamp per provider |
| `packages/studio/src/pages/ServiceListPage.tsx` | Card grid of all service providers |
| `packages/studio/src/pages/ServiceDetailPage.tsx` | Detail page for one service (key, models, params) |

### Modified Files

| File | Changes |
|------|---------|
| `packages/core/src/llm/service-presets.ts` | Add `temperatureRange`, `defaultTemperature`, `writingTemperature`, `temperatureHint` to ServicePreset; populate for all 12 services |
| `packages/core/src/agent/agent-system-prompt.ts` | Append no-emoji rule to both modes |
| `packages/core/src/__tests__/agent-system-prompt.test.ts` | Add no-emoji assertion |
| `packages/studio/src/api/server.ts` | Add `GET/PUT /api/services/config`, `POST /api/services/:service/test`; update `POST /api/agent` to accept `model`/`service` params |
| `packages/studio/src/hooks/use-hash-route.ts` | Add `services` and `service-detail` route types |
| `packages/studio/src/App.tsx` | Render ServiceListPage / ServiceDetailPage; redirect `config` → `services`; add topbar lang/theme toggles |
| `packages/studio/src/store/chat/types.ts` | Add `selectedModel`, `selectedService` to MessageState |
| `packages/studio/src/store/chat/slices/message/action.ts` | Pass `model`/`service` to `POST /api/agent`; add `setSelectedModel` action |
| `packages/studio/src/pages/ChatPage.tsx` | Add PromptInputSelect with grouped models |
| `packages/studio/src/pages/Dashboard.tsx` | Add warning banner when no services configured |
| `packages/core/src/agent/agent-session.ts` | Evict+rebuild agent on model switch (preserving messages) |

### Deleted Files

| File | Reason |
|------|--------|
| `packages/studio/src/pages/ConfigView.tsx` | Replaced by ServiceListPage + ServiceDetailPage |

---

### Task 1: secrets.ts — API key storage

**Files:**
- Create: `packages/core/src/llm/secrets.ts`
- Test: `packages/core/src/__tests__/secrets.test.ts`

- [ ] **Step 1: Write failing tests for secrets module**

```ts
// packages/core/src/__tests__/secrets.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadSecrets, saveSecrets, getServiceApiKey } from "../llm/secrets.js";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("secrets", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-secrets-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe("loadSecrets", () => {
    it("returns empty when .inkos/secrets.json does not exist", async () => {
      const secrets = await loadSecrets(root);
      expect(secrets).toEqual({ services: {} });
    });

    it("reads existing secrets file", async () => {
      await mkdir(join(root, ".inkos"), { recursive: true });
      await writeFile(
        join(root, ".inkos", "secrets.json"),
        JSON.stringify({ services: { moonshot: { apiKey: "sk-test" } } }),
      );
      const secrets = await loadSecrets(root);
      expect(secrets.services.moonshot.apiKey).toBe("sk-test");
    });
  });

  describe("saveSecrets", () => {
    it("creates .inkos dir and writes secrets file", async () => {
      await saveSecrets(root, {
        services: { deepseek: { apiKey: "sk-deep" } },
      });
      const raw = await readFile(join(root, ".inkos", "secrets.json"), "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.services.deepseek.apiKey).toBe("sk-deep");
    });

    it("overwrites existing secrets file", async () => {
      await mkdir(join(root, ".inkos"), { recursive: true });
      await writeFile(
        join(root, ".inkos", "secrets.json"),
        JSON.stringify({ services: { old: { apiKey: "old-key" } } }),
      );
      await saveSecrets(root, {
        services: { new: { apiKey: "new-key" } },
      });
      const secrets = await loadSecrets(root);
      expect(secrets.services.new.apiKey).toBe("new-key");
      expect(secrets.services.old).toBeUndefined();
    });
  });

  describe("getServiceApiKey", () => {
    it("returns key from secrets.json first", async () => {
      await mkdir(join(root, ".inkos"), { recursive: true });
      await writeFile(
        join(root, ".inkos", "secrets.json"),
        JSON.stringify({ services: { moonshot: { apiKey: "sk-from-file" } } }),
      );
      const key = await getServiceApiKey(root, "moonshot");
      expect(key).toBe("sk-from-file");
    });

    it("falls back to environment variable", async () => {
      vi.stubEnv("MOONSHOT_API_KEY", "sk-from-env");
      const key = await getServiceApiKey(root, "moonshot");
      expect(key).toBe("sk-from-env");
      vi.unstubAllEnvs();
    });

    it("returns null when neither secrets nor env exists", async () => {
      const key = await getServiceApiKey(root, "moonshot");
      expect(key).toBeNull();
    });

    it("handles custom service with colon key format", async () => {
      await mkdir(join(root, ".inkos"), { recursive: true });
      await writeFile(
        join(root, ".inkos", "secrets.json"),
        JSON.stringify({
          services: { "custom:内网GPT": { apiKey: "sk-custom" } },
        }),
      );
      const key = await getServiceApiKey(root, "custom:内网GPT");
      expect(key).toBe("sk-custom");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test packages/core/src/__tests__/secrets.test.ts`
Expected: FAIL — module `../llm/secrets.js` not found

- [ ] **Step 3: Implement secrets module**

```ts
// packages/core/src/llm/secrets.ts
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface SecretsFile {
  services: Record<string, { apiKey: string }>;
}

const SECRETS_DIR = ".inkos";
const SECRETS_FILE = "secrets.json";

export async function loadSecrets(projectRoot: string): Promise<SecretsFile> {
  try {
    const raw = await readFile(
      join(projectRoot, SECRETS_DIR, SECRETS_FILE),
      "utf-8",
    );
    return JSON.parse(raw) as SecretsFile;
  } catch {
    return { services: {} };
  }
}

export async function saveSecrets(
  projectRoot: string,
  secrets: SecretsFile,
): Promise<void> {
  const dir = join(projectRoot, SECRETS_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, SECRETS_FILE),
    JSON.stringify(secrets, null, 2),
    "utf-8",
  );
}

export async function getServiceApiKey(
  projectRoot: string,
  service: string,
): Promise<string | null> {
  // 1. secrets.json
  const secrets = await loadSecrets(projectRoot);
  const entry = secrets.services[service];
  if (entry?.apiKey) return entry.apiKey;

  // 2. Environment variable: MOONSHOT_API_KEY, DEEPSEEK_API_KEY, etc.
  const envKey = `${service.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_API_KEY`;
  if (process.env[envKey]) return process.env[envKey]!;

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test packages/core/src/__tests__/secrets.test.ts`
Expected: PASS — all 6 tests green

- [ ] **Step 5: Add exports to barrel file**

Add to `packages/core/src/index.ts`:
```ts
export { loadSecrets, saveSecrets, getServiceApiKey, type SecretsFile } from "./llm/secrets.js";
```

- [ ] **Step 6: Run full test suite**

Run: `pnpm test`
Expected: All existing tests still pass

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/llm/secrets.ts packages/core/src/__tests__/secrets.test.ts packages/core/src/index.ts
git commit -m "feat(core): add secrets module for API key isolation"
```

---

### Task 2: Extend service-presets with temperature constraints

**Files:**
- Modify: `packages/core/src/llm/service-presets.ts`
- Create: `packages/core/src/__tests__/temperature-constraints.test.ts`

- [ ] **Step 1: Write failing tests for temperature constraints**

```ts
// packages/core/src/__tests__/temperature-constraints.test.ts
import { describe, it, expect } from "vitest";
import { resolveServicePreset } from "../llm/service-presets.js";

describe("temperature constraints per service", () => {
  it("moonshot has range [0, 1] and writingTemperature 1.0", () => {
    const preset = resolveServicePreset("moonshot");
    expect(preset?.temperatureRange).toEqual([0, 1]);
    expect(preset?.writingTemperature).toBe(1.0);
  });

  it("deepseek has range [0, 2] and writingTemperature 1.5", () => {
    const preset = resolveServicePreset("deepseek");
    expect(preset?.temperatureRange).toEqual([0, 2]);
    expect(preset?.writingTemperature).toBe(1.5);
  });

  it("anthropic has range [0, 1] and writingTemperature 1.0", () => {
    const preset = resolveServicePreset("anthropic");
    expect(preset?.temperatureRange).toEqual([0, 1]);
    expect(preset?.writingTemperature).toBe(1.0);
  });

  it("openai has range [0, 2] and writingTemperature 1.0", () => {
    const preset = resolveServicePreset("openai");
    expect(preset?.temperatureRange).toEqual([0, 2]);
    expect(preset?.writingTemperature).toBe(1.0);
  });

  it("zhipu has range [0, 1]", () => {
    const preset = resolveServicePreset("zhipu");
    expect(preset?.temperatureRange).toEqual([0, 1]);
  });

  it("bailian has range [0, 2]", () => {
    const preset = resolveServicePreset("bailian");
    expect(preset?.temperatureRange).toEqual([0, 2]);
  });

  it("minimax has range [0, 2]", () => {
    const preset = resolveServicePreset("minimax");
    expect(preset?.temperatureRange).toEqual([0, 2]);
  });

  it("clampTemperature respects service range", () => {
    const { clampTemperature } = require("../llm/service-presets.js");
    expect(clampTemperature("moonshot", 1.5)).toBe(1.0);
    expect(clampTemperature("moonshot", 0.7)).toBe(0.7);
    expect(clampTemperature("deepseek", 1.5)).toBe(1.5);
    expect(clampTemperature("deepseek", 2.5)).toBe(2.0);
    expect(clampTemperature("unknown-service", 1.5)).toBe(1.5);
  });

  it("getWritingTemperature returns service-specific value", () => {
    const { getWritingTemperature } = require("../llm/service-presets.js");
    expect(getWritingTemperature("moonshot")).toBe(1.0);
    expect(getWritingTemperature("deepseek")).toBe(1.5);
    expect(getWritingTemperature("anthropic")).toBe(1.0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test packages/core/src/__tests__/temperature-constraints.test.ts`
Expected: FAIL — `temperatureRange` is undefined, `clampTemperature`/`getWritingTemperature` don't exist

- [ ] **Step 3: Extend ServicePreset and update SERVICE_PRESETS**

In `packages/core/src/llm/service-presets.ts`, add fields to the interface and populate all presets:

```ts
// Add to ServicePreset interface:
export interface ServicePreset {
  api: "openai" | "anthropic";
  baseUrl: string;
  label: string;
  temperatureRange?: [number, number];
  defaultTemperature?: number;
  writingTemperature?: number;
  temperatureHint?: string;
}

// Update SERVICE_PRESETS entries — add temperature fields to each:
// openai:
temperatureRange: [0, 2], defaultTemperature: 1.0, writingTemperature: 1.0,

// anthropic:
temperatureRange: [0, 1], defaultTemperature: 1.0, writingTemperature: 1.0,
temperatureHint: "不要同时改 temperature 和 top_p",

// deepseek:
temperatureRange: [0, 2], defaultTemperature: 1.0, writingTemperature: 1.5,
temperatureHint: "创意写作推荐 1.5",

// moonshot:
temperatureRange: [0, 1], defaultTemperature: 0.3, writingTemperature: 1.0,
temperatureHint: "kimi-k2.5 推荐 temperature=1.0",

// minimax:
temperatureRange: [0, 2], defaultTemperature: 0.9, writingTemperature: 0.9,

// bailian:
temperatureRange: [0, 2], defaultTemperature: 0.7, writingTemperature: 1.0,

// zhipu:
temperatureRange: [0, 1], defaultTemperature: 0.95, writingTemperature: 0.95,

// siliconflow, ppio, openrouter, ollama — no range (transparent proxies)
// custom — no range (unknown endpoint)
```

- [ ] **Step 4: Add clampTemperature and getWritingTemperature functions**

```ts
// Add to service-presets.ts:

const DEFAULT_TEMPERATURE_RANGE: [number, number] = [0, 2];

export function clampTemperature(service: string, temperature: number): number {
  const preset = resolveServicePreset(service);
  const [min, max] = preset?.temperatureRange ?? DEFAULT_TEMPERATURE_RANGE;
  return Math.max(min, Math.min(max, temperature));
}

export function getWritingTemperature(service: string): number {
  const preset = resolveServicePreset(service);
  return preset?.writingTemperature ?? preset?.defaultTemperature ?? 1.0;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test packages/core/src/__tests__/temperature-constraints.test.ts`
Expected: PASS — all assertions green

- [ ] **Step 6: Run full test suite**

Run: `pnpm test`
Expected: All existing tests still pass (SERVICE_PRESETS is additive, no breaking changes)

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/llm/service-presets.ts packages/core/src/__tests__/temperature-constraints.test.ts
git commit -m "feat(core): add temperature constraints per service provider"
```

---

### Task 3: Config migration — old format to multi-service

**Files:**
- Create: `packages/core/src/llm/config-migration.ts`
- Test: `packages/core/src/__tests__/config-migration.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/core/src/__tests__/config-migration.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { migrateConfig } from "../llm/config-migration.js";
import { loadSecrets } from "../llm/secrets.js";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("config migration", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-migrate-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("migrates old llm.provider+model+apiKey to services[] + secrets", async () => {
    const oldConfig = {
      name: "mybook",
      llm: {
        provider: "openai",
        model: "kimi-k2.5",
        baseUrl: "https://api.moonshot.cn/v1",
        apiKey: "sk-old-key",
      },
      language: "zh",
    };
    await writeFile(join(root, "inkos.json"), JSON.stringify(oldConfig));

    const result = await migrateConfig(root);

    expect(result.migrated).toBe(true);

    // inkos.json should have services[] and no apiKey
    const raw = await readFile(join(root, "inkos.json"), "utf-8");
    const config = JSON.parse(raw);
    expect(config.llm.services).toHaveLength(1);
    expect(config.llm.services[0].service).toBe("moonshot");
    expect(config.llm.services[0].apiKey).toBeUndefined();
    expect(config.llm.defaultModel).toBe("kimi-k2.5");
    expect(config.llm.provider).toBeUndefined();
    expect(config.llm.model).toBeUndefined();
    expect(config.llm.apiKey).toBeUndefined();

    // secrets.json should have the key
    const secrets = await loadSecrets(root);
    expect(secrets.services.moonshot.apiKey).toBe("sk-old-key");
  });

  it("does nothing if already in new format", async () => {
    const newConfig = {
      name: "mybook",
      llm: {
        services: [{ service: "moonshot" }],
        defaultModel: "kimi-k2.5",
      },
      language: "zh",
    };
    await writeFile(join(root, "inkos.json"), JSON.stringify(newConfig));

    const result = await migrateConfig(root);
    expect(result.migrated).toBe(false);
  });

  it("guesses service from baseUrl", async () => {
    const oldConfig = {
      llm: {
        provider: "openai",
        model: "deepseek-chat",
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: "sk-deep",
      },
    };
    await writeFile(join(root, "inkos.json"), JSON.stringify(oldConfig));

    await migrateConfig(root);

    const raw = await readFile(join(root, "inkos.json"), "utf-8");
    const config = JSON.parse(raw);
    expect(config.llm.services[0].service).toBe("deepseek");
  });

  it("creates custom service when baseUrl is unrecognized", async () => {
    const oldConfig = {
      llm: {
        provider: "openai",
        model: "my-model",
        baseUrl: "https://llm.internal.corp/v1",
        apiKey: "sk-corp",
      },
    };
    await writeFile(join(root, "inkos.json"), JSON.stringify(oldConfig));

    await migrateConfig(root);

    const raw = await readFile(join(root, "inkos.json"), "utf-8");
    const config = JSON.parse(raw);
    expect(config.llm.services[0].service).toBe("custom");
    expect(config.llm.services[0].baseUrl).toBe("https://llm.internal.corp/v1");
    expect(config.llm.services[0].name).toBe("Custom");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test packages/core/src/__tests__/config-migration.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement config migration**

```ts
// packages/core/src/llm/config-migration.ts
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { saveSecrets, loadSecrets } from "./secrets.js";
import { guessServiceFromBaseUrl } from "./service-presets.js";

export interface MigrationResult {
  migrated: boolean;
}

export async function migrateConfig(projectRoot: string): Promise<MigrationResult> {
  const configPath = join(projectRoot, "inkos.json");
  let raw: string;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch {
    return { migrated: false };
  }

  const config = JSON.parse(raw);
  const llm = config.llm;
  if (!llm) return { migrated: false };

  // Already new format
  if (Array.isArray(llm.services)) return { migrated: false };

  // Old format: llm.provider, llm.model, llm.baseUrl, llm.apiKey
  const { provider, model, baseUrl, apiKey, ...restLlm } = llm;
  if (!model && !provider) return { migrated: false };

  // Determine service from baseUrl
  const guessedService = baseUrl ? guessServiceFromBaseUrl(baseUrl) : null;
  const service = guessedService ?? "custom";

  // Build new service entry
  const serviceEntry: Record<string, string> = { service };
  if (service === "custom") {
    serviceEntry.name = "Custom";
    if (baseUrl) serviceEntry.baseUrl = baseUrl;
  }

  // Write new config (no apiKey)
  config.llm = {
    ...restLlm,
    services: [serviceEntry],
    defaultModel: model,
  };
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");

  // Move apiKey to secrets
  if (apiKey) {
    const secrets = await loadSecrets(projectRoot);
    const secretKey = service === "custom" ? `custom:${serviceEntry.name}` : service;
    secrets.services[secretKey] = { apiKey };
    await saveSecrets(projectRoot, secrets);
  }

  return { migrated: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test packages/core/src/__tests__/config-migration.test.ts`
Expected: PASS

- [ ] **Step 5: Add export to barrel**

Add to `packages/core/src/index.ts`:
```ts
export { migrateConfig, type MigrationResult } from "./llm/config-migration.js";
```

- [ ] **Step 6: Run full test suite**

Run: `pnpm test`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/llm/config-migration.ts packages/core/src/__tests__/config-migration.test.ts packages/core/src/index.ts
git commit -m "feat(core): add config migration from old single-provider format"
```

---

### Task 4: service-resolver — resolve service+model to pi-ai Model

**Files:**
- Create: `packages/core/src/llm/service-resolver.ts`
- Test: `packages/core/src/__tests__/service-resolver.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/core/src/__tests__/service-resolver.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock pi-ai's getModel
vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn((provider: string, modelId: string) => ({
    id: modelId,
    api: { name: "mock-api" },
    _provider: provider,
  })),
  getEnvApiKey: vi.fn(() => undefined),
}));

import { resolveServiceModel } from "../llm/service-resolver.js";

describe("resolveServiceModel", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-resolver-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("resolves built-in service with key from secrets", async () => {
    await mkdir(join(root, ".inkos"), { recursive: true });
    await writeFile(
      join(root, ".inkos", "secrets.json"),
      JSON.stringify({ services: { moonshot: { apiKey: "sk-moon" } } }),
    );

    const result = await resolveServiceModel("moonshot", "kimi-k2.5", root);

    expect(result.model.id).toBe("kimi-k2.5");
    expect(result.apiKey).toBe("sk-moon");
    expect(result.writingTemperature).toBe(1.0);
    expect(result.temperatureRange).toEqual([0, 1]);
  });

  it("resolves deepseek with correct temperature", async () => {
    await mkdir(join(root, ".inkos"), { recursive: true });
    await writeFile(
      join(root, ".inkos", "secrets.json"),
      JSON.stringify({ services: { deepseek: { apiKey: "sk-deep" } } }),
    );

    const result = await resolveServiceModel("deepseek", "deepseek-chat", root);

    expect(result.apiKey).toBe("sk-deep");
    expect(result.writingTemperature).toBe(1.5);
    expect(result.temperatureRange).toEqual([0, 2]);
  });

  it("falls back to env var when no secrets file", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-env");

    const result = await resolveServiceModel("deepseek", "deepseek-chat", root);

    expect(result.apiKey).toBe("sk-env");
  });

  it("throws when no key found", async () => {
    await expect(
      resolveServiceModel("moonshot", "kimi-k2.5", root),
    ).rejects.toThrow(/API key/i);
  });

  it("resolves custom service with baseUrl", async () => {
    await mkdir(join(root, ".inkos"), { recursive: true });
    await writeFile(
      join(root, ".inkos", "secrets.json"),
      JSON.stringify({ services: { "custom:内网GPT": { apiKey: "sk-corp" } } }),
    );

    const result = await resolveServiceModel(
      "custom:内网GPT",
      "gpt-4o",
      root,
      "https://llm.internal.corp/v1",
    );

    expect(result.apiKey).toBe("sk-corp");
    expect(result.model.id).toBe("gpt-4o");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test packages/core/src/__tests__/service-resolver.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement service-resolver**

```ts
// packages/core/src/llm/service-resolver.ts
import { getModel } from "@mariozechner/pi-ai";
import type { Model, Api } from "@mariozechner/pi-ai";
import { resolveServicePreset, SERVICE_TO_PI_PROVIDER } from "./service-presets.js";
import { getServiceApiKey } from "./secrets.js";

export interface ResolvedModel {
  model: Model<Api>;
  apiKey: string;
  writingTemperature?: number;
  temperatureRange?: [number, number];
  temperatureHint?: string;
}

export async function resolveServiceModel(
  service: string,
  modelId: string,
  projectRoot: string,
  customBaseUrl?: string,
): Promise<ResolvedModel> {
  // Resolve API key
  const apiKey = await getServiceApiKey(projectRoot, service);
  if (!apiKey) {
    throw new Error(`API key not found for service "${service}". Add it in .inkos/secrets.json or set the environment variable.`);
  }

  // Determine pi-ai provider
  const baseService = service.startsWith("custom:") ? "custom" : service;
  const preset = resolveServicePreset(baseService);
  const piProvider = SERVICE_TO_PI_PROVIDER[baseService] ?? "openai";

  // Get pi-ai Model
  const model = getModel(piProvider as any, modelId as any);

  return {
    model,
    apiKey,
    writingTemperature: preset?.writingTemperature,
    temperatureRange: preset?.temperatureRange,
    temperatureHint: preset?.temperatureHint,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test packages/core/src/__tests__/service-resolver.test.ts`
Expected: PASS

- [ ] **Step 5: Add export to barrel**

Add to `packages/core/src/index.ts`:
```ts
export { resolveServiceModel, type ResolvedModel } from "./llm/service-resolver.js";
```

- [ ] **Step 6: Run full test suite**

Run: `pnpm test`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/llm/service-resolver.ts packages/core/src/__tests__/service-resolver.test.ts packages/core/src/index.ts
git commit -m "feat(core): add service-resolver for multi-provider model resolution"
```

---

### Task 5: System prompt no-emoji patch

**Files:**
- Modify: `packages/core/src/agent/agent-system-prompt.ts`
- Modify: `packages/core/src/__tests__/agent-system-prompt.test.ts`

- [ ] **Step 1: Write failing test**

Add to `packages/core/src/__tests__/agent-system-prompt.test.ts`:

```ts
// Inside describe("no book (creation flow)"):
it("Chinese prompt forbids emoji", () => {
  const prompt = buildAgentSystemPrompt(null, "zh");
  expect(prompt).toContain("不要在回复中添加表情符号");
});

it("English prompt forbids emoji", () => {
  const prompt = buildAgentSystemPrompt(null, "en");
  expect(prompt).toContain("Do NOT use emoji");
});

// Inside describe("with book (writing flow)"):
it("Chinese prompt forbids emoji", () => {
  const prompt = buildAgentSystemPrompt("my-book", "zh");
  expect(prompt).toContain("不要在回复中添加表情符号");
});

it("English prompt forbids emoji", () => {
  const prompt = buildAgentSystemPrompt("novel", "en");
  expect(prompt).toContain("Do NOT use emoji");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test packages/core/src/__tests__/agent-system-prompt.test.ts`
Expected: FAIL — "不要在回复中添加表情符号" not found in prompt

- [ ] **Step 3: Add no-emoji to system prompts**

In `packages/core/src/agent/agent-system-prompt.ts`, append to each of the four prompt strings (zh no-book, en no-book, zh with-book, en with-book):

For Chinese prompts, add before the closing backtick:
```
- **不要在回复中添加表情符号**
```

For English prompts, add before the closing backtick:
```
- **Do NOT use emoji in your responses**
```

Specifically:
- zh no-book: append after `- 保持简短、自然`
- en no-book: append after `- Keep responses brief and natural`
- zh with-book: append after `- **注意：不要调用 architect，当前已有书籍，不需要建书**`
- en with-book: append after `- **Do NOT call architect — a book already exists**`

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test packages/core/src/__tests__/agent-system-prompt.test.ts`
Expected: PASS — all tests including new emoji ones

- [ ] **Step 5: Run full test suite**

Run: `pnpm test`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/agent/agent-system-prompt.ts packages/core/src/__tests__/agent-system-prompt.test.ts
git commit -m "feat(core): forbid emoji in agent system prompts"
```

---

### Task 6: API endpoints for service config CRUD

**Files:**
- Modify: `packages/studio/src/api/server.ts`

- [ ] **Step 1: Add GET /api/services/config endpoint**

In `packages/studio/src/api/server.ts`, add after the existing services endpoints:

```ts
// GET /api/services/config — return services array from inkos.json (no apiKeys)
app.get("/api/services/config", async (c) => {
  const configPath = join(root, "inkos.json");
  const raw = await readFile(configPath, "utf-8");
  const config = JSON.parse(raw);
  const services = config.llm?.services ?? [];
  return c.json({ services, defaultModel: config.llm?.defaultModel ?? null });
});
```

- [ ] **Step 2: Add PUT /api/services/config endpoint**

```ts
// PUT /api/services/config — update services array + defaultModel in inkos.json
app.put("/api/services/config", async (c) => {
  const body = await c.req.json<{ services: any[]; defaultModel?: string }>();
  const configPath = join(root, "inkos.json");
  const raw = await readFile(configPath, "utf-8");
  const config = JSON.parse(raw);
  config.llm = config.llm ?? {};
  config.llm.services = body.services;
  if (body.defaultModel !== undefined) {
    config.llm.defaultModel = body.defaultModel;
  }
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  return c.json({ ok: true });
});
```

- [ ] **Step 3: Add POST /api/services/:service/test endpoint**

```ts
// POST /api/services/:service/test — test connection with apiKey
app.post("/api/services/:service/test", async (c) => {
  const service = c.req.param("service");
  const { apiKey } = await c.req.json<{ apiKey: string }>();
  const { resolveServicePreset, listModelsForService } = await import("@actalk/inkos-core");
  const preset = resolveServicePreset(service);
  if (!preset && service !== "custom") {
    return c.json({ ok: false, error: `Unknown service: ${service}` }, 400);
  }
  try {
    const models = await listModelsForService(service, apiKey);
    return c.json({ ok: true, modelCount: models.length, models: models.slice(0, 20) });
  } catch (err: any) {
    return c.json({ ok: false, error: err?.message ?? String(err) }, 400);
  }
});
```

- [ ] **Step 4: Add PUT /api/services/:service/secret endpoint**

```ts
// PUT /api/services/:service/secret — save apiKey to .inkos/secrets.json
app.put("/api/services/:service/secret", async (c) => {
  const service = c.req.param("service");
  const { apiKey } = await c.req.json<{ apiKey: string }>();
  const { loadSecrets, saveSecrets } = await import("@actalk/inkos-core");
  const secrets = await loadSecrets(root);
  secrets.services[service] = { apiKey };
  await saveSecrets(root, secrets);
  return c.json({ ok: true });
});
```

- [ ] **Step 5: Run full test suite to check nothing broke**

Run: `pnpm test`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add packages/studio/src/api/server.ts
git commit -m "feat(studio): add service config CRUD and secrets API endpoints"
```

---

### Task 7: Update POST /api/agent for multi-service model resolution

**Files:**
- Modify: `packages/studio/src/api/server.ts` (POST /api/agent handler)
- Modify: `packages/core/src/agent/agent-session.ts` (model switch eviction)

- [ ] **Step 1: Update POST /api/agent to accept model/service params**

In `packages/studio/src/api/server.ts`, modify the existing `POST /api/agent` handler. Change the body parsing to accept new fields:

```ts
const { instruction, activeBookId, sessionId: reqSessionId, model: reqModel, service: reqService } = await c.req.json<{
  instruction: string;
  activeBookId?: string;
  sessionId?: string;
  model?: string;
  service?: string;
}>();
```

Replace the model resolution block (lines ~660-663) with:

```ts
// Resolve model — new multi-service path
let model: any;
let apiKey: string | undefined;

if (reqService && reqModel) {
  // Frontend explicitly selected a service+model
  const { resolveServiceModel } = await import("@actalk/inkos-core");
  const resolved = await resolveServiceModel(reqService, reqModel, root);
  model = resolved.model;
  apiKey = resolved.apiKey;
} else {
  // Fallback: use defaultModel from inkos.json
  const config = await loadCurrentProjectConfig({ requireApiKey: false });
  const { resolveServiceModel, getServiceApiKey } = await import("@actalk/inkos-core");
  const defaultModel = config.llm?.defaultModel ?? config.llm?.model;
  const defaultService = config.llm?.services?.[0]?.service ?? config.llm?.service;
  if (defaultService && defaultModel) {
    const resolved = await resolveServiceModel(defaultService, defaultModel, root);
    model = resolved.model;
    apiKey = resolved.apiKey;
  } else {
    // Legacy fallback
    const client = createLLMClient(config.llm);
    model = client._piModel ?? { provider: config.llm.provider ?? "anthropic", modelId: config.llm.model };
    apiKey = client._apiKey;
  }
}
```

- [ ] **Step 2: Add model switch eviction to agent-session.ts**

In `packages/core/src/agent/agent-session.ts`, modify `runAgentSession` to detect model changes and evict:

```ts
// After line "let cached = agentCache.get(sessionId);"
// Add model-switch detection:
if (cached) {
  const currentModelId = (cached.agent.state.model as any)?.id;
  const newModelId = (resolveModel(config.model) as any)?.id;
  if (currentModelId && newModelId && currentModelId !== newModelId) {
    // Model changed — preserve messages, evict agent
    const preservedMessages = cached.agent.state.messages;
    agentCache.delete(sessionId);
    cached = undefined;
    // Will recreate below with new model, restoring messages
    if (!initialMessages || initialMessages.length === 0) {
      const { agentMessagesToPlain } = require("./agent-session.js");
      // Convert preserved messages back to plain format for re-injection
      initialMessages = agentMessagesToPlain(preservedMessages);
    }
  }
}
```

Note: Export `agentMessagesToPlain` from agent-session.ts (currently private function, make it exported).

- [ ] **Step 3: Run full test suite**

Run: `pnpm test`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add packages/studio/src/api/server.ts packages/core/src/agent/agent-session.ts
git commit -m "feat: multi-service model resolution in POST /api/agent with cache eviction"
```

---

### Task 8: Routes — add services pages, redirect config

**Files:**
- Modify: `packages/studio/src/hooks/use-hash-route.ts`
- Modify: `packages/studio/src/App.tsx`
- Create: `packages/studio/src/pages/ServiceListPage.tsx`
- Create: `packages/studio/src/pages/ServiceDetailPage.tsx`
- Delete: `packages/studio/src/pages/ConfigView.tsx`

- [ ] **Step 1: Add route types for services**

In `packages/studio/src/hooks/use-hash-route.ts`, add to the `HashRoute` union:

```ts
| { page: "services" }
| { page: "service-detail"; serviceId: string }
```

Update `parseHash`:
```ts
if (path === "config" || path === "services") return { page: "services" };
const serviceMatch = path.match(/^services\/([^/]+)$/);
if (serviceMatch) return { page: "service-detail", serviceId: decodeURIComponent(serviceMatch[1]) };
```

Add to `routeToHash`:
```ts
case "services": return "#/services";
case "service-detail": return `#/services/${encodeURIComponent(route.serviceId)}`;
```

Add navigation methods to the `nav` object in `useHashRoute`:
```ts
toServices: () => setRoute({ page: "services" }),
toServiceDetail: (id: string) => setRoute({ page: "service-detail", serviceId: id }),
```

- [ ] **Step 2: Create ServiceListPage skeleton**

```tsx
// packages/studio/src/pages/ServiceListPage.tsx
import { useState, useEffect } from "react";
import { fetchJson } from "../hooks/use-api";

interface ServiceStatus {
  service: string;
  label: string;
  connected: boolean;
  modelCount: number;
}

interface Nav {
  toDashboard: () => void;
  toServiceDetail: (id: string) => void;
}

export function ServiceListPage({ nav }: { nav: Nav }) {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchJson<{ services: ServiceStatus[] }>("/services")
      .then((data) => setServices(data.services))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-muted-foreground py-20 text-center text-sm">Loading...</div>;
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
        <button onClick={nav.toDashboard} className="hover:text-foreground transition-colors">首页</button>
        <span className="text-border">/</span>
        <span className="text-foreground">服务商管理</span>
      </div>

      <h1 className="font-serif text-2xl mb-8">服务商管理</h1>

      <div className="grid grid-cols-2 gap-3">
        {services.map((svc) => (
          <button
            key={svc.service}
            onClick={() => nav.toServiceDetail(svc.service)}
            className={`text-left rounded-xl p-4 transition-all hover:scale-[1.01] ${
              svc.connected
                ? "border border-green-500/30 bg-green-950/20"
                : "border border-dashed border-border/50"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <div className={`w-1.5 h-1.5 rounded-full ${svc.connected ? "bg-green-500" : "bg-muted-foreground/30"}`} />
              <span className={`text-sm font-medium ${svc.connected ? "text-foreground" : "text-muted-foreground"}`}>
                {svc.label}
              </span>
            </div>
            <div className="text-xs text-muted-foreground/60">
              {svc.connected ? `${svc.modelCount} 个模型` : "未配置"}
            </div>
          </button>
        ))}

        {/* Add custom service card */}
        <button
          onClick={() => nav.toServiceDetail("custom-new")}
          className="text-left rounded-xl p-4 border border-dashed border-border/50 flex items-center justify-center hover:border-border transition-colors"
        >
          <span className="text-sm text-muted-foreground">+ 自定义服务</span>
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create ServiceDetailPage skeleton**

```tsx
// packages/studio/src/pages/ServiceDetailPage.tsx
import { useState, useEffect, useCallback } from "react";
import { fetchJson } from "../hooks/use-api";
import { resolveServicePreset } from "../hooks/use-service-presets";

interface Nav {
  toServices: () => void;
}

interface ModelInfo {
  id: string;
  name?: string;
}

export function ServiceDetailPage({ serviceId, nav }: { serviceId: string; nav: Nav }) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Custom service fields
  const isCustom = serviceId === "custom-new" || serviceId.startsWith("custom:");
  const [customName, setCustomName] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");

  // Advanced params
  const [temperature, setTemperature] = useState<number | undefined>(undefined);
  const [maxTokens, setMaxTokens] = useState<number | undefined>(undefined);

  const preset = isCustom ? null : resolveServicePreset(serviceId);
  const label = preset?.label ?? customName || "自定义服务";
  const tempRange = preset?.temperatureRange ?? [0, 2];
  const tempHint = preset?.temperatureHint;

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const data = await fetchJson<{ ok: boolean; error?: string; models?: ModelInfo[] }>(
        `/services/${encodeURIComponent(serviceId)}/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey }),
        },
      );
      setTestResult({ ok: data.ok, error: data.error });
      if (data.models) setModels(data.models);
    } catch (err: any) {
      setTestResult({ ok: false, error: err?.message ?? "Connection failed" });
    } finally {
      setTesting(false);
    }
  }, [serviceId, apiKey]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      // Save API key to secrets
      await fetchJson(`/services/${encodeURIComponent(serviceId)}/secret`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      // TODO: save service config to inkos.json if new
    } catch (err: any) {
      alert(err?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }, [serviceId, apiKey]);

  return (
    <div className="max-w-xl mx-auto px-6 py-12">
      <button onClick={nav.toServices} className="text-sm text-primary hover:underline mb-6 block">
        ← 返回
      </button>

      <div className="flex items-center gap-3 mb-8">
        <div className={`w-2 h-2 rounded-full ${models.length > 0 ? "bg-green-500" : "bg-muted-foreground/30"}`} />
        <h1 className="font-serif text-2xl">{label}</h1>
        {models.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-500">已连接</span>
        )}
      </div>

      {/* Custom service fields */}
      {isCustom && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">名称</label>
            <input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="例：公司内网 GPT"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              Base URL <span className="text-destructive">*</span>
            </label>
            <input
              value={customBaseUrl}
              onChange={(e) => setCustomBaseUrl(e.target.value)}
              placeholder="https://llm.corp/v1"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono"
            />
          </div>
        </div>
      )}

      {/* API Key */}
      <div className="mb-6">
        <label className="text-xs text-muted-foreground block mb-1">
          API Key {isCustom && <span className="text-muted-foreground/50">（选填）</span>}
        </label>
        <div className="flex gap-2">
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono"
          />
          <button
            onClick={() => setShowKey(!showKey)}
            className="px-3 py-2 text-xs border border-border rounded-lg text-muted-foreground hover:text-foreground"
          >
            {showKey ? "隐藏" : "显示"}
          </button>
          <button
            onClick={handleTest}
            disabled={testing || !apiKey}
            className="px-4 py-2 text-xs rounded-lg border border-border hover:bg-accent disabled:opacity-50"
          >
            {testing ? "测试中..." : "测试连接"}
          </button>
        </div>
        {testResult && (
          <div className={`mt-2 text-xs ${testResult.ok ? "text-green-500" : "text-destructive"}`}>
            {testResult.ok ? `连接成功，发现 ${models.length} 个模型` : testResult.error}
          </div>
        )}
      </div>

      {/* Models */}
      {models.length > 0 && (
        <div className="mb-6">
          <label className="text-xs text-muted-foreground block mb-2">可用模型（{models.length}）</label>
          <div className="flex gap-2 flex-wrap">
            {models.map((m) => (
              <span key={m.id} className="text-xs px-3 py-1 rounded-lg bg-green-950/30 text-green-500 border border-green-500/20">
                {m.name ?? m.id}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Advanced params */}
      <div className="border-t border-border/30 pt-6 mb-6">
        <label className="text-xs text-muted-foreground block mb-3">高级参数</label>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] text-muted-foreground/60 block mb-1">
              Temperature（{tempRange[0]} ~ {tempRange[1]}）
            </label>
            <input
              type="number"
              min={tempRange[0]}
              max={tempRange[1]}
              step={0.1}
              value={temperature ?? preset?.writingTemperature ?? preset?.defaultTemperature ?? ""}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono"
            />
            {tempHint && <div className="text-[10px] text-muted-foreground/50 mt-1">ℹ {tempHint}</div>}
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground/60 block mb-1">Max Tokens</label>
            <input
              type="number"
              value={maxTokens ?? ""}
              onChange={(e) => setMaxTokens(parseInt(e.target.value, 10))}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono"
            />
          </div>
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2.5 text-sm rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire routes in App.tsx**

In `packages/studio/src/App.tsx`:

1. Import the new pages:
```ts
import { ServiceListPage } from "./pages/ServiceListPage";
import { ServiceDetailPage } from "./pages/ServiceDetailPage";
```

2. Add nav methods (in the nav object):
```ts
toServices: () => setRoute({ page: "services" }),
toServiceDetail: (id: string) => setRoute({ page: "service-detail", serviceId: id }),
```

3. Replace the `config` route rendering with:
```tsx
{route.page === "services" && (
  <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
    <ServiceListPage nav={nav} />
  </div>
)}
{route.page === "service-detail" && (
  <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
    <ServiceDetailPage serviceId={route.serviceId} nav={nav} />
  </div>
)}
```

4. Remove the ConfigView import and its route rendering block.

- [ ] **Step 5: Delete ConfigView.tsx**

Delete `packages/studio/src/pages/ConfigView.tsx`.

- [ ] **Step 6: Update GET /api/services to return connection status**

In `packages/studio/src/api/server.ts`, update the existing `GET /api/services` endpoint to include per-service connection status by checking if a key exists in secrets.json:

```ts
app.get("/api/services", async (c) => {
  const { loadSecrets } = await import("@actalk/inkos-core");
  const secrets = await loadSecrets(root);

  // Read inkos.json for configured services
  const configPath = join(root, "inkos.json");
  let configuredServices: any[] = [];
  try {
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw);
    configuredServices = config.llm?.services ?? [];
  } catch {}

  const configuredSet = new Set(configuredServices.map((s: any) => s.service));

  // Build full list: all presets + configured customs
  const SERVICE_PRESETS = (await import("@actalk/inkos-core")).SERVICE_PRESETS ?? {};
  const allServices = Object.entries(SERVICE_PRESETS)
    .filter(([key]) => key !== "custom")
    .map(([key, preset]: [string, any]) => ({
      service: key,
      label: preset.label,
      connected: !!secrets.services[key]?.apiKey,
      modelCount: 0, // Will be populated lazily by frontend
    }));

  // Add custom services
  for (const svc of configuredServices) {
    if (svc.service === "custom") {
      const secretKey = `custom:${svc.name}`;
      allServices.push({
        service: secretKey,
        label: svc.name ?? "Custom",
        connected: !!secrets.services[secretKey]?.apiKey,
        modelCount: 0,
      });
    }
  }

  return c.json({ services: allServices });
});
```

- [ ] **Step 7: Run full test suite**

Run: `pnpm test`
Expected: All pass (ConfigView tests may need removal if they exist)

- [ ] **Step 8: Commit**

```bash
git add packages/studio/src/hooks/use-hash-route.ts packages/studio/src/App.tsx packages/studio/src/pages/ServiceListPage.tsx packages/studio/src/pages/ServiceDetailPage.tsx packages/studio/src/api/server.ts
git rm packages/studio/src/pages/ConfigView.tsx
git commit -m "feat(studio): add ServiceListPage and ServiceDetailPage, remove ConfigView"
```

---

### Task 9: PromptInputSelect model picker in ChatPage

**Files:**
- Modify: `packages/studio/src/store/chat/types.ts`
- Modify: `packages/studio/src/store/chat/slices/message/action.ts`
- Modify: `packages/studio/src/store/chat/slices/message/initialState.ts`
- Modify: `packages/studio/src/pages/ChatPage.tsx`

- [ ] **Step 1: Add model selection state to store types**

In `packages/studio/src/store/chat/types.ts`, add to `MessageState`:

```ts
selectedModel: string | null;   // e.g. "kimi-k2.5"
selectedService: string | null; // e.g. "moonshot"
```

Add to `MessageActions`:

```ts
setSelectedModel: (model: string, service: string) => void;
```

- [ ] **Step 2: Update initial state**

In `packages/studio/src/store/chat/slices/message/initialState.ts`, add:

```ts
selectedModel: null,
selectedService: null,
```

- [ ] **Step 3: Implement setSelectedModel and update sendMessage**

In `packages/studio/src/store/chat/slices/message/action.ts`:

Add `setSelectedModel`:
```ts
setSelectedModel: (model: string, service: string) => {
  set({ selectedModel: model, selectedService: service });
},
```

Update `sendMessage` to pass model/service to POST /api/agent:
```ts
// In the fetch body, add:
body: JSON.stringify({
  instruction,
  activeBookId,
  sessionId: get().currentSessionId,
  model: get().selectedModel ?? undefined,
  service: get().selectedService ?? undefined,
}),
```

- [ ] **Step 4: Add PromptInputSelect to ChatPage**

In `packages/studio/src/pages/ChatPage.tsx`:

1. Add imports:
```tsx
import {
  PromptInputSelect,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSelectContent,
  PromptInputSelectItem,
} from "../components/ai-elements/prompt-input";
```

2. Add store selectors:
```tsx
const selectedModel = useChatStore((s) => s.selectedModel);
const selectedService = useChatStore((s) => s.selectedService);
const setSelectedModel = useChatStore((s) => s.setSelectedModel);
```

3. Add state for available models:
```tsx
const [availableModels, setAvailableModels] = useState<Array<{ service: string; label: string; models: Array<{ id: string; name?: string }> }>>([]);

useEffect(() => {
  void fetchJson<{ services: any[] }>("/services").then(async (data) => {
    const connected = data.services.filter((s) => s.connected);
    const grouped = await Promise.all(
      connected.map(async (svc) => {
        try {
          const res = await fetchJson<{ models: any[] }>(`/services/${encodeURIComponent(svc.service)}/models`);
          return { service: svc.service, label: svc.label, models: res.models ?? [] };
        } catch {
          return { service: svc.service, label: svc.label, models: [] };
        }
      }),
    );
    setAvailableModels(grouped.filter((g) => g.models.length > 0));
  });
}, []);
```

4. Add PromptInputSelect in the input bar's tools area (inside PromptInputFooter / PromptInputTools):
```tsx
<PromptInputSelect
  value={selectedModel ? `${selectedService}:${selectedModel}` : ""}
  onValueChange={(value) => {
    const [svc, ...modelParts] = value.split(":");
    const model = modelParts.join(":");
    setSelectedModel(model, svc);
  }}
>
  <PromptInputSelectTrigger>
    <PromptInputSelectValue placeholder="选择模型" />
  </PromptInputSelectTrigger>
  <PromptInputSelectContent>
    {availableModels.map((group) => (
      <optgroup key={group.service} label={group.label}>
        {group.models.map((m) => (
          <PromptInputSelectItem key={`${group.service}:${m.id}`} value={`${group.service}:${m.id}`}>
            {m.name ?? m.id}
          </PromptInputSelectItem>
        ))}
      </optgroup>
    ))}
  </PromptInputSelectContent>
</PromptInputSelect>
```

Note: PromptInputSelectContent uses SelectGroup/SelectLabel from shadcn for the group headers. Verify the actual shadcn Select group API and adjust.

- [ ] **Step 5: Run full test suite**

Run: `pnpm test`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add packages/studio/src/store/chat/types.ts packages/studio/src/store/chat/slices/message/action.ts packages/studio/src/store/chat/slices/message/initialState.ts packages/studio/src/pages/ChatPage.tsx
git commit -m "feat(studio): add PromptInputSelect model picker grouped by provider"
```

---

### Task 10: Dashboard warning banner + topbar toggles

**Files:**
- Modify: `packages/studio/src/pages/Dashboard.tsx`
- Modify: `packages/studio/src/App.tsx`

- [ ] **Step 1: Add warning banner to Dashboard**

In `packages/studio/src/pages/Dashboard.tsx`, add at the top of the component return, before existing content:

```tsx
const [hasServices, setHasServices] = useState(true); // optimistic

useEffect(() => {
  void fetchJson<{ services: any[] }>("/services/config")
    .then((data) => {
      setHasServices((data.services?.length ?? 0) > 0);
    })
    .catch(() => {});
}, []);

// In the JSX, before existing content:
{!hasServices && (
  <div className="rounded-xl border border-amber-500/40 bg-amber-950/20 px-5 py-4 mb-8 flex items-center justify-between">
    <div>
      <div className="text-sm text-amber-500 font-medium">还没有配置 AI 模型</div>
      <div className="text-xs text-amber-500/60 mt-0.5">配好一个服务商才能开始创作</div>
    </div>
    <button
      onClick={nav.toServices}
      className="px-4 py-2 text-xs rounded-lg bg-amber-500 text-black font-medium hover:opacity-90"
    >
      去配置
    </button>
  </div>
)}
```

Note: `nav.toServices` must be passed to Dashboard. Add it to the Dashboard props if not already there.

- [ ] **Step 2: Add language/theme toggles to top bar**

In `packages/studio/src/App.tsx`, in the header section (the `<header>` tag), add to the right side:

```tsx
<div className="flex items-center gap-3">
  {/* Language toggle */}
  <div className="flex gap-0.5 bg-muted/50 rounded-md p-0.5">
    <button
      onClick={() => { /* update language in inkos.json via API */ }}
      className={`text-xs px-2 py-0.5 rounded ${language === "zh" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
    >
      中
    </button>
    <button
      onClick={() => { /* update language in inkos.json via API */ }}
      className={`text-xs px-2 py-0.5 rounded ${language === "en" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
    >
      EN
    </button>
  </div>

  {/* Theme toggle */}
  <button
    onClick={theme.toggle}
    className="text-muted-foreground hover:text-foreground text-sm"
  >
    {theme.isDark ? "☀" : "🌙"}
  </button>
</div>
```

Note: Use text characters instead of emoji for the theme toggle (since we forbid emoji). Use a sun/moon SVG icon from lucide-react instead:
```tsx
import { Sun, Moon } from "lucide-react";
// ...
<button onClick={theme.toggle} className="text-muted-foreground hover:text-foreground">
  {theme.isDark ? <Sun size={14} /> : <Moon size={14} />}
</button>
```

- [ ] **Step 3: Run full test suite**

Run: `pnpm test`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add packages/studio/src/pages/Dashboard.tsx packages/studio/src/App.tsx
git commit -m "feat(studio): add no-config warning banner and topbar lang/theme toggles"
```
