import { loadSecrets } from "./secrets.js";
import { getEndpoint } from "./providers/index.js";
import { resolveServicePreset, listModelsForService } from "./service-presets.js";
import { isApiKeyOptionalForEndpoint } from "../utils/llm-endpoint-auth.js";

export interface FailoverServiceEntry {
  readonly service: string;
  readonly model?: string;
  readonly name?: string;
}

export interface ModelFailoverConfig {
  readonly enabled: boolean;
  readonly mode: "auto" | "manual";
  readonly fallbacks: ReadonlyArray<FailoverServiceEntry>;
  readonly maxAutoSwitches?: number;
  readonly retryDelayMs?: number;
}

export interface FailoverState {
  readonly config: ModelFailoverConfig;
  readonly currentService: string;
  readonly currentModel: string;
  readonly switchedCount: number;
  readonly lastError?: string;
  readonly lastSwitchAt?: number;
  readonly activeFallbackIndex?: number;
}

export interface FailoverResult {
  readonly switched: boolean;
  readonly newService: string;
  readonly newModel: string;
  readonly fallbackIndex: number;
  readonly reason: string;
}

export interface FailoverSSEEvent {
  readonly type: "model:failover";
  readonly timestamp: number;
  readonly switched: boolean;
  readonly previousService: string;
  readonly previousModel: string;
  readonly newService: string;
  readonly newModel: string;
  readonly reason: string;
  readonly requiresUserAction: boolean;
}

const DEFAULT_MAX_AUTO_SWITCHES = 3;
const DEFAULT_RETRY_DELAY_MS = 5000;

export function createDefaultFailoverConfig(): ModelFailoverConfig {
  return {
    enabled: false,
    mode: "manual",
    fallbacks: [],
    maxAutoSwitches: DEFAULT_MAX_AUTO_SWITCHES,
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
  };
}

export function isQuotaError(error: unknown): boolean {
  const text = collectErrorText(error);
  const lower = text.toLowerCase();

  if (text.includes("429")) return true;

  const quotaPatterns = [
    "quota exceeded",
    "insufficient_quota",
    "you exceeded your current quota",
    "rate limit exceeded",
    "rate_limit_exceeded",
    "too many requests",
    "requests per minute",
    "requests per day",
    "daily quota",
    "monthly quota",
    "credit balance",
    "余额不足",
    "额度已用完",
    "超出配额",
    "流量包已耗尽",
    "available quota",
    "insufficient balance",
  ];

  return quotaPatterns.some((pattern) => lower.includes(pattern));
}

function collectErrorText(error: unknown, depth = 0): string {
  if (depth > 4 || error === null || error === undefined) return "";
  const parts = [String(error)];
  if (error instanceof Error) {
    parts.push(error.name, error.message);
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause) parts.push(collectErrorText(cause, depth + 1));
  } else if (typeof error === "object") {
    const err = error as { code?: unknown; cause?: unknown; message?: unknown; name?: unknown };
    if (err.name) parts.push(String(err.name));
    if (err.message) parts.push(String(err.message));
    if (err.code) parts.push(String(err.code));
    if (err.cause) parts.push(collectErrorText(err.cause, depth + 1));
  }
  return parts.join("\n");
}

export class ModelFailoverManager {
  private state: FailoverState;
  private errorHistory: Array<{ service: string; model: string; error: string; timestamp: number }> = [];

  constructor(
    config: ModelFailoverConfig,
    initialService: string,
    initialModel: string,
  ) {
    this.state = {
      config,
      currentService: initialService,
      currentModel: initialModel,
      switchedCount: 0,
    };
    console.log(`[failover] Manager initialized: service=${initialService}, model=${initialModel}`);
    console.log(`[failover] Config: enabled=${config.enabled}, mode=${config.mode}, fallbacks=${config.fallbacks.length}, maxSwitches=${config.maxAutoSwitches}, delay=${config.retryDelayMs}ms`);
  }

  getConfig(): ModelFailoverConfig {
    return this.state.config;
  }

  getState(): FailoverState {
    return { ...this.state };
  }

  updateConfig(config: Partial<ModelFailoverConfig>): void {
    const oldConfig = { ...this.state.config };
    this.state = {
      ...this.state,
      config: { ...this.state.config, ...config },
    };
    console.log(`[failover] Config updated: ${JSON.stringify({ old: oldConfig, new: this.state.config })}`);
  }

