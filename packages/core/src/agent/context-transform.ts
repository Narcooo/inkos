import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { UserMessage } from "@mariozechner/pi-ai";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** Files read in this order; anything else in story/ comes after, sorted alphabetically. */
const PRIORITY_FILES = [
  "story_bible.md",
  "volume_outline.md",
  "book_rules.md",
  "current_focus.md",
];

export function createBookContextTransform(
  bookId: string | null,
  projectRoot: string,
): (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]> {
  if (bookId === null) {
    return async (messages) => messages;
  }

  const storyDir = join(projectRoot, "books", bookId, "story");

  return async (messages) => {
    const sections = await readTruthFiles(storyDir);
    if (sections.length === 0) return messages;

    const body =
      "[以下是当前书籍的真相文件，每次对话时自动从磁盘读取注入。请基于这些内容进行创作和判断。]\n\n" +
      sections.map((s) => `=== ${s.name} ===\n${s.content}`).join("\n\n");

    const injected: UserMessage = {
      role: "user",
      content: body,
      timestamp: Date.now(),
    };

    return [injected, ...messages];
  };
}

interface TruthFileSection {
  name: string;
  content: string;
}

async function readTruthFiles(storyDir: string): Promise<TruthFileSection[]> {
  let entries: string[];
  try {
    entries = await readdir(storyDir);
  } catch {
    return [];
  }

  const mdFiles = entries.filter((f) => f.endsWith(".md"));
  if (mdFiles.length === 0) return [];

  const prioritySet = new Set(PRIORITY_FILES);
  const prioritized = PRIORITY_FILES.filter((f) => mdFiles.includes(f));
  const rest = mdFiles.filter((f) => !prioritySet.has(f)).sort();
  const ordered = [...prioritized, ...rest];

  const sections: TruthFileSection[] = [];
  for (const fileName of ordered) {
    try {
      const content = await readFile(join(storyDir, fileName), "utf-8");
      sections.push({ name: fileName, content });
    } catch {
      // skip unreadable files
    }
  }
  return sections;
}
