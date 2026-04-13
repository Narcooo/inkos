import { useState } from "react";
import type { Theme } from "../../hooks/use-theme";
import { cn } from "../../lib/utils";
import { StreamMessage } from "../book-create/StreamMessage";
import {
  User,
  Sparkles,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";

export interface ChatMessageProps {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly timestamp: number;
  readonly theme: Theme;
}

const HAS_DIRECTIVE_RE = /^:::/m;

function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\n{2,}/g, '</p><p class="mt-3">')
    .replace(/\n/g, "<br />");
}

function AssistantContent({ content, theme }: { readonly content: string; readonly theme: Theme }) {
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  if (HAS_DIRECTIVE_RE.test(content)) {
    return (
      <StreamMessage
        content={content}
        onFieldChange={(key, value) =>
          setFieldValues((prev) => ({ ...prev, [key]: value }))
        }
        fieldValues={fieldValues}
        theme={theme}
      />
    );
  }

  return (
    <div
      className="text-sm leading-7"
      dangerouslySetInnerHTML={{ __html: `<p>${renderMarkdown(content)}</p>` }}
    />
  );
}

export function ChatMessage({ role, content, timestamp, theme }: ChatMessageProps) {
  const isUser = role === "user";
  const isStatus = content.startsWith("⋯");
  const isSuccess = content.startsWith("✓");
  const isError = content.startsWith("✗");

  return (
    <div
      className={cn(
        "flex gap-3",
        isUser ? "flex-row-reverse" : "",
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          "w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
          isUser ? "bg-primary/10" : "bg-secondary",
        )}
      >
        {isUser ? (
          <User size={14} className="text-primary" />
        ) : isSuccess ? (
          <CheckCircle2 size={14} className="text-emerald-500" />
        ) : isError ? (
          <XCircle size={14} className="text-destructive" />
        ) : isStatus ? (
          <Loader2 size={14} className="text-primary animate-spin" />
        ) : (
          <Sparkles size={14} className="text-primary" />
        )}
      </div>

      {/* Bubble */}
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm",
          isUser
            ? "bg-primary text-primary-foreground font-medium rounded-tr-sm"
            : isStatus
              ? "bg-secondary/50 border border-border/30 text-muted-foreground text-xs rounded-tl-sm"
              : isSuccess
                ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 rounded-tl-sm"
                : isError
                  ? "bg-destructive/10 border border-destructive/20 text-destructive rounded-tl-sm"
                  : "bg-card border border-border/50 text-foreground rounded-tl-sm",
        )}
      >
        {isUser ? (
          <div>{content}</div>
        ) : (
          <AssistantContent content={content} theme={theme} />
        )}

        {/* Timestamp */}
        <div
          className={cn(
            "text-[9px] mt-1.5 font-mono",
            isUser ? "text-primary-foreground/40" : "text-muted-foreground/40",
          )}
        >
          {new Date(timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}
