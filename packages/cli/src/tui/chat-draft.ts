import {
  appendInteractionMessage,
  type InteractionSession,
} from "@actalk/inkos-core";

export function createOptimisticUserMessageSession(
  session: InteractionSession,
  input: string,
  timestamp: number = Date.now(),
): InteractionSession {
  return appendInteractionMessage(session, {
    role: "user",
    content: input,
    timestamp,
  });
}

export function appendStreamingAssistantChunk(
  session: InteractionSession,
  chunk: string,
  timestamp: number = Date.now(),
): InteractionSession {
  if (!chunk) {
    return session;
  }

  const lastMessage = session.messages.at(-1);
  if (lastMessage?.role === "assistant" && lastMessage.timestamp === timestamp) {
    return {
      ...session,
      messages: session.messages.map((message, index) => index === session.messages.length - 1
        ? { ...message, content: message.content + chunk }
        : message),
    };
  }

  return appendInteractionMessage(session, {
    role: "assistant",
    content: chunk,
    timestamp,
  });
}
