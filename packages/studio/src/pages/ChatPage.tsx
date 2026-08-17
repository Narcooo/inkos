import { useRef, useEffect, useMemo, useState } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import type { SSEMessage } from "../hooks/use-sse";
import { fetchJson, postApi, useApi } from "../hooks/use-api";
import type { ChatAttachmentPayload } from "../store/chat/types";
import { chatSelectors, useChatStore } from "../store/chat";
import type { ChatSessionKind } from "../store/chat";
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
import { ToolExecutionSteps, type ProposedActionDetails } from "../components/chat/ToolExecutionSteps";
import {
  buildNarrativeForecastRecheckInstruction,
  buildNarrativeForecastSelectionInstruction,
} from "../components/chat/NarrativeForecastPreview";
import { ProjectArtifactDrawer } from "../components/chat/ProjectArtifactDrawer";
import { PlayHud } from "../components/chat/PlayHud";
import { PlayChoicePanel } from "../components/chat/PlayChoicePanel";
import { latestPlayChoiceSet } from "../components/chat/play-choices";
import {
  BotMessageSquare,
  ArrowUp,
  ChevronDown,
  Check,
  FolderUp,
  X,
  Paperclip,
  Gamepad2,
  Palette,
  RotateCcw,
  Square,
  Plus,
} from "lucide-react";
import { Shimmer } from "../components/ai-elements/shimmer";
import {
  Message,
  MessageContent,
} from "../components/ai-elements/message";
import {
  type ChatPageModelPreference,
  filterModelGroups,
  getChatScrollBehavior,
  getBookCreateSessionId,
  getProjectChatSessionId,
  pickProjectChatSessionId,
  pickModelSelection,
  setBookCreateSessionId,
  setProjectChatSessionId,
  isChatScrollNearBottom,
  shouldShowPlayChoicePanel,
} from "./chat-page-state";
import {
  serializeSkillFolder,
  selectedSkillIdsForSend,
  toggleSelectedSkillIds,
  type StudioSkill,
} from "./skill-ui-state";

// -- Types --

interface Nav {
  toDashboard: () => void;
  toBook: (id: string) => void;
  toServices: () => void;
  toFilm: (projectId: string) => void;
  toFilmStudio: (projectId: string) => void;
}

export interface ChatPageProps {
  readonly activeBookId?: string;
  readonly mode?: "book" | "book-create" | "project-chat" | "interactive-film-authoring";
  readonly nav: Nav;
  readonly theme: Theme;
  readonly t: TFunction;
  readonly sse: { messages: ReadonlyArray<SSEMessage>; connected: boolean };
}

interface ServiceConfigPayload {
  readonly service?: string | null;
  readonly defaultModel?: string | null;
}

interface PlayImageSettings {
  readonly actors: boolean;
  readonly moments: boolean;
  readonly inventory: boolean;
}

interface PlayRunImagePayload {
  readonly imageSettings?: PlayImageSettings;
}

interface CoverConfigResponse {
  readonly service?: string | null;
  readonly configured?: boolean;
  readonly providers?: ReadonlyArray<{ readonly service: string; readonly connected?: boolean }>;
}

const MAX_CHAT_ATTACHMENTS = 8;
const MAX_CHAT_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const CHAT_ATTACHMENT_ACCEPT = [
  "image/*",
  "text/plain",
  "text/markdown",
  "application/json",
  "text/csv",
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".csv",
  ".tsv",
  ".yaml",
  ".yml",
  ".log",
  ".pdf",
].join(",");

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

async function serializeChatAttachments(files: ReadonlyArray<File>): Promise<ChatAttachmentPayload[]> {
  return Promise.all(files.map(async (file) => ({
    id: `${file.name}-${file.size}-${file.lastModified}`,
    filename: file.name,
    mediaType: file.type || "application/octet-stream",
    size: file.size,
    dataUrl: await fileToDataUrl(file),
  })));
}

function formatFileSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${size} B`;
}

interface SkillsResponse {
  readonly skills: ReadonlyArray<StudioSkill>;
  readonly diagnostics?: ReadonlyArray<{ readonly path?: string; readonly message?: string }>;
}

type ScrollFrameId = number | ReturnType<typeof setTimeout>;

function requestScrollFrame(callback: () => void): ScrollFrameId {
  if (typeof globalThis.requestAnimationFrame === "function") {
    return globalThis.requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(callback, 16);
}

function cancelScrollFrame(id: ScrollFrameId): void {
  if (typeof id === "number" && typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(id);
    return;
  }
  globalThis.clearTimeout(id);
}

function SkillPickerPanel({
  isZh,
  skills,
  diagnostics,
  selectedSkillIds,
  loading,
  error,
  saving,
  createError,
  onToggleSkill,
  onImport,
}: {
  readonly isZh: boolean;
  readonly skills: ReadonlyArray<StudioSkill>;
  readonly diagnostics?: ReadonlyArray<{ readonly path?: string; readonly message?: string }>;
  readonly selectedSkillIds: ReadonlyArray<string>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly saving: boolean;
  readonly createError: string | null;
  readonly onToggleSkill: (skillId: string) => void;
  readonly onImport: (files: FileList) => void;
}) {
  const selected = new Set(selectedSkillIds);
  const folderInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="absolute bottom-[calc(100%+10px)] left-0 z-40 w-full overflow-hidden rounded-2xl border border-border/60 bg-card/95 shadow-2xl backdrop-blur">
      <div className="border-b border-border/40 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold">{isZh ? "选择 Agent Skill" : "Select Agent Skills"}</div>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              {isZh
                ? "Agent 会按当前意图自主调用；点选 Skill 可强制它随下一条消息启用。"
                : "The agent can choose a skill from your intent; selecting one forces it for the next message."}
            </p>
          </div>
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg border border-border/50 px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
            >
              <FolderUp size={13} />
              {isZh ? "导入" : "Import"}
            </button>
            <input
              ref={folderInputRef}
              type="file"
              multiple
              className="hidden"
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              onChange={(event) => {
                if (event.currentTarget.files?.length) onImport(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
          </div>
        </div>
      </div>
      <div className="max-h-[380px] overflow-y-auto p-3">
        {createError ? <div className="mb-3 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{createError}</div> : null}
        {diagnostics?.length ? (
          <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <div className="font-semibold">{isZh ? "部分外部 Skill 未加载" : "Some external skills were not loaded"}</div>
            {diagnostics.slice(0, 4).map((item, index) => (
              <div key={`${item.path ?? "skill"}-${index}`} className="mt-1 break-all">
                {item.path ? `${item.path}: ` : ""}{item.message ?? (isZh ? "格式无效" : "Invalid format")}
              </div>
            ))}
          </div>
        ) : null}
        {loading ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">{isZh ? "加载 Skill..." : "Loading skills..."}</div>
        ) : error ? (
          <div className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
        ) : skills.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">{isZh ? "还没有可用 Skill。" : "No skills available yet."}</div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {skills.map((skill) => {
              const checked = selected.has(skill.id);
              return (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => onToggleSkill(skill.id)}
                  className={`rounded-xl border p-3 text-left transition-all ${checked ? "border-primary/60 bg-primary/10" : "border-border/50 bg-secondary/20 hover:border-primary/30 hover:bg-secondary/35"}`}
                >
                  <div className="flex items-start gap-2">
                    <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-border text-transparent"}`}>
                      <Check size={13} strokeWidth={3} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-semibold">{skill.name}</div>
                        <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {skill.source ?? "skill"}
                        </span>
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground/70">@{skill.id}</div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{skill.description}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}

// -- Component --

