import { describe, it, expect } from "vitest";
import {
  parseDraftDirectives,
  createDirectiveStreamFilter,
} from "../interaction/draft-directive-parser.js";

// ---------------------------------------------------------------------------
// 1. Pure markdown — no directives
// ---------------------------------------------------------------------------

describe("parseDraftDirectives", () => {
  it("returns empty fields and full text when input has no directives", () => {
    const raw = "# 欢迎\n\n这是一段普通的 markdown，没有任何表单标记。";
    const result = parseDraftDirectives(raw);

    expect(result.fields).toEqual({});
    expect(result.textContent).toBe(raw);
    expect(result.summary).toBe("");
    expect(result.raw).toBe(raw);
  });

  // ---------------------------------------------------------------------------
  // 2. Single :::field extraction
  // ---------------------------------------------------------------------------

  it("extracts a single :::field block", () => {
    const raw = [
      "请为你的小说起一个名字：",
      "",
      ':::field{key="title" label="书名"}',
      "星河彼岸",
      ":::",
      "",
      "很好的名字！",
    ].join("\n");

    const result = parseDraftDirectives(raw);

    expect(result.fields["title"]).toBe("星河彼岸");
    expect(result.textContent).toBe(
      ["请为你的小说起一个名字：", "", "", "很好的名字！"].join("\n"),
    );
    expect(result.raw).toBe(raw);
  });

  // ---------------------------------------------------------------------------
  // 3. Multiple fields of different types
  // ---------------------------------------------------------------------------

  it("extracts multiple fields of different types", () => {
    const raw = [
      "以下是你的创作信息：",
      "",
      ':::field{key="title" label="书名"}',
      "星河彼岸",
      ":::",
      "",
      ':::field{key="worldPremise" label="世界观" type="textarea"}',
      "一个被星际战争撕裂的宇宙",
      ":::",
      "",
      ':::pick{key="platform" label="目标平台"}',
      "- 起点中文网",
      "- 番茄小说",
      "- 七猫",
      ":::",
      "",
      ':::number{key="targetChapters" label="目标章数"}',
      "300",
      ":::",
    ].join("\n");

    const result = parseDraftDirectives(raw);

    expect(result.fields["title"]).toBe("星河彼岸");
    expect(result.fields["worldPremise"]).toBe("一个被星际战争撕裂的宇宙");
    expect(result.fields["platform"]).toBe("起点中文网");
    expect(result.fields["targetChapters"]).toBe("300");
  });

  // ---------------------------------------------------------------------------
  // 4. Nested :::group containing multiple fields
  // ---------------------------------------------------------------------------

  it("extracts fields nested inside a :::group", () => {
    const raw = [
      "请确认篇幅设置：",
      "",
      ':::group{label="篇幅"}',
      ':::number{key="targetChapters" label="目标章数"}',
      "300",
      ":::",
      ':::number{key="chapterLength" label="每章字数"}',
      "3000",
      ":::",
      ":::",
      "",
      "确认无误！",
    ].join("\n");

    const result = parseDraftDirectives(raw);

    expect(result.fields["targetChapters"]).toBe("300");
    expect(result.fields["chapterLength"]).toBe("3000");
    // group itself should not appear in textContent
    expect(result.textContent).toBe(
      ["请确认篇幅设置：", "", "", "确认无误！"].join("\n"),
    );
  });

  // ---------------------------------------------------------------------------
  // 5. Mixed content: markdown paragraphs interspersed with directives
  // ---------------------------------------------------------------------------

  it("handles mixed markdown and directives", () => {
    const raw = [
      "# 创建新书",
      "",
      "让我们开始吧。首先需要一个书名：",
      "",
      ':::field{key="title" label="书名"}',
      "星河彼岸",
      ":::",
      "",
      "好的！接下来设定你的世界观：",
      "",
      ':::field{key="worldPremise" label="世界观" type="textarea"}',
      "宇宙分裂为光暗两域",
      ":::",
      "",
      "让我们继续完善细节。",
    ].join("\n");

    const result = parseDraftDirectives(raw);

    expect(result.fields["title"]).toBe("星河彼岸");
    expect(result.fields["worldPremise"]).toBe("宇宙分裂为光暗两域");
    expect(result.textContent).toContain("# 创建新书");
    expect(result.textContent).toContain("让我们开始吧。首先需要一个书名：");
    expect(result.textContent).toContain("好的！接下来设定你的世界观：");
    expect(result.textContent).toContain("让我们继续完善细节。");
    expect(result.textContent).not.toContain(":::field");
    expect(result.textContent).not.toContain("星河彼岸");
  });

  // ---------------------------------------------------------------------------
  // 6. :::pick extracts first option as default value
  // ---------------------------------------------------------------------------

  it("extracts first option from :::pick as default value", () => {
    const raw = [
      ':::pick{key="genre" label="题材"}',
      "- 玄幻",
      "- 仙侠",
      "- 都市",
      ":::",
    ].join("\n");

    const result = parseDraftDirectives(raw);
    expect(result.fields["genre"]).toBe("玄幻");
  });

  it("handles :::pick with no options gracefully", () => {
    const raw = [
      ':::pick{key="genre" label="题材"}',
      ":::",
    ].join("\n");

    const result = parseDraftDirectives(raw);
    expect(result.fields["genre"]).toBe("");
  });

  // ---------------------------------------------------------------------------
  // 7. Summary generation from field labels
  // ---------------------------------------------------------------------------

  it("generates summary from field labels", () => {
    const raw = [
      ':::field{key="title" label="书名"}',
      "星河彼岸",
      ":::",
      ':::field{key="worldPremise" label="世界观"}',
      "一个宇宙",
      ":::",
      ':::field{key="protagonist" label="主角"}',
      "陈风",
      ":::",
    ].join("\n");

    const result = parseDraftDirectives(raw);
    expect(result.summary).toBe("确立了书名、世界观和主角");
  });

  it("generates summary with single field", () => {
    const raw = [
      ':::field{key="title" label="书名"}',
      "星河彼岸",
      ":::",
    ].join("\n");

    const result = parseDraftDirectives(raw);
    expect(result.summary).toBe("确立了书名");
  });

  it("generates summary with two fields", () => {
    const raw = [
      ':::field{key="title" label="书名"}',
      "星河彼岸",
      ":::",
      ':::field{key="worldPremise" label="世界观"}',
      "一个宇宙",
      ":::",
    ].join("\n");

    const result = parseDraftDirectives(raw);
    expect(result.summary).toBe("确立了书名和世界观");
  });

  // ---------------------------------------------------------------------------
  // 8. Edge case: ::: in code blocks should NOT be parsed as directives
  // ---------------------------------------------------------------------------

  it("does not parse ::: inside fenced code blocks", () => {
    const raw = [
      "下面是一个示例：",
      "",
      "```markdown",
      ':::field{key="demo" label="示例"}',
      "这不是真正的字段",
      ":::",
      "```",
      "",
      "以上只是演示。",
    ].join("\n");

    const result = parseDraftDirectives(raw);

    expect(result.fields).toEqual({});
    expect(result.textContent).toBe(raw);
  });

  it("does not parse ::: inside indented code blocks with backtick fences", () => {
    const raw = [
      "示例代码：",
      "",
      "````",
      ':::field{key="demo" label="示例"}',
      "不是字段",
      ":::",
      "````",
      "",
      "结束。",
    ].join("\n");

    const result = parseDraftDirectives(raw);
    expect(result.fields).toEqual({});
    expect(result.textContent).toBe(raw);
  });

  // ---------------------------------------------------------------------------
  // Multi-line field value
  // ---------------------------------------------------------------------------

  it("extracts multi-line field value from textarea type", () => {
    const raw = [
      ':::field{key="outline" label="大纲" type="textarea"}',
      "第一卷：起源",
      "第二卷：征途",
      "第三卷：终局",
      ":::",
    ].join("\n");

    const result = parseDraftDirectives(raw);
    expect(result.fields["outline"]).toBe(
      "第一卷：起源\n第二卷：征途\n第三卷：终局",
    );
  });

  // ---------------------------------------------------------------------------
  // group label appears in summary
  // ---------------------------------------------------------------------------

  it("does not include group labels in summary (only leaf fields)", () => {
    const raw = [
      ':::group{label="篇幅设置"}',
      ':::number{key="chapterCount" label="总章数"}',
      "200",
      ":::",
      ":::",
    ].join("\n");

    const result = parseDraftDirectives(raw);
    // summary should mention "总章数", not "篇幅设置"
    expect(result.summary).toBe("确立了总章数");
  });

  // ---------------------------------------------------------------------------
  // Attribute parsing edge cases
  // ---------------------------------------------------------------------------

  it("handles single-quoted attributes", () => {
    const raw = [
      ":::field{key='title' label='书名'}",
      "星河彼岸",
      ":::",
    ].join("\n");

    const result = parseDraftDirectives(raw);
    expect(result.fields["title"]).toBe("星河彼岸");
  });

  it("handles attributes with extra spaces", () => {
    const raw = [
      ':::field{ key="title"  label="书名" }',
      "星河彼岸",
      ":::",
    ].join("\n");

    const result = parseDraftDirectives(raw);
    expect(result.fields["title"]).toBe("星河彼岸");
  });
});

