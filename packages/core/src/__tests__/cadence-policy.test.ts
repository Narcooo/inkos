import { describe, expect, it } from "vitest";
import {
  CADENCE_PRESSURE_THRESHOLDS,
  CADENCE_WINDOW_DEFAULTS,
  LONG_SPAN_FATIGUE_THRESHOLDS,
  resolveCadencePressure,
} from "../utils/cadence-policy.js";

describe("cadence-policy", () => {
  it("exposes shared cadence and fatigue defaults from one policy surface", () => {
    expect(CADENCE_WINDOW_DEFAULTS.summaryLookback).toBe(4);
    expect(CADENCE_WINDOW_DEFAULTS.englishVarianceLookback).toBeGreaterThan(
      CADENCE_WINDOW_DEFAULTS.summaryLookback,
    );
    expect(LONG_SPAN_FATIGUE_THRESHOLDS.boundarySimilarityFloor).toBe(0.72);
    expect(LONG_SPAN_FATIGUE_THRESHOLDS.boundarySentenceMinLength).toBe(18);
  });

  it("resolves shared medium/high cadence pressure without duplicating threshold logic", () => {
    expect(resolveCadencePressure({
      count: 3,
      total: 4,
      highThreshold: CADENCE_PRESSURE_THRESHOLDS.scene.highCount,
      mediumThreshold: CADENCE_PRESSURE_THRESHOLDS.scene.mediumCount,
      mediumWindowFloor: CADENCE_PRESSURE_THRESHOLDS.scene.mediumWindowFloor,
    })).toBe("high");

    expect(resolveCadencePressure({
      count: 2,
      total: 4,
      highThreshold: CADENCE_PRESSURE_THRESHOLDS.mood.highCount,
      mediumThreshold: CADENCE_PRESSURE_THRESHOLDS.mood.mediumCount,
      mediumWindowFloor: CADENCE_PRESSURE_THRESHOLDS.mood.mediumWindowFloor,
    })).toBe("medium");

    expect(resolveCadencePressure({
      count: 1,
      total: 3,
      highThreshold: CADENCE_PRESSURE_THRESHOLDS.title.highCount,
      mediumThreshold: CADENCE_PRESSURE_THRESHOLDS.title.mediumCount,
      mediumWindowFloor: CADENCE_PRESSURE_THRESHOLDS.title.mediumWindowFloor,
    })).toBeUndefined();
  });
});
