import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProgram } from "../program.js";

describe("interact command", () => {
  const originalArgv = process.argv;
  let projectRoot: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn> | {
    mockClear: () => void;
    mock: { calls: Array<ReadonlyArray<unknown>> };
  };

  beforeEach(async () => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    projectRoot = await mkdtemp(join(tmpdir(), "inkos-interact-cli-"));
    await mkdir(join(projectRoot, "books", "harbor"), { recursive: true });
    await writeFile(join(projectRoot, "books", "harbor", "book.json"), "{}", "utf-8");
    stdoutSpy.mockClear();
    process.argv = originalArgv;
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it("routes natural language through the shared executor and prints plain text by default", async () => {
    const runInteraction = vi.fn(async () => ({
      request: { intent: "write_next" },
      responseText: "Continuing harbor.",
      session: {
        activeBookId: "harbor",
        automationMode: "semi",
        messages: [{ role: "assistant", content: "Continuing harbor.", timestamp: 1 }],
        events: [{ kind: "task.completed", status: "completed", timestamp: 1 }],
      },
    }));

    const program = createProgram({
      runInteraction,
      readInteractionInput: async () => "",
    });

    await program.parseAsync(["interact", "continue", "--book", "harbor"], {
      from: "user",
    });

    expect(runInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: process.cwd(),
        input: "continue",
        activeBookId: "harbor",
      }),
    );
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining("Continuing harbor."));
  });

  it("emits structured JSON when --json is used", async () => {
    const runInteraction = vi.fn(async () => ({
      request: { intent: "switch_mode", mode: "auto" },
      responseText: "Switched to auto.",
      session: {
        activeBookId: "harbor",
        automationMode: "auto",
        messages: [],
        events: [{ kind: "task.completed", status: "completed", timestamp: 1 }],
      },
    }));

    const program = createProgram({
      runInteraction,
      readInteractionInput: async () => "",
    });

    await program.parseAsync(["interact", "切换到全自动", "--book", "harbor", "--json"], {
      from: "user",
    });

    const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
    const parsed = JSON.parse(output);
    expect(parsed.request.intent).toBe("switch_mode");
    expect(parsed.responseText).toBe("Switched to auto.");
    expect(parsed.session.automationMode).toBe("auto");
  });

  it("accepts --message as an explicit OpenClaw-friendly input channel", async () => {
    const runInteraction = vi.fn(async () => ({
      request: { intent: "continue_book" },
      responseText: "Continuing via --message.",
      session: {
        activeBookId: "harbor",
        automationMode: "semi",
        messages: [],
        events: [],
      },
    }));

    const program = createProgram({
      runInteraction,
      readInteractionInput: async () => "",
    });

    await program.parseAsync(["interact", "--book", "harbor", "--message", "continue current book"], {
      from: "user",
    });

    expect(runInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        input: "continue current book",
        activeBookId: "harbor",
      }),
    );
  });

  it("reads the message from stdin when no args are provided", async () => {
    const runInteraction = vi.fn(async () => ({
      request: { intent: "explain_status" },
      responseText: "Explaining status.",
      session: {
        activeBookId: "harbor",
        automationMode: "semi",
        messages: [],
        events: [],
      },
    }));

    const program = createProgram({
      runInteraction,
      readInteractionInput: async () => "why did it stop?",
    });

    await program.parseAsync(["interact"], { from: "user" });

    expect(runInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        input: "why did it stop?",
      }),
    );
  });
});
