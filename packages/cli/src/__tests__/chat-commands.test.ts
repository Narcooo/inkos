/**
 * Tests for slash command parser.
 */

import { describe, test, expect } from "vitest";
import {
  getAutocompleteInput,
  parseSlashCommand,
  SLASH_COMMANDS,
  validateCommandArgs,
} from "../chat/commands.js";

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
      expect(result.options.guidance).toBe("增加动作戏"); // Quotes are stripped
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

  test("should reject extra positional args for zero-arg commands", () => {
    const result = parseSlashCommand("/status foo");

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("不接受额外参数");
    }
  });

  test("should reject extra positional args for single-arg commands", () => {
    const result = parseSlashCommand("/switch my-book extra");

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("最多接受 1 个参数");
    }
  });

  test("should reject positional args for option-only commands", () => {
    const result = parseSlashCommand("/write draft");

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("不接受额外参数");
    }
  });

  test("should enforce max positional args in validateCommandArgs", () => {
    const result = validateCommandArgs("switch", ["my-book", "extra"]);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("最多接受 1 个参数");
    }
  });

  test("should parse /exit even with trailing whitespace", () => {
    const result = parseSlashCommand("/exit ");

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.command).toBe("exit");
      expect(result.args).toEqual([]);
    }
  });

  test("should not append trailing space for zero-argument autocomplete commands", () => {
    expect(getAutocompleteInput("exit")).toBe("/exit");
    expect(getAutocompleteInput("clear")).toBe("/clear");
  });

  test("should append trailing space for autocomplete commands expecting more input", () => {
    expect(getAutocompleteInput("write")).toBe("/write ");
    expect(getAutocompleteInput("switch")).toBe("/switch ");
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
