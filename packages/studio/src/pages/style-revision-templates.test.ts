import { describe, expect, it } from "vitest";
import {
  STYLE_REVISION_TEMPLATES,
  buildStyleCreationBrief,
  buildStyleRevisionBrief,
  buildStyleTemplateFromRisuPreset,
  findStyleRevisionTemplate,
} from "./style-revision-templates";

describe("style revision templates", () => {
  it("includes the Inkwell preset as a selectable style", () => {
    const template = findStyleRevisionTemplate("inkwell");

    expect(template).toBeDefined();
    expect(template?.label.ko).toBe("Inkwell");
    expect(template?.rules.ko).toContain("읽는 속도를 빠르게 유지할 것. 중요한 순간만 선명하게 누르고, 연결부는 가볍게 넘기며 설명으로 장면을 멈추지 말 것.");
    expect(template?.rules.ko.join("\n")).toContain("건조한 유머");
  });

  it("includes the sensory Korean template rules", () => {
    const template = findStyleRevisionTemplate("sensory-scene-twist");

    expect(template).toBeDefined();
    expect(template?.label.ko).toBe("감각 장면 + 비틀기");
    expect(template?.rules.ko).toContain("먹는 묘사는 구체적이고 감각적으로.");
    expect(template?.rules.ko).toContain("마지막 문장에서 감상을 직접 쓰지 말 것.");
  });

  it("builds a localized brief that preserves story facts", () => {
    const template = STYLE_REVISION_TEMPLATES.find((entry) => entry.id === "sensory-scene-twist")!;
    const brief = buildStyleRevisionBrief(template, "ko");

    expect(brief).toContain("이미 완성된 장을 문체 중심으로 수정하세요");
    expect(brief).toContain("사건 사실");
    expect(brief).toContain("먹는 묘사는 구체적이고 감각적으로.");
  });

  it("builds a creation brief for book-wide style direction", () => {
    const template = findStyleRevisionTemplate("inkwell")!;
    const brief = buildStyleCreationBrief(template, "ko");

    expect(brief).toContain("작품 전체의 문체 지시");
    expect(brief).toContain("Inkwell");
    expect(brief).toContain("읽는 속도를 빠르게 유지할 것.");
  });

  it("extracts a custom style template from Risu preset JSON", () => {
    const template = buildStyleTemplateFromRisuPreset(JSON.stringify({
      name: "🖊️ Inkwell v1.5",
      promptTemplate: [
        {
          name: "문체 지침",
          text: [
            "# AI Writing-Style",
            "- Keep the reading pace fast.",
            "- Dialogue should consist of short, rapid exchanges.",
            "- Do not copy the user's input actions/descriptions as-is.",
          ].join("\n"),
        },
      ],
    }));

    expect(template.id).toBe("risu-inkwell-v1-5");
    expect(template.label.ko).toBe("Inkwell v1.5");
    expect(template.rules.ko.join("\n")).toContain("Keep the reading pace fast.");
    expect(template.rules.ko.join("\n")).toContain("short, rapid exchanges");
  });
});
