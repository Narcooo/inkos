import { useState, useEffect } from "react";
import { fetchJson } from "../hooks/use-api";
import { useServiceStore } from "../store/service";
import { Eye, EyeOff, Loader2, ArrowLeft, Trash2 } from "lucide-react";
import { ServiceQuickLinks } from "../components/ServiceQuickLinks";
import { tr } from "../lib/app-language";
import {
  deleteServiceConfig,
  matchServiceConfigEntryForDetail,
  probeServiceForDetail,
  rehydrateServiceConnectionStatus,
  saveServiceConfig,
  startOpenAICodexOAuth,
  readOpenAICodexOAuthStatus,
  submitOpenAICodexOAuthCode,
  type ServiceDetailConnectionStatus as ConnectionStatus,
  type ServiceDetailDetectedConfig as DetectedConfig,
  type ServiceDetailModelInfo as ModelInfo,
  type ServiceDetailVerifiedProbe as VerifiedProbe,
} from "./service-detail-state";

interface Nav {
  toServices: () => void;
}

function DetailSkeleton() {
  return (
    <div className="max-w-xl mx-auto space-y-6 animate-pulse">
      <div className="h-4 w-16 bg-muted rounded" />
      <div className="h-7 w-40 bg-muted rounded" />
      <div className="space-y-2"><div className="h-3 w-16 bg-muted/60 rounded" /><div className="h-10 w-full bg-muted/40 rounded-lg" /></div>
      <div className="h-9 w-24 bg-muted/40 rounded-lg" />
    </div>
  );
}

