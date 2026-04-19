import { describe, expect, it } from "vitest";
import { buildAutoInitMessages, buildInteractiveSetupCopy } from "../tui/setup.js";

describe("tui setup i18n", () => {
  it("builds Chinese setup copy by default", () => {
    const copy = buildInteractiveSetupCopy("zh-CN");
    expect(copy.title).toBe("模型配置");
    expect(copy.subtitle).toContain("配置模型服务");
    expect(copy.steps.provider).toBe("服务提供方");
    expect(copy.steps.scope).toBe("保存范围");
    expect(copy.scopeChoices.project).toBe("当前目录");
  });

  it("builds localized auto-init messages", () => {
    expect(buildAutoInitMessages("山海", "zh-CN").initializing).toContain("正在初始化项目：山海");
    expect(buildAutoInitMessages("harbor", "en").initialized).toContain("Project initialized");
  });
});