// ---------------------------------------------------------------------------
// Streaming filter
// ---------------------------------------------------------------------------

describe("createDirectiveStreamFilter", () => {
  it("passes through pure text unchanged", () => {
    const filter = createDirectiveStreamFilter();
    expect(filter("你好世界")).toBe("你好世界");
    expect(filter("第二段文字")).toBe("第二段文字");
  });

  it("filters out a complete directive block arriving in one chunk", () => {
    const filter = createDirectiveStreamFilter();
    const chunk = ':::field{key="title" label="书名"}\n星河彼岸\n:::\n';
    expect(filter(chunk)).toBe("");
  });

  it("filters directive blocks arriving across multiple chunks", () => {
    const filter = createDirectiveStreamFilter();

    const out1 = filter("欢迎！\n");
    expect(out1).toBe("欢迎！\n");

    // directive opening arrives
    const out2 = filter(':::field{key="title" label="书名"}\n');
    expect(out2).toBe("");

    // content inside directive
    const out3 = filter("星河彼岸\n");
    expect(out3).toBe("");

    // directive close
    const out4 = filter(":::\n");
    expect(out4).toBe("");

    // back to normal text
    const out5 = filter("继续对话。\n");
    expect(out5).toBe("继续对话。\n");
  });

  it("handles nested group directives in stream", () => {
    const filter = createDirectiveStreamFilter();

    expect(filter("开始\n")).toBe("开始\n");
    expect(filter(':::group{label="篇幅"}\n')).toBe("");
    expect(filter(':::number{key="ch" label="章数"}\n')).toBe("");
    expect(filter("300\n")).toBe("");
    expect(filter(":::\n")).toBe(""); // closes number
    expect(filter(":::\n")).toBe(""); // closes group
    expect(filter("结束\n")).toBe("结束\n");
  });

  it("does not filter ::: inside code blocks during streaming", () => {
    const filter = createDirectiveStreamFilter();

    expect(filter("```\n")).toBe("```\n");
    expect(filter(':::field{key="x" label="y"}\n')).toBe(
      ':::field{key="x" label="y"}\n',
    );
    expect(filter(":::\n")).toBe(":::\n");
    expect(filter("```\n")).toBe("```\n");
  });
});
