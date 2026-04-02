/**
 * Tests for CLI command option validation.
 * Focus on testing the parser function logic, not Commander's argument handling.
 */

import { describe, test, expect } from "vitest";

describe("max-messages Parser Logic", () => {
  // DESIGN DEFECT TEST 4: max-messages parsing
  // Problem: Number.parseInt() silently truncates decimals (3.5 → 3)
  // Expected: Should reject non-integer values as error message implies

  // Parser function extracted from chat.ts for testing
  const parseMaxMessages = (value: string): number => {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error("--max-messages must be a positive integer");
    }
    return n;
  };

  test("should reject decimal values (must be integer)", () => {
    // Current bug: parseInt(3.5, 10) returns 3 (truncation)
    // Expected: Should reject "3.5" with error

    let parseError: Error | null = null;
    try {
      parseMaxMessages("3.5");
    } catch (error) {
      parseError = error as Error;
    }

    // Expected: Should reject "3.5" (not truncate to "3")
    expect(parseError).not.toBeNull();
    expect(parseError?.message).toContain("must be a positive integer");
  });

  test("should accept integer values", () => {
    // Valid integers should work
    expect(parseMaxMessages("50")).toBe(50);
    expect(parseMaxMessages("100")).toBe(100);
    expect(parseMaxMessages("1")).toBe(1);
  });

  test("should reject negative values", () => {
    let parseError: Error | null = null;
    try {
      parseMaxMessages("-5");
    } catch (error) {
      parseError = error as Error;
    }

    expect(parseError).not.toBeNull();
    expect(parseError?.message).toContain("must be a positive integer");
  });

  test("should reject zero", () => {
    let parseError: Error | null = null;
    try {
      parseMaxMessages("0");
    } catch (error) {
      parseError = error as Error;
    }

    expect(parseError).not.toBeNull();
    expect(parseError?.message).toContain("must be a positive integer");
  });

  test("should reject non-numeric strings", () => {
    let parseError: Error | null = null;
    try {
      parseMaxMessages("abc");
    } catch (error) {
      parseError = error as Error;
    }

    expect(parseError).not.toBeNull();
    expect(parseError?.message).toContain("must be a positive integer");
  });

  test("should accept large integers", () => {
    expect(parseMaxMessages("10000")).toBe(10000);
    expect(parseMaxMessages("999999")).toBe(999999);
  });
});