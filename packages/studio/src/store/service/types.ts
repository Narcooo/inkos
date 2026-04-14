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
  /** Invalidate and re-fetch services (after saving a key) */
  refreshServices: () => Promise<void>;
}

// -- Composed --

export type ServiceStore = ServiceState & ServiceActions;
