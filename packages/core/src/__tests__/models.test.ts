import { describe, it, expect } from "vitest";
import {
  BookConfigSchema,
  PlatformSchema,
  GenreSchema,
  BookStatusSchema,
} from "../models/book.js";
import { ChapterMetaSchema, ChapterStatusSchema } from "../models/chapter.js";
import {
  ProjectConfigSchema,
  LLMConfigSchema,
  NotifyChannelSchema,
  InputGovernanceModeSchema,
} from "../models/project.js";
import {
  ChapterIntentSchema,
  ContextPackageSchema,
  RuleStackSchema,
  ChapterTraceSchema,
} from "../models/input-governance.js";
import {
  LengthSpecSchema,
  LengthTelemetrySchema,
  LengthWarningSchema,
} from "../models/length-governance.js";
import {
  RuntimeStateDeltaSchema,
  StateManifestSchema,
  HooksStateSchema,
  ChapterSummariesStateSchema,
  CurrentStateStateSchema,
} from "../models/runtime-state.js";

// ---------------------------------------------------------------------------
// BookConfig
// ---------------------------------------------------------------------------

describe("BookConfigSchema", () => {
  const validBook = {
    id: "test-book-1",
    title: "Test Novel",
    platform: "tomato",
    genre: "xuanhuan",
    status: "active",
    targetChapters: 200,
    chapterWordCount: 3000,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  it("accepts a valid BookConfig", () => {
    const result = BookConfigSchema.parse(validBook);
    expect(result.id).toBe("test-book-1");
    expect(result.title).toBe("Test Novel");
    expect(result.platform).toBe("tomato");
  });

  it("applies default targetChapters and chapterWordCount", () => {
    const minimal = {
      id: "b1",
      title: "B1",
      platform: "qidian",
      genre: "xianxia",
      status: "incubating",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const result = BookConfigSchema.parse(minimal);
    expect(result.targetChapters).toBe(200);
    expect(result.chapterWordCount).toBe(3000);
  });

  it("rejects empty id", () => {
    expect(() =>
      BookConfigSchema.parse({ ...validBook, id: "" }),
    ).toThrow();
  });

  it("rejects empty title", () => {
    expect(() =>
      BookConfigSchema.parse({ ...validBook, title: "" }),
    ).toThrow();
  });

  it("rejects invalid platform", () => {
    expect(() =>
      BookConfigSchema.parse({ ...validBook, platform: "kindle" }),
    ).toThrow();
  });

  it("accepts custom genre (string)", () => {
    const config = BookConfigSchema.parse({ ...validBook, genre: "romance" });
    expect(config.genre).toBe("romance");
  });

  it("rejects invalid status", () => {
    expect(() =>
      BookConfigSchema.parse({ ...validBook, status: "archived" }),
    ).toThrow();
  });

  it("rejects chapterWordCount below 1000", () => {
    expect(() =>
      BookConfigSchema.parse({ ...validBook, chapterWordCount: 500 }),
    ).toThrow();
  });

  it("rejects targetChapters below 1", () => {
    expect(() =>
      BookConfigSchema.parse({ ...validBook, targetChapters: 0 }),
    ).toThrow();
  });

  it("rejects non-integer targetChapters", () => {
    expect(() =>
      BookConfigSchema.parse({ ...validBook, targetChapters: 10.5 }),
    ).toThrow();
  });

  it("rejects invalid datetime strings", () => {
    expect(() =>
      BookConfigSchema.parse({ ...validBook, createdAt: "not-a-date" }),
    ).toThrow();
  });
});

describe("PlatformSchema", () => {
  it.each(["tomato", "feilu", "qidian", "other"] as const)(
    "accepts '%s'",
    (value) => {
      expect(PlatformSchema.parse(value)).toBe(value);
    },
  );

  it("rejects unknown platform", () => {
    expect(() => PlatformSchema.parse("amazon")).toThrow();
  });
});

describe("GenreSchema", () => {
  const validGenres = [
    "xuanhuan",
    "xianxia",
    "urban",
    "horror",
    "other",
  ] as const;

  it.each(validGenres)("accepts '%s'", (value) => {
    expect(GenreSchema.parse(value)).toBe(value);
  });

  it("accepts custom genre strings", () => {
    expect(GenreSchema.parse("scifi")).toBe("scifi");
    expect(GenreSchema.parse("my-custom-genre")).toBe("my-custom-genre");
  });

  it("rejects empty genre", () => {
    expect(() => GenreSchema.parse("")).toThrow();
  });
});

describe("BookStatusSchema", () => {
  const validStatuses = [
    "incubating",
    "outlining",
    "active",
    "paused",
    "completed",
    "dropped",
  ] as const;

  it.each(validStatuses)("accepts '%s'", (value) => {
    expect(BookStatusSchema.parse(value)).toBe(value);
  });

  it("rejects unknown status", () => {
    expect(() => BookStatusSchema.parse("archived")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ChapterMeta
// ---------------------------------------------------------------------------

describe("ChapterMetaSchema", () => {
  const validChapter = {
    number: 1,
    title: "Chapter One",
    status: "drafted",
    wordCount: 3000,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    auditIssues: [],
  };

  it("accepts a valid ChapterMeta", () => {
    const result = ChapterMetaSchema.parse(validChapter);
    expect(result.number).toBe(1);
    expect(result.title).toBe("Chapter One");
    expect(result.status).toBe("drafted");
  });

  it("applies default wordCount of 0", () => {
    const minimal = {
      number: 5,
      title: "Ch5",
      status: "card-generated",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const result = ChapterMetaSchema.parse(minimal);
    expect(result.wordCount).toBe(0);
  });

  it("applies default empty auditIssues", () => {
    const minimal = {
      number: 1,
      title: "Ch1",
      status: "drafted",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const result = ChapterMetaSchema.parse(minimal);
    expect(result.auditIssues).toEqual([]);
  });

  it("applies default empty lengthWarnings", () => {
    const minimal = {
      number: 1,
      title: "Ch1",
      status: "drafted",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const result = ChapterMetaSchema.parse(minimal);
    expect(result.lengthWarnings).toEqual([]);
  });

  it("accepts optional reviewNote", () => {
    const withNote = { ...validChapter, reviewNote: "Looks good" };
    const result = ChapterMetaSchema.parse(withNote);
    expect(result.reviewNote).toBe("Looks good");
  });

  it("omits reviewNote when not provided", () => {
    const result = ChapterMetaSchema.parse(validChapter);
    expect(result.reviewNote).toBeUndefined();
  });

  it("rejects chapter number < 1", () => {
    expect(() =>
      ChapterMetaSchema.parse({ ...validChapter, number: 0 }),
    ).toThrow();
  });

  it("rejects negative chapter number", () => {
    expect(() =>
      ChapterMetaSchema.parse({ ...validChapter, number: -1 }),
    ).toThrow();
  });

  it("rejects invalid status", () => {
    expect(() =>
      ChapterMetaSchema.parse({ ...validChapter, status: "writing" }),
    ).toThrow();
  });

  it("rejects non-integer chapter number", () => {
    expect(() =>
      ChapterMetaSchema.parse({ ...validChapter, number: 1.5 }),
    ).toThrow();
  });
});

describe("ChapterStatusSchema", () => {
  const allStatuses = [
    "card-generated",
    "drafting",
    "drafted",
    "auditing",
    "audit-passed",
    "audit-failed",
    "state-degraded",
    "revising",
    "ready-for-review",
    "approved",
    "rejected",
    "published",
    "imported",
  ] as const;

  it.each(allStatuses)("accepts '%s'", (value) => {
    expect(ChapterStatusSchema.parse(value)).toBe(value);
  });

  it("has exactly 13 valid statuses", () => {
    expect(ChapterStatusSchema.options).toHaveLength(13);
  });

  it("rejects unknown status", () => {
    expect(() => ChapterStatusSchema.parse("editing")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ProjectConfig
// ---------------------------------------------------------------------------

describe("ProjectConfigSchema", () => {
  const validProject = {
    name: "my-project",
    version: "0.1.0" as const,
    llm: {
      provider: "anthropic" as const,
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-key",
      model: "claude-sonnet-4-5-20250514",
    },
    notify: [],
  };

  it("accepts a valid ProjectConfig", () => {
    const result = ProjectConfigSchema.parse(validProject);
    expect(result.name).toBe("my-project");
    expect(result.version).toBe("0.1.0");
  });

  it("applies default daemon config", () => {
    const result = ProjectConfigSchema.parse(validProject);
    expect(result.daemon.maxConcurrentBooks).toBe(3);
    expect(result.daemon.schedule.radarCron).toBe("0 */6 * * *");
    expect(result.daemon.schedule.writeCron).toBe("*/15 * * * *");
    expect(result.daemon.chaptersPerCycle).toBe(1);
    expect(result.daemon.maxChaptersPerDay).toBe(50);
  });

  it("applies default empty notify array", () => {
    const withoutNotify = {
      name: "p1",
      version: "0.1.0" as const,
      llm: validProject.llm,
    };
    const result = ProjectConfigSchema.parse(withoutNotify);
    expect(result.notify).toEqual([]);
  });

  it("defaults input governance mode to v2", () => {
    const result = ProjectConfigSchema.parse(validProject);
    expect(result.inputGovernanceMode).toBe("v2");
  });

  it("rejects wrong version", () => {
    expect(() =>
      ProjectConfigSchema.parse({ ...validProject, version: "1.0.0" }),
    ).toThrow();
  });

  it("rejects empty project name", () => {
    expect(() =>
      ProjectConfigSchema.parse({ ...validProject, name: "" }),
    ).toThrow();
  });

  it("rejects missing LLM config", () => {
    expect(() =>
      ProjectConfigSchema.parse({ name: "p", version: "0.1.0" }),
    ).toThrow();
  });
});

describe("InputGovernanceModeSchema", () => {
  it.each(["legacy", "v2"] as const)("accepts '%s'", (value) => {
    expect(InputGovernanceModeSchema.parse(value)).toBe(value);
  });

  it("rejects unknown input governance modes", () => {
    expect(() => InputGovernanceModeSchema.parse("planner")).toThrow();
  });
});

describe("LLMConfigSchema", () => {
  it("accepts valid LLM config", () => {
    const result = LLMConfigSchema.parse({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-xxx",
      model: "gpt-4o",
    });
    expect(result.provider).toBe("openai");
  });

  it("rejects invalid provider", () => {
    expect(() =>
      LLMConfigSchema.parse({
        provider: "mistral",
        baseUrl: "https://api.example.com",
        apiKey: "key",
        model: "m",
      }),
    ).toThrow();
  });

  it("rejects invalid URL", () => {
    expect(() =>
      LLMConfigSchema.parse({
        provider: "custom",
        baseUrl: "not-a-url",
        apiKey: "key",
        model: "m",
      }),
    ).toThrow();
  });

  it("defaults apiKey to empty string when omitted", () => {
    const result = LLMConfigSchema.parse({
      provider: "anthropic",
      baseUrl: "https://api.example.com",
      model: "m",
    });
    expect(result.apiKey).toBe("");
  });

  it("rejects empty model", () => {
    expect(() =>
      LLMConfigSchema.parse({
        provider: "anthropic",
        baseUrl: "https://api.example.com",
        apiKey: "key",
        model: "",
      }),
    ).toThrow();
  });
});

describe("NotifyChannelSchema", () => {
  it("accepts telegram channel", () => {
    const result = NotifyChannelSchema.parse({
      type: "telegram",
      botToken: "123:ABC",
      chatId: "-100123",
    });
    expect(result.type).toBe("telegram");
  });

  it("accepts feishu channel", () => {
    const result = NotifyChannelSchema.parse({
      type: "feishu",
      webhookUrl: "https://open.feishu.cn/webhook/xxx",
    });
    expect(result.type).toBe("feishu");
  });

  it("accepts wechat-work channel", () => {
    const result = NotifyChannelSchema.parse({
      type: "wechat-work",
      webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx",
    });
    expect(result.type).toBe("wechat-work");
  });

  it("rejects telegram with missing botToken", () => {
    expect(() =>
      NotifyChannelSchema.parse({
        type: "telegram",
        chatId: "-100",
      }),
    ).toThrow();
  });

  it("rejects feishu with invalid URL", () => {
    expect(() =>
      NotifyChannelSchema.parse({
        type: "feishu",
        webhookUrl: "not-a-url",
      }),
    ).toThrow();
  });

  it("rejects unknown channel type", () => {
    expect(() =>
      NotifyChannelSchema.parse({
        type: "slack",
        webhookUrl: "https://hooks.slack.com/xxx",
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Input Governance
// ---------------------------------------------------------------------------

describe("ChapterIntentSchema", () => {
  it("accepts a valid chapter intent", () => {
    const result = ChapterIntentSchema.parse({
      chapter: 12,
      goal: "Pull focus back to the mentor conflict",
      outlineNode: "Volume 2 / Chapter 12",
      sceneDirective: "Break the repeated investigation-room rhythm with a location change.",
      arcDirective: "Advance toward the next concrete arc beat instead of replaying the fallback setup.",
      moodDirective: "Release pressure for one chapter before the next escalation.",
      titleDirective: "Avoid another ledger title and use a new concrete image.",
      mustKeep: ["Protagonist remains injured"],
      mustAvoid: ["Do not reveal the mastermind"],
      styleEmphasis: ["dialogue tension", "character conflict"],
      conflicts: [
        {
          type: "outline_vs_focus",
          resolution: "allow local outline deferral",
        },
      ],
      hookAgenda: {
        pressureMap: [
          {
            hookId: "H019",
            type: "relationship",
            payoffTiming: "slow-burn",
            phase: "middle",
            pressure: "high",
            movement: "partial-payoff",
            reason: "stale-promise",
            blockSiblingHooks: true,
          },
        ],
        mustAdvance: ["H019"],
        eligibleResolve: ["H045"],
        staleDebt: ["H023", "H027"],
        avoidNewHookFamilies: [
          "anonymous-source-restatement",
          "mechanism-restatement",
        ],
      },
    });

    expect(result.chapter).toBe(12);
    expect(result.goal).toContain("mentor conflict");
    expect(result.sceneDirective).toContain("location change");
    expect(result.arcDirective).toContain("arc beat");
    expect(result.moodDirective).toContain("Release pressure");
    expect(result.titleDirective).toContain("ledger title");
    expect(result.conflicts).toHaveLength(1);
    expect(result.hookAgenda.pressureMap).toEqual([
      expect.objectContaining({
        hookId: "H019",
        type: "relationship",
        phase: "middle",
        movement: "partial-payoff",
        pressure: "high",
        payoffTiming: "slow-burn",
        reason: "stale-promise",
      }),
    ]);
    expect(result.hookAgenda.mustAdvance).toEqual(["H019"]);
    expect(result.hookAgenda.eligibleResolve).toEqual(["H045"]);
    expect(result.hookAgenda.staleDebt).toEqual(["H023", "H027"]);
    expect(result.hookAgenda.avoidNewHookFamilies).toEqual([
      "anonymous-source-restatement",
      "mechanism-restatement",
    ]);
  });

  it("defaults optional arrays to empty", () => {
    const result = ChapterIntentSchema.parse({
      chapter: 1,
      goal: "Establish the protagonist's first setback",
    });

    expect(result.sceneDirective).toBeUndefined();
    expect(result.arcDirective).toBeUndefined();
    expect(result.moodDirective).toBeUndefined();
    expect(result.titleDirective).toBeUndefined();
    expect(result.mustKeep).toEqual([]);
    expect(result.mustAvoid).toEqual([]);
    expect(result.styleEmphasis).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.hookAgenda.pressureMap).toEqual([]);
    expect(result.hookAgenda.mustAdvance).toEqual([]);
    expect(result.hookAgenda.eligibleResolve).toEqual([]);
    expect(result.hookAgenda.staleDebt).toEqual([]);
    expect(result.hookAgenda.avoidNewHookFamilies).toEqual([]);
  });

  it("rejects invalid chapter numbers", () => {
    expect(() =>
      ChapterIntentSchema.parse({
        chapter: 0,
        goal: "Bad chapter",
      }),
    ).toThrow();
  });
});

describe("ContextPackageSchema", () => {
  it("accepts selected context with provenance", () => {
    const result = ContextPackageSchema.parse({
      chapter: 8,
      selectedContext: [
        {
          source: "story/current_focus.md",
          reason: "Current focus requests mentor conflict recovery",
          excerpt: "Recent chapters should center the mentor/student break.",
        },
        {
          source: "story/chapter_summaries.md#10",
          reason: "Provide prior conflict context",
        },
      ],
    });

    expect(result.chapter).toBe(8);
    expect(result.selectedContext).toHaveLength(2);
  });

  it("rejects context entries without source", () => {
    expect(() =>
      ContextPackageSchema.parse({
        chapter: 8,
        selectedContext: [
          {
            reason: "Missing source",
          },
        ],
      }),
    ).toThrow();
  });
});

describe("RuleStackSchema", () => {
  it("accepts explicit layer precedence and overrides", () => {
    const result = RuleStackSchema.parse({
      layers: [
        { id: "L1", name: "hard_facts", precedence: 100, scope: "global" },
        { id: "L2", name: "author_intent", precedence: 80, scope: "book" },
        { id: "L3", name: "planning", precedence: 60, scope: "arc" },
        { id: "L4", name: "current_task", precedence: 70, scope: "local" },
      ],
      sections: {
        hard: ["story_bible"],
        soft: ["author_intent", "current_focus"],
        diagnostic: ["anti_ai_checks"],
      },
      overrideEdges: [
        { from: "L4", to: "L3", allowed: true, scope: "current_chapter" },
        { from: "L4", to: "L2", allowed: false, scope: "current_chapter" },
      ],
      activeOverrides: [
        {
          from: "L4",
          to: "L3",
          target: "volume_outline.chapter_12",
          reason: "Current focus overrides the local plan",
        },
      ],
    });

    expect(result.layers[0]?.id).toBe("L1");
    expect(result.sections.hard).toContain("story_bible");
    expect(result.activeOverrides).toHaveLength(1);
  });

  it("defaults override lists to empty", () => {
    const result = RuleStackSchema.parse({
      layers: [
        { id: "L1", name: "hard_facts", precedence: 100, scope: "global" },
      ],
    });

    expect(result.sections).toEqual({
      hard: [],
      soft: [],
      diagnostic: [],
    });
    expect(result.overrideEdges).toEqual([]);
    expect(result.activeOverrides).toEqual([]);
  });

  it("rejects empty rule stacks", () => {
    expect(() =>
      RuleStackSchema.parse({
        layers: [],
      }),
    ).toThrow();
  });
});

describe("ChapterTraceSchema", () => {
  it("accepts trace metadata for planner/composer output", () => {
    const result = ChapterTraceSchema.parse({
      chapter: 8,
      plannerInputs: [
        "story/author_intent.md",
        "story/current_focus.md",
      ],
      composerInputs: [
        "story/runtime/chapter-0008.intent.md",
      ],
      selectedSources: [
        "story/current_state.md",
        "story/chapter_summaries.md#7",
      ],
      notes: ["current_focus locally overrides planning"],
    });

    expect(result.plannerInputs).toContain("story/author_intent.md");
    expect(result.notes).toHaveLength(1);
  });

  it("defaults notes to empty", () => {
    const result = ChapterTraceSchema.parse({
      chapter: 2,
      plannerInputs: [],
      composerInputs: [],
      selectedSources: [],
    });

    expect(result.notes).toEqual([]);
  });
});

describe("Length governance schemas", () => {
  it("accepts a conservative length spec", () => {
    const result = LengthSpecSchema.parse({
      target: 2200,
      softMin: 1900,
      softMax: 2500,
      hardMin: 1600,
      hardMax: 2800,
      countingMode: "zh_chars",
      normalizeMode: "compress",
    });

    expect(result.target).toBe(2200);
    expect(result.softMin).toBe(1900);
    expect(result.normalizeMode).toBe("compress");
  });

  it("accepts telemetry for a chapter length pass", () => {
    const result = LengthTelemetrySchema.parse({
      target: 2200,
      softMin: 1900,
      softMax: 2500,
      hardMin: 1600,
      hardMax: 2800,
      countingMode: "en_words",
      writerCount: 2600,
      postWriterNormalizeCount: 2450,
      postReviseCount: 2480,
      finalCount: 2480,
      normalizeApplied: true,
      lengthWarning: false,
    });

    expect(result.writerCount).toBe(2600);
    expect(result.normalizeApplied).toBe(true);
  });

  it("accepts a warning when final length drifts outside the hard band", () => {
    const result = LengthWarningSchema.parse({
      chapter: 12,
      target: 2200,
      actual: 3100,
      countingMode: "zh_chars",
      reason: "chapter exceeded the hard max after one normalization pass",
    });

    expect(result.chapter).toBe(12);
    expect(result.actual).toBe(3100);
  });
});

describe("Runtime state schemas", () => {
  it("accepts a valid state manifest", () => {
    const result = StateManifestSchema.parse({
      schemaVersion: 2,
      language: "en",
      lastAppliedChapter: 12,
      projectionVersion: 1,
      migrationWarnings: [],
    });

    expect(result.language).toBe("en");
    expect(result.lastAppliedChapter).toBe(12);
  });

  it("accepts hook, summary, and current-state payloads", () => {
    const hooks = HooksStateSchema.parse({
      hooks: [
        {
          hookId: "mentor-debt",
          startChapter: 1,
          type: "relationship",
          status: "open",
          lastAdvancedChapter: 12,
          expectedPayoff: "Reveal the debt",
          notes: "Still unresolved",
        },
      ],
    });
    const summaries = ChapterSummariesStateSchema.parse({
      rows: [
        {
          chapter: 12,
          title: "River Ledger",
          characters: "Lin Yue",
          events: "Lin Yue checks the old ledger",
          stateChanges: "Debt sharpens",
          hookActivity: "mentor-debt advanced",
          mood: "tense",
          chapterType: "mainline",
        },
      ],
    });
    const currentState = CurrentStateStateSchema.parse({
      chapter: 12,
      facts: [
        {
          subject: "protagonist",
          predicate: "Current Goal",
          object: "Trace the mentor debt",
          validFromChapter: 12,
          validUntilChapter: null,
          sourceChapter: 12,
        },
      ],
    });

    expect(hooks.hooks[0]?.hookId).toBe("mentor-debt");
    expect(summaries.rows[0]?.title).toBe("River Ledger");
    expect(currentState.chapter).toBe(12);
  });

  it("accepts a valid runtime-state delta", () => {
    const result = RuntimeStateDeltaSchema.parse({
      chapter: 12,
      currentStatePatch: {
        currentGoal: "Trace the mentor debt",
        currentConflict: "Guild pressure keeps colliding with the debt trail",
      },
      hookOps: {
        upsert: [
          {
            hookId: "mentor-debt",
            startChapter: 1,
            type: "relationship",
            status: "progressing",
            lastAdvancedChapter: 12,
            expectedPayoff: "Reveal the debt",
            notes: "Ledger clue sharpens the line",
          },
        ],
        mention: ["ledger-whisper"],
        resolve: [],
        defer: [],
      },
      newHookCandidates: [
        {
          type: "source-risk",
          expectedPayoff: "Reveal what the anonymous source already knew",
          notes: "A new unresolved thread opens around the source's prior knowledge.",
        },
      ],
      chapterSummary: {
        chapter: 12,
        title: "River Ledger",
        characters: "Lin Yue",
        events: "Lin Yue checks the old ledger",
        stateChanges: "Debt sharpens",
        hookActivity: "mentor-debt advanced",
        mood: "tense",
        chapterType: "mainline",
      },
      notes: [],
    });

    expect(result.chapter).toBe(12);
    expect(result.hookOps.upsert[0]?.hookId).toBe("mentor-debt");
    expect(result.hookOps.mention).toEqual(["ledger-whisper"]);
    expect(result.newHookCandidates[0]?.type).toBe("source-risk");
  });

  it("rejects natural-language numeric drift in runtime-state delta hooks", () => {
    expect(() =>
      RuntimeStateDeltaSchema.parse({
        chapter: 12,
        hookOps: {
          upsert: [
            {
              hookId: "mentor-debt",
              startChapter: 1,
              type: "relationship",
              status: "open",
              lastAdvancedChapter: "chapter twelve",
            },
          ],
          resolve: [],
          defer: [],
        },
        notes: [],
      }),
    ).toThrow();
  });
});
