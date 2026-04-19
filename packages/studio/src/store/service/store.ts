import { create } from "zustand";
import type { ServiceStore } from "./types";
import { fetchJson } from "../../hooks/use-api";

export const useServiceStore = create<ServiceStore>()((set, get) => ({
  // -- State --
  services: [],
  servicesLoading: false,
  modelsByService: {},

  // -- Actions --

  fetchServices: async () => {
    // Skip if already loaded
    if (get().services.length > 0 || get().servicesLoading) return;
    set({ servicesLoading: true });
    try {
      const data = await fetchJson<{ services: any[] }>("/services");
      set({ services: data.services ?? [], servicesLoading: false });
    } catch {
      set({ servicesLoading: false });
    }
  },

  fetchModels: async (service: string) => {
    const existing = get().modelsByService[service];
    // Skip if already loaded or loading
    if (existing?.models.length || existing?.loading) return;

    set((s) => ({
      modelsByService: {
        ...s.modelsByService,
        [service]: { models: [], loading: true, error: null },
      },
    }));

    try {
      const data = await fetchJson<{ models: any[] }>(
        `/services/${encodeURIComponent(service)}/models`,
      );
      set((s) => ({
        modelsByService: {
          ...s.modelsByService,
          [service]: { models: data.models ?? [], loading: false, error: null },
        },
      }));
    } catch (e) {
      set((s) => ({
        modelsByService: {
          ...s.modelsByService,
          [service]: {
            models: [],
            loading: false,
            error: e instanceof Error ? e.message : "Failed",
          },
        },
      }));
    }
  },

  setModels: (service, models) => {
    set((s) => ({
      modelsByService: {
        ...s.modelsByService,
        [service]: { models, loading: false, error: null },
      },
    }));
  },

  clearModels: (service) => {
    set((s) => {
      const next = { ...s.modelsByService };
      delete next[service];
      return { modelsByService: next };
    });
  },

  refreshServices: async () => {
    set({ services: [], servicesLoading: false });
    await get().fetchServices();
  },

  // -- Selectors --

  getModelPickerStatus: () => {
    const { services, servicesLoading, modelsByService } = get();
    if (servicesLoading || services.length === 0) return "loading";
    const connected = services.filter((s) => s.connected);
    if (connected.length === 0) return "no-models";
    const anyLoading = connected.some((s) => modelsByService[s.service]?.loading);
    if (anyLoading) return "loading";
    const anyModels = connected.some((s) => (modelsByService[s.service]?.models.length ?? 0) > 0);
    return anyModels ? "ready" : "no-models";
  },

  getGroupedModels: () => {
    const { services, modelsByService } = get();
    const groups: Array<{ service: string; label: string; models: ReadonlyArray<{ id: string; name?: string }> }> = [];
    for (const svc of services.filter((s) => s.connected)) {
      const entry = modelsByService[svc.service];
      if (entry?.models.length) {
        groups.push({ service: svc.service, label: svc.label, models: entry.models });
      }
    }
    return groups;
  },
}));
