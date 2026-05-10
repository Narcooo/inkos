import type { MessagePart } from "../store/chat/types";

export interface ChatPageModelInfo {
  readonly id: string;
  readonly name?: string;
}

export interface ChatPageModelGroup {
  readonly service: string;
  readonly label: string;
  readonly models: ReadonlyArray<ChatPageModelInfo>;
}

export interface ChatPageModelPreference {
  readonly model?: string | null;
  readonly service?: string | null;
}
export type ChatPageAssistantRenderItem =
  | { kind: "thinking"; index: number; part: Extract<MessagePart, { type: "thinking" }> }
  | { kind: "text"; index: number; part: Extract<MessagePart, { type: "text" }> }
  | { kind: "tools"; startIndex: number; parts: Array<Extract<MessagePart, { type: "tool" }>> };

const BOOK_CREATE_SESSION_KEY = "inkos.book-create.session-id";

export function getBookCreateSessionId(): string | null {
  return globalThis.localStorage?.getItem(BOOK_CREATE_SESSION_KEY) ?? null;
}

export function setBookCreateSessionId(sessionId: string): void {
  globalThis.localStorage?.setItem(BOOK_CREATE_SESSION_KEY, sessionId);
}

export function clearBookCreateSessionId(): void {
  globalThis.localStorage?.removeItem(BOOK_CREATE_SESSION_KEY);
}

export function filterModelGroups(
  groupedModels: ReadonlyArray<ChatPageModelGroup>,
  search: string,
): ReadonlyArray<ChatPageModelGroup> {
  const query = search.trim().toLowerCase();
  if (!query) return groupedModels;

  return groupedModels
    .map((group) => ({
      ...group,
      models: group.models.filter((model) =>
        (model.name ?? model.id).toLowerCase().includes(query)
        || group.label.toLowerCase().includes(query),
      ),
    }))
    .filter((group) => group.models.length > 0);
}

export function groupAssistantMessageParts(
  parts: ReadonlyArray<MessagePart>,
): ChatPageAssistantRenderItem[] {
  const items: ChatPageAssistantRenderItem[] = [];

  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part.type === "thinking") {
      items.push({ kind: "thinking", index, part });
      continue;
    }
    if (part.type === "text") {
      items.push({ kind: "text", index, part });
      continue;
    }

    const last = items[items.length - 1];
    if (last?.kind === "tools") {
      last.parts.push(part);
    } else {
      items.push({ kind: "tools", startIndex: index, parts: [part] });
    }
  }

  return items;
}

export function pickModelSelection(
  groupedModels: ReadonlyArray<ChatPageModelGroup>,
  selectedModel: string | null,
  selectedService: string | null,
  preference?: ChatPageModelPreference | null,
): { model: string; service: string } | null {
  const selectedStillAvailable = selectedModel && selectedService
    ? groupedModels.some((group) =>
        group.service === selectedService
        && group.models.some((model) => model.id === selectedModel),
      )
    : false;
  if (selectedStillAvailable) return null;

  const preferredService = preference?.service?.trim();
  const preferredModel = preference?.model?.trim();
  if (preferredService) {
    const preferredGroup = groupedModels.find((group) => group.service === preferredService);
    const exactModel = preferredModel
      ? preferredGroup?.models.find((model) => model.id === preferredModel)
      : undefined;
    if (preferredGroup && exactModel) {
      return { model: exactModel.id, service: preferredGroup.service };
    }
    const firstPreferredModel = preferredGroup?.models[0];
    if (preferredGroup && firstPreferredModel) {
      return { model: firstPreferredModel.id, service: preferredGroup.service };
    }
  }

  if (preferredModel) {
    for (const group of groupedModels) {
      const exactModel = group.models.find((model) => model.id === preferredModel);
      if (exactModel) return { model: exactModel.id, service: group.service };
    }
  }

  const firstGroup = groupedModels.find((group) => group.models.length > 0);
  const firstModel = firstGroup?.models[0];
  if (!firstGroup || !firstModel) return null;
  return { model: firstModel.id, service: firstGroup.service };
}
