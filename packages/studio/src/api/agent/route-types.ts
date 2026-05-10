import type { PipelineConfig, ProjectConfig, StateManager } from "@actalk/inkos-core";

export interface AgentRouteRequest {
  instruction: string;
  activeBookId?: string;
  sessionId?: string;
  model?: string;
  service?: string;
}

export interface AgentRouteDependencies {
  readonly root: string;
  readonly state: StateManager;
  readonly bookCreateStatus: Map<string, { status: "creating" | "error"; error?: string }>;
  readonly loadCurrentProjectConfig: (options?: { readonly requireApiKey?: boolean }) => Promise<ProjectConfig>;
  readonly buildPipelineConfig: (
    overrides?: Partial<Pick<PipelineConfig, "externalContext" | "client" | "model">> & {
      readonly currentConfig?: ProjectConfig;
      readonly sessionIdForSSE?: string;
    },
  ) => Promise<PipelineConfig>;
  readonly normalizeApiBookId: (value: unknown, fieldName: string) => string | null;
  readonly broadcast: (event: string, data: unknown) => void;
}

export interface AgentRouteResult {
  body: Record<string, unknown>;
  status?: number;
}
