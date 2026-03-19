import { describe, it, expect } from "vitest";
import { splitChapters } from "../utils/chapter-splitter.js";

describe("splitChapters", () => {
  it("splits Chinese numeral chapters", () => {
    const text = `第一章 开始
这是第一章的内容。
一些故事。

第二章 继续
这是第二章。

第三章 结局
最终的结局。`;

    const result = splitChapters(text);
    expect(result).toHaveLength(3);
    expect(result[0]!.title).toBe("开始");
    expect(result[0]!.content).toContain("第一章的内容");
    expect(result[1]!.title).toBe("继续");
    expect(result[2]!.title).toBe("结局");
  });

  it("splits Arabic numeral chapters", () => {
    const text = `第1章 起步
内容1

第2章 发展
内容2`;

    const result = splitChapters(text);
    expect(result).toHaveLength(2);
    expect(result[0]!.title).toBe("起步");
    expect(result[1]!.title).toBe("发展");
  });

  it("handles markdown heading prefix", () => {
    const text = `# 第1章 标题一
内容1

## 第2章 标题二
内容2`;

    const result = splitChapters(text);
    expect(result).toHaveLength(2);
    expect(result[0]!.title).toBe("标题一");
  });

  it("returns empty array when no chapters found", () => {
    const text = "这是一段没有章节标记的文本。";
    const result = splitChapters(text);
    expect(result).toHaveLength(0);
  });

  it("assigns default title when title is empty", () => {
    const text = `第1章
内容

第2章
更多内容`;

    const result = splitChapters(text);
    expect(result).toHaveLength(2);
    expect(result[0]!.title).toBe("第1章");
    expect(result[1]!.title).toBe("第2章");
  });

  it("trims content whitespace", () => {
    const text = `第一章 测试

    前面有空白
    
    后面有空白

第二章 下一章
内容`;

    const result = splitChapters(text);
    expect(result[0]!.content).toBe("前面有空白\n    \n    后面有空白");
  });

  it("supports custom pattern", () => {
    const text = `Chapter 1 Start
Content one.

Chapter 2 Middle
Content two.`;

    const result = splitChapters(text, "^Chapter \\d+ (.*)");
    expect(result).toHaveLength(2);
    expect(result[0]!.title).toBe("Start");
    expect(result[1]!.title).toBe("Middle");
  });

  it("handles large chapter numbers", () => {
    const text = `第一百二十三章 大数
内容`;

    const result = splitChapters(text);
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("大数");
  });
});
