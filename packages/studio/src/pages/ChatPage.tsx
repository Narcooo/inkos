import { useMemo } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import type { SSEMessage } from "../hooks/use-sse";
import { chatSelectors, useChatStore } from "../store/chat";
import { ChatComposer } from "./chat/ChatComposer";
import { ChatMessageList } from "./chat/ChatMessageList";
import { useChatModelPicker } from "./chat/use-chat-model-picker";
import { useChatSession } from "./chat/use-chat-session";
import type { ChatNav } from "./chat/types";

export interface ChatPageProps {
  readonly activeBookId?: string;
  readonly nav: ChatNav;
  readonly theme: Theme;
  readonly t: TFunction;
  readonly sse: { messages: ReadonlyArray<SSEMessage>; connected: boolean };
}

export function ChatPage({ activeBookId, nav, theme, t, sse: _sse }: ChatPageProps) {
  const messages = useChatStore(chatSelectors.activeMessages);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const input = useChatStore((s) => s.input);
  const loading = useChatStore(chatSelectors.isActiveSessionStreaming);
  const setInput = useChatStore((s) => s.setInput);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const {
    groupedModels,
    modelPickerStatus,
    selectedModel,
    selectedModelLabel,
    selectedService,
    setSelectedModel,
  } = useChatModelPicker();

  useChatSession(activeBookId);

  const isZh = t("nav.connected") === "\u5DF2\u8FDE\u63A5";
  const hasBook = Boolean(activeBookId);

  const isStreaming = useMemo(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return false;
    return last.thinkingStreaming === true
      || !last.content
      || (last.toolExecutions?.some((tool) =>
        tool.status === "running" || tool.status === "processing"
      ) ?? false);
  }, [messages]);

  const onSend = (text: string) => {
    if (!activeSessionId) return;
    void sendMessage(activeSessionId, text, activeBookId);
  };

  const emptyGuidance = isZh
    ? "\u544A\u8BC9\u6211\u4F60\u60F3\u5199\u4EC0\u4E48\u2014\u2014\u9898\u6750\u3001\u4E16\u754C\u89C2\u3001\u4E3B\u89D2\u3001\u6838\u5FC3\u51B2\u7A81"
    : "Tell me what you want to write \u2014 genre, world, protagonist, core conflict";

  return (
    <div className="flex flex-col h-full flex-1 min-w-0">
      <ChatMessageList
        emptyGuidance={emptyGuidance}
        isStreaming={isStreaming}
        isZh={isZh}
        loading={loading}
        messages={messages}
        theme={theme}
      />
      <ChatComposer
        activeSessionId={activeSessionId}
        disabled={loading}
        groupedModels={groupedModels}
        hasBook={hasBook}
        input={input}
        isZh={isZh}
        modelPickerStatus={modelPickerStatus}
        onManageModels={() => nav.toServices()}
        onQuickAction={onSend}
        onSelectModel={setSelectedModel}
        onSend={onSend}
        selectedModel={selectedModel}
        selectedModelLabel={selectedModelLabel}
        selectedService={selectedService}
        setInput={setInput}
      />
    </div>
  );
}
