import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSkillRegistry,
  loadAvailableAgentSkills,
  loadBuiltinAgentSkills,
  loadConfiguredAgentSkills,
  loadExternalAgentSkills,
  parseAgentSkillDocument,
} from "../skills/index.js";

const BUILTIN_SKILL_IDS = [
  "inkos-interactive-film",
  "inkos-long-market-research",
  "inkos-long-story-analysis",
  "inkos-long-writing",
  "inkos-play-world",
  "inkos-script-writing",
  "inkos-short-market-research",
  "inkos-short-story-analysis",
  "inkos-short-writing",
  "inkos-story-cover",
  "inkos-story-deslop",
  "inkos-story-import",
  "inkos-story-review",
  "inkos-storyboard",
  "inkos-translation",
] as const;

describe("external skill loader", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-external-skills-"));
  });

  afterEach(async () => {
    await import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true }));
  });

  it("loads the built-in professional story skill pack", async () => {
    const loaded = await loadBuiltinAgentSkills();

    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.skills.map((skill) => skill.id)).toEqual(BUILTIN_SKILL_IDS);
    expect(loaded.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "inkos-long-writing",
        source: "builtin",
        body: expect.stringContaining("objective, resistance"),
        baseDir: expect.stringMatching(/skills[\\/]inkos-long-writing$/),
      }),
      expect.objectContaining({
        id: "inkos-story-review",
        source: "builtin",
        body: expect.stringContaining("parser or model-format failure"),
      }),
      expect.objectContaining({
        id: "inkos-play-world",
        source: "builtin",
        body: expect.stringContaining("world contract as authority"),
      }),
      expect.objectContaining({
        id: "inkos-interactive-film",
        source: "builtin",
        body: expect.stringContaining("Variables and flags serve story causality"),
      }),
    ]));
  });

  it("lets a project skill replace a built-in skill with the same id", async () => {
    const skillDir = join(root, ".agents", "skills", "inkos-story-review");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: inkos-story-review",
        "description: Project-specific review standard.",
        "---",
        "Use the project's own review standard.",
      ].join("\n"),
      "utf-8",
    );

    const loaded = await loadAvailableAgentSkills({
      projectRoot: root,
      env: {},
      homeDir: join(root, "home"),
    });
    const registry = createSkillRegistry({ skills: loaded.skills });

    expect(registry.getSkill("inkos-story-review")).toMatchObject({
      source: "project",
      body: "Use the project's own review standard.",
      baseDir: skillDir,
    });
    expect(registry.listSkills()).toHaveLength(BUILTIN_SKILL_IDS.length);
  });

  it("loads only the standard AgentSkills discovery fields and body", async () => {
    const skillDir = join(root, "detective-play");
    await mkdir(join(skillDir, "scripts"), { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "id: legacy-detective-id",
        "name: Detective Play",
        "description: Detective evidence and suspect-board play.",
        "whenToUse: Use for open-world detective play and evidence ledgers.",
        "promptPacks:",
        "  - detective.play",
        "toolHints:",
        "  - play_step",
        "contextNeeds:",
        "  - id: evidence-ledger",
        "    purpose: Preserve suspect, clue, and evidence chain state.",
        "    sources:",
        "      - world/evidence.md",
        "    tier: protected",
        "    appliesTo:",
        "      - play_step",
        "    retrieval: semantic",
        "---",
        "",
        "Use evidence chains; do not turn clues into generic atmosphere.",
      ].join("\n"),
      "utf-8",
    );
    await writeFile(join(skillDir, "scripts", "install.sh"), "echo should-not-run\n", "utf-8");

    const result = await loadExternalAgentSkills({ externalDirs: [skillDir] });

    expect(result.diagnostics).toEqual([]);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]).toEqual({
      id: "detective-play",
      name: "Detective Play",
      description: "Detective evidence and suspect-board play.",
      source: "external",
      body: "Use evidence chains; do not turn clues into generic atmosphere.",
      baseDir: skillDir,
    });
    expect(result.skills[0]).not.toHaveProperty("whenToUse");
    expect(result.skills[0]).not.toHaveProperty("promptPacks");
    expect(result.skills[0]).not.toHaveProperty("toolHints");
    expect(result.skills[0]).not.toHaveProperty("contextNeeds");
  });

  it("loads an AgentSkills/OpenClaw manifest without InkOS-only fields", async () => {
    const skillDir = join(root, "writer-distillation");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: writer-distillation",
        "description: Distill a writer's repeatable craft and use it when the user asks for style analysis or imitation.",
        "version: 1.2.0",
        'metadata: { "openclaw": { "emoji": "✍️" } }',
        "---",
        "",
        "# Writer Distillation",
        "",
        "Read the supplied samples, separate transferable craft from surface wording, and produce an editable writing guide.",
      ].join("\r\n"),
      "utf-8",
    );

    const result = await loadExternalAgentSkills({ externalDirs: [skillDir] });

    expect(result.diagnostics).toEqual([]);
    expect(result.skills).toEqual([
      expect.objectContaining({
        id: "writer-distillation",
        name: "writer-distillation",
        description: expect.stringContaining("Distill a writer"),
        body: expect.stringContaining("transferable craft"),
        baseDir: skillDir,
        source: "external",
      }),
    ]);
    expect(result.skills[0]).not.toHaveProperty("whenToUse");
  });

  it("derives a stable id from a standard skill name when no id is present", () => {
    const skill = parseAgentSkillDocument(
      [
        "---",
        "name: Writer Distillation",
        "description: Use for writer-style distillation.",
        "---",
        "Distill craft.",
      ].join("\n"),
      { skillPath: join(root, "SKILL.md") },
    );

    expect(skill.id).toBe("writer-distillation");
  });

  it("prefixes ids derived from names that begin with a number", () => {
    const skill = parseAgentSkillDocument(
      [
        "---",
        "name: 3D Scene Writer",
        "description: Use for spatial scene writing.",
        "---",
        "Keep spatial continuity visible.",
      ].join("\n"),
      { skillPath: join(root, "SKILL.md") },
    );

    expect(skill.id).toBe("skill-3d-scene-writer");
  });

  it("rejects discovery metadata larger than the Agent Skills limits", () => {
    expect(() => parseAgentSkillDocument(
      [
        "---",
        `name: ${"n".repeat(65)}`,
        "description: Small description.",
        "---",
        "Body.",
      ].join("\n"),
      { skillPath: join(root, "SKILL.md") },
    )).toThrow(/name.*64/i);

    expect(() => parseAgentSkillDocument(
      [
        "---",
        "name: oversized-description",
        `description: ${"d".repeat(1025)}`,
        "---",
        "Body.",
      ].join("\n"),
      { skillPath: join(root, "SKILL.md") },
    )).toThrow(/description.*1024/i);
  });

  it("registers loaded external skills with the normal registry", async () => {
    const skillDir = join(root, "romance-play");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: Romance Play",
        "description: Romance interaction skill.",
        "---",
        "Romance body.",
      ].join("\n"),
      "utf-8",
    );

    const loaded = await loadExternalAgentSkills({ externalDirs: [root] });
    const registry = createSkillRegistry({ skills: loaded.skills });
    const resolved = registry.resolveSkills({ requestedSkills: ["romance-play"] });

    expect(resolved.usedSkills.map((skill) => skill.id)).toEqual(["romance-play"]);
    expect(resolved.forcedSkillIds).toEqual(["romance-play"]);
  });

  it("rejects relative external directories", async () => {
    // 不能用 relative(process.cwd(), root)：Windows CI 上 cwd 和临时目录在不同盘符，
    // path.relative 跨盘符会返回绝对路径，测试意图（传相对路径必须被拒绝）就失效了。
    await expect(loadExternalAgentSkills({ externalDirs: [join("relative", "external-skills")] }))
      .rejects.toThrow(/absolute/);
  });

  it("loads project-local skills from .agents/skills without explicit configuration", async () => {
    const skillDir = join(root, ".agents", "skills", "detective-play");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: Detective Play",
        "description: Detective evidence play.",
        "---",
        "Preserve evidence chains.",
      ].join("\n"),
      "utf-8",
    );

    const loaded = await loadConfiguredAgentSkills({
      projectRoot: root,
      env: {},
      homeDir: join(root, "home"),
    });

    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.skills).toContainEqual(expect.objectContaining({
      id: "detective-play",
      source: "project",
    }));
  });

  it("does not discover the removed InkOS-specific skill directory", async () => {
    const skillDir = join(root, ".inkos", "skills", "legacy-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: legacy-skill",
        "description: A manifest stored under the removed legacy directory.",
        "---",
        "This directory is no longer an Agent Skills source.",
      ].join("\n"),
      "utf-8",
    );

    const loaded = await loadConfiguredAgentSkills({
      projectRoot: root,
      env: {},
      homeDir: join(root, "home"),
    });

    expect(loaded.skills.map((skill) => skill.id)).not.toContain("legacy-skill");
  });

  it("discovers AgentSkills/OpenClaw project roots and one grouping level", async () => {
    const groupedSkillDir = join(root, "project", "skills", "writing", "writer-distillation");
    await mkdir(groupedSkillDir, { recursive: true });
    await writeFile(
      join(groupedSkillDir, "SKILL.md"),
      [
        "---",
        "name: writer-distillation",
        "description: Distill writer craft.",
        "---",
        "Preserve transferable craft, not source wording.",
      ].join("\n"),
      "utf-8",
    );

    const loaded = await loadConfiguredAgentSkills({
      projectRoot: join(root, "project"),
      env: {},
      homeDir: join(root, "home"),
    });

    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.skills.map((skill) => skill.id)).toContain("writer-distillation");
  });

  it("loads external skills from INKOS_SKILL_DIRS and reports bad paths without throwing", async () => {
    const externalRoot = join(root, "external-skills");
    const skillDir = join(externalRoot, "romance-play");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: Romance Play",
        "description: Romance interaction skill.",
        "---",
        "Keep emotional continuity.",
      ].join("\n"),
      "utf-8",
    );

    const loaded = await loadConfiguredAgentSkills({
      projectRoot: join(root, "project"),
      homeDir: join(root, "home"),
      env: {
        INKOS_SKILL_DIRS: [externalRoot, join(root, "does-not-exist")].join(delimiter),
      },
    });
    const registry = createSkillRegistry({ skills: loaded.skills });

    expect(loaded.skills.map((skill) => skill.id)).toContain("romance-play");
    expect(loaded.diagnostics.some((diagnostic) => diagnostic.path.includes("does-not-exist"))).toBe(true);
    expect(registry.resolveSkills({ requestedSkills: ["romance-play"] }).forcedSkillIds).toEqual(["romance-play"]);
  });

  it("marks skills discovered from the user Agent Skills directory as user skills", async () => {
    const homeDir = join(root, "home");
    const skillDir = join(homeDir, ".agents", "skills", "personal-editor");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: personal-editor",
        "description: Personal editing guidance.",
        "---",
        "Preserve the user's house style.",
      ].join("\n"),
      "utf-8",
    );

    const loaded = await loadConfiguredAgentSkills({
      projectRoot: join(root, "project"),
      homeDir,
      env: {},
    });

    expect(loaded.skills).toContainEqual(expect.objectContaining({
      id: "personal-editor",
      source: "user",
    }));
  });
});
