/**
 * SSE stream factory for run event streaming.
 * Ported from PR #96 (Te9ui1a) — typed ReadableStream with auto-close.
 */

import type { RunStreamEvent } from "../../shared/contracts.js";

function encodeSse(event: RunStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export function createRunEventStream(
  initialEvent: RunStreamEvent,
  subscribe: (send: (event: RunStreamEvent) => void) => () => void,
  shouldClose: (event: RunStreamEvent) => boolean,
): Response {
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encodeSse(initialEvent));

      if (shouldClose(initialEvent)) {
        controller.close();
        return;
      }

      unsubscribe = subscribe((event) => {
        controller.enqueue(encodeSse(event));
        if (shouldClose(event)) {
          unsubscribe?.();
          unsubscribe = null;
          controller.close();
        }
      });
    },
    cancel() {
      unsubscribe?.();
      unsubscribe = null;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
