import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { StateManager } from "@actalk/inkos-core";

const testDir = dirname(fileURLToPath(import.meta.url));
const cliDir = resolve(testDir, "..", "..");
const cliEntry = resolve(cliDir, "dist", "index.js");

let projectDir: string;

function buildTestEnv(overrides?: Record<string, string>) {
  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      !key.startsWith("INKOS_")
      && !key.startsWith("OPENAI_")
      && !key.startsWith("ANTHROPIC_")
      && key !== "TAVILY_API_KEY",
    ),
  );

  return {
    ...baseEnv,
    // Prevent global config from leaking into tests
    HOME: projectDir,
    ...overrides,
  };
}

function run(args: string[], options?: { env?: Record<string, string> }): string {
  return execFileSync("node", [cliEntry, ...args], {
    cwd: projectDir,
    encoding: "utf-8",
    env: buildTestEnv(options?.env),
    timeout: 10_000,
  });
}

function runStderr(args: string[], options?: { env?: Record<string, string> }): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync("node", [cliEntry, ...args], {
      cwd: projectDir,
      encoding: "utf-8",
      env: buildTestEnv(options?.env),
      timeout: 10_000,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout: string; stderr: string; status: number };
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", exitCode: err.status ?? 1 };
  }
}

const failingLlmEnv = {
  INKOS_LLM_PROVIDER: "openai",
  INKOS_LLM_BASE_URL: "http://127.0.0.1:9/v1",
  INKOS_LLM_MODEL: "test-model",
  INKOS_LLM_API_KEY: "test-key",
};

