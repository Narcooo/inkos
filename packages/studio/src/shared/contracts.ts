export interface HealthStatus {
  readonly status: "ok";
  readonly projectRoot: string;
  readonly projectConfigFound: boolean;
  readonly envFound: boolean;
  readonly projectEnvFound: boolean;
  readonly globalConfigFound: boolean;
  readonly configReady: boolean;
  readonly bookCount: number;
  readonly provider: string | null;
  readonly model: string | null;
}

export type BootstrapReadinessCode = "READY" | "PROJECT_NOT_INITIALIZED" | "CONFIG_NOT_READY";

export interface BootstrapReadiness {
  readonly ready: boolean;
  readonly code: BootstrapReadinessCode;
  readonly title: string;
  readonly message: string;
  readonly action: string;
}

export interface BootstrapProjectStatus {
  readonly initialized: boolean;
  readonly name: string | null;
  readonly bookCount: number;
  readonly firstBookId: string | null;
}

export interface BootstrapStatus {
  readonly health: HealthStatus;
  readonly project: BootstrapProjectStatus;
  readonly readiness: BootstrapReadiness;
}

export interface CreateBootstrapProjectPayload {
  readonly name: string;
  readonly language: "zh" | "en";
}

export interface BootstrapProjectResult {
  readonly projectRoot: string;
  readonly project: {
    readonly initialized: true;
    readonly name: string;
    readonly language: "zh" | "en";
  };
}

export interface NormalizedIdeaIntake {
  readonly type: "idea";
  readonly titleSuggestion: string;
  readonly sourceText: string;
  readonly prompt: string;
}

export interface ParsedCountSummary {
  readonly label: string;
  readonly count: number;
}

export interface UploadedFileIntakeSummary {
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly totalCharacters: number;
  readonly fileNames: ReadonlyArray<string>;
  readonly formats: ReadonlyArray<ParsedCountSummary>;
  readonly kinds: ReadonlyArray<ParsedCountSummary>;
}

export interface UploadedFilePayload {
  readonly name: string;
  readonly size: number;
  readonly type?: string;
  readonly content: string;
}

export interface UploadedFileMetadata {
  readonly name: string;
  readonly size: number;
  readonly type: string;
  readonly format: string;
  readonly kind: string;
  readonly contentLength: number;
  readonly excerpt: string;
}

export interface NormalizedUploadIntake {
  readonly type: "upload";
  readonly titleSuggestion: string;
  readonly sourceText: string;
  readonly prompt: string;
  readonly summary: UploadedFileIntakeSummary;
  readonly files: ReadonlyArray<UploadedFileMetadata>;
}

export type NormalizedIntake = NormalizedIdeaIntake | NormalizedUploadIntake;

export interface CreateBootstrapBookPayload {
  readonly title: string;
  readonly genre: string;
  readonly platform: string;
  readonly language: "zh" | "en";
  readonly targetChapters?: number;
  readonly chapterWordCount?: number;
  readonly intake: NormalizedIntake;
}

export interface BootstrapBookResult {
  readonly book: BookDetail;
  readonly intake: NormalizedIntake;
}

export interface FactorySetupStoryResult {
  readonly book: BookDetail;
}

export interface FactoryBookPayload {
  readonly bookId: string;
}

export interface FactoryGenerateOutlinePayload {
  readonly context?: string;
}

export interface FactoryGenerateOutlineRequest extends FactoryBookPayload, FactoryGenerateOutlinePayload {}

export interface FactoryGenerateOutlineResult {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly intentPath: string;
  readonly goal: string;
  readonly conflicts: ReadonlyArray<string>;
}

export interface FactoryGenerateFirstChapterResult {
  readonly book: BookDetail;
  readonly chapter: ChapterDetail;
}

export interface BookSummary {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly platform: string;
  readonly genre: string;
  readonly targetChapters: number;
  readonly chapters: number;
  readonly chapterCount: number;
  readonly lastChapterNumber: number;
  readonly totalWords: number;
  readonly approvedChapters: number;
  readonly pendingReview: number;
  readonly pendingReviewChapters: number;
  readonly failedReview: number;
  readonly failedChapters: number;
  readonly recentRunStatus?: string | null;
  readonly updatedAt: string;
}

export interface BookDetail extends BookSummary {
  readonly createdAt: string;
  readonly chapterWordCount: number;
  readonly language: "zh" | "en" | null;
  readonly totalWords: number;
  readonly approvedChapters: number;
  readonly pendingReviewChapters: number;
  readonly failedChapters: number;
}

export interface ChapterSummary {
  readonly number: number;
  readonly title: string;
  readonly status: string;
  readonly wordCount: number;
  readonly auditIssueCount: number;
  readonly updatedAt: string;
  readonly fileName: string | null;
}

export interface ChapterDetail extends ChapterSummary {
  readonly auditIssues: ReadonlyArray<string>;
  readonly reviewNote?: string;
  readonly content: string;
}

export interface SaveChapterPayload {
  readonly content: string;
}

export interface TruthFileSummary {
  readonly name: string;
  readonly label: string;
  readonly exists: boolean;
  readonly path: string;
  readonly optional: boolean;
  readonly available: boolean;
}

export interface TruthFileDetail extends TruthFileSummary {
  readonly content: string | null;
}

export interface ReviewActionPayload {
  readonly chapterNumber: number;
  readonly reason?: string;
}

export type RunAction = "draft" | "audit" | "revise" | "write-next";

export type RunStatus = "queued" | "running" | "succeeded" | "failed";

export interface RunLogEntry {
  readonly timestamp: string;
  readonly level: "info" | "warn" | "error";
  readonly message: string;
}

export interface RunActionPayload {
  readonly chapterNumber?: number;
}

export interface StudioRun {
  readonly id: string;
  readonly bookId: string;
  readonly chapter: number | null;
  readonly chapterNumber: number | null;
  readonly action: RunAction;
  readonly status: RunStatus;
  readonly stage: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly logs: ReadonlyArray<RunLogEntry>;
  readonly result?: unknown;
  readonly error?: string;
}

export interface RunSummary extends StudioRun {}

export interface RunStreamEvent {
  readonly type: "snapshot" | "status" | "stage" | "log";
  readonly runId: string;
  readonly run?: StudioRun;
  readonly status?: RunStatus;
  readonly stage?: string;
  readonly log?: RunLogEntry;
  readonly result?: unknown;
  readonly error?: string;
}
