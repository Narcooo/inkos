import { useEffect, useMemo, useState } from "react";
import { fetchJson } from "../../hooks/use-api";
import { useChatStore } from "../../store/chat";
import { useServiceStore } from "../../store/service";
import {
  type ChatPageModelGroup,
  type ChatPageModelPreference,
  pickModelSelection,
} from "../chat-page-state";
import type { ServiceConfigPayload } from "./types";

type ModelPickerStatus = "loading" | "ready" | "no-models";

export interface ChatModelPickerState {
  readonly groupedModels: ReadonlyArray<ChatPageModelGroup>;
  readonly modelPickerStatus: ModelPickerStatus;
  readonly selectedModel: string | null;
  readonly selectedModelLabel: string;
  readonly selectedService: string | null;
  readonly setSelectedModel: (model: string, service: string) => void;
}

export function useChatModelPicker(): ChatModelPickerState {
  const selectedModel = useChatStore((s) => s.selectedModel);
  const selectedService = useChatStore((s) => s.selectedService);
  const setSelectedModel = useChatStore((s) => s.setSelectedModel);

  const services = useServiceStore((s) => s.services);
  const servicesLoading = useServiceStore((s) => s.servicesLoading);
  const bankModelsLoading = useServiceStore((s) => s.bankModelsLoading);
  const customModelsLoading = useServiceStore((s) => s.customModelsLoading);
  const modelsByService = useServiceStore((s) => s.modelsByService);
  const fetchServices = useServiceStore((s) => s.fetchServices);
  const fetchBankModels = useServiceStore((s) => s.fetchBankModels);
  const fetchCustomModels = useServiceStore((s) => s.fetchCustomModels);
  const [configuredModelSelection, setConfiguredModelSelection] =
    useState<ChatPageModelPreference | null>(null);
  const [serviceConfigLoaded, setServiceConfigLoaded] = useState(false);

  useEffect(() => {
    void fetchServices();
  }, [fetchServices]);

  useEffect(() => {
    void fetchBankModels();
    void fetchCustomModels();
  }, [fetchBankModels, fetchCustomModels]);

  useEffect(() => {
    let cancelled = false;

    void fetchJson<ServiceConfigPayload>("/services/config")
      .then((payload) => {
        if (cancelled) return;
        setConfiguredModelSelection({
          service: payload.service ?? null,
          model: payload.defaultModel ?? null,
        });
      })
      .catch(() => {
        if (!cancelled) setConfiguredModelSelection(null);
      })
      .finally(() => {
        if (!cancelled) setServiceConfigLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const modelPickerStatus = useMemo<ModelPickerStatus>(() => {
    if (servicesLoading || services.length === 0) return "loading";
    const connected = services.filter((s) => s.connected);
    if (connected.length === 0) return "no-models";
    if (bankModelsLoading) return "loading";
    if (connected.some((s) => (modelsByService[s.service]?.length ?? 0) > 0)) return "ready";

    const hasConnectedBank = connected.some((s) => !s.service.startsWith("custom"));
    const hasConnectedCustom = connected.some((s) => s.service.startsWith("custom"));
    if (!hasConnectedBank && hasConnectedCustom && customModelsLoading) return "loading";
    return "no-models";
  }, [bankModelsLoading, customModelsLoading, modelsByService, services, servicesLoading]);

  const groupedModels = useMemo<ReadonlyArray<ChatPageModelGroup>>(() => {
    return services
      .filter((s) => s.connected && (modelsByService[s.service]?.length ?? 0) > 0)
      .map((s) => ({
        service: s.service,
        label: s.label,
        models: modelsByService[s.service] ?? [],
      }));
  }, [modelsByService, services]);

  const selectedModelLabel = useMemo(() => {
    if (!selectedModel) return "选择模型";
    const group = groupedModels.find((item) => item.service === selectedService);
    const model = group?.models.find((item) => item.id === selectedModel);
    const modelLabel = model?.name ?? selectedModel;
    return group ? `${group.label} · ${modelLabel}` : modelLabel;
  }, [groupedModels, selectedModel, selectedService]);

  useEffect(() => {
    if (!serviceConfigLoaded) return;

    const nextSelection = pickModelSelection(
      groupedModels,
      selectedModel,
      selectedService,
      configuredModelSelection,
    );
    if (nextSelection) {
      setSelectedModel(nextSelection.model, nextSelection.service);
    }
  }, [
    configuredModelSelection,
    groupedModels,
    selectedModel,
    selectedService,
    serviceConfigLoaded,
    setSelectedModel,
  ]);

  return {
    groupedModels,
    modelPickerStatus,
    selectedModel,
    selectedModelLabel,
    selectedService,
    setSelectedModel,
  };
}