describe("CLI integration", () => {
  beforeAll(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "inkos-cli-test-"));
  });

  afterAll(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  describe("inkos --version", () => {
    it("prints version number", () => {
      const output = run(["--version"]);
      expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe("inkos --help", () => {
    it("prints help with command list", () => {
      const output = run(["--help"]);
      expect(output).toContain("inkos");
      expect(output).toContain("init");
      expect(output).toContain("book");
      expect(output).toContain("write");
    });
  });

  describe("inkos init", () => {
    it("initializes project in current directory", () => {
      const output = run(["init"]);
      expect(output).toContain("Project initialized");
    });

    it("creates inkos.json with correct structure", async () => {
      const raw = await readFile(join(projectDir, "inkos.json"), "utf-8");
      const config = JSON.parse(raw);
      expect(config.llm).toBeDefined();
      expect(config.llm.provider).toBeDefined();
      expect(config.llm.model).toBeDefined();
      expect(config.daemon).toBeDefined();
      expect(config.notify).toEqual([]);
    });

    it("creates .env file", async () => {
      const envContent = await readFile(join(projectDir, ".env"), "utf-8");
      expect(envContent).toContain("INKOS_LLM_API_KEY");
    });

    it("creates .gitignore", async () => {
      const gitignore = await readFile(join(projectDir, ".gitignore"), "utf-8");
      expect(gitignore).toContain(".env");
    });

    it("creates Node version hints for sqlite-backed memory features", async () => {
      await expect(readFile(join(projectDir, ".nvmrc"), "utf-8")).resolves.toContain("22");
      await expect(readFile(join(projectDir, ".node-version"), "utf-8")).resolves.toContain("22");
    });

    it("creates books/ and radar/ directories", async () => {
      const booksStat = await stat(join(projectDir, "books"));
      expect(booksStat.isDirectory()).toBe(true);
      const radarStat = await stat(join(projectDir, "radar"));
      expect(radarStat.isDirectory()).toBe(true);
    });
  });

  describe("inkos init <name>", () => {
    it("creates project in subdirectory", () => {
      const output = run(["init", "subproject"]);
      expect(output).toContain("Project initialized");
    });

    it("creates inkos.json in subdirectory", async () => {
      const raw = await readFile(join(projectDir, "subproject", "inkos.json"), "utf-8");
      const config = JSON.parse(raw);
      expect(config.name).toBe("subproject");
    });

    it("supports absolute project paths instead of nesting them under cwd", async () => {
      const absoluteDir = await mkdtemp(join(tmpdir(), "inkos-cli-abs-init-"));

      try {
        const output = run(["init", absoluteDir]);
        expect(output).toContain(`Project initialized at ${absoluteDir}`);

        const raw = await readFile(join(absoluteDir, "inkos.json"), "utf-8");
        const config = JSON.parse(raw);
        expect(config.name).toBe(basename(absoluteDir));
      } finally {
        await rm(absoluteDir, { recursive: true, force: true });
      }
    });

    it("prints English next steps when initialized with --lang en", async () => {
      const englishDir = await mkdtemp(join(tmpdir(), "inkos-cli-en-init-"));

      try {
        const output = run(["init", englishDir, "--lang", "en"]);
        expect(output).toContain("Project initialized");
        expect(output).toContain("inkos book create --title 'My Novel'");
        expect(output).not.toContain("我的小说");
      } finally {
        await rm(englishDir, { recursive: true, force: true });
      }
    });
  });

  describe("inkos config set", () => {
    it("sets a known config value", () => {
      const output = run(["config", "set", "llm.provider", "anthropic"]);
      expect(output).toContain("Set llm.provider = anthropic");
    });

    it("sets a nested config value", async () => {
      run(["config", "set", "llm.model", "gpt-5"]);
      const raw = await readFile(join(projectDir, "inkos.json"), "utf-8");
      const config = JSON.parse(raw);
      expect(config.llm.model).toBe("gpt-5");
    });

    it("rejects unknown config keys", () => {
      expect(() => {
        run(["config", "set", "custom.nested.key", "value"]);
      }).toThrow();
    });

    it("sets input governance mode", async () => {
      const output = run(["config", "set", "inputGovernanceMode", "v2"]);
      expect(output).toContain("Set inputGovernanceMode = v2");

      const raw = await readFile(join(projectDir, "inkos.json"), "utf-8");
      const config = JSON.parse(raw);
      expect(config.inputGovernanceMode).toBe("v2");
    });
  });

  describe("inkos config show", () => {
    it("shows current config as JSON", () => {
      const output = run(["config", "show"]);
      const config = JSON.parse(output);
      expect(config.llm.model).toBe("gpt-5");
    });
  });

  describe("inkos interact", () => {
    it("returns structured JSON for shared interaction mode switches", async () => {
      const initialized = await stat(join(projectDir, "inkos.json")).then(() => true).catch(() => false);
      if (!initialized) run(["init"]);
      const envPath = join(projectDir, ".env");
      const originalEnv = await readFile(envPath, "utf-8");
      try {
        await writeFile(
          envPath,
          Object.entries(failingLlmEnv).map(([key, value]) => `${key}=${value}`).join("\n"),
          "utf-8",
        );
        const output = run(["interact", "--json", "--message", "切换到全自动"]);
        const data = JSON.parse(output);

        expect(data.request.intent).toBe("switch_mode");
        expect(data.request.mode).toBe("auto");
        expect(data.session.automationMode).toBe("auto");
      } finally {
        await writeFile(envPath, originalEnv, "utf-8");
      }
    });

    it("binds the requested book when interact is called with --book", async () => {
      const initialized = await stat(join(projectDir, "inkos.json")).then(() => true).catch(() => false);
      if (!initialized) run(["init"]);
      const envPath = join(projectDir, ".env");
      const originalEnv = await readFile(envPath, "utf-8");
      try {
        await writeFile(
          envPath,
          Object.entries(failingLlmEnv).map(([key, value]) => `${key}=${value}`).join("\n"),
          "utf-8",
        );
        const state = new StateManager(projectDir);
        await state.saveBookConfig("harbor", {
          id: "harbor",
          title: "Harbor",
          platform: "tomato",
          genre: "other",
          status: "active",
          targetChapters: 20,
          chapterWordCount: 3000,
          createdAt: "2026-04-07T00:00:00.000Z",
          updatedAt: "2026-04-07T00:00:00.000Z",
        });

        const output = run(["interact", "--json", "--book", "harbor", "--message", "/books"]);
        const data = JSON.parse(output);

        expect(data.session.activeBookId).toBe("harbor");
      } finally {
        await writeFile(envPath, originalEnv, "utf-8");
        await rm(join(projectDir, "books", "harbor"), { recursive: true, force: true });
        await rm(join(projectDir, ".inkos-session.json"), { force: true }).catch(() => {});
      }
    });
  });

  describe("inkos config set-model", () => {
    it("rejects raw API keys passed to --api-key-env", async () => {
      const { exitCode, stderr } = runStderr([
        "config",
        "set-model",
        "writer",
        "gpt-4-turbo",
        "--provider",
        "custom",
        "--base-url",
        "https://poloai.top/v1",
        "--api-key-env",
        "sk-test-direct-key",
      ]);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("--api-key-env expects an environment variable name");

      const raw = await readFile(join(projectDir, "inkos.json"), "utf-8");
      const config = JSON.parse(raw);
      expect(config.modelOverrides).toBeUndefined();
    });
  });

  describe("inkos book list", () => {
    it("shows no books in empty project", () => {
      const output = run(["book", "list"]);
      expect(output).toContain("No books found");
    });

    it("returns empty array in JSON mode", () => {
      const output = run(["book", "list", "--json"]);
      const data = JSON.parse(output);
      expect(data.books).toEqual([]);
    });
  });

  describe("inkos book create", () => {
    it("removes stale incomplete book directories before retrying create", async () => {
      try {
        await stat(join(projectDir, "inkos.json"));
      } catch {
        run(["init"]);
      }
      const bookId = "stale-book";
      const staleDir = join(projectDir, "books", bookId);
      await mkdir(join(staleDir, "story"), { recursive: true });
      await writeFile(join(staleDir, "book.json"), JSON.stringify({
        id: bookId,
        title: "Stale Book",
      }, null, 2));
      await writeFile(join(staleDir, "story", "current_state.md"), "# stale\n", "utf-8");

      const { exitCode, stderr } = runStderr([
        "book",
        "create",
        "--title",
        "stale book",
      ], {
        env: failingLlmEnv,
      });

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("Failed to create book");
      await expect(stat(staleDir)).rejects.toThrow();
    });
  });

  describe("inkos status", () => {
    it("shows project status with zero books", () => {
      const output = run(["status"]);
      expect(output).toContain("Books: 0");
    });

    it("returns JSON with --json flag", () => {
      const output = run(["status", "--json"]);
      const data = JSON.parse(output);
      expect(data.project).toBeDefined();
      expect(data.books).toEqual([]);
    });

    it("errors for nonexistent book", () => {
      const { exitCode, stderr } = runStderr(["status", "nonexistent"]);
      expect(exitCode).not.toBe(0);
    });

    it("shows English chapter counts in words for chapter rows", async () => {
      const bookDir = join(projectDir, "books", "english-status");
      await mkdir(join(bookDir, "chapters"), { recursive: true });
      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: "english-status",
          title: "English Status Book",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          language: "en",
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(
        join(bookDir, "chapters", "index.json"),
        JSON.stringify([
          {
            number: 1,
            title: "A Quiet Sky",
            status: "ready-for-review",
            wordCount: 7,
            createdAt: "2026-03-22T00:00:00.000Z",
            updatedAt: "2026-03-22T00:00:00.000Z",
            auditIssues: [],
            lengthWarnings: [],
          },
        ], null, 2),
        "utf-8",
      );

      const output = run(["status", "english-status", "--chapters"]);
      expect(output).toContain('Ch.1 "A Quiet Sky" | 7 words | ready-for-review');
      expect(output).not.toContain("7字");
    });

    it("shows degraded chapter counts and issues explicitly", async () => {
      const bookDir = join(projectDir, "books", "degraded-status");
      await mkdir(join(bookDir, "chapters"), { recursive: true });
      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: "degraded-status",
          title: "Degraded Status Book",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(
        join(bookDir, "chapters", "index.json"),
        JSON.stringify([
          {
            number: 1,
            title: "Broken State",
            status: "state-degraded",
            wordCount: 1800,
            createdAt: "2026-04-01T00:00:00.000Z",
            updatedAt: "2026-04-01T00:00:00.000Z",
            auditIssues: ["[warning] state validation still failed after retry"],
            lengthWarnings: [],
          },
        ], null, 2),
        "utf-8",
      );

      const output = run(["status", "degraded-status", "--chapters"]);
      expect(output).toContain("Degraded: 1");
      expect(output).toContain('Ch.1 "Broken State" | 1800字 | state-degraded');
      expect(output).toContain("[warning] state validation still failed after retry");

      const json = JSON.parse(run(["status", "degraded-status", "--json"]));
      expect(json.books[0]?.degraded).toBe(1);
    });

    it("shows a migration hint for legacy pre-v0.6 books", async () => {
      const bookDir = join(projectDir, "books", "legacy-status-hint");
      const storyDir = join(bookDir, "story");
      await mkdir(join(bookDir, "chapters"), { recursive: true });
      await mkdir(storyDir, { recursive: true });
      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: "legacy-status-hint",
          title: "Legacy Status Hint",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(join(bookDir, "chapters", "index.json"), "[]", "utf-8");
      await writeFile(join(storyDir, "current_state.md"), "# Current State\n\nLegacy state.\n", "utf-8");
      await writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n\n", "utf-8");

      const output = run(["status", "legacy-status-hint"]);
      expect(output).toContain("legacy format");
    });

    it("reports persisted chapter file count instead of runtime progress when state runs ahead", async () => {
      const bookId = "ahead-status";
      const bookDir = join(projectDir, "books", bookId);
      const chaptersDir = join(bookDir, "chapters");
      const stateDir = join(bookDir, "story", "state");

      await mkdir(chaptersDir, { recursive: true });
      await mkdir(stateDir, { recursive: true });
      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: bookId,
          title: "Ahead Status Book",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(join(chaptersDir, "0001_First.md"), "# 第1章 First\n\nOnly persisted chapter.", "utf-8");
      await writeFile(
        join(chaptersDir, "index.json"),
        JSON.stringify([
          {
            number: 1,
            title: "First",
            status: "ready-for-review",
            wordCount: 42,
            createdAt: "2026-03-29T00:00:00.000Z",
            updatedAt: "2026-03-29T00:00:00.000Z",
            auditIssues: [],
            lengthWarnings: [],
          },
        ], null, 2),
        "utf-8",
      );
      await Promise.all([
        writeFile(
          join(stateDir, "manifest.json"),
          JSON.stringify({
            schemaVersion: 2,
            language: "zh",
            lastAppliedChapter: 4,
            projectionVersion: 1,
            migrationWarnings: [],
          }, null, 2),
          "utf-8",
        ),
        writeFile(
          join(stateDir, "current_state.json"),
          JSON.stringify({
            chapter: 4,
            facts: [],
          }, null, 2),
          "utf-8",
        ),
        writeFile(join(stateDir, "hooks.json"), JSON.stringify({ hooks: [] }, null, 2), "utf-8"),
        writeFile(join(stateDir, "chapter_summaries.json"), JSON.stringify({ rows: [] }, null, 2), "utf-8"),
      ]);

      const output = run(["status", bookId]);
      expect(output).toContain("Chapters: 1 / 10");
      expect(output).not.toContain("Chapters: 4 / 10");

      const json = JSON.parse(run(["status", bookId, "--json"]));
      expect(json.books[0]?.chapters).toBe(1);
    });
  });

  describe("inkos doctor", () => {
    it("checks environment health", () => {
      const { stdout } = runStderr(["doctor"]);
      expect(stdout).toContain("InkOS Doctor");
      expect(stdout).toContain("Node.js >= 20");
      expect(stdout).toContain("SQLite memory index");
      expect(stdout).toContain("inkos.json");
    });

    it("repairs missing node runtime pin files for old projects", async () => {
      await stat(join(projectDir, "inkos.json")).catch(() => {
        run(["init"]);
      });

      await rm(join(projectDir, ".nvmrc"), { force: true });
      await rm(join(projectDir, ".node-version"), { force: true });

      const before = runStderr(["doctor"]);
      expect(before.stdout).toContain("Node runtime pin files");
      expect(before.stdout).toContain(".nvmrc");
      expect(before.stdout).toContain(".node-version");

      const repaired = runStderr(["doctor", "--repair-node-runtime"]);
      expect(repaired.stdout).toContain("Node runtime pin files repaired");
      expect(repaired.stdout).toContain(".nvmrc");
      expect(repaired.stdout).toContain(".node-version");

      await expect(readFile(join(projectDir, ".nvmrc"), "utf-8")).resolves.toBe("22\n");
      await expect(readFile(join(projectDir, ".node-version"), "utf-8")).resolves.toBe("22\n");
    });

    it("treats localhost OpenAI-compatible endpoints as API-key optional", async () => {
      await stat(join(projectDir, "inkos.json")).catch(() => {
        run(["init"]);
      });
      const configPath = join(projectDir, "inkos.json");
      const envPath = join(projectDir, ".env");
      const originalConfig = await readFile(configPath, "utf-8");
      const originalEnv = await readFile(envPath, "utf-8");

      try {
        const config = JSON.parse(originalConfig);
        config.llm.provider = "openai";
        config.llm.baseUrl = "http://127.0.0.1:11434/v1";
        config.llm.model = "gpt-oss:20b";
        await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
        await writeFile(envPath, [
          "INKOS_LLM_PROVIDER=openai",
          "INKOS_LLM_BASE_URL=http://127.0.0.1:11434/v1",
          "INKOS_LLM_MODEL=gpt-oss:20b",
          "",
        ].join("\n"), "utf-8");

        const { stdout } = runStderr(["doctor"], {
          env: { INKOS_LLM_API_KEY: "" },
        });
        expect(stdout).toContain("LLM API Key");
        expect(stdout).toContain("Optional for local/self-hosted endpoint");
        expect(stdout).toContain("LLM Config");
        expect(stdout).not.toContain("No LLM config available");
      } finally {
        await writeFile(configPath, originalConfig, "utf-8");
        await writeFile(envPath, originalEnv, "utf-8");
      }
    });

    it("reports legacy books in the version migration check", async () => {
      const bookDir = join(projectDir, "books", "legacy-doctor-hint");
      const storyDir = join(bookDir, "story");
      await mkdir(join(bookDir, "chapters"), { recursive: true });
      await mkdir(storyDir, { recursive: true });
      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: "legacy-doctor-hint",
          title: "Legacy Doctor Hint",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(join(bookDir, "chapters", "index.json"), "[]", "utf-8");
      await writeFile(join(storyDir, "current_state.md"), "# Current State\n\nLegacy state.\n", "utf-8");
      await writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n\n", "utf-8");

      const { stdout } = runStderr(["doctor"]);
      expect(stdout).toContain("Version Migration");
      expect(stdout).toContain("legacy format");
    });
  });

  describe("inkos write", () => {
    it("warns before writing when the target book still uses legacy format", async () => {
      const bookDir = join(projectDir, "books", "legacy-write-hint");
      const storyDir = join(bookDir, "story");
      await mkdir(join(bookDir, "chapters"), { recursive: true });
      await mkdir(storyDir, { recursive: true });
      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: "legacy-write-hint",
          title: "Legacy Write Hint",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(join(bookDir, "chapters", "index.json"), "[]", "utf-8");
      await writeFile(join(storyDir, "current_state.md"), "# Current State\n\nLegacy state.\n", "utf-8");
      await writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n\n", "utf-8");

      const { stdout, stderr } = runStderr(["write", "next", "legacy-write-hint"], {
        env: failingLlmEnv,
      });
      expect(`${stdout}\n${stderr}`).toContain("legacy format");
    });

    it("fails rewrite before deleting chapters when the rollback snapshot is missing", async () => {
      const bookId = "rewrite-missing-snapshot";
      const bookDir = join(projectDir, "books", bookId);
      const storyDir = join(bookDir, "story");
      const chaptersDir = join(bookDir, "chapters");

      await mkdir(chaptersDir, { recursive: true });
      await mkdir(storyDir, { recursive: true });
      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: bookId,
          title: "Rewrite Missing Snapshot",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(join(storyDir, "current_state.md"), "State at ch1", "utf-8");
      await writeFile(join(storyDir, "pending_hooks.md"), "Hooks at ch1", "utf-8");
      await writeFile(join(chaptersDir, "0001_ch1.md"), "# Chapter 1\n\nContent 1", "utf-8");
      await writeFile(join(chaptersDir, "0002_ch2.md"), "# Chapter 2\n\nContent 2", "utf-8");
      await writeFile(join(chaptersDir, "index.json"), JSON.stringify([
        { number: 1, title: "Ch1", status: "approved", wordCount: 100, createdAt: "", updatedAt: "", auditIssues: [], lengthWarnings: [] },
        { number: 2, title: "Ch2", status: "approved", wordCount: 100, createdAt: "", updatedAt: "", auditIssues: [], lengthWarnings: [] },
      ], null, 2), "utf-8");

      const { exitCode, stdout, stderr } = runStderr(["write", "rewrite", bookId, "2", "--force"], {
        env: failingLlmEnv,
      });
      expect(exitCode).not.toBe(0);
      expect(`${stdout}\n${stderr}`).toContain("missing snapshot for chapter 1");
      await expect(readFile(join(chaptersDir, "0002_ch2.md"), "utf-8")).resolves.toContain("Content 2");
    });

    it("keeps next chapter at 2 after rewrite 2 trims later chapters, even if regeneration fails", async () => {
      const state = new StateManager(projectDir);
      const bookId = "rewrite-cli";
      const bookDir = join(projectDir, "books", bookId);
      const storyDir = join(bookDir, "story");
      const chaptersDir = join(bookDir, "chapters");
      const stateDir = join(storyDir, "state");

      await mkdir(chaptersDir, { recursive: true });
      await mkdir(stateDir, { recursive: true });
      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: bookId,
          title: "Rewrite CLI",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(join(storyDir, "current_state.md"), "State at ch1", "utf-8");
      await writeFile(join(storyDir, "pending_hooks.md"), "Hooks at ch1", "utf-8");
      await writeFile(join(chaptersDir, "0001_ch1.md"), "# Chapter 1\n\nContent 1", "utf-8");
      await writeFile(join(chaptersDir, "0002_ch2.md"), "# Chapter 2\n\nContent 2", "utf-8");
      await writeFile(join(chaptersDir, "0003_ch3.md"), "# Chapter 3\n\nContent 3", "utf-8");
      await writeFile(
        join(chaptersDir, "index.json"),
        JSON.stringify([
          { number: 1, title: "Ch1", status: "approved", wordCount: 100, createdAt: "", updatedAt: "", auditIssues: [], lengthWarnings: [] },
          { number: 2, title: "Ch2", status: "approved", wordCount: 100, createdAt: "", updatedAt: "", auditIssues: [], lengthWarnings: [] },
          { number: 3, title: "Ch3", status: "approved", wordCount: 100, createdAt: "", updatedAt: "", auditIssues: [], lengthWarnings: [] },
        ], null, 2),
        "utf-8",
      );

      await state.snapshotState(bookId, 1);

      await writeFile(join(storyDir, "current_state.md"), "State at ch3", "utf-8");
      await writeFile(join(stateDir, "manifest.json"), JSON.stringify({
        schemaVersion: 2,
        language: "en",
        lastAppliedChapter: 4,
        projectionVersion: 1,
        migrationWarnings: [],
      }, null, 2), "utf-8");
      await writeFile(join(stateDir, "current_state.json"), JSON.stringify({
        chapter: 3,
        facts: [],
      }, null, 2), "utf-8");

      const { exitCode, stdout, stderr } = runStderr(["write", "rewrite", bookId, "2", "--force"], {
        env: failingLlmEnv,
      });
      expect(exitCode).not.toBe(0);
      expect(`${stdout}\n${stderr}`).toContain("Regenerating chapter 2");
      expect(`${stdout}\n${stderr}`).not.toContain("resolved to 3");

      const next = await state.getNextChapterNumber(bookId);
      expect(next).toBe(2);
      await expect(readFile(join(storyDir, "current_state.md"), "utf-8")).resolves.toBe("State at ch1");
    });
  });

  describe("inkos analytics", () => {
    it("errors when no book exists", () => {
      const { exitCode } = runStderr(["analytics"]);
      expect(exitCode).not.toBe(0);
    });
  });

  describe("inkos review", () => {
    it("preserves the original chapter snapshot when approving review", async () => {
      const configPath = join(projectDir, "inkos.json");
      const initialized = await stat(configPath).then(() => true).catch(() => false);
      if (!initialized) run(["init"]);

      const state = new StateManager(projectDir);
      const bookId = "review-approve-cli";
      const bookDir = join(projectDir, "books", bookId);
      const storyDir = join(bookDir, "story");
      const chaptersDir = join(bookDir, "chapters");
      await mkdir(chaptersDir, { recursive: true });
      await mkdir(storyDir, { recursive: true });

      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: bookId,
          title: "Review Approve CLI",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(join(storyDir, "current_state.md"), "State at ch1", "utf-8");
      await writeFile(join(storyDir, "pending_hooks.md"), "Hooks at ch1", "utf-8");
      await writeFile(join(chaptersDir, "0001_ch1.md"), "# Chapter 1\n\nContent 1", "utf-8");
      await writeFile(
        join(chaptersDir, "index.json"),
        JSON.stringify([
          {
            number: 1,
            title: "Ch1",
            status: "ready-for-review",
            wordCount: 100,
            createdAt: "",
            updatedAt: "",
            auditIssues: [],
            lengthWarnings: [],
          },
        ], null, 2),
        "utf-8",
      );

      await state.snapshotState(bookId, 1);

      await writeFile(join(storyDir, "current_state.md"), "State at ch3", "utf-8");
      await writeFile(join(storyDir, "pending_hooks.md"), "Hooks at ch3", "utf-8");

      const output = run(["review", "approve", bookId, "1"]);
      expect(output).toContain("Chapter 1 approved");

      await expect(
        readFile(join(storyDir, "snapshots", "1", "current_state.md"), "utf-8"),
      ).resolves.toBe("State at ch1");
      await expect(
        readFile(join(storyDir, "snapshots", "1", "pending_hooks.md"), "utf-8"),
      ).resolves.toBe("Hooks at ch1");

      const index = await state.loadChapterIndex(bookId);
      expect(index[0]?.status).toBe("approved");
    });
  });

  describe("inkos plan/compose", () => {
    beforeAll(async () => {
      const configPath = join(projectDir, "inkos.json");
      const initialized = await stat(configPath).then(() => true).catch(() => false);
      if (!initialized) run(["init"]);

      const bookDir = join(projectDir, "books", "cli-book");
      const storyDir = join(bookDir, "story");
      await mkdir(join(storyDir, "runtime"), { recursive: true });

      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: "cli-book",
          title: "CLI Book",
          platform: "tomato",
          genre: "other",
          status: "active",
          targetChapters: 20,
          chapterWordCount: 3000,
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(join(bookDir, "chapters", "index.json"), "[]", "utf-8").catch(async () => {
        await mkdir(join(bookDir, "chapters"), { recursive: true });
        await writeFile(join(bookDir, "chapters", "index.json"), "[]", "utf-8");
      });

      await Promise.all([
        writeFile(join(storyDir, "author_intent.md"), "# Author Intent\n\nKeep the story centered on the mentor conflict.\n", "utf-8"),
        writeFile(join(storyDir, "current_focus.md"), "# Current Focus\n\nBring focus back to the mentor conflict.\n", "utf-8"),
        writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n\n- The jade seal cannot be destroyed.\n", "utf-8"),
        writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 1\nTrack the merchant guild trail.\n", "utf-8"),
        writeFile(join(storyDir, "book_rules.md"), "---\nprohibitions:\n  - Do not reveal the mastermind\n---\n\n# Book Rules\n", "utf-8"),
        writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- Lin Yue still hides the broken oath token.\n", "utf-8"),
        writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n\n- Why the mentor vanished after the trial.\n", "utf-8"),
      ]);
    });

    it("runs plan chapter and returns the generated intent path in JSON mode", async () => {
      const output = run(["plan", "chapter", "cli-book", "--json", "--context", "Ignore the guild chase and focus on the mentor conflict."]);
      const data = JSON.parse(output);

      expect(data.bookId).toBe("cli-book");
      expect(data.chapterNumber).toBe(1);
      expect(data.intentPath).toContain("story/runtime/chapter-0001.intent.md");
      await expect(stat(join(projectDir, "books", "cli-book", data.intentPath))).resolves.toBeTruthy();
    });

    it("runs compose chapter and returns runtime artifact paths in JSON mode", async () => {
      const output = run(["compose", "chapter", "cli-book", "--json"]);
      const data = JSON.parse(output);

      expect(data.bookId).toBe("cli-book");
      expect(data.chapterNumber).toBe(1);
      expect(data.contextPath).toContain("story/runtime/chapter-0001.context.json");
      expect(data.ruleStackPath).toContain("story/runtime/chapter-0001.rule-stack.yaml");
      expect(data.tracePath).toContain("story/runtime/chapter-0001.trace.json");

      await expect(stat(join(projectDir, "books", "cli-book", data.contextPath))).resolves.toBeTruthy();
      await expect(stat(join(projectDir, "books", "cli-book", data.ruleStackPath))).resolves.toBeTruthy();
      await expect(stat(join(projectDir, "books", "cli-book", data.tracePath))).resolves.toBeTruthy();
    });

    it("reuses the planned intent when compose runs without a new context", async () => {
      const plannedGoal = "Ignore the guild chase and focus on the mentor conflict.";
      run(["plan", "chapter", "cli-book", "--context", plannedGoal]);

      const output = run(["compose", "chapter", "cli-book", "--json"]);
      const data = JSON.parse(output);
      const intentMarkdown = await readFile(join(projectDir, "books", "cli-book", data.intentPath), "utf-8");

      expect(data.goal).toBe(plannedGoal);
      expect(intentMarkdown).toContain(plannedGoal);
    });
  });

  describe("inkos export", () => {
    beforeAll(async () => {
      const configPath = join(projectDir, "inkos.json");
      const initialized = await stat(configPath).then(() => true).catch(() => false);
      if (!initialized) run(["init"]);

      const bookDir = join(projectDir, "books", "export-book");
      await mkdir(join(bookDir, "chapters"), { recursive: true });

      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: "export-book",
          title: "Export Book",
          platform: "tomato",
          genre: "xuanhuan",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2000,
          createdAt: "2026-03-23T00:00:00.000Z",
          updatedAt: "2026-03-23T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(
        join(bookDir, "chapters", "index.json"),
        JSON.stringify([
          {
            number: 1,
            title: "Dawn Ledger",
            status: "ready-for-review",
            wordCount: 1200,
            createdAt: "2026-03-23T00:00:00.000Z",
            updatedAt: "2026-03-23T00:00:00.000Z",
            auditIssues: [],
          },
        ], null, 2),
        "utf-8",
      );
      await writeFile(
        join(bookDir, "chapters", "0001_Dawn_Ledger.md"),
        "# 第1章 Dawn Ledger\n\n正文。\n",
        "utf-8",
      );
    });

    it("creates missing parent directories for custom output paths", async () => {
      const outputPath = join(projectDir, "exports", "nested", "book.md");
      const output = run(["export", "export-book", "--format", "md", "--output", outputPath, "--json"]);
      const data = JSON.parse(output);

      expect(data.outputPath).toBe(outputPath);
      await expect(stat(outputPath)).resolves.toBeTruthy();
      await expect(readFile(outputPath, "utf-8")).resolves.toContain("# Export Book");
    });
  });
});
