export function getSessionLabel(session: {
  sessionId: string;
  title: string | null;
  messages: ReadonlyArray<{ role: string; content: string }>;
}): string {
  if (session.title) return session.title;
  const firstUserMsg = session.messages.find((message) => message.role === "user")?.content?.trim();
  if (firstUserMsg) {
    const oneLine = firstUserMsg.replace(/\s+/g, " ");
    return oneLine.length > 20 ? `${oneLine.slice(0, 20)}…` : oneLine;
  }
  return "新会话";
}

export function formatRelativeTime(sessionId: string, now = Date.now()): string {
  const rawTs = Number(sessionId.split("-")[0]);
  if (!Number.isFinite(rawTs)) return "";
  const diff = now - rawTs;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天`;
  const months = Math.floor(days / 30);
  return `${months} 个月`;
}
