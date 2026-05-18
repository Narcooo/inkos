import { useState, useEffect, useCallback } from "react";
import { useApi, putApi } from "../hooks/use-api";
import { ALL_AGENTS } from "../constants/agents";
import type { TFunction } from "../hooks/use-i18n";
import { ArrowLeft, Loader2, Save, RotateCcw, Undo2 } from "lucide-react";

interface Nav {
  toAgentConfig: () => void;
}

interface PromptOverrideEntry {
  mode: "full" | "append";
  content: string;
}

export function AgentPromptDetailPage({ agentKey, nav, t }: {
  agentKey: string;
  nav: Nav;
  t: TFunction;
}) {
  const agent = ALL_AGENTS.find((a) => a.key === agentKey);

  // 读取已有的 prompt 覆盖配置
  const { data, loading, refetch } = useApi<{
    overrides: Record<string, PromptOverrideEntry>;
  }>("/project/prompt-overrides");

  // 获取该 Agent 的默认 prompt
  const { data: defaultPromptData } = useApi<{ prompt: string | null }>(
    `/project/agent/${encodeURIComponent(agentKey)}/default-prompt`,
  );
  const defaultContent = defaultPromptData?.prompt ?? "";

  const [mode, setMode] = useState<"full" | "append">("append");
  const [content, setContent] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"success" | "error" | null>(null);

  // 从 API 数据初始化状态
  useEffect(() => {
    if (!data) return;
    const existing = data.overrides[agentKey];
    if (existing) {
      setMode(existing.mode);
      setContent(existing.content);
      setEnabled(true);
    } else {
      setMode("append");
      setContent(defaultContent);
      setEnabled(false);
    }
  }, [data, agentKey, defaultContent]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveStatus(null);
    try {
      const overrides: Record<string, PromptOverrideEntry> = { ...data?.overrides };
      if (enabled && content.trim()) {
        overrides[agentKey] = { mode, content: content.trim() };
      } else {
        delete overrides[agentKey];
      }
      await putApi("/project/prompt-overrides", { overrides });
      setSaveStatus("success");
      refetch();
    } catch {
      setSaveStatus("error");
    } finally {
      setSaving(false);
    }
  }, [enabled, mode, content, data, agentKey, refetch]);

  const handleReset = useCallback(() => {
    setEnabled(false);
    setMode("append");
    setContent(defaultContent);
  }, [defaultContent]);

  const handleRestoreDefault = useCallback(() => {
    if (!defaultContent) return;
    setContent(defaultContent);
  }, [defaultContent]);

  if (loading && !data) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12 animate-pulse">
        <div className="h-4 w-24 bg-muted rounded mb-4" />
        <div className="h-7 w-48 bg-muted rounded mb-2" />
        <div className="h-4 w-72 bg-muted/60 rounded" />
        <div className="mt-8 space-y-4">
          <div className="h-20 w-full bg-muted/40 rounded-lg" />
          <div className="h-48 w-full bg-muted/40 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12 text-center">
        <p className="text-destructive">Agent 不存在</p>
      </div>
    );
  }

  const hasDefaultPrompt = defaultContent.length > 0;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <button
          onClick={nav.toAgentConfig}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
        >
          <ArrowLeft size={12} />
          {t("agentConfig.backToList")}
        </button>
        <h1 className="font-serif text-2xl">
          <span className="font-mono text-primary">{agent.key}</span>
          <span className="ml-2 text-lg font-normal text-muted-foreground">
            {agent.descriptionZh}
          </span>
        </h1>
        <p className="text-sm text-muted-foreground/70">
          自定义该 Agent 的系统提示词
        </p>
      </div>

      {/* Enable toggle */}
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="accent-primary w-4 h-4"
          />
          <span className="text-sm font-medium">启用自定义提示词</span>
        </label>
        {!enabled && (
          <span className="text-xs text-muted-foreground/50">
            （当前使用默认提示词）
          </span>
        )}
      </div>

      {/* Mode selector */}
      <div className={enabled ? "" : "opacity-50 pointer-events-none"}>
        <p className="text-xs text-muted-foreground/70 mb-2 font-medium">
          {t("agentConfig.currentMode")}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => {
              setMode("append");
              setEnabled(true);
            }}
            className={`rounded-lg border p-3 text-left transition-colors ${
              mode === "append" && enabled
                ? "border-primary bg-primary/5"
                : "border-border/60 hover:bg-secondary/30"
            }`}
          >
            <div className="text-sm font-medium">{t("agentConfig.appendMode")}</div>
            <div className="text-xs text-muted-foreground/60 mt-1">
              {t("agentConfig.appendModeDesc")}
            </div>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("full");
              setEnabled(true);
            }}
            className={`rounded-lg border p-3 text-left transition-colors ${
              mode === "full" && enabled
                ? "border-primary bg-primary/5"
                : "border-border/60 hover:bg-secondary/30"
            }`}
          >
            <div className="text-sm font-medium">{t("agentConfig.fullOverride")}</div>
            <div className="text-xs text-muted-foreground/60 mt-1">
              {t("agentConfig.fullOverrideDesc")}
            </div>
          </button>
        </div>
      </div>

      {/* Content editor — 未启用时展示默认 prompt（只读） */}
      {!enabled ? (
        <div className="space-y-2">
          <label className="block text-xs text-muted-foreground/70 mb-2 font-medium">
            默认提示词（只读）
          </label>
          {hasDefaultPrompt ? (
            <textarea
              value={defaultContent}
              readOnly
              rows={16}
              className="w-full rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm font-mono resize-none text-muted-foreground/70"
            />
          ) : (
            <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground/50">
                {t("agentConfig.noDefaultPrompt")}
              </p>
            </div>
          )}
          {hasDefaultPrompt && (
            <button
              onClick={() => {
                setContent(defaultContent);
                setEnabled(true);
              }}
              className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors"
            >
              <Undo2 size={12} />
              {t("agentConfig.editPrompt")}（将默认内容加载到编辑器）
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block text-xs text-muted-foreground/70 mb-2 font-medium">
            {t("agentConfig.promptContent")}
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t("agentConfig.promptPlaceholder")}
            rows={16}
            className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:border-primary/50"
          />
          {hasDefaultPrompt && (
            <button
              onClick={handleRestoreDefault}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              <Undo2 size={12} />
              {t("agentConfig.restoreDefault")}
            </button>
          )}
        </div>
      )}

      {/* Save bar */}
      <div className="sticky bottom-4 flex items-center justify-between rounded-xl border border-border/40 bg-card/90 backdrop-blur-sm px-4 py-3 shadow-lg">
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <RotateCcw size={12} />
            {t("agentConfig.resetOverride")}
          </button>
          {saveStatus === "success" && (
            <span className="text-xs text-emerald-500">{t("agentConfig.saveSuccess")}</span>
          )}
          {saveStatus === "error" && (
            <span className="text-xs text-destructive">{t("agentConfig.saveError")}</span>
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
