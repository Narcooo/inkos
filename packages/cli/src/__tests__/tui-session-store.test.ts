import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createProjectSession,
  loadProjectSession,
  persistProjectSession,
  resolveSessionActiveBook,
} from "../tui/session-store.js";

let projectRoot: string;

describe("tui session store", () => {
  beforeAll(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "inkos-tui-session-"));
    await mkdir(join(projectRoot, "books"), { recursive: true });
  });

  afterAll(async () => {
    // no cleanup needed, tmpdir
  });

  it("creates a default project session", () => {
    const session = createProjectSession(projectRoot);
    expect(session.projectRoot).toBe(projectRoot);
    expect(session.automationMode).toBe("semi");
    expect(session.messages).toEqual([]);
  });

  it("persists and reloads the session", async () => {
    const session = {
      ...createProjectSession(projectRoot),
      activeBookId: "night-harbor",
      automationMode: "auto" as const,
    };

    await persistProjectSession(projectRoot, session);
    const reloaded = await loadProjectSession(projectRoot);

    expect(reloaded.activeBookId).toBe("night-harbor");
    expect(reloaded.automationMode).toBe("auto");
  });

  it("resolves active book from session when it still exists", async () => {
    await writeFile(join(projectRoot, "books", "night-harbor", "book.json"), "{}", "utf-8").catch(async () => {
      await mkdir(join(projectRoot, "books", "night-harbor"), { recursive: true });
      await writeFile(join(projectRoot, "books", "night-harbor", "book.json"), "{}", "utf-8");
    });

    const session = {
      ...createProjectSession(projectRoot),
      activeBookId: "night-harbor",
    };

    expect(await resolveSessionActiveBook(projectRoot, session)).toBe("night-harbor");
  });

  it("falls back to the only book in the project", async () => {
    await mkdir(join(projectRoot, "books", "single-book"), { recursive: true });
    await writeFile(join(projectRoot, "books", "single-book", "book.json"), "{}", "utf-8");

    const singleRoot = await mkdtemp(join(tmpdir(), "inkos-tui-single-"));
    await mkdir(join(singleRoot, "books", "single-book"), { recursive: true });
    await writeFile(join(singleRoot, "books", "single-book", "book.json"), "{}", "utf-8");

    const session = createProjectSession(singleRoot);
    expect(await resolveSessionActiveBook(singleRoot, session)).toBe("single-book");
  });

  it("returns undefined when multiple books exist and no valid active binding is stored", async () => {
    const multiRoot = await mkdtemp(join(tmpdir(), "inkos-tui-multi-"));
    await mkdir(join(multiRoot, "books", "book-a"), { recursive: true });
    await mkdir(join(multiRoot, "books", "book-b"), { recursive: true });
    await writeFile(join(multiRoot, "books", "book-a", "book.json"), "{}", "utf-8");
    await writeFile(join(multiRoot, "books", "book-b", "book.json"), "{}", "utf-8");

    const session = createProjectSession(multiRoot);
    expect(await resolveSessionActiveBook(multiRoot, session)).toBeUndefined();
  });
});