  recordError(service: string, model: string, error: unknown): void {
    const errorText = collectErrorText(error);
    this.errorHistory.push({
      service,
      model,
      error: errorText,
      timestamp: Date.now(),
    });

    if (this.errorHistory.length > 50) {
      this.errorHistory = this.errorHistory.slice(-50);
    }
    console.log(`[failover] Error recorded: service=${service}, model=${model}, error="${errorText.slice(0, 100)}..."`);
  }

  isQuotaErrorForCurrentService(error: unknown): boolean {
    const isQuota = isQuotaError(error);
    console.log(`[failover] Quota error check: ${isQuota} (error="${collectErrorText(error).slice(0, 80)}")`);
    return isQuota;
  }

  canAutoSwitch(): boolean {
    const { enabled, mode, maxAutoSwitches, retryDelayMs } = this.state.config;
    const { switchedCount, lastSwitchAt } = this.state;

    if (!enabled) {
      console.log(`[failover] Auto switch disabled: feature not enabled`);
      return false;
    }

    if (mode !== "auto") {
      console.log(`[failover] Auto switch disabled: mode is ${mode}, not 'auto'`);
      return false;
    }

    const maxSwitches = maxAutoSwitches ?? DEFAULT_MAX_AUTO_SWITCHES;
    if (switchedCount >= maxSwitches) {
      console.log(`[failover] Auto switch disabled: max switches reached (${switchedCount}/${maxSwitches})`);
      return false;
    }

    const retryDelay = retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    if (lastSwitchAt) {
      const timeSinceLastSwitch = Date.now() - lastSwitchAt;
      if (timeSinceLastSwitch < retryDelay) {
        console.log(`[failover] Auto switch disabled: cooldown active (${timeSinceLastSwitch}ms < ${retryDelay}ms)`);
        return false;
      }
    }

    console.log(`[failover] Auto switch allowed: enabled=${enabled}, mode=${mode}, switches=${switchedCount}/${maxSwitches}, cooldown=ok`);
    return true;
  }

  getNextFallback(): FailoverServiceEntry | undefined {
    const fallbacks = this.state.config.fallbacks;
    const nextIndex = (this.state.activeFallbackIndex ?? -1) + 1;

    console.log(`[failover] Looking for next fallback: index=${nextIndex}, total fallbacks=${fallbacks.length}`);

    if (fallbacks.length === 0) {
      console.log(`[failover] No fallback services configured`);
      return undefined;
    }

    if (nextIndex >= fallbacks.length) {
      console.log(`[failover] No more fallback services available (index ${nextIndex} >= ${fallbacks.length})`);
      return undefined;
    }

    const fallback = fallbacks[nextIndex];
    console.log(`[failover] Found next fallback: ${fallback.service}${fallback.model ? `/${fallback.model}` : ''}`);
    return fallback;
  }

  async switchToFallback(
    projectRoot: string,
    error: unknown,
  ): Promise<FailoverResult | null> {
    console.log(`[failover] ========== Failover attempt started ==========`);
    console.log(`[failover] Current state: service=${this.state.currentService}, model=${this.state.currentModel}, switchedCount=${this.state.switchedCount}`);
    console.log(`[failover] Triggering error: ${collectErrorText(error).slice(0, 150)}`);

    if (!this.isQuotaErrorForCurrentService(error)) {
      console.warn("[failover] Skipping failover: error is not a quota error");
      console.log(`[failover] ========== Failover attempt ended (not quota error) ==========`);
      return null;
    }

    this.recordError(this.state.currentService, this.state.currentModel, error);

    if (!this.canAutoSwitch()) {
      console.warn("[failover] Skipping failover: auto switch not allowed");
      console.log(`[failover] ========== Failover attempt ended (switch not allowed) ==========`);
      return null;
    }

    const nextFallback = this.getNextFallback();
    if (!nextFallback) {
      console.warn("[failover] Skipping failover: no fallback available");
      console.log(`[failover] ========== Failover attempt ended (no fallback) ==========`);
      return null;
    }

    console.log(`[failover] Attempting switch: ${this.state.currentService}/${this.state.currentModel} -> ${nextFallback.service}${nextFallback.model ? `/${nextFallback.model}` : ''}`);

    const nextService = nextFallback.service;
    console.log(`[failover] Resolving model for service: ${nextService}, requested model: ${nextFallback.model ?? 'default'}`);
    
    const nextModel = await this.resolveModelForService(projectRoot, nextService, nextFallback.model);
    console.log(`[failover] Resolved model: ${nextModel}`);

    console.log(`[failover] Checking API key for ${nextService}...`);
    const apiKey = await this.getServiceApiKey(projectRoot, nextService);
    const optional = this.isApiKeyOptional(nextService);
    console.log(`[failover] API key check: hasKey=${Boolean(apiKey)}, optional=${optional}`);

    if (!apiKey && !optional) {
      console.warn(`[failover] Skipping ${nextService}: no API key configured and API key is required`);
      console.log(`[failover] Moving to next fallback...`);

      this.state = {
        ...this.state,
        activeFallbackIndex: (this.state.activeFallbackIndex ?? -1) + 1,
      };

      return this.switchToFallback(projectRoot, error);
    }

    const previousService = this.state.currentService;
    const previousModel = this.state.currentModel;
    const newIndex = (this.state.activeFallbackIndex ?? -1) + 1;

    console.log(`[failover] Updating state: service=${previousService}->${nextService}, model=${previousModel}->${nextModel}, index=${newIndex}`);
    
    this.state = {
      ...this.state,
      currentService: nextService,
      currentModel: nextModel,
      switchedCount: this.state.switchedCount + 1,
      lastError: collectErrorText(error),
      lastSwitchAt: Date.now(),
      activeFallbackIndex: newIndex,
    };

    console.log(`[failover] ✅ Successfully switched to ${nextService}/${nextModel}`);
    console.log(`[failover] Switch statistics: totalSwitches=${this.state.switchedCount}, fallbackIndex=${newIndex}`);
    console.log(`[failover] ========== Failover attempt completed successfully ==========`);

    return {
      switched: true,
      newService: nextService,
      newModel: nextModel,
      fallbackIndex: newIndex,
      reason: `API quota exceeded on ${previousService}, switched to ${nextService}`,
    };
  }

