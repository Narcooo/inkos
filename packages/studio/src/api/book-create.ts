import type { Platform } from "@actalk/inkos-core";

export interface StudioCreateBookBody {
  readonly title: string;
  readonly genre: string;
  readonly language?: string;
  readonly platform?: string;
  readonly chapterWordCount?: number;
  readonly targetChapters?: number;
}

export interface StudioBookConfigDraft {
  readonly id: string;
  readonly title: string;
  readonly platform: Platform;
  readonly genre: string;
  readonly status: "outlining";
  readonly targetChapters: number;
  readonly chapterWordCount: number;
  readonly language?: "zh" | "en";
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface StudioBookDetail {
  readonly book: { readonly id: string };
  readonly chapters: ReadonlyArray<unknown>;
  readonly nextChapter: number;
}

interface WaitForStudioBookReadyOptions {
  readonly fetchImpl?: typeof fetch;
  readonly wait?: (delayMs: number) => Promise<void>;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
}

export function normalizeStudioPlatform(platform?: string): Platform {
  switch (platform) {
    case "tomato":
    case "feilu":
    case "qidian":
      return platform;
    default:
      return "other";
  }
}

export function buildStudioBookConfig(body: StudioCreateBookBody, now: string): StudioBookConfigDraft {
  return {
    id: body.title
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 30),
    title: body.title,
    platform: normalizeStudioPlatform(body.platform),
    genre: body.genre,
    status: "outlining",
    targetChapters: body.targetChapters ?? 200,
    chapterWordCount: body.chapterWordCount ?? 3000,
    ...(body.language === "en"
      ? { language: "en" as const }
      : body.language === "zh"
        ? { language: "zh" as const }
        : {}),
    createdAt: now,
    updatedAt: now,
  };
}

function defaultWait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function waitForStudioBookReady(
  bookId: string,
  options: WaitForStudioBookReadyOptions = {},
): Promise<StudioBookDetail> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const wait = options.wait ?? defaultWait;
  const maxAttempts = options.maxAttempts ?? 5;
  const retryDelayMs = options.retryDelayMs ?? 150;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchImpl(`/api/v1/books/${encodeURIComponent(bookId)}`);
    if (response.ok) {
      return await response.json() as StudioBookDetail;
    }

    if (attempt < maxAttempts && response.status === 404) {
      await wait(retryDelayMs);
      continue;
    }

    break;
  }

  throw new Error(`Book "${bookId}" was not ready after ${maxAttempts} attempts.`);
}
