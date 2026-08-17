import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { splitChapters, type SplitChapter } from "../utils/chapter-splitter.js";

const CHAPTER_FILENAME_COLLATOR = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

export function compareChapterSourceNames(left: string, right: string): number {
  return CHAPTER_FILENAME_COLLATOR.compare(left, right);
}

/**
 * Load chapters from a local source path for `import_chapters`.
 *
 * - Directory mode: each `.md`/`.txt` file becomes one chapter, in filename
 *   natural numeric order. The chapter title is the filename without its extension and
 *   without a leading numeric prefix (e.g. `03_风暴.md` → `风暴`).
 * - Single-file mode: the file is split into chapters with `splitChapters`,
 *   using `splitPattern` as a custom heading regex when provided.
 *
 * This mirrors the pure loading logic of `inkos import chapters` in the CLI
 * so the agent tool does not depend on the CLI package.
 */
export async function loadChaptersFromPath(
  sourcePath: string,
  splitPattern?: string,
): Promise<ReadonlyArray<SplitChapter>> {
  const sourceStat = await stat(sourcePath);

  if (sourceStat.isDirectory()) {
    const entries = await readdir(sourcePath);
    const textFiles = entries
      .filter((f) => f.endsWith(".md") || f.endsWith(".txt"))
      .sort(compareChapterSourceNames);

    if (textFiles.length === 0) {
      throw new Error(`No .md or .txt files found in ${sourcePath}.`);
    }

    return Promise.all(
      textFiles.map(async (f) => {
        const content = await readFile(join(sourcePath, f), "utf-8");
        const title = f.replace(/\.(md|txt)$/, "").replace(/^\d+[_\-\s]*/, "");
        return { title, content };
      }),
    );
  }

  const text = await readFile(sourcePath, "utf-8");
  const chapters = splitChapters(text, splitPattern);

  if (chapters.length === 0) {
    throw new Error(
      `No chapters found in ${sourcePath}. ` +
      `The default pattern matches "第X章/第X回" and "Chapter N" heading lines. ` +
      `Pass splitPattern with a custom regex if the source uses a different heading style.`,
    );
  }

  return chapters;
}
