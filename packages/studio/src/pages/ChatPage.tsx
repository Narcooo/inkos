import { useRef, useEffect, useMemo, useState } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import type { SSEMessage } from "../hooks/use-sse";
import { fetchJson } from "../hooks/use-api";
import { chatSelectors, useChatStore } from "../store/chat";
import { useServiceStore } from "../store/service";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../components/ui/dropdown-menu";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "../components/ai-elements/reasoning";
import { ChatMessage } from "../components/chat/ChatMessage";
import { QuickActions } from "../components/chat/QuickActions";
import { ToolExecutionSteps } from "../components/chat/ToolExecutionSteps";
import {
  Loader2,
  BotMessageSquare,
  ArrowUp,
  ChevronDown,
  Check,
} from "lucide-react";
import { Shimmer } from "../components/ai-elements/shimmer";
import {
  Message,
  MessageContent,
} from "../components/ai-elements/message";
import {
  type ChatPageModelPreference,
  filterModelGroups,
  getBookCreateSessionId,
  pickModelSelection,
  setBookCreateSessionId,
} from "./chat-page-state";

// -- Types --

interface Nav {
  toDashboard: () => void;
  toBook: (id: string) => void;
  toServices: () => void;
}

export interface ChatPageProps {
  readonly activeBookId?: string;
  readonly nav: Nav;
  readonly theme: Theme;
  readonly t: TFunction;
  readonly sse: { messages: ReadonlyArray<SSEMessage>; connected: boolean };
}

interface ServiceConfigPayload {
  readonly service?: string | null;
  readonly defaultModel?: string | null;
}

// -- Component --

