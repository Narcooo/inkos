import { describe, it, expect } from "vitest";
import { resolveServicePreset, clampTemperature, getWritingTemperature } from "../llm/service-presets.js";

describe("temperature constraints per service", () => {
  it("moonshot has range [0, 1] and writingTemperature 1.0", () => {
    const preset = resolveServicePreset("moonshot");
    expect(preset?.temperatureRange).toEqual([0, 1]);
    expect(preset?.writingTemperature).toBe(1.0);
  });

  it("deepseek has range [0, 2] and writingTemperature 1.5", () => {
    const preset = resolveServicePreset("deepseek");
    expect(preset?.temperatureRange).toEqual([0, 2]);
    expect(preset?.writingTemperature).toBe(1.5);
  });

  it("anthropic has range [0, 1] and writingTemperature 1.0", () => {
    const preset = resolveServicePreset("anthropic");
    expect(preset?.temperatureRange).toEqual([0, 1]);
    expect(preset?.writingTemperature).toBe(1.0);
  });

  it("openai has range [0, 2] and writingTemperature 1.0", () => {
    const preset = resolveServicePreset("openai");
    expect(preset?.temperatureRange).toEqual([0, 2]);
    expect(preset?.writingTemperature).toBe(1.0);
  });

  it("zhipu has range [0, 1]", () => {
    const preset = resolveServicePreset("zhipu");
    expect(preset?.temperatureRange).toEqual([0, 1]);
  });

  it("bailian has range [0, 2]", () => {
    const preset = resolveServicePreset("bailian");
    expect(preset?.temperatureRange).toEqual([0, 2]);
  });

  it("minimax has range [0, 2]", () => {
    const preset = resolveServicePreset("minimax");
    expect(preset?.temperatureRange).toEqual([0, 2]);
  });

  it("clampTemperature respects service range", () => {
    expect(clampTemperature("moonshot", 1.5)).toBe(1.0);
    expect(clampTemperature("moonshot", 0.7)).toBe(0.7);
    expect(clampTemperature("deepseek", 1.5)).toBe(1.5);
    expect(clampTemperature("deepseek", 2.5)).toBe(2.0);
    expect(clampTemperature("unknown-service", 1.5)).toBe(1.5);
  });

  it("getWritingTemperature returns service-specific value", () => {
    expect(getWritingTemperature("moonshot")).toBe(1.0);
    expect(getWritingTemperature("deepseek")).toBe(1.5);
    expect(getWritingTemperature("anthropic")).toBe(1.0);
  });
});
