import { useEffect, useState } from "react";
import { fetchJson } from "../hooks/use-api";
import { useI18n } from "../hooks/use-i18n";

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
  storedConfigSource?: ConfigSource;
  envConfig: {
    project: EnvConfigSummary;
    global: EnvConfigSummary;
    effectiveSource: EnvScope;
    runtimeUsesEnv: boolean;
  };
}

export function ServiceConfigSourceCard({ onChange }: { onChange?: () => void }) {
  const { lang } = useI18n();
  const copy = lang === "ko"
    ? {
        loadFailed: "설정 출처를 읽지 못했습니다",
        switchFailed: "설정 출처 전환 실패",
        loading: "설정 출처를 읽는 중...",
        title: "LLM 설정 출처",
        runtime: "Studio 런타임:",
        runtimeValue: "서비스 페이지 설정과 Studio 키 사용",
        switching: "전환 중...",
        useStudio: "Studio 설정 사용",
        legacyEnv: "기존 설정이 `.env` 우선으로 표시되어 있습니다. Studio 런타임은 이를 사용하지 않지만, CLI, daemon, 배포 환경에서는 env 오버레이로 사용할 수 있습니다.",
        envOverride: "LLM 환경 변수 오버레이 감지:",
        unknownEnv: "감지되었지만 출처를 확인하지 못함",
        projectEnv: "프로젝트 .env",
        globalEnv: "전역 ~/.inkos/.env",
        configured: "설정됨",
        notConfigured: "설정 안 됨",
        envIgnored: "현재 .env가 감지되었지만 Studio와 Agent 요청은 이 LLM 오버레이를 무시합니다. CLI, daemon, 배포 환경에서는 사용할 수 있습니다.",
        noEnv: "디렉터리 또는 전역 `.env`에서 LLM 오버레이 변수를 찾지 못했습니다. 현재는 프로젝트 설정과 Studio 서비스 설정을 직접 사용합니다.",
      }
    : {
        loadFailed: "读取配置来源失败",
        switchFailed: "切换配置来源失败",
        loading: "正在读取配置来源…",
        title: "LLM 配置来源",
        runtime: "Studio 运行时：",
        runtimeValue: " 使用服务页配置和 Studio 密钥",
        switching: "切换中…",
        useStudio: "使用 Studio 配置",
        legacyEnv: "检测到旧配置标记为 `.env` 优先。Studio 运行时不会使用它；CLI、daemon 和部署环境仍可按 env 覆盖层使用。",
        envOverride: "检测到 LLM 环境变量覆盖：",
        unknownEnv: "已检测到但未定位来源",
        projectEnv: "项目 .env",
        globalEnv: "全局 ~/.inkos/.env",
        configured: "已设置",
        notConfigured: "未设置",
        envIgnored: "当前虽然检测到 .env，但 Studio 和 Agent 请求会忽略这套 LLM 覆盖；CLI、daemon 和部署环境可以使用它。",
        noEnv: "未检测到目录或全局 `.env` 里的 LLM 覆盖变量。当前会直接使用项目配置和 Studio 服务配置。",
      };
  const [data, setData] = useState<ServiceConfigPayload | null>(null);
  const [saving, setSaving] = useState<ConfigSource | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const payload = await fetchJson<ServiceConfigPayload>("/services/config");
      setData(payload);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.loadFailed);
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
      setError(e instanceof Error ? e.message : copy.switchFailed);
    } finally {
      setSaving(null);
    }
  };

  if (!data && !error) {
    return (
      <div className="rounded-xl border border-border/40 bg-card/70 p-4 text-sm text-muted-foreground/70">
        {copy.loading}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-4 text-sm text-amber-600">
        {error ?? copy.loadFailed}
      </div>
    );
  }

  const { configSource, envConfig } = data;
  const storedConfigSource = data.storedConfigSource ?? configSource;
  const activeEnvSummary = envConfig.effectiveSource === "project" ? envConfig.project : envConfig.global;
  const envLabel = envConfig.effectiveSource === "project" ? copy.projectEnv : envConfig.effectiveSource === "global" ? copy.globalEnv : null;
  const envDetected = envConfig.project.detected || envConfig.global.detected;

  return (
    <div className="rounded-xl border border-border/40 bg-card/70 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{copy.title}</div>
          <div className="text-xs text-muted-foreground/70 mt-1">
            {copy.runtime}
            <span className="text-foreground"> {copy.runtimeValue}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void switchSource("studio")}
            disabled={saving !== null || configSource === "studio"}
            className="rounded-lg border border-border/50 px-3 py-1.5 text-xs hover:bg-secondary/50 disabled:opacity-50"
          >
            {saving === "studio" ? copy.switching : copy.useStudio}
          </button>
        </div>
      </div>

      {storedConfigSource === "env" ? (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.04] p-3 text-xs text-muted-foreground/80">
          {copy.legacyEnv}
        </div>
      ) : null}

      {envDetected ? (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.04] p-3 text-xs text-muted-foreground/80 space-y-1.5">
          <div className="text-foreground">
            {copy.envOverride}
            <span className="font-medium"> {envLabel ?? copy.unknownEnv}</span>
          </div>
          {activeEnvSummary.baseUrl ? <div>Base URL: <span className="font-mono text-foreground">{activeEnvSummary.baseUrl}</span></div> : null}
          {activeEnvSummary.model ? <div>Model: <span className="font-mono text-foreground">{activeEnvSummary.model}</span></div> : null}
          {activeEnvSummary.provider ? <div>Provider: <span className="font-mono text-foreground">{activeEnvSummary.provider}</span></div> : null}
          <div>API Key: <span className="text-foreground">{activeEnvSummary.hasApiKey ? copy.configured : copy.notConfigured}</span></div>
          <div className="text-muted-foreground/70 pt-1">
            {copy.envIgnored}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border/30 bg-secondary/20 p-3 text-xs text-muted-foreground/75">
          {copy.noEnv}
        </div>
      )}

      {error ? (
        <div className="text-xs text-rose-500">{error}</div>
      ) : null}
    </div>
  );
}
