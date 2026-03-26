import { describe, it, expect } from "vitest";
import { parseCron, cronNextRunMs } from "../utils/cron-calc.js";

// ---------------------------------------------------------------------------
// parseCron
// ---------------------------------------------------------------------------

describe("parseCron", () => {
  it("parses wildcard fields", () => {
    const fields = parseCron("* * * * *");
    expect(fields).toHaveLength(5);
    expect(fields[0]!.type).toBe("any");
    expect(fields[4]!.type).toBe("any");
  });

  it("parses fixed value fields", () => {
    const fields = parseCron("30 8 * * *");
    expect(fields[0]!.type).toBe("fixed");
    expect(fields[0]!.values).toEqual([30]);
    expect(fields[1]!.type).toBe("fixed");
    expect(fields[1]!.values).toEqual([8]);
  });

  it("parses step fields", () => {
    const fields = parseCron("*/15 * * * *");
    expect(fields[0]!.type).toBe("step");
    expect(fields[0]!.step).toBe(15);
    expect(fields[0]!.values).toEqual([0, 15, 30, 45]);
  });

  it("parses list fields", () => {
    const fields = parseCron("0,30 * * * *");
    expect(fields[0]!.type).toBe("list");
    expect(fields[0]!.values).toEqual([0, 30]);
  });

  it("parses range fields", () => {
    const fields = parseCron("* * * * 1-5");
    expect(fields[4]!.type).toBe("range");
    expect(fields[4]!.values).toEqual([1, 2, 3, 4, 5]);
  });

  it("throws on invalid expression", () => {
    expect(() => parseCron("bad")).toThrow("Invalid cron");
  });

  it("parses hour step fields", () => {
    const fields = parseCron("0 */2 * * *");
    expect(fields[1]!.type).toBe("step");
    expect(fields[1]!.step).toBe(2);
    expect(fields[1]!.values).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]);
  });
});

// ---------------------------------------------------------------------------
// cronNextRunMs
// ---------------------------------------------------------------------------

describe("cronNextRunMs", () => {
  it("returns step interval for simple minute patterns", () => {
    // Para un cron simple como cada 15 minutos, debe retornar 15 * 60 * 1000
    const ms = cronNextRunMs("*/15 * * * *");
    expect(ms).toBe(15 * 60 * 1000);
  });

  it("returns step interval for simple hour patterns", () => {
    const ms = cronNextRunMs("0 */4 * * *");
    expect(ms).toBe(4 * 60 * 60 * 1000);
  });

  it("calculates correct delay for fixed time in the future", () => {
    // Simular ahora = 07:00:00, cron = 30 8 * * * (8:30)
    const now = new Date("2026-03-26T07:00:00");
    const ms = cronNextRunMs("30 8 * * *", now);

    // Debe ser ~90 minutos (5400000ms), pero avanzamos 1 minuto al inicio
    // Entonces: 8:30 - 7:01 = 89 minutos
    expect(ms).toBeGreaterThan(80 * 60 * 1000);
    expect(ms).toBeLessThanOrEqual(90 * 60 * 1000);
  });

  it("wraps to next day for fixed time already passed", () => {
    // Simular ahora = 10:00:00, cron = 30 8 * * * (8:30 ya paso)
    const now = new Date("2026-03-26T10:00:00");
    const ms = cronNextRunMs("30 8 * * *", now);

    // Debe ser ~22.5 horas (espera hasta manana 8:30)
    const hoursToWait = ms / (60 * 60 * 1000);
    expect(hoursToWait).toBeGreaterThan(22);
    expect(hoursToWait).toBeLessThanOrEqual(23);
  });

  it("handles list patterns correctly", () => {
    // Cron: 0,30 * * * * (cada 30 minutos, en minuto 0 y 30)
    const now = new Date("2026-03-26T10:05:00");
    const ms = cronNextRunMs("0,30 * * * *", now);

    // Proximo disparo: 10:30, delay ~25 minutos
    const minutes = ms / (60 * 1000);
    expect(minutes).toBeGreaterThan(23);
    expect(minutes).toBeLessThanOrEqual(25);
  });

  it("handles weekday range patterns (Mon-Fri)", () => {
    // 2026-03-26 es jueves (day 4), cron = 0 9 * * 1-5 (L-V a las 9:00)
    const now = new Date("2026-03-26T08:00:00"); // Jueves 8am
    const ms = cronNextRunMs("0 9 * * 1-5", now);

    // Proximo disparo: hoy 9:00 (jueves esta en 1-5)
    const minutes = ms / (60 * 1000);
    expect(minutes).toBeGreaterThan(55);
    expect(minutes).toBeLessThanOrEqual(60);
  });

  it("skips weekends for weekday-only crons", () => {
    // 2026-03-28 es sabado (day 6), cron = 0 9 * * 1-5
    const now = new Date("2026-03-28T10:00:00"); // Sabado 10am
    const ms = cronNextRunMs("0 9 * * 1-5", now);

    // Proximo disparo: lunes 2026-03-30 9:00, ~47 horas
    const hours = ms / (60 * 60 * 1000);
    expect(hours).toBeGreaterThan(40);
    expect(hours).toBeLessThan(48);
  });

  it("returns 24h fallback when no match in 48h window", () => {
    // Un cron que nunca coincide en 48h (mes 13 no existe)
    // Usamos day-of-month 31 y month 2 (febrero casi nunca tiene 31)
    const now = new Date("2026-03-26T10:00:00");
    const ms = cronNextRunMs("0 0 31 2 *", now);

    // Deberia devolver fallback de 24h
    expect(ms).toBe(24 * 60 * 60 * 1000);
  });
});
