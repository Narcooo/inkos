import { describe, expect, it } from "vitest";
import {
  parseBookProductionMap,
  resolveProductionScope,
} from "../production/book-production-map.js";

const valid = {
  schema_version: "1.0",
  book_id: "book-a",
  authority_book_id: "authority-a",
  title: "A Book",
  total_chapters: 12,
  volumes: [
    { volume_id: "volume-001", volume_number: 1, title: "One", start_chapter: 1, end_chapter: 4, chapter_count: 4 },
    { volume_id: "volume-002", volume_number: 2, title: "Two", start_chapter: 5, end_chapter: 9, chapter_count: 5 },
    { volume_id: "volume-003", volume_number: 3, title: "Three", start_chapter: 10, end_chapter: 12, chapter_count: 3 },
  ],
};

describe("book production map", () => {
  it("derives current-volume and full-book targets without fixed boundaries", () => {
    const map = parseBookProductionMap(valid, "book-a");
    expect(resolveProductionScope(map, 3, "current-volume")).toMatchObject({
      startChapter: 3,
      targetChapter: 4,
      currentVolume: { volumeId: "volume-001", startChapter: 1, endChapter: 4 },
    });
    expect(resolveProductionScope(map, 5, "full-book")).toMatchObject({
      startChapter: 5,
      targetChapter: 12,
      currentVolume: { volumeId: "volume-002", startChapter: 5, endChapter: 9 },
    });
  });

  it.each([
    ["gap", { ...valid, volumes: [valid.volumes[0], { ...valid.volumes[1], start_chapter: 6, chapter_count: 4 }, valid.volumes[2]] }],
    ["overlap", { ...valid, volumes: [valid.volumes[0], { ...valid.volumes[1], start_chapter: 4, chapter_count: 6 }, valid.volumes[2]] }],
    ["bad count", { ...valid, volumes: [{ ...valid.volumes[0], chapter_count: 3 }, ...valid.volumes.slice(1)] }],
    ["bad final", { ...valid, total_chapters: 13 }],
    ["wrong book", valid],
  ])("fails closed for %s", (_label, input) => {
    expect(() => parseBookProductionMap(input, _label === "wrong book" ? "other" : "book-a")).toThrow();
  });

  it("reports completion after the final mapped chapter", () => {
    const map = parseBookProductionMap(valid, "book-a");
    expect(resolveProductionScope(map, 13, "full-book")).toEqual({
      complete: true,
      startChapter: 13,
      targetChapter: 12,
      currentVolume: map.volumes[2],
    });
  });
});
