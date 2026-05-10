import { useEffect, useMemo, useRef } from "react";
import { BotMessageSquare } from "lucide-react";
import type { Theme } from "../../hooks/use-theme";
import type { Message as ChatStoreMessage } from "../../store/chat";
import { ChatMessage } from "../../components/chat/ChatMessage";
import { ToolExecutionSteps } from "../../components/chat/ToolExecutionSteps";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "../../components/ai-elements/reasoning";
import { Shimmer } from "../../components/ai-elements/shimmer";
import {
  Message,
  MessageContent,
} from "../../components/ai-elements/message";
import { groupAssistantMessageParts } from "../chat-page-state";

interface ChatMessageListProps {
  readonly emptyGuidance: string;
  readonly isStreaming: boolean;
  readonly isZh: boolean;
  readonly loading: boolean;
  readonly messages: ReadonlyArray<ChatStoreMessage>;
  readonly theme: Theme;
}

export function ChatMessageList({
  emptyGuidance,
  isStreaming,
  isZh,
  loading,
  messages,
  theme,
}: ChatMessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  return (
    <div
      ref={scrollRef}
      className="chat-message-scroll flex-1 overflow-y-auto [scrollbar-gutter:stable] px-4 py-6"
    >
      {messages.length === 0 && !loading ? (
        <div className="h-full flex flex-col items-center justify-center text-center select-none">
          <div className="w-14 h-14 rounded-2xl border border-dashed border-border flex items-center justify-center mb-4 bg-secondary/30 opacity-40">
            <BotMessageSquare size={24} className="text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground/70 max-w-md leading-7">
            {emptyGuidance}
          </p>
        </div>
      ) : (
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.map((msg, index) => (
            <ChatMessageFrame
              key={`${msg.timestamp}-${index}`}
              message={msg}
              theme={theme}
            />
          ))}

          {loading && !isStreaming && (
            <Message from="assistant">
              <MessageContent>
                <Shimmer className="text-sm" duration={1.5}>
                  {isZh ? "思考中..." : "Thinking..."}
                </Shimmer>
              </MessageContent>
            </Message>
          )}
        </div>
      )}
    </div>
  );
}

function ChatMessageFrame({
  message,
  theme,
}: {
  readonly message: ChatStoreMessage;
  readonly theme: Theme;
}) {
  const assistantItems = useMemo(
    () => message.parts && message.parts.length > 0
      ? groupAssistantMessageParts(message.parts)
      : [],
    [message.parts]
  );

  if (message.role === "user") {
    return (
      <div>
        <ChatMessage
          role="user"
          content={message.content}
          timestamp={message.timestamp}
          theme={theme}
        />
      </div>
    );
  }

  if (assistantItems.length > 0) {
    return (
      <div>
        {assistantItems.map((item) => {
          if (item.kind === "thinking") {
            return (
              <div key={`t-${item.index}`} className="mb-2">
                <Reasoning isStreaming={item.part.streaming}>
                  <ReasoningTrigger />
                  <ReasoningContent>{item.part.content}</ReasoningContent>
                </Reasoning>
              </div>
            );
          }
          if (item.kind === "tools") {
            return (
              <ToolExecutionSteps
                key={`x-${item.startIndex}`}
                executions={item.parts.map((part) => part.execution)}
              />
            );
          }
          if (item.part.content) {
            return (
              <ChatMessage
                key={`c-${item.index}`}
                role="assistant"
                content={item.part.content}
                timestamp={message.timestamp}
                theme={theme}
              />
            );
          }
          return null;
        })}
      </div>
    );
  }

  return (
    <div>
      <ChatMessage
        role={message.role}
        content={message.content}
        timestamp={message.timestamp}
        theme={theme}
      />
    </div>
  );
}
