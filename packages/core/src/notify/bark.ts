export interface BarkConfig {
  readonly serverUrl: string;
  readonly deviceKey: string;
  readonly group?: string;
  readonly url?: string;
  readonly sound?: string;
  readonly icon?: string;
  readonly level?: "active" | "timeSensitive" | "passive" | "critical";
}

export async function sendBark(
  config: BarkConfig,
  title: string,
  body: string,
): Promise<void> {
  const serverUrl = config.serverUrl.replace(/\/+$/, "");

  const payload: Record<string, string> = {
    device_key: config.deviceKey,
    title,
    body,
  };

  if (config.group) payload.group = config.group;
  if (config.url) payload.url = config.url;
  if (config.sound) payload.sound = config.sound;
  if (config.icon) payload.icon = config.icon;
  if (config.level) payload.level = config.level;

  const response = await fetch(`${serverUrl}/push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Bark send failed: ${response.status} ${text}`);
  }
}
