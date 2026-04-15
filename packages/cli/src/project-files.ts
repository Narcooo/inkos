import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_GITIGNORE_ENTRIES = [".env", "node_modules/", ".DS_Store"] as const;

export async function ensureProjectGitignore(projectRoot: string): Promise<void> {
  const gitignorePath = join(projectRoot, ".gitignore");
  let existingContent: string | undefined;

  try {
    existingContent = await readFile(gitignorePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  if (existingContent === undefined) {
    await writeFile(gitignorePath, DEFAULT_GITIGNORE_ENTRIES.join("\n"), "utf-8");
    return;
  }

  const existingEntries = new Set(
    existingContent.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0),
  );
  const missingEntries = DEFAULT_GITIGNORE_ENTRIES.filter((entry) => !existingEntries.has(entry));

  if (missingEntries.length === 0) return;

  const eol = existingContent.includes("\r\n") ? "\r\n" : "\n";
  const needsSeparator = existingContent.length > 0 && !existingContent.endsWith("\n") && !existingContent.endsWith("\r\n");
  const mergedContent = `${existingContent}${needsSeparator ? eol : ""}${missingEntries.join(eol)}`;
  await writeFile(gitignorePath, mergedContent, "utf-8");
}
