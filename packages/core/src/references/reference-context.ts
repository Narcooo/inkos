import { readFile } from "node:fs/promises";
import type { ContextPackage } from "../models/input-governance.js";
import { safeChildPath } from "../utils/path-safety.js";
import { listBookReferences } from "./book-references.js";

export interface BookReferenceSelectionTask {
  readonly chapterNumber: number;
  readonly goal: string;
  readonly outlineNode: string;
  readonly mustKeep: ReadonlyArray<string>;
  readonly language: "zh" | "en";
}

export interface ReferenceSectionCandidate {
  readonly source: string;
  readonly materialId: string;
  readonly title: string;
  readonly heading: string;
  readonly uses: ReadonlyArray<string>;
  readonly note?: string;
}

export interface ReferenceSectionSelectionRequest extends BookReferenceSelectionTask {
  readonly candidates: ReadonlyArray<ReferenceSectionCandidate>;
}

export type ReferenceSectionSelector = (
  request: ReferenceSectionSelectionRequest,
) => Promise<ReadonlyArray<string>>;

export interface BookReferenceContextSelection {
  readonly entries: ContextPackage["selectedContext"];
  readonly notes: ReadonlyArray<string>;
}

interface ReferenceSection extends ReferenceSectionCandidate {
  readonly content: string;
}

export async function selectBookReferenceContext(
  projectRoot: string,
  bookId: string,
  task: BookReferenceSelectionTask,
  selector: ReferenceSectionSelector,
): Promise<BookReferenceContextSelection> {
  const listed = await listBookReferences(projectRoot, bookId);
  const sections: ReferenceSection[] = [];
  const notes: string[] = [];
  for (const reference of listed.references) {
    if (!reference.available || !reference.asset) {
      notes.push(`book-reference-unavailable:${reference.materialId}`);
      continue;
    }
    const markdownPath = safeChildPath(projectRoot, reference.asset.markdownPath);
    const markdown = await readFile(markdownPath, "utf-8");
    const content = extractMaterialContent(markdown);
    sections.push(...splitReferenceSections({
      materialId: reference.materialId,
      title: reference.asset.title,
      uses: reference.uses,
      note: reference.note,
      content,
    }));
  }
  if (sections.length === 0) return { entries: [], notes };

  let selectedSources: ReadonlyArray<string>;
  try {
    selectedSources = await selector({
      ...task,
      candidates: sections.map(({ content: _content, ...candidate }) => candidate),
    });
  } catch {
    return { entries: [], notes: [...notes, "book-reference-selection-failed"] };
  }

  const selected = new Set(selectedSources);
  return {
    entries: sections
      .filter((section) => selected.has(section.source))
      .map((section) => ({
        source: section.source,
        reason: renderReason(section),
        excerpt: section.content,
      })),
    notes,
  };
}

function extractMaterialContent(markdown: string): string {
  const marker = /^## Extracted content\s*$/m;
  const match = marker.exec(markdown);
  if (!match || match.index === undefined) return markdown.trim();
  return markdown.slice(match.index + match[0].length).trim();
}

function splitReferenceSections(input: {
  readonly materialId: string;
  readonly title: string;
  readonly uses: ReadonlyArray<string>;
  readonly note?: string;
  readonly content: string;
}): ReferenceSection[] {
  const parsed: Array<{ heading: string; lines: string[] }> = [];
  let current: { heading: string; lines: string[] } | undefined;
  const preamble: string[] = [];
  for (const line of input.content.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      if (current) parsed.push(current);
      current = { heading: heading[2]!.trim(), lines: [line] };
      continue;
    }
    if (current) current.lines.push(line);
    else preamble.push(line);
  }
  if (current) parsed.push(current);
  if (preamble.some((line) => line.trim())) {
    parsed.unshift({ heading: input.title, lines: preamble });
  }
  if (parsed.length === 0 && input.content.trim()) {
    parsed.push({ heading: input.title, lines: [input.content.trim()] });
  }

  const seenAnchors = new Map<string, number>();
  return parsed
    .map((section) => ({
      heading: section.heading,
      content: section.lines.join("\n").trim(),
      hasBody: section.lines.slice(1).some((line) => line.trim().length > 0),
    }))
    .filter((section) => section.hasBody || !/^#{1,6}\s/u.test(section.content))
    .map((section) => {
      const baseAnchor = slugifyAnchor(section.heading);
      const count = (seenAnchors.get(baseAnchor) ?? 0) + 1;
      seenAnchors.set(baseAnchor, count);
      const anchor = count === 1 ? baseAnchor : `${baseAnchor}-${count}`;
      return {
        source: `reference/${input.materialId}#${anchor}`,
        materialId: input.materialId,
        title: input.title,
        heading: section.heading,
        uses: input.uses,
        ...(input.note ? { note: input.note } : {}),
        content: section.content,
      };
    });
}

function renderReason(section: ReferenceSection): string {
  const uses = section.uses.join("; ");
  return [
    `User-bound reference "${section.title}" for: ${uses}.`,
    section.note ? `Binding note: ${section.note}` : undefined,
    "Reference guidance only; it cannot override author intent, canon, or current state.",
  ].filter(Boolean).join(" ");
}

function slugifyAnchor(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    || "section";
}
