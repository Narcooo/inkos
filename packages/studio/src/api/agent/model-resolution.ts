import {
  createLLMClient,
  listModelsForService,
  loadSecrets,
  resolveServiceModel,
  type ProjectConfig,
  type ResolvedModel,
} from "@actalk/inkos-core";
import {
  filterTextChatModels,
  isTextChatModelId,
  normalizeServiceConfig,
  resolveConfiguredServiceBaseUrl,
  resolveConfiguredServiceEntry,
  serviceConfigKey,
  type ServiceConfigEntry,
} from "../services/service-config.js";

type LLMClient = ReturnType<typeof createLLMClient>;

export class AgentModelApiKeyError extends Error {
  constructor(readonly service: string) {
    super(`请先为 ${service} 配置 API Key`);
  }
}

export interface AgentModelResolution {
  readonly model: ResolvedModel["model"];
  readonly apiKey?: string;
  readonly configuredEntry?: ServiceConfigEntry;
}

export async function resolveAgentModel(args: {
  readonly root: string;
  readonly config: ProjectConfig;
  readonly client: LLMClient;
  readonly requestedService?: string;
  readonly requestedModel?: string;
}): Promise<AgentModelResolution> {
  let resolvedModel: ResolvedModel["model"] | undefined;
  let resolvedApiKey: string | undefined;

  if (args.requestedService && args.requestedModel) {
    try {
      const configuredEntry = await resolveConfiguredServiceEntry(args.root, args.requestedService);
      const resolved = await resolveServiceModel(
        args.requestedService,
        args.requestedModel,
        args.root,
        await resolveConfiguredServiceBaseUrl(args.root, args.requestedService),
        configuredEntry?.apiFormat,
      );
      return {
        model: resolved.model,
        apiKey: resolved.apiKey,
        configuredEntry,
      };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (/API key/i.test(msg)) {
        throw new AgentModelApiKeyError(args.requestedService);
      }
      throw e;
    }
  }

  const rawConfig = args.config.llm as unknown as Record<string, unknown>;
  const defaultModel = rawConfig.defaultModel as string | undefined;
  const servicesArr = normalizeServiceConfig(rawConfig.services);
  const firstService = servicesArr[0];
  if (firstService?.service && defaultModel && isTextChatModelId(defaultModel)) {
    try {
      const resolved = await resolveServiceModel(
        serviceConfigKey(firstService),
        defaultModel,
        args.root,
        firstService.baseUrl,
        firstService.apiFormat,
      );
      resolvedModel = resolved.model;
      resolvedApiKey = resolved.apiKey;
    } catch {
      // fall through
    }
  }

  if (!resolvedModel) {
    const secrets = await loadSecrets(args.root);
    for (const [svcName, svcData] of Object.entries(secrets.services)) {
      if (svcData?.apiKey) {
        try {
          const models = await listModelsForService(svcName, svcData.apiKey);
          const textModels = filterTextChatModels(models);
          if (textModels.length > 0) {
            const configuredEntry = await resolveConfiguredServiceEntry(args.root, svcName);
            const resolved = await resolveServiceModel(
              svcName,
              textModels[0].id,
              args.root,
              await resolveConfiguredServiceBaseUrl(args.root, svcName),
              configuredEntry?.apiFormat,
            );
            resolvedModel = resolved.model;
            resolvedApiKey = resolved.apiKey;
            break;
          }
        } catch {
          // try next service
        }
      }
    }
  }

  if (!resolvedModel) {
    const legacyClient = args.client as LLMClient & {
      readonly _piModel?: ResolvedModel["model"];
      readonly _apiKey?: string;
    };
    resolvedModel = legacyClient._piModel
      ? legacyClient._piModel
      : { provider: args.config.llm.provider ?? "anthropic", modelId: args.config.llm.model } as unknown as ResolvedModel["model"];
    resolvedApiKey = legacyClient._apiKey;
  }

  const configuredEntry = args.requestedService
    ? await resolveConfiguredServiceEntry(args.root, args.requestedService)
    : undefined;

  return {
    model: resolvedModel,
    apiKey: resolvedApiKey,
    configuredEntry,
  };
}

export function createAgentPipelineClient(args: {
  readonly config: ProjectConfig;
  readonly fallbackClient: LLMClient;
  readonly resolution: AgentModelResolution;
  readonly requestedService?: string;
  readonly requestedModel?: string;
}): LLMClient {
  if (args.requestedService && args.requestedModel) {
    return createLLMClient({
      ...args.config.llm,
      service: args.resolution.configuredEntry?.service ?? args.requestedService,
      model: args.requestedModel,
      apiKey: args.resolution.apiKey ?? "",
      ...(args.resolution.configuredEntry?.apiFormat ? { apiFormat: args.resolution.configuredEntry.apiFormat } : {}),
      ...(args.resolution.configuredEntry?.stream !== undefined ? { stream: args.resolution.configuredEntry.stream } : {}),
      baseUrl: args.resolution.configuredEntry?.baseUrl ?? "",
    } as ProjectConfig["llm"]);
  }

  return args.fallbackClient;
}
