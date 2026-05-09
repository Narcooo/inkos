import { describe, expect, it } from "vitest";
import {
  STYLE_REVISION_TEMPLATES,
  buildStyleRevisionBrief,
  findStyleRevisionTemplate,
} from "./style-revision-templates";

describe("style revision templates", () => {
  it("includes the sensory Korean template rules", () => {
    const template = findStyleRevisionTemplate("sensory-scene-twist");

    expect(template).toBeDefined();
    expect(template?.label.ko).toBe("감각 장면 + 비틀기");
    expect(template?.rules.ko).toContain("먹는 묘사는 구체적이고 감각적으로.");
    expect(template?.rules.ko).toContain("마지막 문장에서 감상을 직접 쓰지 말 것.");
  });

  it("builds a localized brief that preserves story facts", () => {
    const template = STYLE_REVISION_TEMPLATES[0]!;
    const brief = buildStyleRevisionBrief(template, "ko");

    expect(brief).toContain("이미 완성된 장을 문체 중심으로 수정하세요");
    expect(brief).toContain("사건 사실");
    expect(brief).toContain("먹는 묘사는 구체적이고 감각적으로.");
  });
});
