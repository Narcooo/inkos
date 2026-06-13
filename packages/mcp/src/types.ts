import type {
  BookConfig,
  ChapterMeta,
  ChapterStatus,
} from "@actalk/inkos-core";

export type ImportMode = "append" | "replace" | "new-book";
export type ContextPurpose = "continue" | "revise" | "summarize" | "inspect";
export type ControlDocName = "author_intent" | "current_focus" | "notes";
export type ExportFormat = "md" | "txt" | "epub";

export interface InkosMcpService {
  getStarted(): Promise<Record<string, unknown>>;
  projectStatus(): Promise<ProjectStatus>;
  listBooks(): Promise<ListBooksResult>;
  inspectBook(input?: { readonly bookId?: string; readonly maxChars?: number }): Promise<InspectBookResult>;
  importPreview(input: ImportPreviewInput): Promise<ImportPreviewResult>;
  importCommit(input: ImportCommitInput): Promise<ImportCommitResult>;
  getContextBundle(input: ContextBundleInput): Promise<ContextBundleResult>;
  updateControlDoc(input: UpdateControlDocInput): Promise<UpdateControlDocResult>;
  writeAgentChapter(input: WriteAgentChapterInput): Promise<WriteAgentChapterResult>;
  exportBook(input: ExportBookInput): Promise<ExportBookResult>;
  diagnoseImport(input?: { readonly bookId?: string }): Promise<DiagnoseImportResult>;
  repairProjectIndex(input?: { readonly bookId?: string; readonly dryRun?: boolean }): Promise<RepairProjectIndexResult>;
  agentCreateBookPlan(input: AgentCreateBookPlanInput): Promise<AgentCreateBookPlanResult>;
  agentCommitBook(input: AgentCommitBookInput): Promise<AgentCommitBookResult>;
  agentImportPlan(input: AgentImportPlanInput): Promise<AgentImportPlanResult>;
  agentContinuePlan(input: AgentContinuePlanInput): Promise<AgentContinuePlanResult>;
  agentCommitChapter(input: AgentCommitChapterInput): Promise<AgentCommitChapterResult>;
  readResource(uri: string): Promise<{ readonly mimeType: string; readonly text: string }>;
}

export interface InkosMcpServiceOptions {
  readonly cwd?: string;
  readonly createPipeline?: unknown;
}

export interface ProjectStatus {
  readonly summary: string;
  readonly projectRoot: string;
  readonly isInkosProject: boolean;
  readonly manifestExists: boolean;
  readonly booksCount: number;
  readonly books: ReadonlyArray<BookSummary>;
  readonly problems: ReadonlyArray<string>;
  readonly recommendedActions: ReadonlyArray<string>;
}

export interface BookSummary {
  readonly bookId: string;
  readonly title: string;
  readonly genre: string;
  readonly language?: string;
  readonly chapterCount: number;
  readonly lastChapterNumber: number;
  readonly approximateWordCount: number;
  readonly status: string;
}

export interface ListBooksResult {
  readonly summary: string;
  readonly projectRoot: string;
  readonly books: ReadonlyArray<BookSummary>;
}

export interface InspectBookResult {
  readonly summary: string;
  readonly metadata: BookConfig;
  readonly chapters: ReadonlyArray<ChapterInspection>;
  readonly recentChapterSnippets: ReadonlyArray<ChapterSnippet>;
  readonly controlDocs: Record<ControlDocName, boolean>;
  readonly storyStateExists: boolean;
  readonly riskHints: ReadonlyArray<string>;
}

export interface ChapterInspection {
  readonly number: number;
  readonly title: string;
  readonly status: string;
  readonly wordCount: number;
  readonly file?: string;
}

export interface ChapterSnippet {
  readonly number: number;
  readonly title: string;
  readonly head: string;
  readonly tail: string;
}

export interface ImportPreviewInput {
  readonly sourcePath: string;
  readonly bookId?: string;
  readonly splitPattern?: string;
  readonly encoding?: BufferEncoding;
}

