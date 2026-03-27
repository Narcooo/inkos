import type {
  NormalizedIdeaIntake,
  NormalizedUploadIntake,
  ParsedCountSummary,
  UploadedFileMetadata,
} from "../../shared/contracts.js";
import { ApiError } from "../errors.js";

interface IdeaPayload {
  readonly idea: unknown;
}

interface UploadPayload {
  readonly files: unknown;
}

interface UploadFileInput {
  readonly name: unknown;
  readonly size: unknown;
  readonly type?: unknown;
  readonly content?: unknown;
}

interface NormalizedUploadFile extends UploadedFileMetadata {
  readonly normalizedContent: string;
}

export class ImportService {
  normalizeIdea(payload: IdeaPayload): NormalizedIdeaIntake {
    if (typeof payload.idea !== "string") {
      throw new ApiError(400, "INVALID_PAYLOAD", "Enter a short idea to continue.");
    }

    const sourceText = payload.idea.replace(/\s+/g, " ").trim();
    if (!sourceText) {
      throw new ApiError(400, "IMPORT_FAILED", "Add a short idea before continuing.");
    }

    return {
      type: "idea",
      titleSuggestion: this.toTitleSuggestion(sourceText),
      sourceText,
      prompt: sourceText,
    };
  }

  summarizeUpload(payload: UploadPayload): NormalizedUploadIntake {
    if (!Array.isArray(payload.files)) {
      throw new ApiError(400, "INVALID_PAYLOAD", "We couldn't read those files. Try uploading them again.");
    }

    const files = payload.files.map((file) => this.normalizeFile(file as UploadFileInput));
    if (files.length === 0) {
      throw new ApiError(400, "IMPORT_FAILED", "Add at least one file before continuing.");
    }

    const summary = {
      fileCount: files.length,
      totalBytes: files.reduce((total, file) => total + file.size, 0),
      totalCharacters: files.reduce((total, file) => total + file.contentLength, 0),
      fileNames: files.map((file) => file.name),
      formats: this.buildCountSummary(files.map((file) => file.format)),
      kinds: this.buildCountSummary(files.map((file) => file.kind)),
    };
    const priorityKind = summary.kinds.find((entry) => entry.label !== "Other")?.label ?? "Imported materials";
    const sourceText = files
      .map((file) => [`[${file.kind}] ${file.name}`, file.normalizedContent].filter(Boolean).join("\n\n"))
      .join("\n\n");
    const prompt = [
      "Use the uploaded materials as bootstrap context for story setup, outlining, and first-chapter generation.",
      `${summary.fileCount} files imported (${summary.totalBytes} bytes total, ${summary.totalCharacters} normalized characters).`,
      ...files.map((file) => [`${file.kind}: ${file.name}`, file.excerpt].filter(Boolean).join("\n")),
    ].join("\n\n");

    return {
      type: "upload",
      titleSuggestion: `${priorityKind} intake`,
      sourceText,
      prompt,
      summary,
      files: files.map(({ normalizedContent: _normalizedContent, ...file }) => file),
    };
  }

  private normalizeFile(file: UploadFileInput): NormalizedUploadFile {
    if (typeof file.name !== "string" || !file.name.trim() || typeof file.size !== "number" || file.size < 0) {
      throw new ApiError(400, "IMPORT_FAILED", "One or more uploaded files could not be read.");
    }
    if (typeof file.content !== "string") {
      throw new ApiError(400, "IMPORT_FAILED", "Uploaded files must include readable content.");
    }

    const type = typeof file.type === "string" ? file.type : "";
    const normalizedContent = this.normalizeContent(file.content);
    return {
      name: file.name,
      size: file.size,
      type,
      format: this.detectFormat(file.name, type),
      kind: this.detectKind(file.name),
      contentLength: normalizedContent.length,
      excerpt: this.createExcerpt(normalizedContent),
      normalizedContent,
    };
  }

  private detectFormat(name: string, type: string): string {
    const lowerName = name.toLowerCase();
    if (lowerName.endsWith(".md") || type === "text/markdown") return "Markdown";
    if (lowerName.endsWith(".txt") || type === "text/plain") return "Text";
    if (lowerName.endsWith(".json") || type === "application/json") return "JSON";
    return type || "Unknown";
  }

  private detectKind(name: string): string {
    const lowerName = name.toLowerCase();
    if (lowerName.includes("chapter") && lowerName.includes("outline")) return "Chapter outline";
    if (/^ch\d+.*outline/i.test(name)) return "Chapter outline";
    if (lowerName.includes("brief") || lowerName.includes("outline")) return "Brief";
    if (lowerName.includes("chapter") || /^ch\d+/i.test(name)) return "Draft chapter";
    if (lowerName.includes("research") || lowerName.includes("note")) return "Research notes";
    if (lowerName.includes("canon") || lowerName.includes("world") || lowerName.includes("character")) return "Canon/reference";
    return "Other";
  }

  private normalizeContent(content: string): string {
    return content.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
  }

  private createExcerpt(content: string): string {
    if (content.length <= 280) {
      return content;
    }

    return `${content.slice(0, 277).trimEnd()}...`;
  }

  private buildCountSummary(values: ReadonlyArray<string>): Array<ParsedCountSummary> {
    const counts = new Map<string, number>();
    for (const value of values) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    return [...counts.entries()].map(([label, count]) => ({ label, count }));
  }

  private toTitleSuggestion(text: string): string {
    const normalized = text.replace(/[.?!,:;]+$/g, "").trim();
    const clause = normalized.split(/[,.;!?]/)[0]?.trim();
    if (clause && clause.length > 0) {
      return clause;
    }

    if (normalized.length <= 24) {
      return normalized;
    }

    return normalized.slice(0, 24).trimEnd();
  }
}
