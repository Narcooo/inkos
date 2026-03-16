import { ProxyAgent } from "undici";

export interface TelegramConfig {
  readonly botToken: string;
  readonly chatId: string;
  readonly proxy?: string;
}

export async function sendTelegram(
  config: TelegramConfig,
  message: string,
): Promise<void> {
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const proxyUrl =
    config.proxy ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;

  const fetchOptions: Record<string, unknown> = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: config.chatId,
      text: message,
      parse_mode: "Markdown",
    }),
  };

  if (proxyUrl) {
    fetchOptions.dispatcher = new ProxyAgent(proxyUrl);
  }

  const response = await fetch(url, fetchOptions as RequestInit);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram send failed: ${response.status} ${body}`);
  }
}
