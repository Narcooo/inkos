import type { Theme } from "../../hooks/use-theme";
import { cn } from "../../lib/utils";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "../ai-elements/message";
import { BookFormCard } from "./BookFormCard";
import type { BookFormArgs } from "./BookFormCard";
import {
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";

export interface ToolCall {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export interface ChatMessageProps {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly timestamp: number;
  readonly theme: Theme;
  readonly toolCall?: ToolCall;
  readonly onArgsChange?: (args: Record<string, unknown>) => void;
  readonly onConfirm?: () => void;
  readonly confirming?: boolean;
}

export function ChatMessage({
  role,
  content,
  timestamp,
  theme,
  toolCall,
  onArgsChange,
  onConfirm,
  confirming,
}: ChatMessageProps) {
  const isUser = role === "user";
  const isStatus = content.startsWith("\u22EF");
  const isSuccess = content.startsWith("\u2713");
  const isError = content.startsWith("\u2717");

  const hasBookForm = toolCall?.name === "create_book" && onArgsChange && onConfirm;

  return (
    <Message from={role}>
      <MessageContent>
        {isUser ? (
          <div className="text-sm leading-relaxed">{content}</div>
        ) : isError ? (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <XCircle size={14} className="shrink-0" />
            <span>{content.replace(/^\u2717\s*/, "")}</span>
          </div>
        ) : (
          <MessageResponse>{content}</MessageResponse>
        )}
      </MessageContent>

      {hasBookForm && (
        <BookFormCard
          args={toolCall.arguments as BookFormArgs}
          onArgsChange={(a) => onArgsChange(a as Record<string, unknown>)}
          onConfirm={onConfirm}
          confirming={confirming ?? false}
          theme={theme}
        />
      )}
    </Message>
  );
}