export interface ImportPreviewResult {
  readonly summary: string;
  readonly ok: boolean;
  readonly sourcePath: string;
  readonly sourceKind: "file" | "directory";
  readonly chapterCount: number;
  readonly chapters: ReadonlyArray<PreviewChapter>;
  readonly anomalies: ReadonlyArray<string>;
  readonly duplicateTitles: ReadonlyArray<string>;
  readonly shortChapters: ReadonlyArray<PreviewChapter>;
  readonly unrecognizedReason?: string;
  readonly suggestions: ReadonlyArray<string>;
}

export interface PreviewChapter {
  readonly number: number;
  readonly title: string;
  readonly wordCount: number;
  readonly charCount: number;
  readonly sourceFile?: string;
  readonly tooShort: boolean;
}

export interface ImportCommitInput extends ImportPreviewInput {
  readonly title?: string;
  readonly mode: ImportMode;
  readonly dryRun?: boolean;
}

export interface ImportCommitResult {
  readonly summary: string;
  readonly dryRun: boolean;
  readonly bookId: string;
  readonly mode: ImportMode;
  readonly importedCount: number;
  readonly totalWords: number;
  readonly nextChapter: number;
  readonly needsAgentSettlement: boolean;
  readonly modifiedFiles: ReadonlyArray<string>;
}

export interface ContextBundleInput {
  readonly bookId?: string;
  readonly purpose: ContextPurpose;
  readonly chapterWindow?: number;
  readonly maxChars?: number;
}

export interface ContextBundleResult {
  readonly summary: string;
  readonly purpose: ContextPurpose;
  readonly book: BookSummary;
  readonly author_intent?: string;
  readonly current_focus?: string;
  readonly recentSummaries?: string;
  readonly recentChapters: ReadonlyArray<ChapterSnippet>;
  readonly characterStateFiles: ReadonlyArray<{ readonly path: string; readonly excerpt: string }>;
  readonly pendingHooks?: string;
  readonly styleNotes?: string;
  readonly recommendedNextAction: string;
  readonly instructions: string;
  readonly budget: { readonly maxChars: number; readonly usedChars: number };
}

export interface UpdateControlDocInput {
  readonly bookId?: string;
  readonly doc: ControlDocName;
  readonly content: string;
  readonly append?: boolean;
}

export interface UpdateControlDocResult {
  readonly summary: string;
  readonly bookId: string;
  readonly doc: ControlDocName;
  readonly path: string;
  readonly backupPath?: string;
  readonly modifiedFiles: ReadonlyArray<string>;
}

export interface WriteAgentChapterInput {
  readonly bookId?: string;
  readonly title?: string;
  readonly chapterNumber?: number;
  readonly content: string;
  readonly summary?: string;
  readonly notes?: string;
  readonly approve?: boolean;
}

export interface WriteAgentChapterResult {
  readonly summary: string;
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly title: string;
  readonly wordCount: number;
  readonly status: ChapterStatus;
  readonly needsSettlement: boolean;
  readonly filePath: string;
  readonly modifiedFiles: ReadonlyArray<string>;
}

export interface ExportBookInput {
  readonly bookId?: string;
  readonly format: ExportFormat;
  readonly outputPath?: string;
}

export interface ExportBookResult {
  readonly summary: string;
  readonly bookId: string;
  readonly format: ExportFormat;
  readonly outputPath: string;
  readonly chaptersExported: number;
  readonly totalWords: number;
  readonly modifiedFiles: ReadonlyArray<string>;
}

export interface DiagnoseImportResult {
  readonly summary: string;
  readonly bookId: string;
  readonly missingFiles: ReadonlyArray<string>;
  readonly indexProblems: ReadonlyArray<string>;
  readonly unindexedChapterFiles: ReadonlyArray<UnindexedChapterFile>;
  readonly missingChapterFiles: ReadonlyArray<number>;
  readonly importReportExists: boolean;
  readonly storyStateExists: boolean;
  readonly autoFixable: ReadonlyArray<string>;
  readonly recommendedTool?: string;
}

export interface RepairProjectIndexResult {
  readonly summary: string;
  readonly bookId: string;
  readonly dryRun: boolean;
  readonly repairedEntries: ReadonlyArray<ChapterInspection>;
  readonly plannedFiles: ReadonlyArray<string>;
  readonly modifiedFiles: ReadonlyArray<string>;
}

