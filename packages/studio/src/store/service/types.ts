export type EndpointGroup =
  | "overseas"
  | "china"
  | "aggregator"
  | "local"
  | "codingPlan";

export interface ServiceInfo {
  readonly service: string;
  readonly label: string;
  readonly group?: EndpointGroup;
  readonly connected: boolean;
  readonly apiKeyOptional?: boolean;
}

export interface ModelInfo {
  readonly id: string;
  readonly name?: string;
  readonly maxOutput?: number;
  readonly contextWindow?: number;
}

export type ModelPickerStatus = "loading" | "no-models" | "ready";

export interface ModelGroup {
  readonly service: string;
  readonly label: string;
  readonly models: ReadonlyArray<ModelInfo>;
}

export interface ServiceStore {
  services: ReadonlyArray<ServiceInfo>;
  servicesLoading: boolean;

  modelsByService: Record<string, ReadonlyArray<ModelInfo>>;
  bankModelsLoading: boolean;
  customModelsLoading: boolean;
  liveModelsLoading: Record<string, boolean>;

  fetchServices: () => Promise<void>;
  refreshServices: () => Promise<void>;
  fetchBankModels: () => Promise<void>;
  fetchCustomModels: () => Promise<void>;
  fetchLiveModels: (service: string) => Promise<void>;

  setLiveModels: (service: string, models: ReadonlyArray<ModelInfo>) => void;
  clearModels: (service: string) => void;

  getModelPickerStatus: () => ModelPickerStatus;
  getGroupedModels: () => ReadonlyArray<ModelGroup>;
}