export function ChatPage({ activeBookId, nav, theme, t, sse: _sse }: ChatPageProps) {
  // -- Store selectors --
  const messages = useChatStore(chatSelectors.activeMessages);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const input = useChatStore((s) => s.input);
  const loading = useChatStore(chatSelectors.isActiveSessionStreaming);
  const selectedModel = useChatStore((s) => s.selectedModel);
  const selectedService = useChatStore((s) => s.selectedService);
  // -- Store actions --
  const setInput = useChatStore((s) => s.setInput);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const setSelectedModel = useChatStore((s) => s.setSelectedModel);
  const loadSessionList = useChatStore((s) => s.loadSessionList);
  const createSession = useChatStore((s) => s.createSession);
  const loadSessionDetail = useChatStore((s) => s.loadSessionDetail);
  const activateSession = useChatStore((s) => s.activateSession);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isZh = t("nav.connected") === "\u5DF2\u8FDE\u63A5";
  const isKo = t("nav.connected") === "연결됨";
  const language = isKo ? "ko" : isZh ? "zh" : "en";
  const hasBook = Boolean(activeBookId);

  // Derived: is the assistant currently streaming/thinking/executing tools?
  const isStreaming = useMemo(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return false;
    return last.thinkingStreaming === true
      || !last.content
      || (last.toolExecutions?.some(t => t.status === "running" || t.status === "processing") ?? false);
  }, [messages]);

  // -- Model picker: read raw state, derive with useMemo (stable refs) --
  const services = useServiceStore((s) => s.services);
  const servicesLoading = useServiceStore((s) => s.servicesLoading);
  const bankModelsLoading = useServiceStore((s) => s.bankModelsLoading);
  const customModelsLoading = useServiceStore((s) => s.customModelsLoading);
  const modelsByService = useServiceStore((s) => s.modelsByService);
  const fetchServices = useServiceStore((s) => s.fetchServices);
  const fetchBankModels = useServiceStore((s) => s.fetchBankModels);
  const setLiveModels = useServiceStore((s) => s.setLiveModels);
  const [configuredModelSelection, setConfiguredModelSelection] = useState<ChatPageModelPreference | null>(null);
  const [serviceConfigLoaded, setServiceConfigLoaded] = useState(false);

  useEffect(() => { void fetchServices(); }, [fetchServices]);
  useEffect(() => {
    void fetchBankModels();
  }, [fetchBankModels]);
  useEffect(() => {
    let cancelled = false;

    void fetchJson<ServiceConfigPayload>("/services/config")
      .then((payload) => {
        if (cancelled) return;
        setConfiguredModelSelection({
          service: payload.service ?? null,
          model: payload.defaultModel ?? null,
        });
        if (payload.service && payload.defaultModel) {
          setLiveModels(payload.service, [{ id: payload.defaultModel, name: payload.defaultModel }]);
        }
      })
      .catch(() => {
        if (!cancelled) setConfiguredModelSelection(null);
      })
      .finally(() => {
        if (!cancelled) setServiceConfigLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [setLiveModels]);

  const modelPickerStatus = useMemo(() => {
    if (servicesLoading || services.length === 0) return "loading" as const;
    const connected = services.filter((s) => s.connected);
    if (connected.length === 0) return "no-models" as const;
    if (bankModelsLoading) return "loading" as const;
    if (connected.some((s) => (modelsByService[s.service]?.length ?? 0) > 0)) return "ready" as const;
    const hasConnectedBank = connected.some((s) => !s.service.startsWith("custom"));
    const hasConnectedCustom = connected.some((s) => s.service.startsWith("custom"));
    if (!hasConnectedBank && hasConnectedCustom && customModelsLoading) return "loading" as const;
    return "no-models" as const;
  }, [services, servicesLoading, bankModelsLoading, customModelsLoading, modelsByService]);

  const groupedModels = useMemo(() => {
    return services
      .filter((s) => s.connected && (modelsByService[s.service]?.length ?? 0) > 0)
      .map((s) => ({ service: s.service, label: s.label, models: modelsByService[s.service]! }));
  }, [services, modelsByService]);

  const selectedModelLabel = useMemo(() => {
    if (!selectedModel) return isKo ? "모델 선택" : isZh ? "选择模型" : "Select model";
    const group = groupedModels.find((item) => item.service === selectedService);
    const model = group?.models.find((item) => item.id === selectedModel);
    const modelLabel = model?.name ?? selectedModel;
    return group ? `${group.label} · ${modelLabel}` : modelLabel;
  }, [groupedModels, isKo, isZh, selectedModel, selectedService]);

  // Auto-select from saved service config first, then fall back to the first available model.
  useEffect(() => {
    if (!serviceConfigLoaded) return;
    const nextSelection = pickModelSelection(
      groupedModels,
      selectedModel,
      selectedService,
      configuredModelSelection,
    );
    if (nextSelection) {
      setSelectedModel(nextSelection.model, nextSelection.service);
    }
  }, [configuredModelSelection, groupedModels, selectedModel, selectedService, serviceConfigLoaded, setSelectedModel]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  // Entering a book loads its latest session; book-create mode persists its orphan session in localStorage.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (activeBookId) {
        await loadSessionList(activeBookId);
        if (cancelled) return;

        const state = useChatStore.getState();
        const currentSession = state.activeSessionId ? state.sessions[state.activeSessionId] : null;
        if (currentSession?.bookId === activeBookId) {
          await loadSessionDetail(currentSession.sessionId);
          return;
        }
        const ids = state.sessionIdsByBook[activeBookId] ?? [];
        if (ids.length > 0) {
          activateSession(ids[0]);
          await loadSessionDetail(ids[0]);
          return;
        }

        await createSession(activeBookId);
        return;
      }

      const existingId = getBookCreateSessionId();
      if (existingId) {
        await loadSessionDetail(existingId);
        if (cancelled) return;

        const state = useChatStore.getState();
        const session = state.sessions[existingId];
        if (session && session.bookId === null) {
          activateSession(existingId);
          return;
        }
      }

      const newSessionId = await createSession(null);
      if (!cancelled) {
        setBookCreateSessionId(newSessionId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeBookId, activateSession, createSession, loadSessionDetail, loadSessionList]);

  const onSend = (text: string) => {
    if (!activeSessionId) return;
    void sendMessage(activeSessionId, text, activeBookId, language);
  };

  const handleQuickAction = (command: string) => {
    if (!activeSessionId) return;
    void sendMessage(activeSessionId, command, activeBookId, language);
  };

  const emptyGuidance = isKo
    ? "무엇을 쓰고 싶은지 알려주세요. 장르, 세계관, 주인공, 핵심 갈등처럼 떠오르는 것부터 시작해도 됩니다."
    : isZh
    ? "\u544A\u8BC9\u6211\u4F60\u60F3\u5199\u4EC0\u4E48\u2014\u2014\u9898\u6750\u3001\u4E16\u754C\u89C2\u3001\u4E3B\u89D2\u3001\u6838\u5FC3\u51B2\u7A81"
    : "Tell me what you want to write \u2014 genre, world, protagonist, core conflict";

  return (
    <div className="flex flex-col h-full flex-1 min-w-0">
      {/* Message scroll area */}
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
            {messages.map((msg, i) => (
              <div key={`${msg.timestamp}-${i}`}>
                {msg.role === "user" ? (
                  /* User message */
                  <ChatMessage role="user" content={msg.content} timestamp={msg.timestamp} theme={theme} />
                ) : msg.parts && msg.parts.length > 0 ? (
                  /* Assistant message — parts-based rendering (chronological) */
                  /* Merge consecutive utility tool parts into one group */
                  <>
                    {(() => {
                      type RenderItem =
                        | { kind: "thinking"; pi: number; part: Extract<typeof msg.parts[0], { type: "thinking" }> }
                        | { kind: "text"; pi: number; part: Extract<typeof msg.parts[0], { type: "text" }> }
                        | { kind: "tools"; parts: Array<Extract<typeof msg.parts[0], { type: "tool" }>>; startIdx: number };

                      const items: RenderItem[] = [];
                      for (let pi = 0; pi < msg.parts!.length; pi++) {
                        const part = msg.parts![pi];
                        if (part.type === "thinking") {
                          items.push({ kind: "thinking", pi, part });
                        } else if (part.type === "text") {
                          items.push({ kind: "text", pi, part });
                        } else if (part.type === "tool") {
                          // Merge consecutive tool parts into one group
                          const last = items[items.length - 1];
                          if (last?.kind === "tools") {
                            last.parts.push(part);
                          } else {
                            items.push({ kind: "tools", parts: [part], startIdx: pi });
                          }
                        }
                      }

                      return items.map((item) => {
                        if (item.kind === "thinking") {
                          return (
                            <div key={`t-${item.pi}`} className="mb-2">
                              <Reasoning isStreaming={item.part.streaming}>
                                <ReasoningTrigger />
                                <ReasoningContent>{item.part.content}</ReasoningContent>
                              </Reasoning>
                            </div>
                          );
                        }
                        if (item.kind === "tools") {
                          return <ToolExecutionSteps key={`x-${item.startIdx}`} executions={item.parts.map(p => p.execution)} language={language} />;
                        }
                        if (item.kind === "text" && item.part.content) {
                          return (
                            <ChatMessage
                              key={`c-${item.pi}`}
                              role="assistant"
                              content={item.part.content}
                              timestamp={msg.timestamp}
                              theme={theme}
                            />
                          );
                        }
                        return null;
                      });
                    })()}
                  </>
                ) : (
                  /* Assistant message — fallback (no parts, e.g. error messages) */
                  <ChatMessage
                    role={msg.role}
                    content={msg.content}
                    timestamp={msg.timestamp}
                    theme={theme}
                  />
                )}
              </div>
            ))}

            {/* Loading indicator — only when loading and no streaming activity */}
            {loading && !isStreaming && (
              <Message from="assistant">
                <MessageContent>
                  <Shimmer className="text-sm" duration={1.5}>
                    {isKo ? "생각 중..." : isZh ? "思考中..." : "Thinking..."}
                  </Shimmer>
                </MessageContent>
              </Message>
            )}

          </div>
        )}
      </div>

      {/* Quick actions (only when a book is active) */}
      {hasBook && (
        <div className="shrink-0 max-w-3xl mx-auto w-full px-4">
          <QuickActions
            onAction={handleQuickAction}
            disabled={loading || !activeSessionId}
            language={language}
          />
        </div>
      )}

      {/* Input area */}
      <div className="shrink-0 border-t border-border/40 px-4 py-3">
        <div className="max-w-3xl mx-auto">
            <div className="rounded-xl bg-secondary/30 transition-all">
              <div className="flex items-center gap-2 px-3 py-2">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(input); } }}
                  placeholder={isKo ? "명령 입력..." : isZh ? "输入指令..." : "Enter command..."}
                  disabled={loading || !activeSessionId}
                  rows={1}
                  className="flex-1 bg-transparent text-sm leading-6 placeholder:text-muted-foreground/50 outline-none! border-none! ring-0! shadow-none focus:outline-none! focus:ring-0! focus:border-none! resize-none disabled:opacity-50 max-h-[200px] overflow-y-auto"
                />
                <button
                  type="button"
                  onClick={() => onSend(input)}
                  disabled={!input.trim() || loading || !activeSessionId}
                  className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shrink-0 hover:scale-105 active:scale-95 transition-all disabled:opacity-20 disabled:scale-100 shadow-sm shadow-primary/20"
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={14} strokeWidth={2.5} />}
                </button>
              </div>
              <div className="flex items-center gap-2 px-3 pb-2 border-t border-border/20 pt-1.5">
                {modelPickerStatus === "loading" ? (
                  <span className="text-xs text-muted-foreground/40 animate-pulse">
                    {isKo ? "모델 불러오는 중..." : isZh ? "加载模型..." : "Loading models..."}
                  </span>
                ) : modelPickerStatus === "ready" ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-muted text-sm transition-colors cursor-pointer">
                      <span className="font-medium text-xs truncate max-w-[220px]">
                        {selectedModelLabel}
                      </span>
                      <ChevronDown size={14} className="text-muted-foreground" />
                    </DropdownMenuTrigger>
                    <ModelPickerContent
                      groupedModels={groupedModels}
                      selectedModel={selectedModel}
                      selectedService={selectedService}
                      isKo={isKo}
                      isZh={isZh}
                      onSelect={setSelectedModel}
                      onManage={() => nav.toServices()}
                    />
                  </DropdownMenu>
                ) : (
                  <button
                    onClick={() => nav.toServices()}
                    className="text-xs text-muted-foreground/50 hover:text-primary transition-colors"
                  >
                    {isKo ? "모델 설정 →" : isZh ? "配置模型 →" : "Configure model →"}
                  </button>
                )}
              </div>
            </div>
        </div>
      </div>
    </div>
  );
}

