/**
 * Tests for slash command parser.
 */

import { describe, test, expect } from "vitest";
import { parseSlashCommand, SLASH_COMMANDS } from "../chat/commands.js";

describe("Slash Commands", () => {
  test("should parse /write command", () => {
    const result = parseSlashCommand("/write");

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.command).toBe("write");
      expect(result.args).toEqual([]);
    }
  });

  test("should parse /write with guidance", () => {
    const result = parseSlashCommand("/write --guidance '增加动作戏'");

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.command).toBe("write");
      expect(result.options.guidance).toBe("'增加动作戏'");
    }
  });

  test("should parse /audit with chapter number", () => {
    const result = parseSlashCommand("/audit 5");

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.command).toBe("audit");
      expect(result.args).toEqual(["5"]);
    }
  });

  test("should parse /revise with mode", () => {
    const result = parseSlashCommand("/revise 5 --mode polish");

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.command).toBe("revise");
      expect(result.args).toEqual(["5"]);
      expect(result.options.mode).toBe("polish");
    }
  });

  test("should parse /switch command", () => {
    const result = parseSlashCommand("/switch my-book");

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.command).toBe("switch");
      expect(result.args).toEqual(["my-book"]);
    }
  });

  test("should reject invalid command", () => {
    const result = parseSlashCommand("/invalid");

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("未知命令");
    }
  });

  test("should require argument for /switch", () => {
    const result = parseSlashCommand("/switch");

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("至少需要");
    }
  });

  test("should have all expected commands", () => {
    const commands = Object.keys(SLASH_COMMANDS);

    expect(commands).toContain("write");
    expect(commands).toContain("audit");
    expect(commands).toContain("revise");
    expect(commands).toContain("status");
    expect(commands).toContain("clear");
    expect(commands).toContain("switch");
    expect(commands).toContain("help");
  });
});