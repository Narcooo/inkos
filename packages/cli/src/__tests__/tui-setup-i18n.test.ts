import { describe, expect, it } from "vitest";
import {
  buildAutoInitMessages,
  buildInteractiveSetupCopy,
  buildSetupEnvContent,
  hasUsableLlmEnv,
  resolveSetupBaseUrl,
  resolveSetupModel,
  resolveSetupProvider,
  resolveSetupService,
} from "../tui/setup.js";

describe("tui setup i18n", () => {
  it("builds Chinese setup copy by default", () => {
    const copy = buildInteractiveSetupCopy("zh-CN");
    expect(copy.title).toBe("模型配置");
    expect(copy.subtitle).toContain("配置模型服务");
    expect(copy.steps.provider).toBe("服务提供方");
    expect(copy.hints.provider).toContain("kkaiapi");
    expect(copy.hints.apiKey).not.toMatch(/kkaiapi/i);
    expect(copy.steps.scope).toBe("保存范围");
    expect(copy.scopeChoices.project).toBe("当前目录");
  });

  it("builds localized auto-init messages", () => {
    expect(buildAutoInitMessages("山海", "zh-CN").initializing).toContain("正在初始化项目：山海");
    expect(buildAutoInitMessages("harbor", "en").initialized).toContain("Project initialized");
  });

  it("uses Anthropic protocol for Kimi Code base URLs even when the user picked custom", () => {
    expect(resolveSetupProvider("custom", "https://api.kimi.com/coding")).toBe("anthropic");
    expect(resolveSetupProvider("openai", "https://api.kimi.com/coding/v1")).toBe("anthropic");
  });

  it("keeps kkaiapi as a service while using the OpenAI-compatible transport", () => {
    expect(resolveSetupProvider("kkaiapi", "https://api.kkaiapi.com/v1")).toBe("openai");
    expect(resolveSetupService("kkaiapi", "")).toBe("kkaiapi");
    expect(resolveSetupService("openai", "https://api.kkaiapi.com/v1")).toBe("kkaiapi");
  });

  it("configures Codex OAuth as a keyless service", () => {
    expect(resolveSetupProvider("codexOAuth", "")).toBe("openai");
    expect(resolveSetupService("codexOAuth", "")).toBe("codexOAuth");
    expect(resolveSetupBaseUrl("codexOAuth", "")).toBe("https://chatgpt.com/backend-api/codex");
    expect(resolveSetupModel("codexOAuth", "")).toBe("gpt-5.5");

    const env = buildSetupEnvContent({
      provider: "codexOAuth",
      baseUrl: "",
      apiKey: "sk-ignored",
      model: "",
    });
    expect(env).toContain("INKOS_LLM_SERVICE=codexOAuth");
    expect(env).toContain("INKOS_LLM_BASE_URL=https://chatgpt.com/backend-api/codex");
    expect(env).toContain("INKOS_LLM_MODEL=gpt-5.5");
    expect(env).toContain("INKOS_LLM_API_FORMAT=responses");
    expect(env).not.toContain("INKOS_LLM_API_KEY");
    expect(hasUsableLlmEnv(env)).toBe(true);
  });
});
