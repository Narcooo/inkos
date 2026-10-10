import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appendManualSessionMessages, bindBookSessionToBook, commitAtomicFileSet, createAndPersistBookSession, createInitialWorkManifestWrite } from "@actalk/inkos-core";
import { ChatRequestStore } from "../src/api/chat-request-store";

const root = process.env.INKOS_E2E_PROJECT_ROOT ?? resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..", "test-project");

for (const entry of [
  { route: "book/new", key: "inkos.book-create.session-id", kind: "book-create" as const },
  { route: "chat", key: "inkos.project-chat.session-id", kind: "chat" as const },
]) test(`restores a bound failed creation from ${entry.route} without submitting it again`, async ({ page, request }) => {
  const id = `e2e-entry-${randomUUID()}`, now = new Date().toISOString();
  const writes = [{ relativePath: `works/${id}/source/book.json`, content: JSON.stringify({
    id, title: "Entry recovery", platform: "other", genre: "general", status: "active",
    targetChapters: 3, chapterWordCount: 1000, language: "zh", createdAt: now, updatedAt: now,
  }) }];
  const initial = createInitialWorkManifestWrite({ workId: id, title: "Entry recovery", profileId: "longform-novel", language: "zh", writes });
  const requests = new ChatRequestStore(root);
  let agentPosts = 0;
  page.on("request", event => { if (event.url().endsWith("/api/v1/agent") && event.method() === "POST") agentPosts++; });
  try {
    await commitAtomicFileSet({ rootDir: root, writes: [...writes, initial.write] });
    await createAndPersistBookSession(root, null, id, entry.kind);
    await appendManualSessionMessages(root, id, [{ role: "user", content: "Create a story.", timestamp: 10 }]);
    await bindBookSessionToBook(root, id, id);
    await requests.save({ sessionId: id, requestId: id, startedAt: 10, completedAt: 20, status: "failed",
      error: { code: "CHAT_REQUEST_INTERRUPTED", message: "Interrupted." }, retry: { text: "Create a story." } });

    await page.goto("/");
    await page.evaluate(({ key, id }) => localStorage.setItem(key, id), { key: entry.key, id });
    await page.goto("about:blank");
    await page.goto(`/#/${entry.route}`);
    await expect(page.getByRole("button", { name: "重试上一条消息", exact: true })).toBeVisible();
    await expect.poll(() => new URL(page.url()).hash).toBe(`#/book/${id}`);
    await page.reload();
    await expect(page.getByRole("button", { name: "重试上一条消息", exact: true })).toBeVisible();
    const detail = await (await request.get(`/api/v1/sessions/${id}`)).json();
    expect(detail.session).toMatchObject({ sessionId: id, bookId: id, workId: id });
    expect(detail.chatRequest).toMatchObject({ requestId: id, status: "failed", error: { code: "CHAT_REQUEST_INTERRUPTED" } });
    expect(agentPosts).toBe(0);
  } finally {
    await requests.delete(id);
    await rm(resolve(root, ".inkos/sessions", `${id}.jsonl`), { force: true });
    await rm(resolve(root, "works", id), { recursive: true, force: true });
  }
});
