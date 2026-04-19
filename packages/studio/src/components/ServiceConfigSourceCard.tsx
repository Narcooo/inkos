import { useEffect, useState } from "react";
import { fetchJson } from "../hooks/use-api";

type ConfigSource = "env" | "studio";
type EnvScope = "project" | "global" | null;

interface EnvConfigSummary {
  detected: boolean;
  provider: string | null;
  baseUrl: string | null;
  model: string | null;
  hasApiKey: boolean;
}

interface ServiceConfigPayload {
  services: Array<Record<string, unknown>>;
  defaultModel: string | null;
  configSource: ConfigSource;
  envConfig: {
    project: EnvConfigSummary;
    global: EnvConfigSummary;
    effectiveSource: EnvScope;
  };
}

export function ServiceConfigSourceCard({ onChange }: { onChange?: () => void }) {
  const [data, setData] = useState<ServiceConfigPayload | null>(null);
  const [saving, setSaving] = useState<ConfigSource | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const payload = await fetchJson<ServiceConfigPayload>("/services/config");
      setData(payload);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取配置来源失败");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const switchSource = async (configSource: ConfigSource) => {
    setSaving(configSource);
    try {
      await fetchJson("/services/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configSource }),
      });
      await load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "切换配置来源失败");
    } finally {
      setSaving(null);
    }
  };

  if (!data && !error) {
    return (
      <div className="rounded-xl border border-border/40 bg-card/70 p-4 text-sm text-muted-foreground/70">
        正在读取配置来源…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-4 text-sm text-amber-600">
        {error ?? "读取配置来源失败"}
      </div>
    );
  }

  const { configSource, envConfig } = data;
  const activeEnvSummary = envConfig.effectiveSource === "project" ? envConfig.project : envConfig.global;
  const envLabel = envConfig.effectiveSource === "project" ? "项目 .env" : envConfig.effectiveSource === "global" ? "全局 ~/.inkos/.env" : null;
  const envDetected = envConfig.project.detected || envConfig.global.detected;

  return (
    <div className="rounded-xl border border-border/40 bg-card/70 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">LLM 配置来源</div>
          <div className="text-xs text-muted-foreground/70 mt-1">
            当前策略：
            <span className="text-foreground"> {configSource === "env" ? "优先使用 .env" : "优先使用 Studio 配置"}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void switchSource("studio")}
            disabled={saving !== null || configSource === "studio"}
            className="rounded-lg border border-border/50 px-3 py-1.5 text-xs hover:bg-secondary/50 disabled:opacity-50"
          >
            {saving === "studio" ? "切换中…" : "使用 Studio 配置"}
          </button>
          <button
            type="button"
            onClick={() => void switchSource("env")}
            disabled={saving !== null || configSource === "env"}
            className="rounded-lg border border-border/50 px-3 py-1.5 text-xs hover:bg-secondary/50 disabled:opacity-50"
          >
            {saving === "env" ? "切换中…" : "使用 .env 优先"}
          </button>
        </div>
      </div>

      {envDetected ? (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.04] p-3 text-xs text-muted-foreground/80 space-y-1.5">
          <div className="text-foreground">
            检测到 LLM 环境变量覆盖：
            <span className="font-medium"> {envLabel ?? "已检测到但未定位来源"}</span>
          </div>
          {activeEnvSummary.baseUrl ? <div>Base URL: <span className="font-mono text-foreground">{activeEnvSummary.baseUrl}</span></div> : null}
          {activeEnvSummary.model ? <div>Model: <span className="font-mono text-foreground">{activeEnvSummary.model}</span></div> : null}
          {activeEnvSummary.provider ? <div>Provider: <span className="font-mono text-foreground">{activeEnvSummary.provider}</span></div> : null}
          <div>API Key: <span className="text-foreground">{activeEnvSummary.hasApiKey ? "已设置" : "未设置"}</span></div>
          <div className="text-muted-foreground/70 pt-1">
            {configSource === "env"
              ? "当前请求会优先使用这套 .env 配置。切到 Studio 配置后，将改用服务页里的 service/baseUrl/model。"
              : "当前虽然检测到 .env，但已切到 Studio 配置；Studio 和 Agent 请求会忽略这套 LLM 覆盖。"}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border/30 bg-secondary/20 p-3 text-xs text-muted-foreground/75">
          未检测到目录或全局 `.env` 里的 LLM 覆盖变量。当前会直接使用项目配置和 Studio 服务配置。
        </div>
      )}

      {error ? (
        <div className="text-xs text-rose-500">{error}</div>
      ) : null}
    </div>
  );
}
