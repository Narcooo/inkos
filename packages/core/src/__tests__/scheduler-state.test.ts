import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Pruebas para la persistencia del estado del Scheduler.
 *
 * No se instancia el Scheduler completo (requiere LLMClient real),
 * sino que se testea la serialización/deserialización del PersistedSchedulerState
 * de forma aislada, replicando la lógica de persistState/loadState.
 */

interface PersistedSchedulerState {
  consecutiveFailures: Record<string, number>;
  pausedBooks: string[];
  failureDimensions: Record<string, Record<string, number>>;
  dailyChapterCount: Record<string, number>;
  savedAt: string;
}

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `inkos-sched-test-${Date.now()}`);
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("Scheduler state persistence format", () => {
  it("serializes empty state correctly", () => {
    const state: PersistedSchedulerState = {
      consecutiveFailures: {},
      pausedBooks: [],
      failureDimensions: {},
      dailyChapterCount: {},
      savedAt: new Date().toISOString(),
    };
    const json = JSON.stringify(state, null, 2);
    const parsed = JSON.parse(json) as PersistedSchedulerState;
    expect(parsed.pausedBooks).toEqual([]);
    expect(parsed.consecutiveFailures).toEqual({});
  });

  it("serializes full state correctly", () => {
    const state: PersistedSchedulerState = {
      consecutiveFailures: { "book-a": 3, "book-b": 1 },
      pausedBooks: ["book-a"],
      failureDimensions: {
        "book-a": { "OOC检查": 2, "时间线检查": 1 },
      },
      dailyChapterCount: { "2026-03-19": 5 },
      savedAt: "2026-03-19T00:00:00Z",
    };
    const json = JSON.stringify(state, null, 2);
    const parsed = JSON.parse(json) as PersistedSchedulerState;
    expect(parsed.pausedBooks).toEqual(["book-a"]);
    expect(parsed.consecutiveFailures["book-a"]).toBe(3);
    expect(parsed.failureDimensions["book-a"]!["OOC检查"]).toBe(2);
    expect(parsed.dailyChapterCount["2026-03-19"]).toBe(5);
  });

  it("round-trips through file system", async () => {
    const statePath = join(testDir, "scheduler_state.json");
    const state: PersistedSchedulerState = {
      consecutiveFailures: { "book-1": 2 },
      pausedBooks: ["book-1"],
      failureDimensions: { "book-1": { "节奏检查": 3 } },
      dailyChapterCount: { "2026-03-19": 3 },
      savedAt: new Date().toISOString(),
    };

    await writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
    const raw = await readFile(statePath, "utf-8");
    const loaded = JSON.parse(raw) as PersistedSchedulerState;

    expect(loaded.pausedBooks).toEqual(["book-1"]);
    expect(loaded.consecutiveFailures["book-1"]).toBe(2);
    expect(loaded.failureDimensions["book-1"]!["节奏检查"]).toBe(3);
  });

  it("reconstructs Maps from persisted Records", () => {
    const data: PersistedSchedulerState = {
      consecutiveFailures: { "a": 1, "b": 5 },
      pausedBooks: ["b"],
      failureDimensions: { "a": { "设定冲突": 2 } },
      dailyChapterCount: { "2026-03-19": 10 },
      savedAt: "",
    };

    const failures = new Map(Object.entries(data.consecutiveFailures));
    const paused = new Set(data.pausedBooks);
    const dims = new Map(
      Object.entries(data.failureDimensions).map(([k, v]) => [k, new Map(Object.entries(v))]),
    );

    expect(failures.get("a")).toBe(1);
    expect(failures.get("b")).toBe(5);
    expect(paused.has("b")).toBe(true);
    expect(paused.has("a")).toBe(false);
    expect(dims.get("a")!.get("设定冲突")).toBe(2);
  });

  it("handles corrupted file gracefully (not valid JSON)", async () => {
    const statePath = join(testDir, "scheduler_state.json");
    await writeFile(statePath, "not-json{{{", "utf-8");

    let loadedOk = false;
    try {
      const raw = await readFile(statePath, "utf-8");
      JSON.parse(raw);
    } catch {
      // Simulación del fallback del scheduler — arranca limpio
      loadedOk = true;
    }
    expect(loadedOk).toBe(true);
  });

  it("handles missing file gracefully", async () => {
    const statePath = join(testDir, "nonexistent.json");
    let fallback = false;
    try {
      await readFile(statePath, "utf-8");
    } catch {
      fallback = true;
    }
    expect(fallback).toBe(true);
  });

  it("filters stale dates from dailyChapterCount", () => {
    const today = new Date().toISOString().slice(0, 10);
    const data: PersistedSchedulerState = {
      consecutiveFailures: {},
      pausedBooks: [],
      failureDimensions: {},
      dailyChapterCount: { "2025-01-01": 99, [today]: 3 },
      savedAt: "",
    };

    // Replica la lógica del loadState del scheduler
    const dailyMap = new Map<string, number>();
    for (const [date, count] of Object.entries(data.dailyChapterCount)) {
      if (date === today) {
        dailyMap.set(date, count);
      }
    }

    expect(dailyMap.size).toBe(1);
    expect(dailyMap.get(today)).toBe(3);
  });
});
