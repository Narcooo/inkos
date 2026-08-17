import { afterEach, describe, expect, it } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { commitAtomicFileSet } from "../utils/atomic-file-set.js";

describe("commitAtomicFileSet", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function createBookFixture(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "inkos-file-set-"));
    roots.push(root);
    await Promise.all([
      mkdir(join(root, "chapters"), { recursive: true }),
      mkdir(join(root, "story"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(root, "chapters", "0001_old.md"), "old chapter", "utf-8"),
      writeFile(join(root, "story", "current_state.md"), "old state", "utf-8"),
      writeFile(join(root, "story", "pending_hooks.md"), "old hooks", "utf-8"),
    ]);
    return root;
  }

  it("commits the complete file set and removes superseded files", async () => {
    const root = await createBookFixture();

    await commitAtomicFileSet({
      rootDir: root,
      writes: [
        { relativePath: "chapters/0001_new.md", content: "new chapter" },
        { relativePath: "story/current_state.md", content: "new state" },
        { relativePath: "story/pending_hooks.md", content: "new hooks" },
      ],
      deletes: ["chapters/0001_old.md"],
    });

    await expect(readFile(join(root, "chapters", "0001_new.md"), "utf-8")).resolves.toBe("new chapter");
    await expect(readFile(join(root, "story", "current_state.md"), "utf-8")).resolves.toBe("new state");
    await expect(readFile(join(root, "story", "pending_hooks.md"), "utf-8")).resolves.toBe("new hooks");
    await expect(readdir(join(root, "chapters"))).resolves.toEqual(["0001_new.md"]);
  });

  it("restores every original file when commit fails after the first replacement", async () => {
    const root = await createBookFixture();
    let stagedRenameCount = 0;

    await expect(commitAtomicFileSet({
      rootDir: root,
      writes: [
        { relativePath: "chapters/0001_new.md", content: "new chapter" },
        { relativePath: "story/current_state.md", content: "new state" },
        { relativePath: "story/pending_hooks.md", content: "new hooks" },
      ],
      deletes: ["chapters/0001_old.md"],
      renameFile: async (from, to) => {
        if (from.includes(`${sep}staged${sep}`)) {
          stagedRenameCount += 1;
          if (stagedRenameCount === 2) {
            throw new Error("injected commit failure");
          }
        }
        await rename(from, to);
      },
    })).rejects.toThrow("injected commit failure");

    await expect(readFile(join(root, "chapters", "0001_old.md"), "utf-8")).resolves.toBe("old chapter");
    await expect(readFile(join(root, "story", "current_state.md"), "utf-8")).resolves.toBe("old state");
    await expect(readFile(join(root, "story", "pending_hooks.md"), "utf-8")).resolves.toBe("old hooks");
    await expect(readdir(join(root, "chapters"))).resolves.toEqual(["0001_old.md"]);
  });
});
