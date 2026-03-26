import { createHmac } from "node:crypto";

export interface WebhookConfig {
  readonly url: string;
  readonly secret?: string;
  readonly events?: ReadonlyArray<string>;
}

export type WebhookEvent =
  | "chapter-complete"
  | "audit-passed"
  | "audit-failed"
  | "revision-complete"
  | "pipeline-complete"
  | "pipeline-error"
  | "diagnostic-alert"
  | "settlement-complete";

export interface WebhookPayload {
  readonly event: WebhookEvent;
  readonly bookId: string;
  readonly chapterNumber?: number;
  readonly timestamp: string;
  readonly data?: Record<string, unknown>;
}

export async function sendWebhook(
  config: WebhookConfig,
  payload: WebhookPayload,
): Promise<void> {
  // Filter by subscribed events
  if (config.events && config.events.length > 0 && !config.events.includes(payload.event)) {
    return;
  }

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // HMAC-SHA256 signature if secret is configured
  if (config.secret) {
    const signature = createHmac("sha256", config.secret)
      .update(body)
      .digest("hex");
    headers["X-InkOS-Signature"] = `sha256=${signature}`;
  }

  const response = await fetch(config.url, {
    method: "POST",
    headers,
    body,
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`Webhook POST to ${config.url} failed: ${response.status} ${responseBody}`);
  }
}
