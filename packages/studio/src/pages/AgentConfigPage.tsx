import { useState, useEffect, useMemo, useCallback } from "react";
import { useApi, putApi } from "../hooks/use-api";
import { useServiceStore } from "../store/service";
import type { TFunction } from "../hooks/use-i18n";
import { ALL_AGENTS, AGENT_CATEGORIES, CATEGORY_ORDER } from "../constants/agents";
import { Brain, Loader2, Save, CheckCircle2, AlertCircle, MessageSquare } from "lucide-react";

type AgentOverrideValue = string | {
  model: string;
  provider?: "anthropic" | "openai" | "custom";
  baseUrl?: string;
  apiKeyEnv?: string;
  stream?: boolean;
};

interface Nav {
  toServices: () => void;
  toAgentPromptDetail: (agentKey: string) => void;
}

interface AgentState {
  useDefault: boolean;
  value: string;
}

export function AgentConfigPage({ nav, t }: { nav: Nav; t: TFunction }) {
  // -- Fetch existing overrides --
  const { data, loading: overridesLoading, refetch } = useApi<{
    overrides: Record<string, AgentOverrideValue>;
  }>("/project/model-overrides");

  // 读取 prompt 覆盖状态（用于显示覆盖指示）
  const { data: promptData } = useApi<{
    overrides: Record<string, { mode: string; content: string }>;
  }>("/project/prompt-overrides");

  // -- Get available models from service store --
  const services = useServiceStore((s) => s.services);
  const modelsByService = useServiceStore((s) => s.modelsByService);
  const fetchServices = useServiceStore((s) => s.fetchServices);
  const fetchBankModels = useServiceStore((s) => s.fetchBankModels);
  const fetchCustomModels = useServiceStore((s) => s.fetchCustomModels);

  useEffect(() => { void fetchServices(); }, [fetchServices]);
  useEffect(() => { void fetchBankModels(); }, [fetchBankModels]);
  useEffect(() => { void fetchCustomModels(); }, [fetchCustomModels]);

  // Flatten all available models
  const allAvailableModels = useMemo(() => {
    const models = new Map<string, string>();
    for (const svc of services) {
      if (!svc.connected) continue;
      const svcModels = modelsByService[svc.service] ?? [];
      for (const m of svcModels) {
        if (!models.has(m.id)) {
          models.set(m.id, svc.label);
        }
      }
    }
    return Array.from(models.entries()).map(([id, sourceLabel]) => ({ id, sourceLabel }));
  }, [services, modelsByService]);

  // -- Local state --
  const [agentStates, setAgentStates] = useState<Map<string, AgentState>>(new Map());
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!data || initialized) return;
    const map = new Map<string, AgentState>();
    for (const agent of ALL_AGENTS) {
      const existing = data.overrides[agent.key];
      if (existing) {
        const model = typeof existing === "string" ? existing : existing.model;
        map.set(agent.key, { useDefault: false, value: model });
      } else {
        map.set(agent.key, { useDefault: true, value: "" });
      }
    }
    setAgentStates(map);
    setInitialized(true);
  }, [data, initialized]);

  // -- Save --
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"success" | "error" | null>(null);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveStatus(null);
    try {
      const overrides: Record<string, AgentOverrideValue> = {};
      for (const [key, state] of agentStates) {
        if (!state.useDefault && state.value.trim()) {
          overrides[key] = state.value.trim();
        }
      }
      await putApi("/project/model-overrides", { overrides });
      setSaveStatus("success");
      refetch();
    } catch {
      setSaveStatus("error");
    } finally {
      setSaving(false);
    }
  }, [agentStates, refetch]);

  const updateAgent = useCallback((agentKey: string, updater: (prev: AgentState) => AgentState) => {
    setAgentStates((prev) => {
      const next = new Map(prev);
      const current = next.get(agentKey);
      if (current) {
        next.set(agentKey, updater(current));
      }
      return next;
    });
  }, []);

  // Group agents by category
  const grouped = useMemo(() => {
    const groups: Record<string, ReadonlyArray<typeof ALL_AGENTS[number]>> = {};
    for (const agent of ALL_AGENTS) {
      const existing = groups[agent.category] ?? [];
      groups[agent.category] = [...existing, agent];
    }
    return groups;
  }, []);

  const overrideCount = useMemo(() => {
    let count = 0;
    for (const state of agentStates.values()) {
      if (!state.useDefault && state.value.trim()) count++;
    }
    return count;
  }, [agentStates]);

  if (overridesLoading || !initialized) {
    return <AgentConfigSkeleton />;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="font-serif text-2xl flex items-center gap-3">
          <Brain size={24} className="text-primary" />
          {t("agentConfig.title")}
        </h1>
        <p className="text-sm text-muted-foreground/70">
          {t("agentConfig.subtitle")}
          {overrideCount > 0 && (
            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              {overrideCount} 个已覆盖
            </span>
          )}
        </p>
      </div>

      {/* Categories */}
      {CATEGORY_ORDER.map((category) => {
        const agents = grouped[category];
        if (!agents) return null;
        return (
          <div key={category} className="space-y-2">
            <h2 className="text-[11px] uppercase tracking-widest text-muted-foreground font-bold">
              {AGENT_CATEGORIES[category].zh}
            </h2>
            <div className="space-y-2">
              {agents.map((agent) => {
                const state = agentStates.get(agent.key);
                if (!state) return null;
                return (
                  <AgentRow
                    key={agent.key}
                    agent={agent}
                    state={state}
                    availableModels={allAvailableModels}
                    onUpdate={(updater) => updateAgent(agent.key, updater)}
                    t={t}
                    hasPromptOverride={!!promptData?.overrides[agent.key]}
                    onEdit={() => nav.toAgentPromptDetail(agent.key)}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Save bar */}
      <div className="sticky bottom-4 flex items-center justify-between rounded-xl border border-border/40 bg-card/90 backdrop-blur-sm px-4 py-3 shadow-lg">
        <div className="text-sm flex items-center gap-2">
          {saveStatus === "success" && (
            <span className="flex items-center gap-1.5 text-emerald-500">
              <CheckCircle2 size={14} />{t("agentConfig.saveSuccess")}
            </span>
          )}
          {saveStatus === "error" && (
            <span className="flex items-center gap-1.5 text-destructive">
              <AlertCircle size={14} />{t("agentConfig.saveError")}
            </span>
          )}
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          <Save size={14} />
          保存
        </button>
      </div>
    </div>
  );
}

function AgentRow({ agent, state, availableModels, onUpdate, t, hasPromptOverride, onEdit }: {
  agent: { key: string; labelZh: string; descriptionZh: string };
  state: AgentState;
  availableModels: Array<{ id: string; sourceLabel: string }>;
  onUpdate: (updater: (prev: AgentState) => AgentState) => void;
  t: TFunction;
  hasPromptOverride: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border/40 bg-card/70 px-4 py-3">
      {/* Agent info — 点击编辑提示词 */}
      <button
        onClick={onEdit}
        className="min-w-0 flex-1 flex items-center gap-2 text-left hover:bg-secondary/20 -ml-1 pl-1 pr-1 py-0.5 rounded-lg transition-colors"
        title={t("agentConfig.editPrompt")}
      >
        <span className="font-mono text-sm font-medium">{agent.key}</span>
        <span className="text-xs text-muted-foreground/60">{agent.descriptionZh}</span>
        {hasPromptOverride && (
          <MessageSquare size={12} className="shrink-0 text-primary" />
        )}
      </button>

      {/* Model input */}
      <div className="flex items-center gap-3 shrink-0">
        {availableModels.length > 0 ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={state.useDefault ? "" : state.value}
              onChange={(e) => onUpdate((prev) => ({ ...prev, useDefault: false, value: e.target.value }))}
              placeholder={t("agentConfig.selectModel")}
              disabled={state.useDefault}
              list={`models-${agent.key}`}
              className={`w-48 rounded-lg border border-border/60 bg-background px-3 py-1.5 text-sm font-mono transition-opacity ${
                state.useDefault ? "opacity-50" : ""
              }`}
            />
            <datalist id={`models-${agent.key}`}>
              {availableModels.map((m) => (
                <option key={m.id} value={m.id} />
              ))}
            </datalist>
          </div>
        ) : (
          <input
            type="text"
            value={state.useDefault ? "" : state.value}
            onChange={(e) => onUpdate((prev) => ({ ...prev, useDefault: false, value: e.target.value }))}
            placeholder={t("agentConfig.noModels")}
            disabled={state.useDefault}
            className={`w-48 rounded-lg border border-border/60 bg-background px-3 py-1.5 text-sm font-mono transition-opacity ${
              state.useDefault ? "opacity-50" : ""
            }`}
          />
        )}

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none shrink-0">
          <input
            type="checkbox"
            checked={state.useDefault}
            onChange={(e) => onUpdate((prev) => ({ ...prev, useDefault: e.target.checked }))}
            className="accent-primary"
          />
          {t("agentConfig.useDefault")}
        </label>
      </div>
    </div>
  );
}

function AgentConfigSkeleton() {
  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-pulse">
      <div className="space-y-2">
        <div className="h-7 w-48 bg-muted rounded" />
        <div className="h-4 w-80 bg-muted/60 rounded" />
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <div className="h-3 w-16 bg-muted rounded" />
          <div className="rounded-xl border border-border/40 bg-card/70 px-4 py-3">
            <div className="h-4 w-32 bg-muted rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
