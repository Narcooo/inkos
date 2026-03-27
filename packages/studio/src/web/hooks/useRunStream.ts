import { useEffect, useMemo, useState } from "react";
import type { RunStreamEvent, StudioRun } from "../../shared/contracts";

function isTerminal(run: StudioRun): boolean {
  return run.status === "succeeded" || run.status === "failed";
}

function applyRunEvent(current: StudioRun, event: RunStreamEvent): StudioRun {
  if (event.runId !== current.id) {
    return current;
  }

  switch (event.type) {
    case "snapshot":
      return event.run ?? current;
    case "status":
      return {
        ...current,
        ...(event.status ? { status: event.status } : {}),
        ...(event.result !== undefined ? { result: event.result } : {}),
        ...(event.error !== undefined ? { error: event.error } : {}),
      };
    case "stage":
      return {
        ...current,
        ...(event.stage ? { stage: event.stage } : {}),
      };
    case "log":
      return event.log
        ? {
            ...current,
            logs: [...current.logs, event.log],
          }
        : current;
  }
}

function shouldCloseStream(event: RunStreamEvent, run: StudioRun): boolean {
  return event.type === "snapshot" && isTerminal(run);
}

export function useRunStream(initialRun: StudioRun | null) {
  const [run, setRun] = useState<StudioRun | null>(initialRun);
  const [streamError, setStreamError] = useState<string | null>(null);

  useEffect(() => {
    setRun(initialRun);
    setStreamError(null);
  }, [initialRun]);

  useEffect(() => {
    if (!run || isTerminal(run) || typeof EventSource === "undefined") {
      return;
    }

    const source = new EventSource(`/api/runs/${encodeURIComponent(run.id)}/stream`);
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as RunStreamEvent;
        setRun((current) => {
          if (!current) {
            return current;
          }
          const next = applyRunEvent(current, event);
          if (shouldCloseStream(event, next)) {
            source.close();
          }
          return next;
        });
      } catch {
        setStreamError("Unable to parse run stream update.");
      }
    };
    source.onerror = () => {
      setStreamError("Run stream disconnected.");
      source.close();
    };

    return () => {
      source.close();
    };
  }, [run?.id]);

  return useMemo(() => ({ run, streamError }), [run, streamError]);
}
