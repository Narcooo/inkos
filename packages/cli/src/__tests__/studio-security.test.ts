import path from "node:path";
import { describe, expect, it, vi } from "vitest";

describe("studio server safety helpers", () => {
  it("accepts only simple upload file ids", async () => {
    const helperModulePath = "../../../studio/server-safety.cjs";
    const { isSafeUploadFileId } = await import(helperModulePath);

    expect(isSafeUploadFileId("1711234567890-abcd1234")).toBe(true);
    expect(isSafeUploadFileId("../secret")).toBe(false);
    expect(isSafeUploadFileId("..\\secret")).toBe(false);
    expect(isSafeUploadFileId("bad/slash")).toBe(false);
  });

  it("builds import regexes only from a constrained safe subset", async () => {
    const helperModulePath = "../../../studio/server-safety.cjs";
    const { buildImportRegex } = await import(helperModulePath);

    const safeRegex = buildImportRegex("第[一二三四五六七八九十百千\\d]+章\\s*.*");
    expect(safeRegex).toBeInstanceOf(RegExp);
    expect(safeRegex.flags).toContain("g");

    expect(() => buildImportRegex("((a+)+)$")).toThrow(/unsafe|invalid/i);
    expect(() => buildImportRegex("(?=boom)")).toThrow(/unsafe|invalid/i);
    expect(() => buildImportRegex("x".repeat(500))).toThrow(/too long/i);
  });

  it("keeps upload responses free of server file paths", async () => {
    const helperModulePath = "../../../studio/server-safety.cjs";
    const { createUploadResponse } = await import(helperModulePath);

    expect(createUploadResponse({
      fileId: "1711234567890-abcd1234",
      size: 123,
      chapterCount: 4,
      firstTitle: "第一章",
      totalChars: 4567,
    })).toEqual({
      ok: true,
      fileId: "1711234567890-abcd1234",
      size: 123,
      chapterCount: 4,
      firstTitle: "第一章",
      totalChars: 4567,
    });
  });

  it("supports legacy INKOS_STUDIO_PORT when PORT is absent", async () => {
    const helperModulePath = "../../../studio/server-safety.cjs";
    const { resolveServerPort } = await import(helperModulePath);

    expect(resolveServerPort({ PORT: "9001", INKOS_STUDIO_PORT: "8123" })).toBe(9001);
    expect(resolveServerPort({ INKOS_STUDIO_PORT: "8123" })).toBe(8123);
    expect(resolveServerPort({})).toBe(8799);
  });

  it("creates runtime directories before the server starts listening", async () => {
    const helperModulePath = "../../../studio/server-safety.cjs";
    const { ensureRuntimeDirs } = await import(helperModulePath);
    const mkdirMock = vi.fn(async () => undefined);

    await ensureRuntimeDirs({
      projectRoot: "/project",
      homeDir: "/home/user",
      mkdirFn: mkdirMock,
      pathModule: path.posix,
    });

    expect(mkdirMock).toHaveBeenNthCalledWith(1, "/project", { recursive: true });
    expect(mkdirMock).toHaveBeenNthCalledWith(2, "/project/.inkos", { recursive: true });
    expect(mkdirMock).toHaveBeenNthCalledWith(3, "/home/user/.inkos", { recursive: true });
  });
});
