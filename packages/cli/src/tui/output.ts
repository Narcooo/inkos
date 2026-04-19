import type { AutomationMode, ExecutionStatus, InteractionIntentType } from "@actalk/inkos-core";
import { formatModeLabel, getTuiCopy, resolveTuiLocale, type TuiLocale } from "./i18n.js";

export function formatTuiResult(params: {
  readonly intent: InteractionIntentType;
  readonly status: ExecutionStatus;
  readonly bookId?: string;
  readonly mode?: AutomationMode;
  readonly responseText?: string;
  readonly locale?: TuiLocale;
}): string {
  const copy = getTuiCopy(params.locale ?? resolveTuiLocale());

  if (params.responseText?.trim()) {
    return params.responseText.trim();
  }

  if (params.intent === "switch_mode" && params.mode) {
    return copy.results.modeSwitched(formatModeLabel(params.mode, copy));
  }

  if (params.intent === "list_books") {
    return copy.results.booksListed;
  }

  if (params.intent === "select_book" && params.bookId) {
    return copy.results.activeBook(params.bookId);
  }

  if (params.bookId) {
    return `${intentLabel(params.intent, copy)} — ${params.bookId}`;
  }

  return intentLabel(params.intent, copy);
}

function intentLabel(intent: InteractionIntentType, copy: ReturnType<typeof getTuiCopy>): string {
  return copy.results.intentLabels[intent] ?? copy.results.completed(intent);
}
