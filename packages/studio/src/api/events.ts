import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";

type EventHandler = (event: string, data: unknown) => void;

export interface StudioEventBus {
  readonly broadcast: (event: string, data: unknown) => void;
  readonly registerRoutes: (app: Hono) => void;
}

export function createStudioEventBus(): StudioEventBus {
  const subscribers = new Set<EventHandler>();

  return {
    broadcast(event, data) {
      for (const handler of subscribers) {
        handler(event, data);
      }
    },
    registerRoutes(app) {
      app.get("/api/v1/events", (c) => {
        return streamSSE(c, async (stream) => {
          const handler: EventHandler = (event, data) => {
            stream.writeSSE({ event, data: JSON.stringify(data) });
          };
          subscribers.add(handler);
          await stream.writeSSE({ event: "ping", data: "" });

          const keepAlive = setInterval(() => {
            stream.writeSSE({ event: "ping", data: "" });
          }, 30000);

          stream.onAbort(() => {
            subscribers.delete(handler);
            clearInterval(keepAlive);
          });

          await new Promise(() => {});
        });
      });
    },
  };
}
