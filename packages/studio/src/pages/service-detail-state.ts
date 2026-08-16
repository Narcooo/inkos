import { fetchJson } from "../hooks/use-api";

export interface ServiceDetailModelInfo {
  readonly id: string;
  readonly name?: string;
}

export function mergeServiceDetailModels(
  ...groups: ReadonlyArray<ReadonlyArray<ServiceDetailModelInfo | string> | undefined>
): ServiceDetailModelInfo[] {
  const seen = new Set<string>();
  const merged: ServiceDetailModelInfo[] = [];
  for (const group of groups) {
    for (const item of group ?? []) {
      const model = typeof item === "string" ? { id: item } : item;
      const id = model.id.trim();
      const key = id.toLowerCase();
      if (!id || seen.has(key)) continue;
      seen.add(key);
      merged.push({ ...model, id });
    }
  }
  return merged;
}

/**
 * Decide which model ids to persist as the writing-picker snapshot.
 * The on-screen catalog (test results + manual adds) is the contract:
 * a later bank-only fallback must not replace a richer list the user already saw.
 */
export function resolveModelsToPersist(args: {
  readonly displayedModels?: ReadonlyArray<ServiceDetailModelInfo | string>;
  readonly probeModels?: ReadonlyArray<ServiceDetailModelInfo | string>;
  readonly modelsSource?: "api" | "fallback";
}): ServiceDetailModelInfo[] {
  const displayed = mergeServiceDetailModels(args.displayedModels);
  const probed = mergeServiceDetailModels(args.probeModels);

  if (args.modelsSource === "fallback") {
    return displayed.length > 0 ? displayed : probed;
  }
  if (args.modelsSource === "api") {
    return mergeServiceDetailModels(probed, displayed);
  }
  return mergeServiceDetailModels(displayed, probed);
}

export interface ServiceDetailDetectedConfig {
  readonly apiFormat?: "chat" | "responses";
  readonly stream?: boolean;
  readonly baseUrl?: string;
  readonly modelsSource?: "api" | "fallback";
}

export type ServiceDetailConnectionStatus =
  | { state: "idle" }
  | { state: "testing" }
  | { state: "connected"; models: ServiceDetailModelInfo[] }
  | { state: "error"; message: string }
  | { state: "saving" }
  | { state: "saved" };

type JsonFetcher = typeof fetchJson;

export interface ServiceProbeResponse {
  readonly ok: boolean;
  readonly models?: ServiceDetailModelInfo[];
  readonly selectedModel?: string;
  readonly detected?: ServiceDetailDetectedConfig;
  readonly error?: string;
}

export interface ServiceDetailVerifiedProbe {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly apiFormat: "chat" | "responses";
  readonly stream: boolean;
  readonly models: ServiceDetailModelInfo[];
  readonly selectedModel?: string;
  readonly detected?: ServiceDetailDetectedConfig;
}

