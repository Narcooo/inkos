export type ChatDepth = "light" | "normal" | "deep";

export interface ChatDepthProfile {
  readonly depth: ChatDepth;
  readonly maxTokens?: number;
  readonly label: string;
}

export function resolveChatDepthProfile(depth: ChatDepth): ChatDepthProfile {
  switch (depth) {
    case "light":
      return { depth,  maxTokens: 160, label: "light" };
    case "deep":
      return { depth,  maxTokens: 420, label: "deep" };
    case "normal":
    default:
      // No maxTokens — let the model decide its own output length.
      // Only /depth light|deep explicitly caps tokens.
      return { depth: "normal",  label: "normal" };
  }
}