export interface AgentImportPlanInput extends ImportPreviewInput {
  readonly bookId?: string;
  readonly resumeFrom?: number;
  readonly importMode?: "continuation" | "series";
  readonly maxChars?: number;
}

export interface AgentTask {
  readonly kind: "create_book_foundation" | "import_settlement" | "continue_chapter";
  readonly instructions: string;
  readonly expectedOutputSchema: Record<string, unknown>;
}

export interface AgentCreateBookPlanInput {
  readonly title: string;
  readonly bookId?: string;
  readonly brief?: string;
  readonly genre?: string;
  readonly language?: BookConfig["language"];
  readonly platform?: BookConfig["platform"];
}

export interface AgentCreateBookPlanResult {
  readonly summary: string;
  readonly mode: "agent-mediated";
  readonly requiresInkosLlm: false;
  readonly bookId: string;
  readonly title: string;
  readonly agentTask: AgentTask;
  readonly brief?: string;
}

export interface AgentCommitBookInput {
  readonly title: string;
  readonly bookId?: string;
  readonly genre?: string;
  readonly language?: BookConfig["language"];
  readonly platform?: BookConfig["platform"];
  readonly targetChapters?: number;
  readonly chapterWordCount?: number;
  readonly foundationFiles?: Partial<Record<AgentFoundationFileName, string>>;
  readonly dryRun?: boolean;
}

export type AgentFoundationFileName =
  | "authorIntent"
  | "currentFocus"
  | "notes"
  | "storyBible"
  | "bookRules"
  | "styleNotes"
  | "currentState"
  | "pendingHooks";

export interface AgentCommitBookResult {
  readonly summary: string;
  readonly mode: "agent-mediated";
  readonly requiresInkosLlm: false;
  readonly dryRun: boolean;
  readonly bookId: string;
  readonly modifiedFiles: ReadonlyArray<string>;
}

export interface AgentImportPlanResult {
  readonly summary: string;
  readonly mode: "agent-mediated";
  readonly requiresInkosLlm: false;
  readonly bookId: string;
  readonly importMode: "continuation" | "series";
  readonly agentTask: AgentTask;
  readonly chapters: ReadonlyArray<{ readonly number: number; readonly title: string; readonly wordCount: number; readonly charCount: number }>;
  readonly sourceExcerpt: string;
}

export interface AgentContinuePlanInput {
  readonly bookId?: string;
  readonly chapterWindow?: number;
  readonly maxChars?: number;
}

export interface AgentContinuePlanResult {
  readonly summary: string;
  readonly mode: "agent-mediated";
  readonly requiresInkosLlm: false;
  readonly bookId: string;
  readonly nextChapterNumber: number;
  readonly agentTask: AgentTask;
  readonly contextBundle: ContextBundleResult;
}

export interface AgentCommitChapterInput {
  readonly bookId?: string;
  readonly chapterNumber?: number;
  readonly title?: string;
  readonly content: string;
  readonly summary?: string;
  readonly notes?: string;
  readonly approve?: boolean;
  readonly truthFiles?: Partial<Record<AgentTruthFileName, string>>;
}

export type AgentTruthFileName =
  | "currentState"
  | "pendingHooks"
  | "authorIntent"
  | "currentFocus"
  | "notes"
  | "styleNotes"
  | "chapterSummaries";

export interface AgentCommitChapterResult extends WriteAgentChapterResult {
  readonly summary: string;
  readonly mode: "agent-mediated";
  readonly requiresInkosLlm: false;
}

export interface ResolvedProject {
  readonly cwd: string;
  readonly projectRoot: string;
  readonly isInkosProject: boolean;
}

export interface ParsedChapter {
  readonly title: string;
  readonly content: string;
  readonly sourceFile?: string;
}

export interface ChapterFile {
  readonly number: number;
  readonly file: string;
  readonly path: string;
}

export interface UnindexedChapterFile {
  readonly chapterNumber: number;
  readonly file: string;
}

export type Budget = {
  readonly max: number;
  used: number;
  readonly remaining: number;
  take(text: string, limit?: number): string;
};

export type BookResource = {
  readonly bookId: string;
  readonly kind: "manifest" | "chapters" | "chapter" | "context";
  readonly chapterNumber: number;
};

export type ChapterIndex = ReadonlyArray<ChapterMeta>;