export function ChatPage({ activeBookId, mode = activeBookId ? "book" : "book-create", nav, theme, t, sse: _sse }: ChatPageProps) {
  // -- Store selectors --
  const messages = useChatStore(chatSelectors.activeMessages);
  const activeSession = useChatStore(chatSelectors.activeSession);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const input = useChatStore((s) => s.input);
  const loading = useChatStore(chatSelectors.isActiveSessionStreaming);
  const chatStreaming = useChatStore(chatSelectors.isActiveSessionChatStreaming);
  const lastFailedSend = useChatStore(chatSelectors.activeSessionLastFailedSend);
  const selectedModel = useChatStore((s) => s.selectedModel);
  const selectedService = useChatStore((s) => s.selectedService);
  // -- Store actions --
  const setInput = useChatStore((s) => s.setInput);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const retryLastSend = useChatStore((s) => s.retryLastSend);
  const abortSession = useChatStore((s) => s.abortSession);
  const setSelectedModel = useChatStore((s) => s.setSelectedModel);
  const loadSessionList = useChatStore((s) => s.loadSessionList);
  const createSession = useChatStore((s) => s.createSession);
  const markProposalResolved = useChatStore((s) => s.markProposalResolved);
  const loadSessionDetail = useChatStore((s) => s.loadSessionDetail);
  const activateSession = useChatStore((s) => s.activateSession);
  const setSessionPlayMode = useChatStore((s) => s.setSessionPlayMode);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<ScrollFrameId | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoScrollPinnedRef = useRef(true);

  const isZh = t("nav.connected") === "\u5DF2\u8FDE\u63A5";
  const hasBook = Boolean(activeBookId);
  const currentSessionKind: ChatSessionKind = activeSession?.sessionKind
    ?? (mode === "interactive-film-authoring" ? "interactive-film-authoring"
      : mode === "book-create" ? "book-create"
      : activeBookId ? "book" : "chat");
  const playMode = activeSession?.playMode;
  // A play session must pick its playstyle (点着玩 / 自由玩) before chatting.
  const needsPlayModeChoice = currentSessionKind === "play" && !playMode;
  // Even in 点着玩 the world is shaped by free typing first; the choice panel
  // only replaces the input once play has actually started (a play tool
  // produced choices).
  const playChoiceSet = useMemo(
    () => (currentSessionKind === "play" && playMode === "guided" ? latestPlayChoiceSet(messages) : null),
    [currentSessionKind, playMode, messages],
  );
  const [consumedPlayChoiceKey, setConsumedPlayChoiceKey] = useState<string | null>(null);
  const playChoices = playChoiceSet?.choices ?? [];
  const showChoicePanel = shouldShowPlayChoicePanel({
    playMode,
    choiceSetKey: playChoiceSet?.key ?? null,
    consumedChoiceKey: consumedPlayChoiceKey,
    choiceCount: playChoices.length,
  });
  // World panel (holdings / state / relations) defaults collapsed; the scene
  // image and choices live in the chat center now, opened on demand.
  const [worldPanelOpen, setWorldPanelOpen] = useState(false);
  const [playImageError, setPlayImageError] = useState<string | null>(null);
  const [playImageMenuOpen, setPlayImageMenuOpen] = useState(false);
  const [playImageSettings, setPlayImageSettings] = useState<PlayImageSettings>({ actors: false, moments: false, inventory: false });
  const [playImageCoverReady, setPlayImageCoverReady] = useState(false);
  const [skillPanelOpen, setSkillPanelOpen] = useState(false);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [skillSaving, setSkillSaving] = useState(false);
  const [skillCreateError, setSkillCreateError] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const { data: skillsData, loading: skillsLoading, error: skillsError, refetch: refetchSkills } = useApi<SkillsResponse>("/skills");
  const worldPanelInsetClass = currentSessionKind === "play" && worldPanelOpen ? "lg:pr-[380px]" : "";
  const availableSkills = skillsData?.skills ?? [];
  const selectedSkills = useMemo(
    () => selectedSkillIds
      .map((id) => availableSkills.find((skill) => skill.id === id))
      .filter((skill): skill is StudioSkill => Boolean(skill)),
    [availableSkills, selectedSkillIds],
  );

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
  const fetchCustomModels = useServiceStore((s) => s.fetchCustomModels);
  const [configuredModelSelection, setConfiguredModelSelection] = useState<ChatPageModelPreference | null>(null);
  const [serviceConfigLoaded, setServiceConfigLoaded] = useState(false);

  useEffect(() => { void fetchServices(); }, [fetchServices]);
  useEffect(() => {
    void fetchBankModels();
    void fetchCustomModels();
  }, [fetchBankModels, fetchCustomModels]);
  useEffect(() => {
    let cancelled = false;

    void fetchJson<ServiceConfigPayload>("/services/config")
      .then((payload) => {
        if (cancelled) return;
        setConfiguredModelSelection({
          service: payload.service ?? null,
          model: payload.defaultModel ?? null,
        });
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
  }, []);

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
    if (!selectedModel) return isZh ? "选择模型" : "Select model";
    const group = groupedModels.find((item) => item.service === selectedService);
    const model = group?.models.find((item) => item.id === selectedModel);
    const modelLabel = model?.name ?? selectedModel;
    return group ? `${group.label} · ${modelLabel}` : modelLabel;
  }, [groupedModels, selectedModel, selectedService, isZh]);

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

  // Auto-scroll only while the reader is already near the bottom. Streaming
  // updates use instant scroll to avoid piling up smooth-scroll animations.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    if (!autoScrollPinnedRef.current) return undefined;

    if (scrollFrameRef.current !== null) {
      cancelScrollFrame(scrollFrameRef.current);
    }

    scrollFrameRef.current = requestScrollFrame(() => {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: getChatScrollBehavior(loading || isStreaming),
      });
      scrollFrameRef.current = null;
    });

    return () => {
      if (scrollFrameRef.current !== null) {
        cancelScrollFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [messages, loading, isStreaming]);

  useEffect(() => {
    autoScrollPinnedRef.current = true;
  }, [activeSessionId]);

  // Entering a book loads its latest session; book-create mode persists its orphan session in localStorage.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!activeBookId && mode === "project-chat") {
        const state = useChatStore.getState();
        const currentSession = state.activeSessionId ? state.sessions[state.activeSessionId] : null;
        if (currentSession?.bookId === null && currentSession.isDraft) {
          return;
        }
      }

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

        await createSession(activeBookId, mode === "interactive-film-authoring" ? "interactive-film-authoring" : "book");
        return;
      }

      const existingId = mode === "project-chat"
        ? getProjectChatSessionId()
        : getBookCreateSessionId();
      if (existingId) {
        await loadSessionDetail(existingId);
        if (cancelled) return;

        const state = useChatStore.getState();
        const session = state.sessions[existingId];
        if (session && session.bookId === null && (mode !== "project-chat" || session.messages.length > 0)) {
          activateSession(existingId);
          return;
        }
      }

      if (mode === "project-chat") {
        const projectSessions = await loadSessionList(null);
        if (cancelled) return;

        const reusableSessionId = pickProjectChatSessionId(projectSessions);
        if (reusableSessionId) {
          activateSession(reusableSessionId);
          await loadSessionDetail(reusableSessionId);
          if (!cancelled) setProjectChatSessionId(reusableSessionId);
          return;
        }
      }

      const newSessionId = await createSession(null, mode === "book-create" ? "book-create" : "chat");
      if (!cancelled) {
        if (mode === "project-chat") {
          setProjectChatSessionId(newSessionId);
        } else {
          setBookCreateSessionId(newSessionId);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeBookId, activateSession, createSession, loadSessionDetail, loadSessionList, mode]);

  const addAttachedFiles = (files: FileList | File[]) => {
    const incoming = Array.from(files);
    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const file of incoming) {
      if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
        rejected.push(`${file.name} > ${formatFileSize(MAX_CHAT_ATTACHMENT_BYTES)}`);
        continue;
      }
      accepted.push(file);
    }
    setAttachedFiles((prev) => [...prev, ...accepted].slice(0, MAX_CHAT_ATTACHMENTS));
    setAttachmentError(rejected.length > 0
      ? (isZh ? `以下文件过大，未添加：${rejected.join("、")}` : `Some files were too large: ${rejected.join(", ")}`)
      : null);
  };

  const onSend = async (text: string) => {
    if (!activeSessionId) return;
    const hasPendingMessage = Boolean(text.trim()) || attachedFiles.length > 0;
    if (!hasPendingMessage) {
      if (chatStreaming || loading) await abortSession(activeSessionId);
      return;
    }
    const requestedSkills = selectedSkillIdsForSend(selectedSkillIds);
    autoScrollPinnedRef.current = true;
    const attachments = await serializeChatAttachments(attachedFiles);
    if (chatStreaming) {
      // Steering by a new user message cancels the current serial workflow.
      await abortSession(activeSessionId);
    }
    await sendMessage(activeSessionId, text, {
      activeBookId,
      sessionKind: currentSessionKind,
      actionSource: "free-text",
      requestedSkills,
      attachments,
    });
    setAttachedFiles([]);
    setAttachmentError(null);
    if (requestedSkills?.length) {
      setSelectedSkillIds([]);
      setSkillPanelOpen(false);
    }
  };

  const importProjectSkill = async (files: FileList) => {
    setSkillSaving(true);
    setSkillCreateError(null);
    try {
      const serialized = await serializeSkillFolder(files);
      const response = await postApi<{ skill: StudioSkill }>("/skills/import", { files: serialized });
      await refetchSkills();
      setSelectedSkillIds((prev) => prev.includes(response.skill.id) ? prev : [...prev, response.skill.id]);
    } catch (error) {
      setSkillCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setSkillSaving(false);
    }
  };

  const handleQuickAction = (command: string, requestedIntent?: "write_next") => {
    if (!activeSessionId) return;
    autoScrollPinnedRef.current = true;
    void sendMessage(activeSessionId, command, {
      activeBookId,
      sessionKind: currentSessionKind,
      actionSource: "quick-action",
      requestedIntent,
    });
  };

  const handleProposedAction = async (details: ProposedActionDetails) => {
    // Lock the proposal card so the production action can't be re-fired.
    markProposalResolved(details.execId, "confirmed");
    const targetPlayMode = details.targetSessionKind === "play"
      ? details.actionPayload?.playStart?.mode ?? activeSession?.playMode ?? (details.action === "play_start" ? "open" : undefined)
      : undefined;
    if (details.sameSession && activeSessionId) {
      autoScrollPinnedRef.current = true;
      await sendMessage(activeSessionId, details.instruction ?? "", {
        activeBookId,
        sessionKind: details.targetSessionKind,
        playMode: targetPlayMode,
        actionSource: "button",
        requestedIntent: details.action,
        actionPayload: details.actionPayload,
        requestedSkills: details.requestedSkills,
      });
      return;
    }
    const targetSessionId = await createSession(null, details.targetSessionKind, targetPlayMode);
    autoScrollPinnedRef.current = true;
    await sendMessage(targetSessionId, details.instruction ?? "", {
      sessionKind: details.targetSessionKind,
      playMode: targetPlayMode,
      actionSource: "button",
      requestedIntent: details.action,
      actionPayload: details.actionPayload,
      requestedSkills: details.requestedSkills,
    });
  };

  const handleRejectProposedAction = async (details: ProposedActionDetails) => {
    markProposalResolved(details.execId, "rejected");
    if (!activeSessionId) return;
    autoScrollPinnedRef.current = true;
    const rejectionText = isZh
      ? `取消这次操作：${details.title ?? details.instruction}`
      : `Cancel this action: ${details.title ?? details.instruction}`;
    await sendMessage(activeSessionId, rejectionText, {
      activeBookId,
      sessionKind: currentSessionKind,
      actionSource: "button",
    });
  };

  const handleSelectNarrativeBranch = async (forecastId: string, branchId: string) => {
    if (!activeSessionId || !activeBookId) return;
    autoScrollPinnedRef.current = true;
    await sendMessage(
      activeSessionId,
      buildNarrativeForecastSelectionInstruction(forecastId, branchId, isZh ? "zh" : "en"),
      {
        activeBookId,
        sessionKind: "book",
        actionSource: "button",
      },
    );
  };

  const handleRecheckNarrativeForecast = async (forecastId: string) => {
    if (!activeSessionId || !activeBookId) return;
    autoScrollPinnedRef.current = true;
    await sendMessage(
      activeSessionId,
      buildNarrativeForecastRecheckInstruction(forecastId, isZh ? "zh" : "en"),
      {
        activeBookId,
        sessionKind: "book",
        actionSource: "button",
      },
    );
  };

  useEffect(() => { setPlayImageError(null); }, [activeSessionId]);

  useEffect(() => {
    if (!activeSessionId || currentSessionKind !== "play") return;
    let cancelled = false;
    void fetchJson<PlayRunImagePayload>(`/play/runs/${encodeURIComponent(activeSessionId)}/main`)
      .then((payload) => {
        if (!cancelled && payload.imageSettings) setPlayImageSettings(payload.imageSettings);
      })
      .catch(() => {
        // No persisted play world yet.
      });
    void fetchJson<CoverConfigResponse>("/cover/config")
      .then((cfg) => {
        if (cancelled) return;
        const selected = cfg.service ?? null;
        setPlayImageCoverReady(
          cfg.configured ?? (!!selected && (cfg.providers ?? []).some((p) => p.service === selected && p.connected)),
        );
      })
      .catch(() => {
        if (!cancelled) setPlayImageCoverReady(false);
      });
    return () => { cancelled = true; };
  }, [activeSessionId, currentSessionKind]);

  const togglePlayImageSetting = async (key: keyof PlayImageSettings) => {
    if (!activeSessionId || currentSessionKind !== "play" || !playImageCoverReady) return;
    const next = { ...playImageSettings, [key]: !playImageSettings[key] };
    setPlayImageSettings(next);
    setPlayImageError(null);
    try {
      await fetchJson(`/play/runs/${encodeURIComponent(activeSessionId)}/main/image-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
    } catch (error) {
      setPlayImageSettings(playImageSettings);
      setPlayImageError(error instanceof Error ? error.message : String(error));
    }
  };

  const emptyGuidance = (() => {
    if (currentSessionKind === "short") {
      return isZh
        ? "说一个短篇方向、标题灵感、人物压力或核心冲突，我会走 InkOS Short 生成正文、简介和封面。"
        : "Describe a short-fiction direction, title hook, pressure, or core conflict to run InkOS Short.";
    }
    if (currentSessionKind === "play") {
      return isZh
        ? "说一个可玩的世界、角色处境或开场动作，我会启动互动世界；之后你可以自由行动或点建议动作。"
        : "Describe a playable world, character situation, or opening action to start an interactive world.";
    }
    return isZh
      ? "\u544A\u8BC9\u6211\u4F60\u60F3\u5199\u4EC0\u4E48\u2014\u2014\u9898\u6750\u3001\u4E16\u754C\u89C2\u3001\u4E3B\u89D2\u3001\u6838\u5FC3\u51B2\u7A81"
      : "Tell me what you want to write \u2014 genre, world, protagonist, core conflict";
  })();

  return (
    <div className="flex flex-col h-full flex-1 min-w-0 relative">
      {/* Message scroll area */}
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const target = event.currentTarget;
          autoScrollPinnedRef.current = isChatScrollNearBottom({
            scrollTop: target.scrollTop,
            clientHeight: target.clientHeight,
            scrollHeight: target.scrollHeight,
          });
        }}
        className={`chat-message-scroll flex-1 overflow-y-auto [scrollbar-gutter:stable] px-4 py-6 transition-[padding] duration-200 ${worldPanelInsetClass}`}
      >
        {needsPlayModeChoice ? (
          <div className="h-full flex flex-col items-center justify-center text-center select-none gap-4">
            <div className="w-14 h-14 rounded-2xl border border-dashed border-border flex items-center justify-center bg-secondary/30 opacity-40">
              <Gamepad2 size={24} className="text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground/70 max-w-md leading-7">
              {isZh ? "选个玩法，进去再聊你想玩的世界。" : "Pick a playstyle, then describe the world you want in chat."}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { if (activeSessionId) setSessionPlayMode(activeSessionId, "guided"); }}
                className="w-40 rounded-xl border border-border/50 bg-secondary/30 px-4 py-3 text-left transition-all hover:border-primary/40 hover:bg-primary/5"
              >
                <div className="text-sm font-medium text-foreground">{isZh ? "点着玩" : "Choices"}</div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">{isZh ? "GM 给选项，点着推进" : "Pick from offered actions"}</div>
              </button>
              <button
                type="button"
                onClick={() => { if (activeSessionId) setSessionPlayMode(activeSessionId, "open"); }}
                className="w-40 rounded-xl border border-border/50 bg-secondary/30 px-4 py-3 text-left transition-all hover:border-primary/40 hover:bg-primary/5"
              >
                <div className="text-sm font-medium text-foreground">{isZh ? "自由玩" : "Free"}</div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">{isZh ? "自己打字，想干嘛干嘛" : "Type anything you want"}</div>
              </button>
            </div>
          </div>
        ) : messages.length === 0 && !loading ? (
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
                              <Reasoning defaultOpen={false} isStreaming={item.part.streaming}>
                                <ReasoningTrigger />
                                <ReasoningContent>{item.part.content}</ReasoningContent>
                              </Reasoning>
                            </div>
                          );
                        }
                        if (item.kind === "tools") {
                          return (
                            <ToolExecutionSteps
                              key={`x-${item.startIdx}`}
                              executions={item.parts.map(p => p.execution)}
                              onProposedAction={handleProposedAction}
                              onRejectProposedAction={handleRejectProposedAction}
                              onOpenFilmStudio={nav.toFilmStudio}
                              onSelectNarrativeBranch={handleSelectNarrativeBranch}
                              onRecheckNarrativeForecast={handleRecheckNarrativeForecast}
                            />
                          );
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
                    {isZh ? "思考中..." : "Thinking..."}
                  </Shimmer>
                </MessageContent>
              </Message>
            )}

          </div>
        )}
      </div>

      {/* Quick actions (only when a book is active) */}
      {hasBook && !showChoicePanel && (
        <div className={`shrink-0 transition-[padding] duration-200 ${worldPanelInsetClass}`}>
          <div className="max-w-3xl mx-auto w-full px-4">
            <QuickActions
              onAction={handleQuickAction}
              disabled={loading || !activeSessionId}
              isZh={isZh}
            />
          </div>
        </div>
      )}

      {/* Play choices are shortcuts, not a replacement for free actions. Scene
          images render inside their corresponding chat result card so the
          visual history scrolls with the conversation. */}
      {currentSessionKind === "play" && !needsPlayModeChoice && showChoicePanel && (
        <div className={`shrink-0 transition-[padding] duration-200 ${worldPanelInsetClass}`}>
          <PlayChoicePanel
            choices={playChoices}
            disabled={loading || !activeSessionId}
            isZh={isZh}
            onChoose={(action) => {
              if (!activeSessionId || !playChoiceSet) return;
              setConsumedPlayChoiceKey(playChoiceSet.key);
              autoScrollPinnedRef.current = true;
              void sendMessage(activeSessionId, action, { activeBookId, sessionKind: "play", actionSource: "button" });
            }}
          />
        </div>
      )}
      {/* 重试上一条失败的聊天消息（issue #335）：只针对聊天轮失败；
          后台生产任务的失败由任务卡自己展示，不在这里出现。 */}
      {lastFailedSend && !chatStreaming && activeSessionId ? (
        <div className={`shrink-0 transition-[padding] duration-200 ${worldPanelInsetClass}`}>
          <div className="max-w-3xl mx-auto w-full px-4 pb-2">
            <button
              type="button"
              onClick={() => {
                autoScrollPinnedRef.current = true;
                void retryLastSend(activeSessionId);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-secondary/30 px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              <RotateCcw size={14} />
              {isZh ? "重试上一条消息" : "Retry last message"}
            </button>
          </div>
        </div>
      ) : null}
      {needsPlayModeChoice ? null : (
      <div className={`shrink-0 border-t border-border/40 px-4 py-3 transition-[padding] duration-200 ${worldPanelInsetClass}`}>
        <div className="max-w-3xl mx-auto">
          <div className="flex items-start gap-2">
            <div className="relative flex-1 rounded-xl bg-secondary/30 transition-all">
              {skillPanelOpen ? (
                <SkillPickerPanel
                  isZh={isZh}
                  skills={availableSkills}
                  diagnostics={skillsData?.diagnostics}
                  selectedSkillIds={selectedSkillIds}
                  loading={skillsLoading}
                  error={skillsError}
                  saving={skillSaving}
                  createError={skillCreateError}
                  onToggleSkill={(skillId) => setSelectedSkillIds((prev) => toggleSelectedSkillIds(prev, skillId))}
                  onImport={(files) => void importProjectSkill(files)}
                />
              ) : null}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={CHAT_ATTACHMENT_ACCEPT}
                className="hidden"
                onChange={(event) => {
                  if (event.currentTarget.files) addAttachedFiles(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
              />
              {selectedSkills.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 border-b border-border/20 px-3 py-2">
                  {selectedSkills.map((skill) => (
                    <span
                      key={skill.id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                    >
                      {skill.name}
                      <button
                        type="button"
                        onClick={() => setSelectedSkillIds((prev) => prev.filter((id) => id !== skill.id))}
                        className="rounded-full p-0.5 hover:bg-primary/20"
                        aria-label={isZh ? `移除 ${skill.name}` : `Remove ${skill.name}`}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              {attachedFiles.length > 0 || attachmentError ? (
                <div className="border-b border-border/20 px-3 py-2">
                  {attachedFiles.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {attachedFiles.map((file) => (
                        <span
                          key={`${file.name}-${file.size}-${file.lastModified}`}
                          className="inline-flex max-w-[220px] items-center gap-1.5 rounded-full border border-border/50 bg-secondary/60 px-2.5 py-1 text-xs text-muted-foreground"
                          title={`${file.name} · ${file.type || "application/octet-stream"} · ${formatFileSize(file.size)}`}
                        >
                          <Paperclip size={12} />
                          <span className="truncate">{file.name}</span>
                          <button
                            type="button"
                            onClick={() => setAttachedFiles((prev) => prev.filter((item) => item !== file))}
                            className="rounded-full p-0.5 hover:bg-muted"
                            aria-label={isZh ? `移除 ${file.name}` : `Remove ${file.name}`}
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {attachmentError ? (
                    <div className="mt-1 text-xs leading-5 text-destructive">{attachmentError}</div>
                  ) : null}
                </div>
              ) : null}
              <div className="flex items-center gap-2 px-3 py-2">
                <button
                  type="button"
                  onClick={() => setSkillPanelOpen((value) => !value)}
                  disabled={loading || !activeSessionId}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/50 transition-colors disabled:opacity-30 ${skillPanelOpen || selectedSkillIds.length > 0 ? "bg-primary/10 text-primary" : "text-muted-foreground hover:border-primary/40 hover:text-primary"}`}
                  title={isZh ? "添加 Skill" : "Add skill"}
                  aria-label={isZh ? "添加 Skill" : "Add skill"}
                >
                  <Plus size={16} strokeWidth={2.4} />
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!activeSessionId}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/50 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-30"
                  title={isZh ? "上传图片或资料" : "Attach files"}
                  aria-label={isZh ? "上传图片或资料" : "Attach files"}
                >
                  <Paperclip size={16} strokeWidth={2.3} />
                </button>
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void onSend(input); } }}
                  placeholder={isZh ? "输入指令..." : "Enter command..."}
                  disabled={!activeSessionId}
                  rows={1}
                  className="flex-1 bg-transparent text-base leading-7 placeholder:text-muted-foreground/50 outline-none! border-none! ring-0! shadow-none focus:outline-none! focus:ring-0! focus:border-none! resize-none disabled:opacity-50 max-h-[200px] overflow-y-auto"
                />
                <button
                  type="button"
                  onClick={() => void onSend(input)}
                  disabled={(!input.trim() && attachedFiles.length === 0 && !loading) || !activeSessionId}
                  className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shrink-0 hover:scale-105 active:scale-95 transition-all disabled:opacity-20 disabled:scale-100 shadow-sm shadow-primary/20"
                  title={loading && !input.trim() && attachedFiles.length === 0 ? (isZh ? "停止当前回复" : "Stop") : undefined}
                >
                  {loading && !input.trim() && attachedFiles.length === 0
                    ? <Square size={13} fill="currentColor" />
                    : <ArrowUp size={14} strokeWidth={2.5} />}
                </button>
              </div>
              <div className="flex items-center gap-2 px-3 pb-2 border-t border-border/20 pt-1.5">
                {modelPickerStatus === "loading" ? (
                  <span className="text-[15px] text-muted-foreground/40 animate-pulse">{isZh ? "加载模型..." : "Loading models..."}</span>
                ) : modelPickerStatus === "ready" ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-muted text-[16px] transition-colors cursor-pointer">
                      <span className="font-medium truncate max-w-[260px]">
                        {selectedModelLabel}
                      </span>
                      <ChevronDown size={17} className="text-muted-foreground" />
                    </DropdownMenuTrigger>
                    <ModelPickerContent
                      groupedModels={groupedModels}
                      selectedModel={selectedModel}
                      selectedService={selectedService}
                      onSelect={setSelectedModel}
                      onManage={() => nav.toServices()}
                    />
                  </DropdownMenu>
                ) : (
                  <button
                    onClick={() => nav.toServices()}
                    className="text-[15px] text-muted-foreground/50 hover:text-primary transition-colors"
                  >
                    {isZh ? "配置模型 →" : "Set up models →"}
                  </button>
                )}
                {currentSessionKind === "play" && (
                  <button
                    type="button"
                    onClick={() => setWorldPanelOpen((v) => !v)}
                    className={`ml-auto flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[16px] font-medium transition-colors ${worldPanelOpen ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted hover:text-primary"}`}
                    title={isZh ? "查看世界：持有 / 状态 / 关系" : "View world: holdings / state / relations"}
                  >
                    <Gamepad2 size={18} />
                    {isZh ? "查看世界" : "View World"}
                  </button>
                )}
              </div>
            </div>
            {currentSessionKind === "play" ? (
              <div className="relative mt-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setPlayImageMenuOpen((value) => !value)}
                  disabled={loading || !activeSessionId}
                  title={isZh ? "自动配图" : "Auto illustration"}
                  className={`flex h-10 w-10 items-center justify-center rounded-xl border border-border/50 bg-secondary/40 shadow-sm transition-all hover:border-primary/50 hover:bg-primary/10 hover:text-primary active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 ${playImageMenuOpen || playImageSettings.actors || playImageSettings.moments || playImageSettings.inventory ? "text-primary" : "text-muted-foreground"}`}
                  aria-label={isZh ? "自动配图" : "Auto illustration"}
                >
                  <Palette size={17} />
                </button>
                {playImageMenuOpen ? (
                  <div className="absolute bottom-12 right-0 z-30 w-44 rounded-xl border border-border/50 bg-card/95 p-2 shadow-xl backdrop-blur">
                    <div className="mb-1.5 px-1 text-[12px] leading-5 font-semibold uppercase tracking-wider text-muted-foreground/60">
                      {isZh ? "自动配图" : "Auto illustration"}
                    </div>
                    {(["actors", "moments", "inventory"] as const).map((key) => (
                      <label
                        key={key}
                        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[14px] leading-6 ${playImageCoverReady ? "cursor-pointer text-foreground hover:bg-secondary/50" : "cursor-not-allowed text-muted-foreground/40"}`}
                        title={playImageCoverReady ? undefined : (isZh ? "先在「模型配置」里配好生图 API 才能开启" : "Configure an image API in Model Settings first")}
                      >
                        <input
                          type="checkbox"
                          disabled={!playImageCoverReady}
                          checked={playImageCoverReady && playImageSettings[key]}
                          onChange={() => void togglePlayImageSetting(key)}
                          className="h-4 w-4 accent-primary"
                        />
                        {key === "actors"
                          ? (isZh ? "为角色配图" : "Characters")
                          : key === "moments"
                            ? (isZh ? "为时刻配图" : "Moments")
                            : (isZh ? "为背包配图" : "Inventory")}
                      </label>
                    ))}
                    {!playImageCoverReady ? (
                      <p className="mt-1 px-1 text-[12px] leading-5 text-muted-foreground/50">
                        {isZh ? "未检测到生图 API。" : "No image API configured."}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          {playImageError ? (
            <p className="mt-2 text-right text-[13px] leading-5 text-destructive/80">
              {isZh ? `配图失败：${playImageError}` : `Image failed: ${playImageError}`}
            </p>
          ) : null}
        </div>
      </div>
      )}

      {currentSessionKind === "play" && activeSessionId && (
        <PlayHud
          sessionId={activeSessionId}
          isStreaming={loading}
          isZh={isZh}
          open={worldPanelOpen}
          onClose={() => setWorldPanelOpen(false)}
          imageSettings={playImageSettings}
          sessionTitle={activeSession?.title ?? null}
        />
      )}
      <ProjectArtifactDrawer />
    </div>
  );
}

function ModelPickerContent({
  groupedModels,
  selectedModel,
  selectedService,
  onSelect,
  onManage,
}: {
  groupedModels: ReadonlyArray<{ service: string; label: string; models: ReadonlyArray<{ id: string; name?: string }> }>;
  selectedModel: string | null;
  selectedService: string | null;
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
          placeholder="搜索模型..."
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
            无匹配模型
          </div>
        )}
      </div>
      <div className="border-t border-border/30">
        <DropdownMenuItem onClick={onManage} className="text-primary">
          管理服务商
        </DropdownMenuItem>
      </div>
    </DropdownMenuContent>
  );
}
