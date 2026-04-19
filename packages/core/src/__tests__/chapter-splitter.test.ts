import { describe, expect, it } from "vitest";
import { splitChapters } from "../utils/chapter-splitter.js";

describe("splitChapters", () => {
  it("splits classical Chinese chapter headings with 第X回 by default", () => {
    const input = [
      "第一回：宴桃園豪傑三結義，斬黃巾英雄首立功",
      "",
      "滾滾長江東逝水，浪花淘盡英雄。",
      "",
      "第二回：張翼德怒鞭督郵，何國舅謀誅宦豎",
      "",
      "且說董卓專權，朝野震動。",
    ].join("\n");

    const chapters = splitChapters(input);

    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toEqual({
      title: "宴桃園豪傑三結義，斬黃巾英雄首立功",
      content: "滾滾長江東逝水，浪花淘盡英雄。",
    });
    expect(chapters[1]).toEqual({
      title: "張翼德怒鞭督郵，何國舅謀誅宦豎",
      content: "且說董卓專權，朝野震動。",
    });
  });

  it("uses a 第N回 fallback title when a classical Chinese heading has no title text", () => {
    const input = [
      "第一回",
      "",
      "天下大勢，分久必合，合久必分。",
    ].join("\n");

    const chapters = splitChapters(input);

    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.title).toBe("第1回");
  });

  it("splits classical Chinese headings that use the round-zero numeral form", () => {
    const input = [
      "第九十九回：孔明秋雨退魏兵",
      "",
      "未知孔明怎生破魏，且看下文分解。",
      "",
      "第一○○回：漢兵劫寨破曹真，武侯鬥陣辱仲達",
      "",
      "卻說眾將聞孔明不追魏兵，俱入帳告曰。",
    ].join("\n");

    const chapters = splitChapters(input);

    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toEqual({
      title: "孔明秋雨退魏兵",
      content: "未知孔明怎生破魏，且看下文分解。",
    });
    expect(chapters[1]).toEqual({
      title: "漢兵劫寨破曹真，武侯鬥陣辱仲達",
      content: "卻說眾將聞孔明不追魏兵，俱入帳告曰。",
    });
  });

  it("splits English chapter headings with the default pattern", () => {
    const input = [
      "Chapter 1: Prelude",
      "",
      "The harbor bells rang before dawn.",
      "",
      "Chapter 2: Into the Fog",
      "",
      "Mara followed the last lantern into the mist.",
    ].join("\n");

    const chapters = splitChapters(input);

    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toEqual({
      title: "Prelude",
      content: "The harbor bells rang before dawn.",
    });
    expect(chapters[1]).toEqual({
      title: "Into the Fog",
      content: "Mara followed the last lantern into the mist.",
    });
  });

  it("uses an English fallback title when the chapter heading has no title text", () => {
    const input = [
      "Chapter 1",
      "",
      "The harbor bells rang before dawn.",
    ].join("\n");

    const chapters = splitChapters(input);

    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.title).toBe("Chapter 1");
  });

  it("splits Roman numeral English chapter headings with the default pattern", () => {
    const input = [
      "CHAPTER I.",
      "",
      "The harbor bells rang before dawn.",
      "",
      "CHAPTER II.",
      "",
      "Mara followed the last lantern into the mist.",
    ].join("\n");

    const chapters = splitChapters(input);

    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toEqual({
      title: "Chapter 1",
      content: "The harbor bells rang before dawn.",
    });
    expect(chapters[1]).toEqual({
      title: "Chapter 2",
      content: "Mara followed the last lantern into the mist.",
    });
  });

  it("keeps English fallback titles when a custom regex matches Roman numeral headings", () => {
    const input = [
      "CHAPTER I.",
      "",
      "The harbor bells rang before dawn.",
    ].join("\n");

    const chapters = splitChapters(input, "^CHAPTER\\s+[IVXLCDM]+\\.$");

    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.title).toBe("Chapter 1");
  });

  it("strips a Project Gutenberg trailer from the final chapter content", () => {
    const input = [
      "Chapter 1: Finale",
      "",
      "The harbor bells rang once and went silent.",
      "",
      "Project Gutenberg™ depends upon and cannot survive without widespread",
      "public support and donations to carry out its mission.",
    ].join("\n");

    const chapters = splitChapters(input);

    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.content).toBe("The harbor bells rang once and went silent.");
    expect(chapters[0]?.content).not.toContain("Project Gutenberg");
  });
});