export async function probeServiceForDetail(
  serviceId: string,
  body: {
    readonly apiKey: string;
    readonly apiFormat: "chat" | "responses";
    readonly stream: boolean;
    readonly baseUrl?: string;
  },
  deps?: { readonly fetchJsonImpl?: JsonFetcher },
): Promise<ServiceProbeResponse> {
  const fetchJsonImpl = deps?.fetchJsonImpl ?? fetchJson;
  return await fetchJsonImpl<ServiceProbeResponse>(
    `/services/${encodeURIComponent(serviceId)}/test`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export async function rehydrateServiceConnectionStatus(args: {
  readonly effectiveServiceId: string;
  readonly shouldVerify: boolean;
  readonly isCustom: boolean;
  readonly baseUrl: string;
  readonly apiFormat: "chat" | "responses";
  readonly stream: boolean;
  readonly fetchJsonImpl?: JsonFetcher;
}): Promise<{
  readonly apiKey: string;
  readonly status: ServiceDetailConnectionStatus;
  readonly detectedModel: string;
  readonly detectedConfig: ServiceDetailDetectedConfig | null;
}> {
  const fetchJsonImpl = args.fetchJsonImpl ?? fetchJson;
  const secret = await fetchJsonImpl<{ apiKey?: string }>(
    `/services/${encodeURIComponent(args.effectiveServiceId)}/secret`,
  );
  const apiKey = String(secret.apiKey ?? "");

  return {
    apiKey,
    status: { state: "idle" },
    detectedModel: "",
    detectedConfig: null,
  };
}

export function matchServiceConfigEntryForDetail(
  entries: ReadonlyArray<Record<string, unknown>>,
  serviceId: string,
): Record<string, unknown> | undefined {
  return entries.find((entry) => {
    if (typeof entry.service !== "string") return false;
    if (serviceId.startsWith("custom:")) {
      return entry.service === "custom" && `custom:${String(entry.name ?? "")}` === serviceId;
    }
    if (serviceId === "custom") return false;
    return entry.service === serviceId;
  });
}

export async function saveServiceConfig(args: {
  readonly effectiveServiceId: string;
  readonly serviceId: string;
  readonly isCustom: boolean;
  readonly apiKeyOptional?: boolean;
  readonly resolvedCustomName: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly apiFormat: "chat" | "responses";
  readonly stream: boolean;
  readonly temperature: string;
  readonly detectedModel: string;
  readonly configuredModels?: ReadonlyArray<ServiceDetailModelInfo | string>;
  readonly verifiedProbe?: ServiceDetailVerifiedProbe | null;
  readonly fetchJsonImpl?: JsonFetcher;
}): Promise<{
  readonly status: ServiceDetailConnectionStatus;
  readonly detectedModel: string;
  readonly detectedConfig: ServiceDetailDetectedConfig | null;
}> {
  const fetchJsonImpl = args.fetchJsonImpl ?? fetchJson;
  const trimmedKey = args.apiKey.trim();
  const trimmedBaseUrl = args.baseUrl.trim();

  if (!trimmedKey && !args.isCustom && !args.apiKeyOptional) {
    return {
      status: { state: "error", message: "请先输入 API Key" },
      detectedModel: "",
      detectedConfig: null,
    };
  }
  if (args.isCustom && !trimmedBaseUrl) {
    return {
      status: { state: "error", message: "请先填写 Base URL" },
      detectedModel: "",
      detectedConfig: null,
    };
  }

  const verifiedBaseUrl = args.isCustom ? trimmedBaseUrl : "";
  const verified = args.verifiedProbe;
  const canReuseVerifiedProbe = Boolean(
    verified
      && verified.apiKey === trimmedKey
      && verified.baseUrl === verifiedBaseUrl
      && verified.apiFormat === args.apiFormat
      && verified.stream === args.stream,
  );

  let probe: ServiceProbeResponse;
  if (canReuseVerifiedProbe && verified) {
    probe = {
      ok: true,
      models: verified.models,
      selectedModel: verified.selectedModel,
      detected: verified.detected,
    };
  } else {
    try {
      probe = await probeServiceForDetail(args.effectiveServiceId, {
        apiKey: trimmedKey,
        apiFormat: args.apiFormat,
        stream: args.stream,
        ...(args.isCustom ? { baseUrl: trimmedBaseUrl } : {}),
      }, { fetchJsonImpl });
    } catch (error) {
      return {
        status: { state: "error", message: error instanceof Error ? error.message : "连接失败" },
        detectedModel: "",
        detectedConfig: null,
      };
    }
  }

  if (!probe.ok) {
    return {
      status: { state: "error", message: probe.error ?? "连接失败" },
      detectedModel: "",
      detectedConfig: null,
    };
  }

  const detectedModel = probe.selectedModel ?? args.detectedModel;
  const detectedConfig = probe.detected ?? null;
  const savedModels = resolveModelsToPersist({
    displayedModels: args.configuredModels,
    probeModels: probe.models,
    modelsSource: detectedConfig?.modelsSource ?? verified?.detected?.modelsSource,
  });
  const savedApiFormat = detectedConfig?.apiFormat ?? args.apiFormat;
  const savedStream = typeof detectedConfig?.stream === "boolean" ? detectedConfig.stream : args.stream;
  const savedBaseUrl = args.isCustom ? (detectedConfig?.baseUrl ?? trimmedBaseUrl) : undefined;

  await fetchJsonImpl(`/services/${encodeURIComponent(args.effectiveServiceId)}/secret`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey: trimmedKey }),
  });

  await fetchJsonImpl("/services/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service: args.effectiveServiceId,
      ...(detectedModel ? { defaultModel: detectedModel } : {}),
      services: [
        {
          service: args.isCustom ? "custom" : args.serviceId,
          temperature: parseFloat(args.temperature),
          apiFormat: savedApiFormat,
          stream: savedStream,
          models: savedModels.map((model) => model.id),
          ...(args.isCustom ? {
            name: args.resolvedCustomName,
            baseUrl: savedBaseUrl,
          } : {}),
        },
      ],
    }),
  });

  return {
    status: { state: "connected", models: savedModels },
    detectedModel,
    detectedConfig,
  };
}

export async function deleteServiceConfig(
  serviceId: string,
  deps?: { readonly fetchJsonImpl?: JsonFetcher },
): Promise<void> {
  const fetchJsonImpl = deps?.fetchJsonImpl ?? fetchJson;
  await fetchJsonImpl(`/services/${encodeURIComponent(serviceId)}`, {
    method: "DELETE",
  });
}
