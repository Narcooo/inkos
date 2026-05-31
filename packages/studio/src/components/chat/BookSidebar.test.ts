import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

describe("BookSidebar artifact preview", () => {
  it("refetches the open artifact when book data changes", async () => {
    const source = await readFile(join(here, "BookSidebar.tsx"), "utf-8");

    expect(source).toContain("const bookDataVersion = useChatStore((s) => s.bookDataVersion);");
    expect(source).toContain("[bookId, artifactFile, artifactChapter, isChapter, artifactKey, bookDataVersion]");
  });

  it("preserves the preview scroll position while refreshing the same artifact", async () => {
    const source = await readFile(join(here, "BookSidebar.tsx"), "utf-8");

    expect(source).toContain("const scrollRef = useRef<HTMLDivElement>(null);");
    expect(source).toContain("const refreshingSameArtifact = lastArtifactKeyRef.current === artifactKey;");
    expect(source).toContain("const previousScrollTop = refreshingSameArtifact ? scrollRef.current?.scrollTop ?? null : null;");
    expect(source).toContain("scrollRef.current.scrollTop = previousScrollTop;");
    expect(source).toContain("ref={scrollRef}");
    expect(source).toContain("if (!refreshingSameArtifact) {");
    expect(source).toContain("setLoading(true);");
  });
});
