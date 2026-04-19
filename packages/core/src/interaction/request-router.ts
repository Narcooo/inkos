import { InteractionRequestSchema, type InteractionRequest } from "./intents.js";

export function routeInteractionRequest(input: InteractionRequest): InteractionRequest {
  return InteractionRequestSchema.parse(input);
}