export function ServiceDetailPage({ serviceId, nav }: { serviceId: string; nav: Nav }) {
  // -- Service store --
  const services = useServiceStore((s) => s.services);
  const loading = useServiceStore((s) => s.servicesLoading);
  const fetchServices = useServiceStore((s) => s.fetchServices);
  const refreshServices = useServiceStore((s) => s.refreshServices);
  const fetchLiveModels = useServiceStore((s) => s.fetchLiveModels);
  const setStoreModels = useServiceStore((s) => s.setLiveModels);
  const clearStoreModels = useServiceStore((s) => s.clearModels);

  useEffect(() => { void fetchServices(); }, [fetchServices]);

  const svc = services.find((s) => s.service === serviceId);
  const isCustom = serviceId === "custom" || serviceId.startsWith("custom:");
  const isOpenAICodex = serviceId === "openaiCodex";
  const persistedCustomName = serviceId.startsWith("custom:") ? decodeURIComponent(serviceId.slice("custom:".length)) : "";

  // -- Local form state --
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [customName, setCustomName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [temperature, setTemperature] = useState("0.7");
  const [apiFormat, setApiFormat] = useState<"chat" | "responses">("chat");
  const [stream, setStream] = useState(true);
  const [detectedModel, setDetectedModel] = useState<string>("");
  const [detectedConfig, setDetectedConfig] = useState<DetectedConfig | null>(null);
  const [verifiedProbe, setVerifiedProbe] = useState<VerifiedProbe | null>(null);
  const [oauthSessionId, setOauthSessionId] = useState("");
  const [oauthCode, setOauthCode] = useState("");

  // -- Unified connection status --
  const [status, setStatus] = useState<ConnectionStatus>({ state: "idle" });

  useEffect(() => {
    let cancelled = false;
    void fetchJson<{ services: Array<Record<string, unknown>> }>("/services/config")
      .then((data) => {
        if (cancelled) return;
        const matched = matchServiceConfigEntryForDetail(data.services ?? [], serviceId);
        if (!matched) return;
        if (isCustom) {
          setCustomName(String(matched.name ?? persistedCustomName));
          setBaseUrl(String(matched.baseUrl ?? ""));
        }
        if (typeof matched.temperature === "number") setTemperature(String(matched.temperature));
        if (matched.apiFormat === "chat" || matched.apiFormat === "responses") setApiFormat(matched.apiFormat);
        if (typeof matched.stream === "boolean") setStream(matched.stream);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isCustom, persistedCustomName, serviceId]);

  const resolvedCustomName = persistedCustomName || customName.trim() || "Custom";
  const effectiveServiceId = isCustom ? `custom:${resolvedCustomName}` : serviceId;
  const label = isCustom ? (customName || persistedCustomName || tr("自定义服务", "Custom service")) : (svc?.label ?? serviceId);
  const storeModels = useServiceStore((s) => s.modelsByService[effectiveServiceId]);

  useEffect(() => {
    let cancelled = false;
    void rehydrateServiceConnectionStatus({
      effectiveServiceId,
      shouldVerify: Boolean(svc?.connected),
      isCustom,
      baseUrl,
      apiFormat,
      stream,
    })
      .then((result) => {
        if (cancelled) return;
        setApiKey(result.apiKey);
        setDetectedModel(result.detectedModel);
        setDetectedConfig(result.detectedConfig);
        setStatus(result.status);
        if (result.status.state === "connected") {
          setStoreModels(effectiveServiceId, result.status.models);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setStatus({ state: "idle" });
      });
    return () => { cancelled = true; };
  }, [
    apiFormat,
    baseUrl,
    effectiveServiceId,
    isCustom,
    setStoreModels,
    stream,
    svc?.connected,
  ]);

  if (loading) return <DetailSkeleton />;

  // -- Derived state --
  const isConnected = Boolean(svc?.connected);
  const models = status.state === "connected" ? status.models : (storeModels ?? []);
  const isBusy = status.state === "testing" || status.state === "saving";

  // -- Handlers --
  const handleTest = async () => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey && !isCustom) {
      setStatus({ state: "error", message: tr("请先输入 API Key", "Enter an API key first") });
      return;
    }
    if (isCustom && !baseUrl.trim()) {
      setStatus({ state: "error", message: tr("请先填写 Base URL", "Enter a base URL first") });
      return;
    }
    setApiKey(trimmedKey);
    setStatus({ state: "testing" });
    try {
      const result = await probeServiceForDetail(effectiveServiceId, {
        apiKey: trimmedKey,
        apiFormat,
        stream,
        ...(isCustom ? { baseUrl: baseUrl.trim() } : {}),
      });
      if (result.ok) {
        const models = result.models ?? [];
        const verifiedApiFormat = result.detected?.apiFormat ?? apiFormat;
        const verifiedStream = typeof result.detected?.stream === "boolean" ? result.detected.stream : stream;
        const verifiedBaseUrl = isCustom ? (result.detected?.baseUrl ?? baseUrl.trim()) : "";
        if (result.detected?.apiFormat) setApiFormat(result.detected.apiFormat);
        if (typeof result.detected?.stream === "boolean") setStream(result.detected.stream);
        if (isCustom && result.detected?.baseUrl) setBaseUrl(result.detected.baseUrl);
        setDetectedModel(result.selectedModel ?? "");
        setDetectedConfig(result.detected ?? null);
        setVerifiedProbe({
          apiKey: trimmedKey,
          baseUrl: verifiedBaseUrl,
          apiFormat: verifiedApiFormat,
          stream: verifiedStream,
          models,
          selectedModel: result.selectedModel,
          detected: result.detected,
        });
        setStatus({ state: "connected", models });
        setStoreModels(effectiveServiceId, models); // Write to global store
      } else {
        setVerifiedProbe(null);
        setStatus({ state: "error", message: result.error ?? tr("连接失败", "Connection failed") });
        clearStoreModels(effectiveServiceId);
      }
    } catch (e) {
      setVerifiedProbe(null);
      setStatus({ state: "error", message: e instanceof Error ? e.message : tr("连接失败", "Connection failed") });
    }
  };

  const handleOpenAICodexLogin = async () => {
    setStatus({ state: "testing" });
    const popup = window.open("about:blank", "inkos-openai-codex-oauth", "popup,width=720,height=820");
    if (popup) popup.opener = null;
    try {
      const login = await startOpenAICodexOAuth();
      setOauthSessionId(login.sessionId);
      if (popup) popup.location.href = login.url;
      else window.location.assign(login.url);

      for (let attempt = 0; attempt < 600; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
        const current = await readOpenAICodexOAuthStatus(login.sessionId);
        if (current.state === "error") throw new Error(current.error);
        if (current.state === "success") {
          await refreshServices();
          await fetchLiveModels(serviceId);
          setStatus({ state: "idle" });
          setOauthSessionId("");
          setOauthCode("");
          return;
        }
      }
      throw new Error(tr("登录超时，请重试", "Login timed out; try again"));
    } catch (error) {
      popup?.close();
      setStatus({ state: "error", message: error instanceof Error ? error.message : tr("登录失败", "Login failed") });
    }
  };

  const handleOpenAICodexCode = async () => {
    if (!oauthSessionId || !oauthCode.trim()) return;
    try {
      await submitOpenAICodexOAuthCode(oauthSessionId, oauthCode.trim());
    } catch (error) {
      setStatus({ state: "error", message: error instanceof Error ? error.message : tr("提交失败", "Submission failed") });
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(tr(`删除“${label}”的配置和密钥？`, `Delete the config and key for “${label}”?`))) return;
    setStatus({ state: "saving" });
    try {
      await deleteServiceConfig(effectiveServiceId);
      clearStoreModels(effectiveServiceId);
      await refreshServices();
      nav.toServices();
    } catch (e) {
      setStatus({ state: "error", message: e instanceof Error ? e.message : tr("删除失败", "Delete failed") });
    }
  };

  const handleSave = async () => {
    const trimmedKey = apiKey.trim();
    setApiKey(trimmedKey);
    if (isCustom && !baseUrl.trim()) {
      setStatus({ state: "error", message: tr("请先填写 Base URL", "Enter a base URL first") });
      return;
    }
    setStatus({ state: "saving" });
    try {
      const result = await saveServiceConfig({
        effectiveServiceId,
        serviceId,
        isCustom,
        resolvedCustomName,
        apiKey: trimmedKey,
        baseUrl,
        apiFormat,
        stream,
        temperature,
        detectedModel,
        verifiedProbe,
      });
      if (result.status.state === "connected") {
        if (result.detectedConfig?.apiFormat) setApiFormat(result.detectedConfig.apiFormat);
        if (typeof result.detectedConfig?.stream === "boolean") setStream(result.detectedConfig.stream);
        if (isCustom && result.detectedConfig?.baseUrl) setBaseUrl(result.detectedConfig.baseUrl);
        setDetectedModel(result.detectedModel);
        setDetectedConfig(result.detectedConfig);
        setStoreModels(effectiveServiceId, result.status.models);
        setStatus(result.status);
      } else {
        setStatus(result.status);
        if (result.status.state === "error") return;
      }
      await refreshServices();
      nav.toServices();
    } catch (e) {
      setStatus({ state: "error", message: e instanceof Error ? e.message : tr("保存失败", "Save failed") });
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {/* Back */}
      <button
        onClick={nav.toServices}
        className="inline-flex items-center gap-2 rounded-lg border border-border/50 bg-card/60 px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary/50 transition-colors"
      >
        <ArrowLeft size={14} />
        {tr("返回服务商管理", "Back to providers")}
      </button>

      {/* Title + status */}
      <div className="flex items-center gap-3">
        <h1 className="font-serif text-2xl">{label}</h1>
        {isConnected && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-medium">
            {tr("已连接", "Connected")}
          </span>
        )}
      </div>
      <ServiceQuickLinks serviceId={serviceId} />

      <div className="space-y-5">
        {/* Custom fields */}
        {isCustom && (
        <div className="grid grid-cols-2 gap-4">
            <Field label={tr("服务名称", "Service name")}>
              <input type="text" value={customName} onChange={(e) => setCustomName(e.target.value)}
                placeholder={tr("例如：本地 Ollama", "e.g. local Ollama")} className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm" />
            </Field>
            <Field label="Base URL">
              <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1" className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono" />
            </Field>
          </div>
        )}

        {isOpenAICodex ? (
          <div className="space-y-3 rounded-xl border border-border/60 bg-card/60 p-4">
            <p className="text-sm text-muted-foreground">
              {tr(
                "使用浏览器登录 ChatGPT。InkOS 会保存并自动刷新 OAuth 凭据，不需要填写 API Key。",
                "Sign in to ChatGPT in your browser. InkOS stores and refreshes the OAuth credentials; no API key is needed.",
              )}
            </p>
            <div className="flex items-center gap-2">
              <button onClick={handleOpenAICodexLogin} disabled={isBusy}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
                {status.state === "testing" && <Loader2 size={12} className="animate-spin" />}
                {isConnected ? tr("重新登录 ChatGPT", "Sign in again") : tr("使用 ChatGPT 登录", "Sign in with ChatGPT")}
              </button>
              {isConnected && (
                <button onClick={handleDelete} disabled={isBusy}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50">
                  <Trash2 size={12} />
                  {tr("退出并删除配置", "Sign out and delete")}
                </button>
              )}
            </div>
            {status.state === "testing" && oauthSessionId && (
              <div className="space-y-2 border-t border-border/40 pt-3">
                <p className="text-xs text-muted-foreground">
                  {tr(
                    "如果浏览器无法自动返回 InkOS，请粘贴最终回调地址或授权码。",
                    "If the browser cannot return to InkOS automatically, paste the final callback URL or authorization code.",
                  )}
                </p>
                <div className="flex gap-2">
                  <input value={oauthCode} onChange={(event) => setOauthCode(event.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-border/60 bg-background px-3 py-2 text-xs font-mono"
                    placeholder={tr("回调地址或授权码", "Callback URL or authorization code")} />
                  <button onClick={handleOpenAICodexCode} disabled={!oauthCode.trim()}
                    className="rounded-lg border border-border/60 px-3 py-2 text-xs hover:bg-secondary/50 disabled:opacity-50">
                    {tr("提交", "Submit")}
                  </button>
                </div>
              </div>
            )}
            {status.state === "error" && <p className="text-xs text-destructive">{status.message}</p>}
          </div>
        ) : <>
        {/* API Key */}
        <Field label="API Key">
          <div className="relative">
            <input
              type={showKey ? "text" : "password"} value={apiKey}
              onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..."
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 pr-10 text-sm font-mono"
            />
            <button type="button" onClick={() => setShowKey((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground transition-colors">
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </Field>

        {/* Actions + feedback */}
        <div className="flex items-center gap-2">
          <button onClick={handleTest} disabled={isBusy}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg border border-border/60 hover:bg-secondary/50 transition-colors disabled:opacity-50">
            {status.state === "testing" && <Loader2 size={12} className="animate-spin" />}
            {tr("测试连接", "Test connection")}
          </button>
          <button onClick={handleSave} disabled={isBusy}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
            {status.state === "saving" && <Loader2 size={12} className="animate-spin" />}
            {tr("保存", "Save")}
          </button>
          {(isConnected || isCustom) && (
            <button onClick={handleDelete} disabled={isBusy}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50">
              <Trash2 size={12} />
              {tr("删除配置", "Delete config")}
            </button>
          )}
          {/* Status feedback */}
          {status.state === "connected" && (
            <span className="text-xs text-emerald-500">
              {tr(`连接成功，${models.length} 个模型`, `Connected, ${models.length} models`)}
              {detectedModel
                ? tr(
                    `，已自动匹配 ${detectedModel}${detectedConfig ? ` / ${detectedConfig.apiFormat === "responses" ? "Responses" : "Chat"} / ${detectedConfig.stream ? "流式" : "非流式"}` : ""}`,
                    `, auto-matched ${detectedModel}${detectedConfig ? ` / ${detectedConfig.apiFormat === "responses" ? "Responses" : "Chat"} / ${detectedConfig.stream ? "streaming" : "non-streaming"}` : ""}`,
                  )
                : ""}
            </span>
          )}
          {status.state === "error" && (
            <span className="text-xs text-destructive">{status.message}</span>
          )}
          {status.state === "saved" && (
            <span className="text-xs text-emerald-500">{tr("已保存", "Saved")}</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label={tr("协议类型", "Protocol")}>
            <select
              value={apiFormat}
              onChange={(e) => setApiFormat(e.target.value as "chat" | "responses")}
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
            >
              <option value="chat">Chat / Completions</option>
              <option value="responses">Responses</option>
            </select>
          </Field>

          <Field label={tr("流式响应", "Streaming")}>
            <label className="flex h-10 items-center gap-2 rounded-lg border border-border/60 bg-background px-3 text-sm">
              <input
                type="checkbox"
                checked={stream}
                onChange={(e) => setStream(e.target.checked)}
              />
              <span>{stream ? tr("开启", "On") : tr("关闭", "Off")}</span>
            </label>
          </Field>
        </div>

        {/* Models */}
        {isConnected && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground/70 font-medium uppercase tracking-wider">
              {tr(`可用模型（${models.length}）`, `Available models (${models.length})`)}
            </p>
            {models.length > 0 ? (
              <div className="flex gap-1.5 flex-wrap">
                {models.map((m) => (
                  <span key={m.id} className="text-[11px] px-2.5 py-1 rounded-md bg-emerald-500/[0.06] text-emerald-600 dark:text-emerald-400 border border-emerald-500/15">
                    {m.name ?? m.id}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/60">{tr("点击“测试连接”查看可用模型", "Click “Test connection” to list available models")}</p>
            )}
          </div>
        )}

        {/* Advanced params */}
        <details className="group pt-2 border-t border-border/20">
          <summary className="text-xs text-muted-foreground/60 cursor-pointer select-none hover:text-muted-foreground transition-colors py-2">
            {tr("高级参数", "Advanced")}
          </summary>
          <div className="space-y-4 pt-2">
            <Field label="temperature">
              <div className="flex items-center gap-3">
                <input type="range" min="0" max="2" step="0.05" value={temperature}
                  onChange={(e) => setTemperature(e.target.value)} className="flex-1 accent-primary h-1" />
                <input type="number" value={temperature} onChange={(e) => setTemperature(e.target.value)}
                  min="0" max="2" step="0.05" className="w-16 rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-right font-mono" />
              </div>
            </Field>
          </div>
        </details>
        </>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs text-muted-foreground/70 font-medium">{label}</label>
      {children}
    </div>
  );
}
