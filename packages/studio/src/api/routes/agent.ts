import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import { isTextChatModelId } from "../services/service-config.js";
import { handleAgentRoute } from "../agent/route-handler.js";
import type {
  AgentRouteDependencies,
  AgentRouteRequest,
} from "../agent/route-types.js";
import { nonTextModelMessage } from "../agent/execution.js";

type RegisterAgentRoutesOptions = AgentRouteDependencies;

export function registerAgentRoutes(app: Hono, options: RegisterAgentRoutesOptions): void {
  app.post("/api/v1/agent", async (c) => {
    const request = await c.req.json<AgentRouteRequest>();
    const {
      instruction,
      sessionId,
      model: reqModel,
    } = request;

    if (!instruction?.trim()) {
      return c.json({ error: "No instruction provided" }, 400);
    }
    if (!sessionId?.trim()) {
      throw new ApiError(400, "SESSION_ID_REQUIRED", "sessionId is required");
    }
    if (reqModel && !isTextChatModelId(reqModel)) {
      const message = nonTextModelMessage(reqModel);
      return c.json({ error: message, response: message }, 400);
    }

    const result = await handleAgentRoute(request, options);
    if (result.status) {
      return c.json(result.body, result.status as never);
    }
    return c.json(result.body);
  });
}
