import { describe, expect, it } from "vitest";
import {
  HOOK_ACTIVITY_THRESHOLDS,
  HOOK_AGENDA_LIMITS,
  HOOK_HEALTH_DEFAULTS,
  HOOK_PHASE_THRESHOLDS,
  HOOK_PRESSURE_WEIGHTS,
  HOOK_TIMING_PROFILES,
  resolveHookVisibilityWindow,
} from "../utils/hook-policy.js";

describe("hook-policy", () => {
  it("exposes shared lifecycle timing profiles from a single policy surface", () => {
    expect(HOOK_TIMING_PROFILES.immediate.earliestResolveAge).toBe(1);
    expect(HOOK_TIMING_PROFILES["slow-burn"].minimumPhase).toBe("middle");
    expect(HOOK_TIMING_PROFILES.endgame.overdueAge).toBeGreaterThan(
      HOOK_TIMING_PROFILES["near-term"].overdueAge,
    );
  });

  it("widens visibility windows for longer-payoff hooks", () => {
    expect(resolveHookVisibilityWindow("immediate")).toBe(5);
    expect(resolveHookVisibilityWindow("mid-arc")).toBeGreaterThan(resolveHookVisibilityWindow("near-term"));
    expect(resolveHookVisibilityWindow("endgame")).toBeGreaterThan(resolveHookVisibilityWindow("slow-burn"));
  });

  it("keeps shared agenda, phase, pressure, and health defaults together", () => {
    expect(HOOK_AGENDA_LIMITS.light.mustAdvance).toBeLessThan(HOOK_AGENDA_LIMITS.heavy.mustAdvance);
    expect(HOOK_AGENDA_LIMITS.heavy.eligibleResolve).toBeGreaterThan(HOOK_AGENDA_LIMITS.light.eligibleResolve);
    expect(HOOK_HEALTH_DEFAULTS.maxActiveHooks).toBe(12);
    expect(HOOK_PHASE_THRESHOLDS.lateProgress).toBeGreaterThan(HOOK_PHASE_THRESHOLDS.middleProgress);
    expect(HOOK_PRESSURE_WEIGHTS.resolveBiasMultiplier).toBe(10);
  });

  it("keeps lifecycle activity and refresh thresholds on the same policy surface", () => {
    expect(HOOK_ACTIVITY_THRESHOLDS.recentlyTouchedDormancy).toBe(1);
    expect(HOOK_ACTIVITY_THRESHOLDS.longArcQuietHoldMaxAge).toBeGreaterThan(
      HOOK_ACTIVITY_THRESHOLDS.freshPromiseAge,
    );
    expect(HOOK_ACTIVITY_THRESHOLDS.refreshDormancy).toBeGreaterThan(
      HOOK_ACTIVITY_THRESHOLDS.longArcQuietHoldMaxDormancy,
    );
  });
});
