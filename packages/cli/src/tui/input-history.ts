import type { InteractionMessage } from "@actalk/inkos-core";

export interface InputHistoryState {
  readonly cursor: number | null;
  readonly draft: string;
}

export type InputHistoryDirection = "up" | "down";

export function buildInputHistory(messages: ReadonlyArray<InteractionMessage>): string[] {
  const result: string[] = [];

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }

    const value = message.content.trim();
    if (!value || result[result.length - 1] === value) {
      continue;
    }
    result.push(value);
  }

  return result;
}

export function moveHistoryCursor(
  entries: ReadonlyArray<string>,
  state: InputHistoryState,
  currentValue: string,
  direction: InputHistoryDirection,
): { state: InputHistoryState; value: string } {
  if (entries.length === 0) {
    return { state, value: currentValue };
  }

  if (direction === "up") {
    if (state.cursor === null) {
      return {
        state: { cursor: entries.length - 1, draft: currentValue },
        value: entries[entries.length - 1]!,
      };
    }

    const nextCursor = Math.max(0, state.cursor - 1);
    return {
      state: { ...state, cursor: nextCursor },
      value: entries[nextCursor]!,
    };
  }

  if (state.cursor === null) {
    return { state, value: currentValue };
  }

  if (state.cursor >= entries.length - 1) {
    return {
      state: { cursor: null, draft: state.draft },
      value: state.draft,
    };
  }

  const nextCursor = state.cursor + 1;
  return {
    state: { ...state, cursor: nextCursor },
    value: entries[nextCursor]!,
  };
}
