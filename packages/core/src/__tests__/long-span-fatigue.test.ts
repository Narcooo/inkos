import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeLongSpanFatigue } from "../utils/long-span-fatigue.js";

async function createBookDir(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const bookDir = join(root, "book");
  await mkdir(join(bookDir, "story"), { recursive: true });
  await mkdir(join(bookDir, "chapters"), { recursive: true });
  return bookDir;
}

async function writeChapter(bookDir: string, chapter: number, title: string, body: string): Promise<void> {
  const filename = `${String(chapter).padStart(4, "0")}_${title}.md`;
  await writeFile(
    join(bookDir, "chapters", filename),
    `# 第${chapter}章 ${title}\n\n${body}\n`,
    "utf-8",
  );
}

describe("analyzeLongSpanFatigue", () => {
  it("warns when the last three chapter types are identical", async () => {
    const bookDir = await createBookDir("inkos-long-span-type-test-");

    await Promise.all([
      writeChapter(bookDir, 1, "铺陈", "城门口下着雨。林越压低斗笠，慢慢走进旧巷。风从墙缝里钻出来。"),
      writeChapter(bookDir, 2, "潜伏", "午后的石街很亮。林越在茶棚外停了一下，随后绕向后院。铜铃轻轻响了一声。"),
      writeFile(
        join(bookDir, "story", "chapter_summaries.md"),
        [
          "# 章节摘要",
          "",
          "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |",
          "|------|------|----------|----------|----------|----------|----------|----------|",
          "| 1 | 铺陈 | 林越 | 进城 | 潜伏开始 | 债印未解 | 克制 | 布局 |",
          "| 2 | 潜伏 | 林越 | 试探 | 线索加深 | 债印未解 | 克制 | 布局 |",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    try {
      const result = await analyzeLongSpanFatigue({
        bookDir,
        chapterNumber: 3,
        chapterContent: "夜色像潮水一样漫到院墙根。林越没有立刻翻墙，而是先贴着墙根听了一阵。最后，他把手按在那道旧债印上。",
        chapterSummary: "| 3 | 试探 | 林越 | 继续潜伏 | 目标未变 | 债印未解 | 克制 | 布局 |",
        language: "zh",
      });

      expect(result.issues.some((issue) => issue.category === "节奏单调")).toBe(true);
    } finally {
      await rm(join(bookDir, ".."), { recursive: true, force: true });
    }
  });

  it("warns in English when recent chapter endings are highly similar", async () => {
    const bookDir = await createBookDir("inkos-long-span-ending-test-");

    await Promise.all([
      writeChapter(bookDir, 1, "Debt", "The rain had finally stopped. The harbor lights thinned behind him. He knew the debt had only grown heavier."),
      writeChapter(bookDir, 2, "Weight", "Morning fog crawled over the quay. No one called his name. He knew the debt had only grown heavier tonight."),
    ]);

    try {
      const result = await analyzeLongSpanFatigue({
        bookDir,
        chapterNumber: 3,
        chapterContent: "The alley was empty by the time he turned back. Even the dogs had gone quiet. He knew the debt had only grown heavier again.",
        language: "en",
      });

      expect(result.issues.some((issue) => issue.category === "Ending Pattern Repetition")).toBe(true);
      expect(result.issues.some((issue) => issue.description.includes("last 3 chapter endings"))).toBe(true);
    } finally {
      await rm(join(bookDir, ".."), { recursive: true, force: true });
    }
  });
});
