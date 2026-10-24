import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { toPosixPath } from "../utils/posix-path.js";
import { EPub } from "epub-gen-memory";
import { loadTranslationChapter, loadTranslationManifest, translationProjectDir } from "./run-store.js";
import type { TranslationExportFormat, TranslationExportResult } from "./types.js";
import { syncWorkSourceArtifacts } from "../harness/source-sync.js";

export async function writeTranslationExport(
  projectRoot: string,
  projectId: string,
  options: {
    readonly format?: TranslationExportFormat;
    readonly outputPath?: string;
  } = {},
): Promise<TranslationExportResult> {
  const format = options.format ?? "md";
  const manifest = await loadTranslationManifest(projectRoot, projectId);
  const outputPath = options.outputPath ?? join(translationProjectDir(projectRoot, projectId), "exports", `${safeFilename(manifest.title)}.${format}`);
  await mkdir(dirname(outputPath), { recursive: true });

  if (format === "epub") {
    const chapters: Array<{ title: string; content: string }> = [];
    for (const chapterInfo of manifest.chapters) {
      const chapter = await loadTranslationChapter(projectRoot, chapterInfo.translatedPath);
      chapters.push({
        title: chapter.title,
        content: chapter.segments
          .map((segment) => segment.target?.trim())
          .filter(Boolean)
          .map((text) => `<p>${escapeHtml(text!)}</p>`)
          .join("\n"),
      });
    }
    const epub = new EPub({ title: manifest.title, lang: manifest.targetLanguage }, chapters);
    await writeFile(outputPath, await epub.genEpub());
  } else {
    await writeFile(outputPath, await renderTextExport(projectRoot, projectId, format), "utf-8");
  }

  await syncWorkSourceArtifacts({ projectRoot, workId: projectId, accept: true,
    acceptPaths: [toPosixPath(relative(join(projectRoot, "works", projectId), outputPath))],
  });

  return {
    outputPath,
    format,
    chaptersExported: manifest.chapters.length,
    exportSourcePaths: manifest.chapters.map(chapter=>chapter.translatedPath),
  };
}

async function renderTextExport(
  projectRoot: string,
  projectId: string,
  format: "txt" | "md",
): Promise<string> {
  const manifest = await loadTranslationManifest(projectRoot, projectId);
  const lines: string[] = [];
  if (format === "md") {
    lines.push(`# ${manifest.title}`, "", `> ${manifest.sourceLanguage} -> ${manifest.targetLanguage}`, "");
  } else {
    lines.push(manifest.title, `${manifest.sourceLanguage} -> ${manifest.targetLanguage}`, "");
  }
  for (const chapterInfo of manifest.chapters) {
    const chapter = await loadTranslationChapter(projectRoot, chapterInfo.translatedPath);
    lines.push(format === "md" ? `## ${chapter.title}` : chapter.title, "");
    for (const segment of chapter.segments) {
      const target = segment.target?.trim();
      if (target) lines.push(target, "");
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function safeFilename(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80) || "translation";
}
