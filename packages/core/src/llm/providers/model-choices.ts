/** Filter ordinary recommendations only; saved model IDs still resolve normally. */
export function isCurrentMiniMaxChoice(service: string, modelId: string): boolean {
  // Custom/local routes and the legacy subscription have their own contracts.
  if (["custom", "newapi", "ollama", "lmstudio", "minimaxCodingPlan"].includes(service)
    || service.startsWith("custom:")) return true;
  const id = modelId.split("/").at(-1)!.toLowerCase();
  if (!/^minimax-(?:m\d|text-01)/.test(id) && id !== "m2-her") return true;
  return ["minimax-m3", "minimax-m3.1-flash", "minimax-m3.1-flash:free", "minimax-m3.1-flash-free"].includes(id);
}
