import { describe, it, expect } from "vitest";
import {
  buildEnglishGenreIntro,
  buildEnglishCoreRules,
  buildEnglishAntiAIRules,
  buildEnglishCharacterMethod,
  buildEnglishPreWriteChecklist,
} from "../agents/en-prompt-sections.js";
import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";

const baseBook: BookConfig = {
  id: "test-en",
  title: "Test EN Book",
  platform: "other",
  genre: "litrpg",
  status: "active",
  targetChapters: 100,
  chapterWordCount: 2000,
  language: "en",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const baseGP: GenreProfile = {
  id: "litrpg",
  name: "LitRPG",
  language: "en",
  chapterTypes: ["action", "progression", "downtime"],
  fatigueWords: ["suddenly"],
  pacingRule: "Hook every 2 chapters",
  numericalSystem: true,
  powerScaling: true,
  eraResearch: false,
  auditDimensions: [],
  satisfactionTypes: [],
};

describe("buildEnglishGenreIntro", () => {
  it("includes genre name", () => {
    const result = buildEnglishGenreIntro(baseBook, baseGP);
    expect(result).toContain("LitRPG");
  });

  it("includes chapter word count and target", () => {
    const result = buildEnglishGenreIntro(baseBook, baseGP);
    expect(result).toContain("2000");
    expect(result).toContain("100");
  });

  it("instructs to write in English", () => {
    const result = buildEnglishGenreIntro(baseBook, baseGP);
    expect(result).toContain("English");
  });
});

describe("buildEnglishCoreRules", () => {
  it("returns non-empty content", () => {
    const result = buildEnglishCoreRules(baseBook);
    expect(result.length).toBeGreaterThan(100);
  });

  it("includes show don't tell rule", () => {
    const result = buildEnglishCoreRules(baseBook);
    expect(result).toContain("Show, don't tell");
  });

  it("includes character consistency rules", () => {
    const result = buildEnglishCoreRules(baseBook);
    expect(result).toContain("Consistency");
    expect(result).toContain("No puppets");
  });
});

describe("buildEnglishAntiAIRules", () => {
  it("contains all 7 iron laws", () => {
    const result = buildEnglishAntiAIRules();
    for (let i = 1; i <= 7; i++) {
      expect(result).toContain(`IRON LAW ${i}`);
    }
  });

  it("includes example table", () => {
    const result = buildEnglishAntiAIRules();
    expect(result).toContain("AI Pattern");
    expect(result).toContain("Human Version");
  });
});

describe("buildEnglishCharacterMethod", () => {
  it("includes 5-step checklist", () => {
    const result = buildEnglishCharacterMethod();
    expect(result).toContain("Situation");
    expect(result).toContain("Want");
    expect(result).toContain("Personality filter");
    expect(result).toContain("Action");
    expect(result).toContain("Reaction");
  });

  it("warns terms are not for prose", () => {
    const result = buildEnglishCharacterMethod();
    expect(result).toContain("never appear in the chapter text");
  });
});

describe("buildEnglishPreWriteChecklist", () => {
  it("includes core items", () => {
    const result = buildEnglishPreWriteChecklist(baseBook, baseGP);
    expect(result).toContain("Outline anchor");
    expect(result).toContain("POV");
    expect(result).toContain("Hook planted");
    expect(result).toContain("Sensory grounding");
    expect(result).toContain("AI-tell check");
  });

  it("includes word count target", () => {
    const result = buildEnglishPreWriteChecklist(baseBook, baseGP);
    expect(result).toContain("2000");
  });

  it("includes power scaling when enabled", () => {
    const result = buildEnglishPreWriteChecklist(baseBook, baseGP);
    expect(result).toContain("Power scaling");
  });

  it("includes numerical check when enabled", () => {
    const result = buildEnglishPreWriteChecklist(baseBook, baseGP);
    expect(result).toContain("Numerical check");
  });

  it("omits power scaling when disabled", () => {
    const gpNoPower = { ...baseGP, powerScaling: false, numericalSystem: false };
    const result = buildEnglishPreWriteChecklist(baseBook, gpNoPower);
    expect(result).not.toContain("Power scaling");
    expect(result).not.toContain("Numerical check");
  });

  it("includes genre pacing rule", () => {
    const result = buildEnglishPreWriteChecklist(baseBook, baseGP);
    expect(result).toContain("Hook every 2 chapters");
  });
});
