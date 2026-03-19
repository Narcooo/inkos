import { describe, it, expect } from "vitest";
import { parseSettlementOutput, type SettlementOutput } from "../agents/settler-parser.js";
import type { GenreProfile } from "../models/genre-profile.js";

const gpWithNumerical: GenreProfile = {
  name: "玄幻",
  id: "xuanhuan",
  language: "zh",
  chapterTypes: [],
  auditDimensions: [],
  fatigueWords: [],
  satisfactionTypes: [],
  numericalSystem: true,
  powerScaling: false,
  eraResearch: false,
  pacingRule: "",
};

const gpWithoutNumerical: GenreProfile = {
  ...gpWithNumerical,
  name: "都市",
  numericalSystem: false,
};

const fullOutput = `=== POST_SETTLEMENT ===
结算完成，主角获得灵石100。

=== UPDATED_STATE ===
| 字段 | 值 |
|------|-----|
| 当前章节 | 5 |

=== UPDATED_LEDGER ===
| 灵石 | 100 |

=== UPDATED_HOOKS ===
| hook_id | 起始章节 | 类型 | 状态 |
| H01 | 3 | 伏线 | active |

=== CHAPTER_SUMMARY ===
| 章节 | 标题 | 出场人物 | 关键事件 |
| 5 | 灵石矿 | 主角 | 获得灵石 |

=== UPDATED_SUBPLOTS ===
支线A推进

=== UPDATED_EMOTIONAL_ARCS ===
主角情绪高涨

=== UPDATED_CHARACTER_MATRIX ===
| 角色A | 角色B | 关系 |
`;

describe("parseSettlementOutput", () => {
  it("extracts all tags from well-formed output", () => {
    const result = parseSettlementOutput(fullOutput, gpWithNumerical);
    expect(result.postSettlement).toContain("灵石100");
    expect(result.updatedState).toContain("当前章节");
    expect(result.updatedLedger).toContain("灵石");
    expect(result.updatedHooks).toContain("H01");
    expect(result.chapterSummary).toContain("灵石矿");
    expect(result.updatedSubplots).toContain("支线A");
    expect(result.updatedEmotionalArcs).toContain("情绪高涨");
    expect(result.updatedCharacterMatrix).toContain("角色A");
  });

  it("returns empty ledger when numericalSystem is false", () => {
    const result = parseSettlementOutput(fullOutput, gpWithoutNumerical);
    expect(result.updatedLedger).toBe("");
  });

  it("provides fallback for missing state/hooks", () => {
    const result = parseSettlementOutput("", gpWithNumerical);
    expect(result.updatedState).toBe("(状态卡未更新)");
    expect(result.updatedHooks).toBe("(伏笔池未更新)");
    expect(result.updatedLedger).toBe("(账本未更新)");
  });

  it("handles partial output (only some tags present)", () => {
    const partial = `=== UPDATED_STATE ===
| 字段 | 值 |
| 当前章节 | 3 |

=== UPDATED_HOOKS ===
| H01 | active |
`;
    const result = parseSettlementOutput(partial, gpWithoutNumerical);
    expect(result.updatedState).toContain("当前章节");
    expect(result.updatedHooks).toContain("H01");
    expect(result.postSettlement).toBe("");
    expect(result.chapterSummary).toBe("");
  });
});
