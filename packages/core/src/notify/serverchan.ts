export interface ServerChanConfig {
  readonly sendUrl: string;
}

interface ServerChanResponse {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export async function sendServerChan(
  config: ServerChanConfig,
  title: string,
  content: string,
): Promise<void> {
  const response = await fetch(config.sendUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      title,
      desp: content,
    }),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`ServerChan send failed: ${response.status} ${text}`);
  }

  try {
    const result = JSON.parse(text) as ServerChanResponse;
    if (typeof result.code === "number" && result.code !== 0) {
      throw new Error(
        `ServerChan send failed: ${result.code} ${result.message}`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("ServerChan send failed:")) {
      throw error;
    }
    // 部分兼容网关可能不返回标准 JSON，这里 HTTP 200 就视为成功
  }
}
