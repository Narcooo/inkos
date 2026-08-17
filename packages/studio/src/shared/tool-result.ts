function textFromContentParts(content: unknown): string {
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const item = part as Record<string, unknown>;
      return item.type === "text" && typeof item.text === "string" ? item.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

export function summarizeToolResult(result: unknown, maxLength = 2000): string {
  let text = "";

  if (typeof result === "string") {
    text = result;
  } else if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (typeof record.content === "string") text = record.content;
    else text = textFromContentParts(record.content);
    if (!text && typeof record.text === "string") text = record.text;
    if (!text && typeof record.message === "string") text = record.message;
  }

  if (!text) {
    if (result === undefined || result === null) return "";
    try {
      text = JSON.stringify(result);
    } catch {
      text = "";
    }
  }

  return text.slice(0, maxLength);
}
