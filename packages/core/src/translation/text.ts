import { splitChapters } from "../utils/chapter-splitter.js";

export interface TranslationTextChapter {
  readonly title: string;
  readonly content: string;
}

export function normalizeTranslationText(value: string): string {
  return decodeHtml(value)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export function splitTranslationChapters(text: string): ReadonlyArray<TranslationTextChapter> {
  const normalized = normalizeTranslationText(text);
  const detected = splitChapters(normalized);
  if (detected.length > 0) return detected;

  const markdownSections = splitMarkdownHeadings(normalized);
  if (markdownSections.length > 0) return markdownSections;

  return [{
    title: "Chapter 1",
    content: normalized,
  }];
}

export function segmentTranslationText(text: string, maxChars = 1200): ReadonlyArray<string> {
  const normalized = normalizeTranslationText(text);
  if (!normalized) return [];

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const units = paragraphs.length > 0 ? paragraphs : [normalized];
  return units.flatMap((paragraph) =>
    paragraph.length > maxChars ? splitLongParagraph(paragraph, maxChars) : [paragraph],
  );
}

function splitMarkdownHeadings(text: string): ReadonlyArray<TranslationTextChapter> {
  const lines = text.split("\n");
  const headings: Array<{ title: string; line: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^#{1,3}\s+(.+?)\s*$/.exec(lines[i] ?? "");
    if (match) headings.push({ title: match[1]!.trim(), line: i });
  }
  if (headings.length === 0) return [];

  return headings.map((heading, index) => {
    const next = headings[index + 1]?.line ?? lines.length;
    return {
      title: heading.title,
      content: lines.slice(heading.line + 1, next).join("\n").trim(),
    };
  }).filter((chapter) => chapter.content.trim().length > 0);
}

function splitLongParagraph(paragraph: string, maxChars: number): string[] {
  const sentences = [...new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(paragraph)]
    .map((item) => item.segment)
    .filter((sentence) => sentence.trim().length > 0);
  return packBoundaryUnits(sentences.length > 0 ? sentences : [paragraph], maxChars);
}

function packBoundaryUnits(units: ReadonlyArray<string>, maxChars: number): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const unit of units) {
    if (unit.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      const words = [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(unit)]
        .map((item) => item.segment)
        .filter((word) => word.length > 0);
      if (words.length <= 1) {
        chunks.push(unit);
      } else {
        chunks.push(...packBoundaryUnits(words, maxChars));
      }
      continue;
    }

    const candidate = current ? `${current}${unit}` : unit;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      current = unit;
    }
  }

  if (current) chunks.push(current);
  return chunks.map((chunk) => chunk.trim()).filter(Boolean);
}

export function stripHtml(html: string): string {
  return decodeHtml(html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|li|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " "));
}

export function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}
