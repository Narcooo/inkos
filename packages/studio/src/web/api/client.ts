import type {
  BookDetail,
  BookSummary,
  ChapterDetail,
  ChapterSummary,
  HealthStatus,
  RunAction,
  RunActionPayload,
  StudioRun,
  ReviewActionPayload,
  SaveChapterPayload,
  TruthFileDetail,
  TruthFileSummary,
} from "../../shared/contracts";

interface ApiErrorPayload {
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
  };
}

export interface StudioApiClient {
  listBooks(): Promise<ReadonlyArray<BookSummary>>;
  getBook(bookId: string): Promise<BookDetail>;
  listChapters(bookId: string): Promise<ReadonlyArray<ChapterSummary>>;
  getChapter(bookId: string, chapterNumber: number): Promise<ChapterDetail>;
  saveChapter(bookId: string, chapterNumber: number, content: SaveChapterPayload["content"]): Promise<ChapterDetail>;
  approveReview(bookId: string, payload: ReviewActionPayload): Promise<ChapterDetail>;
  rejectReview(bookId: string, payload: ReviewActionPayload): Promise<ChapterDetail>;
  createRun(bookId: string, action: RunAction, payload?: RunActionPayload): Promise<StudioRun>;
  listRuns(): Promise<ReadonlyArray<StudioRun>>;
  listTruthFiles(bookId: string): Promise<ReadonlyArray<TruthFileSummary>>;
  getTruthFile(bookId: string, name: string): Promise<TruthFileDetail>;
  getHealth(): Promise<HealthStatus>;
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}.`;

    try {
      const payload = (await response.json()) as ApiErrorPayload;
      if (payload.error?.message) {
        message = payload.error.message;
      }
    } catch {
      // Ignore non-JSON error responses.
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

export function createStudioApiClient(baseUrl = "/api"): StudioApiClient {
  return {
    listBooks: () => requestJson<ReadonlyArray<BookSummary>>(`${baseUrl}/books`),
    getBook: (bookId) => requestJson<BookDetail>(`${baseUrl}/books/${encodeURIComponent(bookId)}`),
    listChapters: (bookId) => requestJson<ReadonlyArray<ChapterSummary>>(`${baseUrl}/books/${encodeURIComponent(bookId)}/chapters`),
    getChapter: (bookId, chapterNumber) =>
      requestJson<ChapterDetail>(`${baseUrl}/books/${encodeURIComponent(bookId)}/chapters/${chapterNumber}`),
    saveChapter: (bookId, chapterNumber, content) =>
      requestJson<ChapterDetail>(`${baseUrl}/books/${encodeURIComponent(bookId)}/chapters/${chapterNumber}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ content } satisfies SaveChapterPayload),
      }),
    approveReview: (bookId, payload) =>
      requestJson<ChapterDetail>(`${baseUrl}/books/${encodeURIComponent(bookId)}/review/approve`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      }),
    rejectReview: (bookId, payload) =>
      requestJson<ChapterDetail>(`${baseUrl}/books/${encodeURIComponent(bookId)}/review/reject`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      }),
    createRun: (bookId, action, payload = {}) =>
      requestJson<StudioRun>(`${baseUrl}/books/${encodeURIComponent(bookId)}/actions/${action}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      }),
    listRuns: () => requestJson<ReadonlyArray<StudioRun>>(`${baseUrl}/runs`),
    listTruthFiles: (bookId) =>
      requestJson<ReadonlyArray<TruthFileSummary>>(`${baseUrl}/books/${encodeURIComponent(bookId)}/truth-files`),
    getTruthFile: (bookId, name) =>
      requestJson<TruthFileDetail>(`${baseUrl}/books/${encodeURIComponent(bookId)}/truth-files/${encodeURIComponent(name)}`),
    getHealth: () => requestJson<HealthStatus>(`${baseUrl}/health`),
  };
}
