import { describe, it, expect } from "vitest";

/**
 * Replicate the title extraction regex from agent-tools.ts architect branch.
 * This tests the pattern matching logic independently.
 */
function extractTitleFromBible(bible: string): string | undefined {
  const titleMatch = bible.match(/(?:书名|Title)\s*[:：]\s*[《「]?(.+?)[》」]?\s*(?:\n|$)/i)
    ?? bible.match(/^#\s+(.+)/m);
  return titleMatch?.[1]?.trim();
}

describe("book title backfill — extractTitleFromBible", () => {
  it("extracts title from 书名: 格式", () => {
    const bible = "## 基本信息\n\n书名：堕仙杀劫\n\n简介：...";
    expect(extractTitleFromBible(bible)).toBe("堕仙杀劫");
  });

  it("extracts title from 书名：《书名》格式 (with brackets)", () => {
    const bible = "书名：《九龙城夜行》\n简介：一个发生在...";
    expect(extractTitleFromBible(bible)).toBe("九龙城夜行");
  });

  it("extracts title from Title: format (English)", () => {
    const bible = "Title: The Last Dragon\nSynopsis: ...";
    expect(extractTitleFromBible(bible)).toBe("The Last Dragon");
  });

  it("falls back to first heading if no 书名/Title line", () => {
    const bible = "# 天道独行\n\n这是一个关于修仙的故事";
    expect(extractTitleFromBible(bible)).toBe("天道独行");
  });

  it("returns undefined for empty content", () => {
    expect(extractTitleFromBible("")).toBeUndefined();
  });

  it("returns undefined for content without title or heading", () => {
    const bible = "这是世界观设定的详细描述，没有标题行。";
    expect(extractTitleFromBible(bible)).toBeUndefined();
  });

  it("extracts title with「」brackets", () => {
    const bible = "书名：「异常体」\n简介：...";
    expect(extractTitleFromBible(bible)).toBe("异常体");
  });

  it("handles colon variants (English colon)", () => {
    const bible = "书名: 废柴逆袭录\n简介：...";
    expect(extractTitleFromBible(bible)).toBe("废柴逆袭录");
  });
});
