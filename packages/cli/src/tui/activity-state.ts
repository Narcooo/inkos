import type { InteractionIntentType } from "@actalk/inkos-core";
import type { TuiCopy } from "./i18n.js";

export interface ActivityState {
  readonly label: string;
  readonly frames: readonly string[];
  readonly accent: string;
  readonly intervalMs: number;
}

import { WARM_ACCENT } from "./theme.js";

const DOTS = ["·  ", "·· ", "···", " ··", "  ·"] as const;
const WAVE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴"] as const;
const PULSE = ["◜", "◠", "◝", "◞", "◡", "◟"] as const;

export function describeActivityState(
  intent: InteractionIntentType | "unknown",
  copy: Pick<TuiCopy, "activity">,
): ActivityState {
  switch (intent) {
    case "write_next":
    case "continue_book":
      return { label: copy.activity.writing, frames: WAVE, accent: WARM_ACCENT, intervalMs: 180 };
    case "revise_chapter":
    case "rewrite_chapter":
      return { label: copy.activity.reviewing, frames: WAVE, accent: WARM_ACCENT, intervalMs: 180 };
    case "update_focus":
    case "update_author_intent":
    case "edit_truth":
      return { label: copy.activity.updating, frames: PULSE, accent: WARM_ACCENT, intervalMs: 220 };
    case "list_books":
    case "select_book":
    case "switch_mode":
    case "explain_status":
      return { label: copy.activity.checking, frames: DOTS, accent: WARM_ACCENT, intervalMs: 220 };
    case "chat":
    default:
      return { label: copy.activity.thinking, frames: DOTS, accent: WARM_ACCENT, intervalMs: 220 };
  }
}
