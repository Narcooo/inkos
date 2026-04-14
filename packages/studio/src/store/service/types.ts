export interface ServiceInfo {
  readonly service: string;
  readonly label: string;
  readonly connected: boolean;
}

export interface ModelInfo {
  readonly id: string;
  readonly name?: string;
}

export interface ServiceModelsEntry {
  readonly models: ReadonlyArray<ModelInfo>;
  readonly loading: boolean;
  readonly error: string | null;
}

// -- State --

export interface ServiceState {
  /** All known services with connection status */
  services: ReadonlyArray<ServiceInfo>;
  servicesLoading: boolean;
  /** Models keyed by service id, fetched on demand */
  modelsByService: Record<string, ServiceModelsEntry>;
}

// -- Actions --

export interface ServiceActions {
  /** Fetch service list (fast — only reads secrets, no external API) */
  fetchServices: () => Promise<void>;
  /** Fetch models for a specific service (calls external API) */
  fetchModels: (service: string) => Promise<void>;
  /** Write models directly (from test connection result) */
  setModels: (service: string, models: ReadonlyArray<ModelInfo>) => void;
  /** Clear models for a service (key removed) */
  clearModels: (service: string) => void;
  /** Invalidate and re-fetch services (after saving a key) */
  refreshServices: () => Promise<void>;
}

// -- Derived (selectors) --

export interface ModelGroup {
  readonly service: string;
  readonly label: string;
  readonly models: ReadonlyArray<ModelInfo>;
}

export type ModelPickerStatus = "loading" | "no-models" | "ready";

export interface ServiceSelectors {
  /** Model picker status: loading → no-models → ready */
  getModelPickerStatus: () => ModelPickerStatus;
  /** Grouped models for dropdown, derived from store state */
  getGroupedModels: () => ReadonlyArray<ModelGroup>;
}

// -- Composed --

export type ServiceStore = ServiceState & ServiceActions & ServiceSelectors;
