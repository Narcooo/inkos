import { describe, it, expect } from "vitest";
import { BookRulesSchema, parseBookRules } from "../models/book-rules.js";

describe("BookRulesSchema", () => {
  it("accepts empty object with all defaults", () => {
    const result = BookRulesSchema.parse({});
    expect(result.version).toBe("1.0");
    expect(result.prohibitions).toEqual([]);
    expect(result.chapterTypesOverride).toEqual([]);
    expect(result.fatigueWordsOverride).toEqual([]);
    expect(result.additionalAuditDimensions).toEqual([]);
    expect(result.enableFullCastTracking).toBe(false);
    expect(result.allowedDeviations).toEqual([]);
  });

  it("accepts protagonist with defaults", () => {
    const result = BookRulesSchema.parse({
      protagonist: { name: "张三" },
    });
    expect(result.protagonist?.name).toBe("张三");
    expect(result.protagonist?.personalityLock).toEqual([]);
    expect(result.protagonist?.behavioralConstraints).toEqual([]);
  });

  it("accepts genreLock with forbidden defaults", () => {
    const result = BookRulesSchema.parse({
      genreLock: { primary: "xuanhuan" },
    });
    expect(result.genreLock?.primary).toBe("xuanhuan");
    expect(result.genreLock?.forbidden).toEqual([]);
  });

  it("accepts numerical system overrides", () => {
    const result = BookRulesSchema.parse({
      numericalSystemOverrides: {
        hardCap: 9999,
        resourceTypes: ["灵石", "功德"],
      },
    });
    expect(result.numericalSystemOverrides?.hardCap).toBe(9999);
    expect(result.numericalSystemOverrides?.resourceTypes).toEqual(["灵石", "功德"]);
  });

  it("accepts era constraints", () => {
    const result = BookRulesSchema.parse({
      eraConstraints: { enabled: true, period: "唐朝", region: "长安" },
    });
    expect(result.eraConstraints?.enabled).toBe(true);
    expect(result.eraConstraints?.period).toBe("唐朝");
  });

  it("accepts fanficMode and allowedDeviations", () => {
    const result = BookRulesSchema.parse({
      fanficMode: "au",
      allowedDeviations: ["world-building", "magic-system"],
    });
    expect(result.fanficMode).toBe("au");
    expect(result.allowedDeviations).toEqual(["world-building", "magic-system"]);
  });

  it("accepts all four fanfic modes", () => {
    for (const mode of ["canon", "au", "ooc", "cp"] as const) {
      const result = BookRulesSchema.parse({ fanficMode: mode });
      expect(result.fanficMode).toBe(mode);
    }
  });

  it("rejects invalid fanficMode", () => {
    expect(() => BookRulesSchema.parse({ fanficMode: "crossover" })).toThrow();
  });

  it("accepts mixed audit dimensions (numbers and strings)", () => {
    const result = BookRulesSchema.parse({
      additionalAuditDimensions: [5, "OOC检查", 12],
    });
    expect(result.additionalAuditDimensions).toEqual([5, "OOC检查", 12]);
  });
});

describe("parseBookRules", () => {
  it("parses valid YAML frontmatter", () => {
    const raw = `---
version: "2.0"
prohibitions:
  - 跪舔
  - 龙傲天
enableFullCastTracking: true
---
这是正文部分的文风指南。`;
    const { rules, body } = parseBookRules(raw);
    expect(rules.version).toBe("2.0");
    expect(rules.prohibitions).toEqual(["跪舔", "龙傲天"]);
    expect(rules.enableFullCastTracking).toBe(true);
    expect(body).toBe("这是正文部分的文风指南。");
  });

  it("returns defaults when no frontmatter found", () => {
    const raw = "这只是普通文本，没有YAML。";
    const { rules, body } = parseBookRules(raw);
    expect(rules.version).toBe("1.0");
    expect(rules.prohibitions).toEqual([]);
    expect(body).toBe("这只是普通文本，没有YAML。");
  });

  it("strips markdown code block wrappers", () => {
    const raw = "```md\n---\nversion: \"1.0\"\n---\nbody text\n```";
    const { rules, body } = parseBookRules(raw);
    expect(rules.version).toBe("1.0");
    expect(body).toBe("body text");
  });

  it("returns defaults on invalid YAML", () => {
    const raw = "---\n: invalid yaml [[\n---\nbody";
    const { rules, body } = parseBookRules(raw);
    expect(rules.version).toBe("1.0");
    // Should fall through to default
    expect(body.length).toBeGreaterThan(0);
  });

  it("handles empty string", () => {
    const { rules, body } = parseBookRules("");
    expect(rules.version).toBe("1.0");
    expect(body).toBe("");
  });

  it("parses protagonist from frontmatter", () => {
    const raw = `---
protagonist:
  name: 陈风
  personalityLock: [冷静, 果断]
  behavioralConstraints: [不杀无辜]
---
content`;
    const { rules } = parseBookRules(raw);
    expect(rules.protagonist?.name).toBe("陈风");
    expect(rules.protagonist?.personalityLock).toEqual(["冷静", "果断"]);
  });

  it("parses fanficMode from frontmatter", () => {
    const raw = `---
fanficMode: cp
allowedDeviations: [relationship-dynamics]
---
fanfic rules`;
    const { rules, body } = parseBookRules(raw);
    expect(rules.fanficMode).toBe("cp");
    expect(rules.allowedDeviations).toEqual(["relationship-dynamics"]);
    expect(body).toBe("fanfic rules");
  });
});
