export interface ChatNav {
  toDashboard: () => void;
  toBook: (id: string) => void;
  toServices: () => void;
}

export interface ServiceConfigPayload {
  readonly service?: string | null;
  readonly defaultModel?: string | null;
}
