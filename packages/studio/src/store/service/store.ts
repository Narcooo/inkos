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

  refreshServices: async () => {
    set({ services: [], servicesLoading: false, modelsByService: {} });
    await get().fetchServices();
  },
}));
