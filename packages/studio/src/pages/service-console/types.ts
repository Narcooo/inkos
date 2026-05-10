export interface ServiceConsoleNav {
  toDashboard: () => void;
  toServiceDetail: (id: string) => void;
}

export interface ServiceConfigPayload {
  readonly services: Array<Record<string, unknown>>;
  readonly service: string | null;
  readonly defaultModel: string | null;
}

export type ApiFormat = "chat" | "responses";

export interface RouteRow {
  readonly id: string;
  readonly task: string;
  readonly primary: string;
  readonly fallback: string;
  readonly timeout: string;
  readonly retry: string;
  readonly enabled: boolean;
}
