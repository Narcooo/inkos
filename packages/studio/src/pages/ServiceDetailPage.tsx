import { useState, useEffect } from "react";
import { fetchJson } from "../hooks/use-api";
import { useServiceStore } from "../store/service";
import { Eye, EyeOff, Loader2, ArrowLeft } from "lucide-react";
import { useI18n } from "../hooks/use-i18n";
import {
  fetchServiceModelsForDetail,
  matchServiceConfigEntryForDetail,
  probeServiceForDetail,
  rehydrateServiceConnectionStatus,
  saveServiceConfig,
  type ServiceDetailConnectionStatus as ConnectionStatus,
  type ServiceDetailDetectedConfig as DetectedConfig,
  type ServiceDetailModelInfo as ModelInfo,
} from "./service-detail-state";

interface Nav {
  toServices: () => void;
}

const SERVICE_DETAIL_COPY = {
  zh: {
    customFallback: "自定义服务",
    back: "返回服务商管理",
    connected: "已连接",
    serviceName: "服务名称",
    serviceNamePlaceholder: "例如：本地 Ollama",
    testConnection: "测试连接",
    save: "保存",
    enterApiKey: "请先输入 API Key",
    enterBaseUrl: "请先填写 Base URL",
    enterModel: "请先选择模型",
    loadModels: "加载模型",
    model: "模型",
    modelPlaceholder: "先加载并选择模型",
    loadModelsFailed: "模型加载失败",
    connectionFailed: "连接失败",
    saveFailed: "保存失败",
    connectionSuccess: (count: number) => `连接成功，${count} 个模型`,
    autoMatched: (model: string, apiFormat: string, stream: boolean) =>
      `，使用 ${model} / ${apiFormat === "responses" ? "Responses" : "Chat"} / ${stream ? "流式" : "非流式"}`,
    saved: "已保存",
    apiFormat: "协议类型",
    streaming: "流式响应",
    on: "开启",
    off: "关闭",
    availableModels: (count: number) => `可用模型（${count}）`,
    testToLoadModels: "点击“测试连接”查看可用模型",
    advanced: "高级参数",
  },
  ko: {
    customFallback: "사용자 지정 서비스",
    back: "모델 설정으로 돌아가기",
    connected: "연결됨",
    serviceName: "서비스 이름",
    serviceNamePlaceholder: "예: 로컬 Ollama",
    testConnection: "연결 테스트",
    save: "저장",
    enterApiKey: "API Key를 먼저 입력하세요",
    enterBaseUrl: "Base URL을 먼저 입력하세요",
    enterModel: "모델을 먼저 선택하세요",
    loadModels: "모델 불러오기",
    model: "모델",
    modelPlaceholder: "먼저 모델을 불러와 선택하세요",
    loadModelsFailed: "모델 불러오기 실패",
    connectionFailed: "연결 실패",
    saveFailed: "저장 실패",
    connectionSuccess: (count: number) => `연결 성공, 모델 ${count}개`,
    autoMatched: (model: string, apiFormat: string, stream: boolean) =>
      `, 사용 모델: ${model} / ${apiFormat === "responses" ? "Responses" : "Chat"} / ${stream ? "스트리밍" : "비스트리밍"}`,
    saved: "저장됨",
    apiFormat: "프로토콜 유형",
    streaming: "스트리밍 응답",
    on: "켜짐",
    off: "꺼짐",
    availableModels: (count: number) => `사용 가능한 모델 (${count})`,
    testToLoadModels: "연결 테스트를 눌러 사용 가능한 모델을 확인하세요",
    advanced: "고급 매개변수",
  },
} as const;

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
  const { lang } = useI18n();
  const copy = lang === "ko" ? SERVICE_DETAIL_COPY.ko : SERVICE_DETAIL_COPY.zh;
  // -- Service store --
  const services = useServiceStore((s) => s.services);
  const loading = useServiceStore((s) => s.servicesLoading);
  const fetchServices = useServiceStore((s) => s.fetchServices);
  const refreshServices = useServiceStore((s) => s.refreshServices);
  const setStoreModels = useServiceStore((s) => s.setLiveModels);
  const clearStoreModels = useServiceStore((s) => s.clearModels);

  useEffect(() => { void fetchServices(); }, [fetchServices]);

  const svc = services.find((s) => s.service === serviceId);
  const isCustom = serviceId === "custom" || serviceId.startsWith("custom:");
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
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [modelOptions, setModelOptions] = useState<ModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [detectedConfig, setDetectedConfig] = useState<DetectedConfig | null>(null);

  // -- Unified connection status --
  const [status, setStatus] = useState<ConnectionStatus>({ state: "idle" });

  useEffect(() => {
    let cancelled = false;
    void fetchJson<{ services: Array<Record<string, unknown>>; service?: string | null; defaultModel?: string | null }>("/services/config")
      .then((data) => {
        if (cancelled) return;
        const matched = matchServiceConfigEntryForDetail(data.services ?? [], serviceId);
        if (matched && isCustom) {
          setCustomName(String(matched.name ?? persistedCustomName));
          setBaseUrl(String(matched.baseUrl ?? ""));
        }
        if (matched && typeof matched.temperature === "number") setTemperature(String(matched.temperature));
        if (matched && (matched.apiFormat === "chat" || matched.apiFormat === "responses")) setApiFormat(matched.apiFormat);
        if (matched && typeof matched.stream === "boolean") setStream(matched.stream);
        const activeService = typeof data.service === "string" ? data.service : null;
        if (activeService === serviceId && typeof data.defaultModel === "string") {
          const defaultModel = data.defaultModel;
          setDetectedModel(defaultModel);
          setSelectedModel(defaultModel);
          setModelOptions((current) =>
            current.some((model) => model.id === defaultModel)
              ? current
              : [{ id: defaultModel, name: defaultModel }, ...current],
          );
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isCustom, persistedCustomName, serviceId]);

  const resolvedCustomName = persistedCustomName || customName.trim() || "Custom";
  const effectiveServiceId = isCustom ? `custom:${resolvedCustomName}` : serviceId;
  const label = isCustom ? (customName || persistedCustomName || copy.customFallback) : (svc?.label ?? serviceId);
  const storeModels = useServiceStore((s) => s.modelsByService[effectiveServiceId]);

  useEffect(() => {
    if (storeModels?.length) setModelOptions([...storeModels]);
  }, [storeModels]);

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
        if (result.detectedModel) setSelectedModel(result.detectedModel);
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
  const handleLoadModels = async () => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      setStatus({ state: "error", message: copy.enterApiKey });
      return;
    }
    if (isCustom && !baseUrl.trim()) {
      setStatus({ state: "error", message: copy.enterBaseUrl });
      return;
    }
    setLoadingModels(true);
    try {
      const loaded = await fetchServiceModelsForDetail(effectiveServiceId, {
        apiKey: trimmedKey,
        ...(isCustom ? { baseUrl: baseUrl.trim() } : {}),
        refresh: true,
      });
      setModelOptions([...loaded]);
      setStoreModels(effectiveServiceId, loaded);
      setStatus({ state: "idle" });
    } catch (e) {
      setStatus({ state: "error", message: e instanceof Error ? e.message : copy.loadModelsFailed });
    } finally {
      setLoadingModels(false);
    }
  };

  const handleTest = async () => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      setStatus({ state: "error", message: copy.enterApiKey });
      return;
    }
    if (isCustom && !baseUrl.trim()) {
      setStatus({ state: "error", message: copy.enterBaseUrl });
      return;
    }
    if (isCustom && !selectedModel.trim()) {
      setStatus({ state: "error", message: copy.enterModel });
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
        ...(selectedModel.trim() ? { model: selectedModel.trim() } : {}),
      });
      if (result.ok) {
        const models = result.models ?? [];
        if (result.detected?.apiFormat) setApiFormat(result.detected.apiFormat);
        if (typeof result.detected?.stream === "boolean") setStream(result.detected.stream);
        if (isCustom && result.detected?.baseUrl) setBaseUrl(result.detected.baseUrl);
        const nextModel = selectedModel.trim() || result.selectedModel || "";
        setDetectedModel(nextModel);
        if (nextModel) setSelectedModel(nextModel);
        setDetectedConfig(result.detected ?? null);
        setStatus({ state: "connected", models });
        setStoreModels(effectiveServiceId, models); // Write to global store
      } else {
        setStatus({ state: "error", message: result.error ?? copy.connectionFailed });
        clearStoreModels(effectiveServiceId);
      }
    } catch (e) {
      setStatus({ state: "error", message: e instanceof Error ? e.message : copy.connectionFailed });
    }
  };

  const handleSave = async () => {
    const trimmedKey = apiKey.trim();
    setApiKey(trimmedKey);
    if (isCustom && !baseUrl.trim()) {
      setStatus({ state: "error", message: copy.enterBaseUrl });
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
        selectedModel,
        messages: {
          enterApiKey: copy.enterApiKey,
          enterBaseUrl: copy.enterBaseUrl,
          enterModel: copy.enterModel,
          connectionFailed: copy.connectionFailed,
        },
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
      setStatus({ state: "error", message: e instanceof Error ? e.message : copy.saveFailed });
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
        {copy.back}
      </button>

      {/* Title + status */}
      <div className="flex items-center gap-3">
        <h1 className="font-serif text-2xl">{label}</h1>
        {isConnected && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-medium">
            {copy.connected}
          </span>
        )}
      </div>

      <div className="space-y-5">
        {/* Custom fields */}
        {isCustom && (
        <div className="grid grid-cols-2 gap-4">
            <Field label={copy.serviceName}>
              <input type="text" value={customName} onChange={(e) => setCustomName(e.target.value)}
                placeholder={copy.serviceNamePlaceholder} className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm" />
            </Field>
            <Field label="Base URL">
              <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1" className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono" />
            </Field>
          </div>
        )}

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

        <Field label={copy.model}>
          <div className="flex gap-2">
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
            >
              {!selectedModel && <option value="">{copy.modelPlaceholder}</option>}
              {modelOptions.map((model) => (
                <option key={model.id} value={model.id}>{model.name ?? model.id}</option>
              ))}
              {selectedModel && !modelOptions.some((model) => model.id === selectedModel) && (
                <option value={selectedModel}>{selectedModel}</option>
              )}
            </select>
            <button
              type="button"
              onClick={handleLoadModels}
              disabled={isBusy || loadingModels}
              className="flex shrink-0 items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg border border-border/60 hover:bg-secondary/50 transition-colors disabled:opacity-50"
            >
              {loadingModels && <Loader2 size={12} className="animate-spin" />}
              {copy.loadModels}
            </button>
          </div>
        </Field>

        {/* Actions + feedback */}
        <div className="flex items-center gap-2">
          <button onClick={handleTest} disabled={isBusy}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg border border-border/60 hover:bg-secondary/50 transition-colors disabled:opacity-50">
            {status.state === "testing" && <Loader2 size={12} className="animate-spin" />}
            {copy.testConnection}
          </button>
          <button onClick={handleSave} disabled={isBusy}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
            {status.state === "saving" && <Loader2 size={12} className="animate-spin" />}
            {copy.save}
          </button>
          {/* Status feedback */}
          {status.state === "connected" && (
            <span className="text-xs text-emerald-500">
              {copy.connectionSuccess(models.length)}
              {detectedModel && detectedConfig
                ? copy.autoMatched(detectedModel, detectedConfig.apiFormat ?? "chat", detectedConfig.stream ?? true)
                : ""}
            </span>
          )}
          {status.state === "error" && (
            <span className="text-xs text-destructive">{status.message}</span>
          )}
          {status.state === "saved" && (
            <span className="text-xs text-emerald-500">{copy.saved}</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label={copy.apiFormat}>
            <select
              value={apiFormat}
              onChange={(e) => setApiFormat(e.target.value as "chat" | "responses")}
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
            >
              <option value="chat">Chat / Completions</option>
              <option value="responses">Responses</option>
            </select>
          </Field>

          <Field label={copy.streaming}>
            <label className="flex h-10 items-center gap-2 rounded-lg border border-border/60 bg-background px-3 text-sm">
              <input
                type="checkbox"
                checked={stream}
                onChange={(e) => setStream(e.target.checked)}
              />
              <span>{stream ? copy.on : copy.off}</span>
            </label>
          </Field>
        </div>

        {/* Models */}
        {isConnected && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground/70 font-medium uppercase tracking-wider">
              {copy.availableModels(models.length)}
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
              <p className="text-xs text-muted-foreground/60">{copy.testToLoadModels}</p>
            )}
          </div>
        )}

        {/* Advanced params */}
        <details className="group pt-2 border-t border-border/20">
          <summary className="text-xs text-muted-foreground/60 cursor-pointer select-none hover:text-muted-foreground transition-colors py-2">
            {copy.advanced}
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
