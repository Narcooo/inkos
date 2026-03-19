import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentContext } from "../agents/base.js";
import type { LLMClient, LLMResponse } from "../llm/provider.js";

// Implementación concreta mínima para testear BaseAgent.readFileSafe
class TestAgent {
  private readonly ctx: AgentContext;

  constructor(ctx: AgentContext) {
    this.ctx = ctx;
  }

  // Expone readFileSafe como método público para testing
  async readFileSafe(path: string, fallback = "(文件不存在)"): Promise<string> {
    const { readFile } = await import("node:fs/promises");
    try {
      return await readFile(path, "utf-8");
    } catch {
      return fallback;
    }
  }
}

// Importa directamente BaseAgent para testear el método real
// Usamos dynamic import para evitar problemas con el abstract class
async function createTestableAgent(): Promise<{
  readFileSafe: (path: string, fallback?: string) => Promise<string>;
}> {
  const { BaseAgent } = await import("../agents/base.js");

  // Creamos una subclase concreta
  class ConcreteAgent extends BaseAgent {
    get name() { return "test-agent"; }

    // Expone el método protegido
    async testReadFileSafe(path: string, fallback?: string): Promise<string> {
      return this.readFileSafe(path, fallback);
    }
  }

  const stubClient = {} as unknown as LLMClient;
  const agent = new ConcreteAgent({
    client: stubClient,
    model: "test",
    projectRoot: "/tmp",
  });

  return {
    readFileSafe: (path, fallback) => agent.testReadFileSafe(path, fallback),
  };
}

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `inkos-base-test-${Date.now()}`);
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("BaseAgent.readFileSafe", () => {
  it("reads existing file contents", async () => {
    const agent = await createTestableAgent();
    const filePath = join(testDir, "exists.md");
    await writeFile(filePath, "hello world", "utf-8");

    const result = await agent.readFileSafe(filePath);
    expect(result).toBe("hello world");
  });

  it("returns default fallback for missing file", async () => {
    const agent = await createTestableAgent();
    const result = await agent.readFileSafe(join(testDir, "nope.md"));
    expect(result).toBe("(文件不存在)");
  });

  it("returns custom fallback for missing file", async () => {
    const agent = await createTestableAgent();
    const result = await agent.readFileSafe(join(testDir, "nope.md"), "(文件尚未创建)");
    expect(result).toBe("(文件尚未创建)");
  });

  it("reads UTF-8 Chinese content correctly", async () => {
    const agent = await createTestableAgent();
    const filePath = join(testDir, "chinese.md");
    const content = "# 第一章 开始\n\n这是一段中文内容。";
    await writeFile(filePath, content, "utf-8");

    const result = await agent.readFileSafe(filePath);
    expect(result).toBe(content);
  });

  it("reads empty files as empty string", async () => {
    const agent = await createTestableAgent();
    const filePath = join(testDir, "empty.md");
    await writeFile(filePath, "", "utf-8");

    const result = await agent.readFileSafe(filePath);
    expect(result).toBe("");
  });
});
