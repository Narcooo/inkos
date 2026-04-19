import { useEffect, useRef, useCallback, useState } from "react";

export interface SSEMessage {
  readonly event: string;
  readonly data: unknown;
  readonly timestamp: number;
}

export const STUDIO_SSE_EVENTS = [
  "book:creating",
  "book:created",
  "book:deleted",
  "book:error",
  "write:start",
  "write:complete",
  "write:error",
  "draft:start",
  "draft:complete",
  "draft:error",
  "daemon:chapter",
  "daemon:started",
  "daemon:stopped",
  "daemon:error",
  "agent:start",
  "agent:complete",
  "agent:error",
  "session:title",
  "audit:start",
  "audit:complete",
  "audit:error",
  "revise:start",
  "revise:complete",
  "revise:error",
  "rewrite:start",
  "rewrite:complete",
  "rewrite:error",
  "style:start",
  "style:complete",
  "style:error",
  "import:start",
  "import:complete",
  "import:error",
  "fanfic:start",
  "fanfic:complete",
  "fanfic:error",
  "fanfic:refresh:start",
  "fanfic:refresh:complete",
  "fanfic:refresh:error",
  "draft:delta",
  "radar:start",
  "radar:complete",
  "radar:error",
  "log",
  "llm:progress",
  "ping",
] as const;

export function useSSE(url = "/api/v1/events") {
  const [messages, setMessages] = useState<ReadonlyArray<SSEMessage>>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    const handleEvent = (e: MessageEvent) => {
      try {
        const data = e.data ? JSON.parse(e.data) : null;
        setMessages((prev) => [...prev.slice(-99), { event: e.type, data, timestamp: Date.now() }]);
      } catch {
        // ignore parse errors
      }
    };

    for (const event of STUDIO_SSE_EVENTS) {
      es.addEventListener(event, handleEvent);
    }

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [url]);

  const clear = useCallback(() => setMessages([]), []);

  return { messages, connected, clear };
}