function ModelPickerContent({
  groupedModels,
  selectedModel,
  selectedService,
  isKo,
  isZh,
  onSelect,
  onManage,
}: {
  groupedModels: ReadonlyArray<{ service: string; label: string; models: ReadonlyArray<{ id: string; name?: string }> }>;
  selectedModel: string | null;
  selectedService: string | null;
  isKo: boolean;
  isZh: boolean;
  onSelect: (model: string, service: string) => void;
  onManage: () => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => filterModelGroups(groupedModels, search), [groupedModels, search]);

  return (
    <DropdownMenuContent side="top" align="start" className="w-64 max-h-80 flex flex-col">
      <div className="px-2 py-1.5 border-b border-border/30">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={isKo ? "모델 검색..." : isZh ? "搜索模型..." : "Search models..."}
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/40"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>
      <div className="overflow-y-auto flex-1">
        {filtered.map((group) => (
          <div key={group.service}>
            <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {group.label}
            </div>
            {group.models.map((m) => {
              const isSelected = selectedModel === m.id && selectedService === group.service;
              return (
                <DropdownMenuItem
                  key={`${group.service}:${m.id}`}
                  onClick={() => onSelect(m.id, group.service)}
                  className={isSelected ? "bg-muted/50" : ""}
                >
                  <div className="flex flex-1 items-center justify-between">
                    <span className="text-sm">{m.name ?? m.id}</span>
                    {isSelected && <Check size={14} className="text-primary shrink-0" />}
                  </div>
                </DropdownMenuItem>
              );
            })}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="px-3 py-4 text-xs text-muted-foreground/50 text-center italic">
            {isKo ? "일치하는 모델이 없습니다" : isZh ? "无匹配模型" : "No matching models"}
          </div>
        )}
      </div>
      <div className="border-t border-border/30">
        <DropdownMenuItem onClick={onManage} className="text-primary">
          {isKo ? "서비스 관리" : isZh ? "管理服务商" : "Manage services"}
        </DropdownMenuItem>
      </div>
    </DropdownMenuContent>
  );
}
