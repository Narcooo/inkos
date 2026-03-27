import type { BootstrapStatus } from "../../shared/contracts";

export function isStageALauncherReady(bootstrapStatus: BootstrapStatus | null): boolean {
  if (!bootstrapStatus?.health.envFound) {
    return false;
  }

  return bootstrapStatus.readiness.ready || bootstrapStatus.readiness.code === "PROJECT_NOT_INITIALIZED";
}
