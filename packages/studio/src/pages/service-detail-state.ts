import { fetchJson } from "../hooks/use-api";

export interface ServiceDetailModelInfo {
  readonly id: string;
  readonly name?: string;
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

interface ServiceProbeResponse {
  readonly ok: boolean;
  readonly models?: ServiceDetailModelInfo[];
  readonly selectedModel?: string;
  readonly detected?: ServiceDetailDetectedConfig;
  readonly error?: string;
}

export async function probeServiceForDetail(
  serviceId: string,
  body: {
    readonly apiKey: string;
    readonly apiFormat: "chat" | "responses";
    readonly stream: boolean;
    readonly baseUrl?: string;
    readonly model?: string;
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

export async function fetchServiceModelsForDetail(
  serviceId: string,
  args: {
    readonly apiKey?: string;
    readonly baseUrl?: string;
    readonly refresh?: boolean;
  } = {},
  deps?: { readonly fetchJsonImpl?: JsonFetcher },
): Promise<ReadonlyArray<ServiceDetailModelInfo>> {
  const fetchJsonImpl = deps?.fetchJsonImpl ?? fetchJson;
  const params = new URLSearchParams();
  if (args.refresh) params.set("refresh", "1");
  if (args.apiKey?.trim()) params.set("apiKey", args.apiKey.trim());
  if (args.baseUrl?.trim()) params.set("baseUrl", args.baseUrl.trim());
  const query = params.toString();
  const result = await fetchJsonImpl<{ models?: ServiceDetailModelInfo[] }>(
    `/services/${encodeURIComponent(serviceId)}/models${query ? `?${query}` : ""}`,
  );
  return result.models ?? [];
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
  readonly resolvedCustomName: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly apiFormat: "chat" | "responses";
  readonly stream: boolean;
  readonly temperature: string;
  readonly selectedModel: string;
  readonly messages?: {
    readonly enterApiKey: string;
    readonly enterBaseUrl: string;
    readonly enterModel: string;
    readonly connectionFailed: string;
  };
  readonly fetchJsonImpl?: JsonFetcher;
}): Promise<{
  readonly status: ServiceDetailConnectionStatus;
  readonly detectedModel: string;
  readonly detectedConfig: ServiceDetailDetectedConfig | null;
}> {
  const fetchJsonImpl = args.fetchJsonImpl ?? fetchJson;
  const trimmedKey = args.apiKey.trim();
  const trimmedBaseUrl = args.baseUrl.trim();
  const messages = args.messages ?? {
    enterApiKey: "请先输入 API Key",
    enterBaseUrl: "请先填写 Base URL",
    enterModel: "请先选择模型",
    connectionFailed: "连接失败",
  };

  if (!trimmedKey) {
    return {
      status: { state: "error", message: messages.enterApiKey },
      detectedModel: "",
      detectedConfig: null,
    };
  }
  if (args.isCustom && !trimmedBaseUrl) {
    return {
      status: { state: "error", message: messages.enterBaseUrl },
      detectedModel: "",
      detectedConfig: null,
    };
  }
  const trimmedModel = args.selectedModel.trim();
  if (args.isCustom && !trimmedModel) {
    return {
      status: { state: "error", message: messages.enterModel },
      detectedModel: "",
      detectedConfig: null,
    };
  }

  let probe: ServiceProbeResponse;
  try {
    probe = await probeServiceForDetail(args.effectiveServiceId, {
      apiKey: trimmedKey,
      apiFormat: args.apiFormat,
      stream: args.stream,
      ...(args.isCustom ? { baseUrl: trimmedBaseUrl } : {}),
      ...(trimmedModel ? { model: trimmedModel } : {}),
    }, { fetchJsonImpl });
  } catch (error) {
    return {
      status: { state: "error", message: error instanceof Error ? error.message : messages.connectionFailed },
      detectedModel: "",
      detectedConfig: null,
    };
  }

  if (!probe.ok) {
    return {
      status: { state: "error", message: probe.error ?? messages.connectionFailed },
      detectedModel: "",
      detectedConfig: null,
    };
  }

  const detectedModel = trimmedModel || probe.selectedModel || "";
  const detectedConfig = probe.detected ?? null;
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
          ...(args.isCustom ? {
            name: args.resolvedCustomName,
            baseUrl: savedBaseUrl,
          } : {}),
        },
      ],
    }),
  });

  return {
    status: { state: "connected", models: probe.models ?? [] },
    detectedModel,
    detectedConfig,
  };
}