  requiresManualSwitch(error: unknown): boolean {
    if (!this.state.config.enabled) return false;
    if (this.state.config.mode !== "manual") return false;
    return this.isQuotaErrorForCurrentService(error);
  }

  getAvailableFallbacks(projectRoot: string): Promise<Array<FailoverServiceEntry & { hasApiKey: boolean }>> {
    return Promise.all(
      this.state.config.fallbacks.map(async (entry) => {
        const apiKey = await this.getServiceApiKey(projectRoot, entry.service);
        const optional = this.isApiKeyOptional(entry.service);
        return {
          ...entry,
          hasApiKey: Boolean(apiKey) || optional,
        };
      }),
    );
  }

  reset(): void {
    this.state = {
      ...this.state,
      switchedCount: 0,
      lastError: undefined,
      lastSwitchAt: undefined,
      activeFallbackIndex: undefined,
    };
    this.errorHistory = [];
  }

  createSSEEvent(
    result: FailoverResult,
    previousService: string,
    previousModel: string,
  ): FailoverSSEEvent {
    return {
      type: "model:failover",
      timestamp: Date.now(),
      switched: result.switched,
      previousService,
      previousModel,
      newService: result.newService,
      newModel: result.newModel,
      reason: result.reason,
      requiresUserAction: this.state.config.mode === "manual",
    };
  }

  private async resolveModelForService(
    projectRoot: string,
    service: string,
    preferredModel: string | undefined,
  ): Promise<string> {
    if (preferredModel) return preferredModel;

    try {
      const apiKey = await this.getServiceApiKey(projectRoot, service);
      const preset = resolveServicePreset(service);
      const liveBaseUrl = preset?.modelsBaseUrl ?? preset?.baseUrl;

      if (liveBaseUrl) {
        const models = await listModelsForService(service, apiKey, liveBaseUrl);
        if (models.length > 0) {
          return models[0].id;
        }
      }
    } catch {
      // fallback to default
    }

    const endpoint = getEndpoint(service);
    if (endpoint?.models && endpoint.models.length > 0) {
      const enabledModel = endpoint.models.find((m) => m.enabled !== false);
      if (enabledModel) return enabledModel.id;
    }

    return "default-model";
  }

  private async getServiceApiKey(projectRoot: string, service: string): Promise<string> {
    try {
      const secrets = await loadSecrets(projectRoot);
      const key = service.startsWith("custom:") ? service : service;
      return secrets.services[key]?.apiKey ?? "";
    } catch {
      return "";
    }
  }

  private isApiKeyOptional(service: string): boolean {
    const preset = resolveServicePreset(service);
    const providerFamily = preset?.providerFamily ?? "openai";
    const presetBaseUrl = preset?.baseUrl ?? "";
    return isApiKeyOptionalForEndpoint({ provider: providerFamily, baseUrl: presetBaseUrl });
  }
}

export function createFailoverManager(
  config: ModelFailoverConfig,
  initialService: string,
  initialModel: string,
): ModelFailoverManager {
  return new ModelFailoverManager(config, initialService, initialModel);
}
