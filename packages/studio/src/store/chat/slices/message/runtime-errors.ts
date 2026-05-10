import { localizeKnownRuntimeMessage } from "../../../../lib/error-copy";

export function extractErrorMessage(error: string | { code?: string; message?: string }): string {
  if (typeof error === "string") return localizeKnownRuntimeMessage(error);
  return localizeKnownRuntimeMessage(error.message ?? "Unknown error");
}

export function summarizeResult(result: unknown): string {
  if (typeof result === "string") return result.slice(0, 200);
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (typeof record.content === "string") return record.content.slice(0, 200);
  }
  return String(result).slice(0, 200);
}

export function extractToolError(result: unknown): string {
  if (typeof result === "string") return localizeKnownRuntimeMessage(result).slice(0, 500);
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (typeof record.content === "string") {
      return localizeKnownRuntimeMessage(record.content).slice(0, 500);
    }
    if (record.content && Array.isArray(record.content)) {
      const textPart = record.content.find((content: any) => content.type === "text");
      if (textPart) return localizeKnownRuntimeMessage((textPart as any).text ?? "").slice(0, 500);
    }
  }
  return localizeKnownRuntimeMessage(String(result)).slice(0, 500);
}
