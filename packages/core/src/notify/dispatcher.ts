import type { NotifyChannel } from "../models/project.js";
import { sendTelegram } from "./telegram.js";
import { sendFeishu } from "./feishu.js";
import { sendWechatWork } from "./wechat-work.js";
import { sendWebhook, type WebhookPayload } from "./webhook.js";
import { withRetry } from "../llm/retry.js";
import type { Logger } from "../utils/logger.js";

export interface NotifyMessage {
  readonly title: string;
  readonly body: string;
}

/** Opciones de reintento para notificaciones: menos agresivas que LLM. */
const NOTIFY_RETRY = { maxRetries: 2, baseDelayMs: 500, maxDelayMs: 5000 } as const;

export async function dispatchNotification(
  channels: ReadonlyArray<NotifyChannel>,
  message: NotifyMessage,
  logger?: Logger,
): Promise<void> {
  const fullText = `**${message.title}**\n\n${message.body}`;

  const tasks = channels.map(async (channel) => {
    try {
      switch (channel.type) {
        case "telegram":
          await withRetry(
            () => sendTelegram(
              { botToken: channel.botToken, chatId: channel.chatId },
              fullText,
            ),
            NOTIFY_RETRY,
          );
          break;
        case "feishu":
          await withRetry(
            () => sendFeishu(
              { webhookUrl: channel.webhookUrl },
              message.title,
              message.body,
            ),
            NOTIFY_RETRY,
          );
          break;
        case "wechat-work":
          await withRetry(
            () => sendWechatWork(
              { webhookUrl: channel.webhookUrl },
              fullText,
            ),
            NOTIFY_RETRY,
          );
          break;
        case "webhook":
          await withRetry(
            () => sendWebhook(
              { url: channel.url, secret: channel.secret, events: channel.events },
              {
                event: "pipeline-complete",
                bookId: "",
                timestamp: new Date().toISOString(),
                data: { title: message.title, body: message.body },
              },
            ),
            NOTIFY_RETRY,
          );
          break;
      }
    } catch (e) {
      // Log pero no lanzar — fallo de notificación no debe bloquear el pipeline
      const msg = `${channel.type} failed after retries: ${e}`;
      if (logger) {
        logger.warn(msg, { channel: channel.type });
      } else {
        process.stderr.write(`[notify] ${msg}\n`);
      }
    }
  });

  await Promise.all(tasks);
}

/** Dispatch a structured webhook event to all webhook channels. */
export async function dispatchWebhookEvent(
  channels: ReadonlyArray<NotifyChannel>,
  payload: WebhookPayload,
  logger?: Logger,
): Promise<void> {
  const webhookChannels = channels.filter((ch) => ch.type === "webhook");
  if (webhookChannels.length === 0) return;

  const tasks = webhookChannels.map(async (channel) => {
    if (channel.type !== "webhook") return;
    try {
      await withRetry(
        () => sendWebhook(
          { url: channel.url, secret: channel.secret, events: channel.events },
          payload,
        ),
        NOTIFY_RETRY,
      );
    } catch (e) {
      const msg = `${channel.url} failed after retries: ${e}`;
      if (logger) {
        logger.warn(msg, { url: channel.url });
      } else {
        process.stderr.write(`[webhook] ${msg}\n`);
      }
    }
  });

  await Promise.all(tasks);
}

