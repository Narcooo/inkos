import { describe, it, expect, vi } from "vitest";
import { readTruthFiles, readStateFiles, readViewFiles } from "../utils/story-files.js";
import * as fs from "node:fs/promises";

vi.mock("node:fs/promises");

describe("story-files (tri-classification)", () => {
  const mockPath = "/mock/project";

  it("should read truth files", async () => {
    (fs.readFile as any).mockResolvedValue("content");
    
    const files = await readTruthFiles(mockPath);
    expect(files.storyBible).toBe("content");
    expect(files.volumeOutline).toBe("content");
    expect(files.styleGuide).toBe("content");
  });

  it("should read state files", async () => {
    (fs.readFile as any).mockResolvedValue("state");
    
    const files = await readStateFiles(mockPath);
    expect(files.currentState).toBe("state");
    expect(files.pendingHooks).toBe("state");
  });

  it("should read view files", async () => {
    (fs.readFile as any).mockResolvedValue("view");
    
    const files = await readViewFiles(mockPath);
    expect(files.chapterSummaries).toBe("view");
    expect(files.subplotBoard).toBe("view");
  });
});
