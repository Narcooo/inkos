// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRunStream } from "../hooks/useRunStream";
import type { StudioRun } from "../../shared/contracts";

class MockEventSource {
  static instances: MockEventSource[] = [];

  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly url: string;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emit(data: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
}

const baseRun: StudioRun = {
  id: "run-1",
  bookId: "book-1",
  chapter: 2,
  chapterNumber: 2,
  action: "revise",
  status: "running",
  stage: "Queued",
  createdAt: "2026-03-26T00:00:00.000Z",
  updatedAt: "2026-03-26T00:00:00.000Z",
  startedAt: "2026-03-26T00:00:01.000Z",
  finishedAt: null,
  logs: [],
};

describe("useRunStream", () => {
  afterEach(() => {
    MockEventSource.instances = [];
    vi.unstubAllGlobals();
  });

  it("appends logs from stream events", async () => {
    vi.stubGlobal("EventSource", MockEventSource);

    const { result } = renderHook(() => useRunStream(baseRun));

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]?.url).toBe("/api/runs/run-1/stream");

    await act(async () => {
      MockEventSource.instances[0]?.emit({
        type: "log",
        runId: "run-1",
        log: {
          timestamp: "2026-03-26T00:00:02.000Z",
          level: "info",
          message: "Revision is underway.",
        },
      });
    });

    expect(result.current.run?.logs).toEqual([
      {
        timestamp: "2026-03-26T00:00:02.000Z",
        level: "info",
        message: "Revision is underway.",
      },
    ]);
  });

  it("waits for the terminal snapshot before closing the stream", async () => {
    vi.stubGlobal("EventSource", MockEventSource);

    const { result } = renderHook(() => useRunStream(baseRun));
    const source = MockEventSource.instances[0];

    await act(async () => {
      source?.emit({
        type: "status",
        runId: "run-1",
        status: "succeeded",
        result: { summary: "Revision complete." },
      });
    });

    expect(result.current.run?.status).toBe("succeeded");
    expect(source?.closed).toBe(false);

    await act(async () => {
      source?.emit({
        type: "snapshot",
        runId: "run-1",
        run: {
          ...baseRun,
          status: "succeeded",
          stage: "Completed",
          finishedAt: "2026-03-26T00:00:05.000Z",
          result: { summary: "Revision complete." },
        },
      });
    });

    expect(result.current.run?.status).toBe("succeeded");
    expect(result.current.run?.stage).toBe("Completed");
    expect(result.current.run?.result).toEqual({ summary: "Revision complete." });
    expect(source?.closed).toBe(true);
  });

  it("does not create a stream when there is no active run", () => {
    vi.stubGlobal("EventSource", MockEventSource);

    const { result } = renderHook(() => useRunStream(null));

    expect(MockEventSource.instances).toHaveLength(0);
    expect(result.current.run).toBeNull();
    expect(result.current.streamError).toBeNull();
  });
});
