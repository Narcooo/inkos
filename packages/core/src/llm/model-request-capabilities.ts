import type { Api, Model } from "@mariozechner/pi-ai";
import { lookupModel } from "./providers/lookup.js";

/** Shape every final request body using the selected model's wire constraints. */
export function applyModelRequestCapabilities(payload: unknown, model: Model<Api>): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const card = lookupModel(model.provider, model.id);
  const body = { ...payload } as Record<string, unknown>;
  if (card?.supportsSampling === false) {
    delete body.temperature;
    delete body.top_p;
    delete body.top_k;
  }
  if (body.tool_choice !== undefined) {
    const choice = body.tool_choice;
    const disabled = choice === "none" || (choice && typeof choice === "object" && "type" in choice && choice.type === "none");
    // Automatic selection is the protocol default. Required result selection
    // is enforced by the host instead of a model-specific forcing parameter.
    if (disabled) body.tool_choice = model.api === "anthropic-messages" ? {type:"none"} : "none";
    else delete body.tool_choice;
  }
  return body;
}
