import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ingestMaterial } from "../materials/ingest.js";
import {
  bindBookReference,
  listBookReferences,
  unbindBookReference,
} from "../references/book-references.js";
import { selectBookReferenceContext } from "../references/reference-context.js";

describe("book reference bindings", () => {
  let root: string;
  const bookId = "reference-book";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-book-reference-"));
    await mkdir(join(root, "books", bookId, "story"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("stores one project asset and only a purpose binding inside the target book", async () => {
    const asset = await createReferenceAsset(root, "参考长篇", [
      "# 开篇机制",
      "用一场误会让主角失去退路。",
      "",
      "# 人物关系",
      "盟友必须先因利益合作，再逐渐建立信任。",
    ].join("\n"));

    const first = await bindBookReference(root, bookId, {
      materialId: asset.id,
      uses: ["开篇机制", "人物关系"],
      note: "只借鉴叙事机制，不复用人物和情节。",
    }, { now: () => new Date("2026-08-03T01:00:00.000Z") });
    const updated = await bindBookReference(root, bookId, {
      materialId: asset.id,
      uses: ["成长节奏"],
    }, { now: () => new Date("2026-08-03T02:00:00.000Z") });

    expect(first.bindings).toHaveLength(1);
    expect(updated.bindings).toHaveLength(1);
    expect(updated.bindings[0]).toMatchObject({
      materialId: asset.id,
      uses: ["成长节奏"],
      createdAt: "2026-08-03T01:00:00.000Z",
      updatedAt: "2026-08-03T02:00:00.000Z",
    });

    const bindingText = await readFile(
      join(root, "books", bookId, "story", "reference_bindings.json"),
      "utf-8",
    );
    expect(bindingText).not.toContain("误会让主角失去退路");
    expect(bindingText).not.toContain("盟友必须先因利益合作");
    expect(await readFile(join(root, asset.markdownPath), "utf-8")).toContain("误会让主角失去退路");
  });

  it("lists resolved assets, surfaces missing assets, and unbinds without deleting the asset", async () => {
    const asset = await createReferenceAsset(root, "关系参考", "# 关系\n先合作后信任。\n");
    await bindBookReference(root, bookId, { materialId: asset.id, uses: ["关系推进"] });
    await writeFile(
      join(root, "books", bookId, "story", "reference_bindings.json"),
      JSON.stringify({
        version: 1,
        bookId,
        bindings: [
          ...(await listBookReferences(root, bookId)).manifest.bindings,
          {
            materialId: "missing-material",
            uses: ["冲突设计"],
            createdAt: "2026-08-03T00:00:00.000Z",
            updatedAt: "2026-08-03T00:00:00.000Z",
          },
        ],
      }, null, 2),
      "utf-8",
    );

    const listed = await listBookReferences(root, bookId);
    expect(listed.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ materialId: asset.id, title: "关系参考", available: true }),
      expect.objectContaining({ materialId: "missing-material", available: false }),
    ]));

    const removed = await unbindBookReference(root, bookId, asset.id);
    expect(removed.removed).toBe(true);
    await expect(readFile(join(root, asset.markdownPath), "utf-8")).resolves.toContain("先合作后信任");
  });
});

describe("book reference context selection", () => {
  let root: string;
  const bookId = "selection-book";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-reference-context-"));
    await mkdir(join(root, "books", bookId, "story"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lets the model select full sections from bound assets only", async () => {
    const bound = await createReferenceAsset(root, "长篇拆解", [
      "# 开篇机制",
      "第一段完整内容。",
      "第二段也必须完整保留。",
      "",
      "# 人物关系",
      "关系段完整内容。",
    ].join("\n"));
    await createReferenceAsset(root, "未绑定资料", "# 禁止出现\n这段不应进入候选。\n");
    await bindBookReference(root, bookId, {
      materialId: bound.id,
      uses: ["开篇机制"],
      note: "本章只看开篇如何施压。",
    });

    const selector = vi.fn(async (request: Parameters<NonNullable<Parameters<typeof selectBookReferenceContext>[3]>>[0]) => {
      expect(request.candidates).toHaveLength(2);
      expect(request.candidates.every((candidate) => candidate.materialId === bound.id)).toBe(true);
      expect(request.candidates[0]?.uses).toEqual(["开篇机制"]);
      expect(request.candidates.map((candidate) => candidate.heading)).not.toContain("禁止出现");
      return [request.candidates.find((candidate) => candidate.heading === "开篇机制")!.source];
    });

    const selected = await selectBookReferenceContext(root, bookId, {
      chapterNumber: 1,
      goal: "让主角在开篇失去退路",
      outlineNode: "事故发生",
      mustKeep: ["第一人称"],
      language: "zh",
    }, selector);

    expect(selector).toHaveBeenCalledOnce();
    expect(selected.notes).toEqual([]);
    expect(selected.entries).toEqual([
      expect.objectContaining({
        source: expect.stringMatching(new RegExp(`^reference/${bound.id}#`)),
        reason: expect.stringContaining("开篇机制"),
        excerpt: "# 开篇机制\n第一段完整内容。\n第二段也必须完整保留。",
      }),
    ]);
  });

  it("fails open when semantic selection is unavailable instead of dumping every reference into context", async () => {
    const asset = await createReferenceAsset(root, "长篇拆解", "# 开篇\nA\n\n# 中段\nB\n");
    await bindBookReference(root, bookId, { materialId: asset.id, uses: ["节奏"] });

    const selected = await selectBookReferenceContext(root, bookId, {
      chapterNumber: 8,
      goal: "推进中段",
      outlineNode: "第二次受挫",
      mustKeep: [],
      language: "zh",
    }, async () => {
      throw new Error("selector unavailable");
    });

    expect(selected.entries).toEqual([]);
    expect(selected.notes).toEqual(["book-reference-selection-failed"]);
  });

  it("lets semantic selection exclude a single-section asset instead of injecting it into every chapter", async () => {
    const asset = await createReferenceAsset(root, "单段关系参考", "只在关系决裂时参考这份推进方式。\n");
    await bindBookReference(root, bookId, { materialId: asset.id, uses: ["关系决裂"] });
    const selector = vi.fn(async () => []);

    const selected = await selectBookReferenceContext(root, bookId, {
      chapterNumber: 3,
      goal: "主角独自调查仓库",
      outlineNode: "发现旧账",
      mustKeep: [],
      language: "zh",
    }, selector);

    expect(selector).toHaveBeenCalledOnce();
    expect(selected.entries).toEqual([]);
    expect(selected.notes).toEqual([]);
  });
});

async function createReferenceAsset(root: string, title: string, content: string) {
  const sourcePath = `${title}.md`;
  await writeFile(join(root, sourcePath), content, "utf-8");
  return ingestMaterial(root, {
    sourceKind: "file",
    filePath: sourcePath,
    title,
    purpose: "reference",
  }, {
    now: () => new Date(`2026-08-03T00:00:0${title.length % 10}.000Z`),
  });
}
