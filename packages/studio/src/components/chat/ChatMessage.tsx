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
        {/* Status icon for special assistant messages */}
        {!isUser && (isSuccess || isError || isStatus) && (
          <div className="flex items-center gap-2 text-xs">
            {isSuccess && <CheckCircle2 size={14} className="text-emerald-500" />}
            {isError && <XCircle size={14} className="text-destructive" />}
            {isStatus && <Loader2 size={14} className="text-primary animate-spin" />}
          </div>
        )}

        {isUser ? (
          <div className="flex items-end gap-2">
            <div className="text-sm leading-relaxed">{content}</div>
            <span className="text-[9px] font-mono text-primary-foreground/40 shrink-0">
              {new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        ) : (
          <>
            <MessageResponse>{content}</MessageResponse>
            <div className="text-[9px] font-mono text-muted-foreground/40">
              {new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          </>
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
