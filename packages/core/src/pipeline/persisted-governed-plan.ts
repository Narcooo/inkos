import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { PlanChapterOutput } from "../agents/planner.js";
import { ChapterIntentSchema } from "../models/input-governance.js";

export async function loadPersistedPlan(
  bookDir: string,
  chapterNumber: number,
): Promise<PlanChapterOutput | null> {
  const runtimePath = join(
    bookDir,
    "story",
    "runtime",
    `chapter-${String(chapterNumber).padStart(4, "0")}.intent.md`,
  );

  try {
    const intentMarkdown = await readFile(runtimePath, "utf-8");
    const sections = parseIntentSections(intentMarkdown);
    const goal = readIntentScalar(sections, "Goal");
    if (!goal || isInvalidPersistedIntentScalar(goal)) return null;

    const outlineNode = readIntentScalar(sections, "Outline Node");
    if (outlineNode && outlineNode !== "(not found)" && isInvalidPersistedIntentScalar(outlineNode)) {
      return null;
    }
    const conflicts = readIntentList(sections, "Conflicts")
      .map((line) => {
        const separator = line.indexOf(":");
        if (separator < 0) return null;

        const type = line.slice(0, separator).trim();
        const resolution = line.slice(separator + 1).trim();
        if (!type || !resolution) return null;
        return { type, resolution };
      })
      .filter((conflict): conflict is { type: string; resolution: string } => conflict !== null);

    return {
      intent: ChapterIntentSchema.parse({
        chapter: chapterNumber,
        goal,
        outlineNode: outlineNode && outlineNode !== "(not found)" ? outlineNode : undefined,
        mustKeep: readIntentList(sections, "Must Keep"),
        mustAvoid: readIntentList(sections, "Must Avoid"),
        styleEmphasis: readIntentList(sections, "Style Emphasis"),
        conflicts,
      }),
      intentMarkdown,
      plannerInputs: [runtimePath],
      runtimePath,
    };
  } catch {
    return null;
  }
}

export function relativeToBookDir(bookDir: string, absolutePath: string): string {
  return relative(bookDir, absolutePath).replaceAll("\\", "/");
}

function parseIntentSections(markdown: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string | null = null;

  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) {
      current = line.slice(3).trim();
      sections.set(current, []);
      continue;
    }

    if (!current) continue;
    sections.get(current)?.push(line);
  }

  return sections;
}

function readIntentScalar(sections: Map<string, string[]>, name: string): string | undefined {
  const lines = sections.get(name) ?? [];
  const value = lines.map((line) => line.trim()).find((line) => line.length > 0);
  return value && value !== "- none" ? value : undefined;
}

function readIntentList(sections: Map<string, string[]>, name: string): string[] {
  return (sections.get(name) ?? [])
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-") && line !== "- none")
    .map((line) => line.replace(/^-\s*/, ""));
}

function isInvalidPersistedIntentScalar(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return true;
  if (/^[*_`~:：|.-]+$/.test(normalized)) return true;
  return (
    /^\((describe|briefly describe|write)\b[\s\S]*\)$/i.test(normalized)
    || /^（(?:在这里描述|描述|填写|写下)[\s\S]*）$/u.test(normalized)
  );
}
