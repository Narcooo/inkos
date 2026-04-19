export type ChatDepth = "light" | "normal" | "deep";

export interface ChatDepthProfile {
  readonly depth: ChatDepth;
  readonly temperature: number;
  readonly maxTokens?: number;
  readonly label: string;
}

export function resolveChatDepthProfile(depth: ChatDepth): ChatDepthProfile {
  switch (depth) {
    case "light":
      return { depth, temperature: 0.3, maxTokens: 160, label: "light" };
    case "deep":
      return { depth, temperature: 0.45, maxTokens: 420, label: "deep" };
    case "normal":
    default:
      // No maxTokens — let the model decide its own output length.
      // Only /depth light|deep explicitly caps tokens.
      return { depth: "normal", temperature: 0.4, label: "normal" };
  }
}
