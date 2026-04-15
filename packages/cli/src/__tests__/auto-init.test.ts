import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";

// Mock readline to simulate user input
const questionMock = vi.fn();
const closeMock = vi.fn();
vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: questionMock,
    close: closeMock,
  }),
}));

// Mock loadProjectConfig from core
const loadProjectConfigMock = vi.fn();
vi.mock("@actalk/inkos-core", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    loadProjectConfig: (...args: unknown[]) => loadProjectConfigMock(...args),
  };
});

describe("loadConfig auto-init", () => {
  let tmpDir: string;
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await mkdtemp(join(tmpdir(), "inkos-auto-init-"));
  });

  afterEach(async () => {
    process.stdin.isTTY = originalIsTTY;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("prompts and auto-initializes when inkos.json is missing in TTY mode", async () => {
    process.stdin.isTTY = true;

    // First call: throw "not found"; second call after init: succeed
    const fakeConfig = { llm: { provider: "openai", baseUrl: "", model: "", apiKey: "" } };
    loadProjectConfigMock
      .mockRejectedValueOnce(new Error(`inkos.json not found in ${tmpDir}.`))
      .mockResolvedValueOnce(fakeConfig);

    // Simulate user pressing Enter (empty = default Y)
    questionMock.mockImplementation((_q: string, cb: (answer: string) => void) => cb(""));

    const { loadConfig } = await import("../utils.js");
    const result = await loadConfig({ projectRoot: tmpDir, requireApiKey: false });

    expect(result).toEqual(fakeConfig);
    expect(loadProjectConfigMock).toHaveBeenCalledTimes(2);

    // Verify files were created
    const inkosJson = JSON.parse(await readFile(join(tmpDir, "inkos.json"), "utf-8"));
    expect(inkosJson.version).toBe("0.1.0");
    expect(inkosJson.language).toBe("zh");
    expect((await stat(join(tmpDir, "books"))).isDirectory()).toBe(true);
  });

  it("throws the original error when user declines init", async () => {
    process.stdin.isTTY = true;

    loadProjectConfigMock
      .mockRejectedValue(new Error(`inkos.json not found in ${tmpDir}.`));

    // Simulate user typing "n"
    questionMock.mockImplementation((_q: string, cb: (answer: string) => void) => cb("n"));

    const { loadConfig } = await import("../utils.js");

    await expect(loadConfig({ projectRoot: tmpDir, requireApiKey: false }))
      .rejects.toThrow(/inkos\.json not found/);
  });

  it("throws immediately in non-TTY mode without prompting", async () => {
    process.stdin.isTTY = false;

    loadProjectConfigMock
      .mockRejectedValue(new Error(`inkos.json not found in ${tmpDir}.`));

    const { loadConfig } = await import("../utils.js");

    await expect(loadConfig({ projectRoot: tmpDir, requireApiKey: false }))
      .rejects.toThrow(/inkos\.json not found/);

    // Should not have prompted
    expect(questionMock).not.toHaveBeenCalled();
  });
});
