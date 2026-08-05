import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PipelineRunner, type ChapterPipelineResult } from "../pipeline/runner.js";

function chapter(
  chapterNumber: number,
  status: ChapterPipelineResult["status"] = "ready-for-review",
): ChapterPipelineResult {
  return {
    chapterNumber,
    title: `Chapter ${chapterNumber}`,
    wordCount: 1800,
    auditResult: {
      passed: status === "ready-for-review",
      issues: [],
      summary: status,
      overallScore: status === "ready-for-review" ? 90 : 50,
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    },
    revised: false,
    status,
  };
}

describe("PipelineRunner.writeChapters", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("holds one book lock while writing sequential chapters", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-batch-"));
    roots.push(root);
    const runner = new PipelineRunner({
      client: {} as never,
      model: "test-model",
      projectRoot: root,
    });
    const release = vi.fn(async () => undefined);
    const acquireBookLock = vi.fn(async () => release);
    const writeLocked = vi.fn()
      .mockResolvedValueOnce(chapter(3))
      .mockResolvedValueOnce(chapter(4))
      .mockResolvedValueOnce(chapter(5));
    const onChapterComplete = vi.fn();
    const internals = runner as unknown as {
      state: { acquireBookLock: typeof acquireBookLock };
      _writeNextChapterLocked: typeof writeLocked;
    };
    internals.state = { acquireBookLock };
    internals._writeNextChapterLocked = writeLocked;

    const results = await runner.writeChapters("demo-book", 3, { onChapterComplete });

    expect(results.map((result) => result.chapterNumber)).toEqual([3, 4, 5]);
    expect(acquireBookLock).toHaveBeenCalledOnce();
    expect(acquireBookLock).toHaveBeenCalledWith("demo-book");
    expect(writeLocked).toHaveBeenCalledTimes(3);
    expect(onChapterComplete).toHaveBeenNthCalledWith(1, chapter(3), 1, 3);
    expect(onChapterComplete).toHaveBeenNthCalledWith(3, chapter(5), 3, 3);
    expect(release).toHaveBeenCalledOnce();
  });

  it("stops the batch after the first chapter that needs review", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-batch-"));
    roots.push(root);
    const runner = new PipelineRunner({
      client: {} as never,
      model: "test-model",
      projectRoot: root,
    });
    const release = vi.fn(async () => undefined);
    const writeLocked = vi.fn()
      .mockResolvedValueOnce(chapter(8, "audit-failed"))
      .mockResolvedValueOnce(chapter(9));
    const internals = runner as unknown as {
      state: { acquireBookLock: () => Promise<typeof release> };
      _writeNextChapterLocked: typeof writeLocked;
    };
    internals.state = { acquireBookLock: async () => release };
    internals._writeNextChapterLocked = writeLocked;

    const results = await runner.writeChapters("demo-book", 5);

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("audit-failed");
    expect(writeLocked).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("releases the book lock when an in-flight chapter is aborted", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-batch-"));
    roots.push(root);
    const runner = new PipelineRunner({
      client: {} as never,
      model: "test-model",
      projectRoot: root,
    });
    const controller = new AbortController();
    const release = vi.fn(async () => undefined);
    const acquireBookLock = vi.fn(async () => release);
    const writeLocked = vi.fn(() => new Promise<ChapterPipelineResult>((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
    }));
    const internals = runner as unknown as {
      state: { acquireBookLock: typeof acquireBookLock };
      _writeNextChapterLocked: typeof writeLocked;
    };
    internals.state = { acquireBookLock };
    internals._writeNextChapterLocked = writeLocked;

    const pending = runner.runWithAbortSignal(
      controller.signal,
      () => runner.writeChapters("demo-book", 5),
    );
    await vi.waitFor(() => expect(writeLocked).toHaveBeenCalledOnce());
    controller.abort(new Error("Stopped by user"));

    await expect(pending).rejects.toThrow("Stopped by user");
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects invalid batch sizes before taking the lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-batch-"));
    roots.push(root);
    const runner = new PipelineRunner({
      client: {} as never,
      model: "test-model",
      projectRoot: root,
    });

    await expect(runner.writeChapters("demo-book", 0)).rejects.toThrow(/chapterCount/i);
    await expect(runner.writeChapters("demo-book", 21)).rejects.toThrow(/chapterCount/i);
  });
});
