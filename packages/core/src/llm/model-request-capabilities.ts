import type { Api, Model } from "@mariozechner/pi-ai";
import { lookupModel } from "./providers/lookup.js";

/** Shape every final request body using the selected model's wire constraints. */
export function applyModelRequestCapabilities(payload: unknown, model: Model<Api>): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const card = lookupModel(model.provider, model.id);
  if (card?.supportsForcedToolChoice !== false && card?.supportsSampling !== false) return payload;
  const body = { ...payload } as Record<string, unknown>;
  if (card.supportsSampling === false) {
    delete body.temperature;
    delete body.top_p;
    delete body.top_k;
  }
  if (card.supportsForcedToolChoice === false && body.tool_choice !== undefined) {
    const choice = body.tool_choice;
    const disabled = choice === "none" || (choice && typeof choice === "object" && "type" in choice && choice.type === "none");
    // The caller retains the original required-result contract. This changes
    // only the request parameter accepted by the provider.
    body.tool_choice = model.api === "anthropic-messages"
      ? { type: disabled ? "none" : "auto" }
      : disabled ? "none" : "auto";
  }
  return body;
}
