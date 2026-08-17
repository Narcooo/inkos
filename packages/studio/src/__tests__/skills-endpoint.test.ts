import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStudioServer } from "../api/server.js";

describe("Studio skill endpoints", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-studio-skills-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lists built-in professional skills alongside editable project skills", async () => {
    await mkdir(join(root, ".agents", "skills", "detective-play"), { recursive: true });
    await writeFile(
      join(root, ".agents", "skills", "detective-play", "SKILL.md"),
      [
        "---",
        "name: Detective Play",
        "description: Evidence-chain play skill.",
        "---",
        "Track evidence before twists.",
      ].join("\n"),
      { flag: "w" },
    );

    const app = createStudioServer({} as never, root);
    const res = await app.request("/api/v1/skills");
    const json = await res.json() as { skills: Array<{ id: string; source: string; editable: boolean; body?: string }> };

    expect(res.status).toBe(200);
    expect(json.skills).toContainEqual(expect.objectContaining({
      id: "inkos-long-writing",
      source: "builtin",
      editable: false,
    }));
    expect(json.skills).toContainEqual(expect.objectContaining({
      id: "detective-play",
      source: "project",
      editable: true,
      body: "Track evidence before twists.",
    }));
    expect(json.skills.find((skill) => skill.id === "detective-play")).not.toHaveProperty("whenToUse");
  });

  it("lets an imported project skill override a built-in skill", async () => {
    const app = createStudioServer({} as never, root);
    const manifest = Buffer.from([
      "---",
      "name: inkos-story-review",
      "description: Review with this project's acceptance standard.",
      "---",
      "Apply the project-specific review standard.",
    ].join("\n")).toString("base64");

    const imported = await app.request("/api/v1/skills/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [
          { path: "inkos-story-review/SKILL.md", dataUrl: `data:text/markdown;base64,${manifest}` },
        ],
      }),
    });
    expect(imported.status).toBe(200);

    const listed = await app.request("/api/v1/skills");
    const json = await listed.json() as {
      skills: Array<{ id: string; source: string; editable: boolean; body: string }>;
    };
    const reviewSkills = json.skills.filter((skill) => skill.id === "inkos-story-review");

    expect(reviewSkills).toEqual([expect.objectContaining({
      source: "project",
      editable: true,
      body: "Apply the project-specific review standard.",
    })]);
  });

  it("does not expose the legacy JSON skill create or update protocol", async () => {
    const app = createStudioServer({} as never, root);

    const createRes = await app.request("/api/v1/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "romance-play",
        name: "Romance Play",
        description: "Relationship-focused play skill.",
        whenToUse: "Use for romance interactions.",
        body: "Keep emotional continuity visible.",
      }),
    });
    expect(createRes.status).toBe(404);

    const updateRes = await app.request("/api/v1/skills/romance-play", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Romance Play",
        description: "Relationship-focused play skill.",
        whenToUse: "Use for romance interactions.",
        body: "Track longing, avoidance, and revealed care.",
      }),
    });
    expect(updateRes.status).toBe(404);
  });

  it("imports a standard AgentSkills folder without manual InkOS fields", async () => {
    const app = createStudioServer({} as never, root);
    const manifest = Buffer.from([
      "---",
      "name: writer-distillation",
      "description: Distill a writer's craft when the user asks for style analysis.",
      "---",
      "Read references/rubric.md and extract transferable craft.",
    ].join("\n")).toString("base64");
    const rubric = Buffer.from("# Rubric\nPrefer scene evidence.", "utf-8").toString("base64");

    const response = await app.request("/api/v1/skills/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [
          { path: "writer-distillation/SKILL.md", dataUrl: `data:text/markdown;base64,${manifest}` },
          { path: "writer-distillation/references/rubric.md", dataUrl: `data:text/markdown;base64,${rubric}` },
        ],
      }),
    });

    expect(response.status).toBe(200);
    const json = await response.json() as { skill: { id: string; editable: boolean } };
    expect(json.skill).toMatchObject({ id: "writer-distillation", editable: true });
    expect(await readFile(
      join(root, ".agents", "skills", "writer-distillation", "references", "rubric.md"),
      "utf-8",
    )).toContain("Prefer scene evidence");
  });

  it("rejects traversal and does not overwrite an imported skill without confirmation", async () => {
    const app = createStudioServer({} as never, root);
    const manifest = Buffer.from([
      "---",
      "name: writer-distillation",
      "description: Distill writer craft.",
      "---",
      "Distill craft.",
    ].join("\n")).toString("base64");
    const payload = {
      files: [
        { path: "writer-distillation/SKILL.md", dataUrl: `data:text/markdown;base64,${manifest}` },
      ],
    };

    expect((await app.request("/api/v1/skills/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })).status).toBe(200);
    expect((await app.request("/api/v1/skills/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })).status).toBe(409);

    const traversal = await app.request("/api/v1/skills/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [
          ...payload.files,
          { path: "writer-distillation/../outside.txt", dataUrl: "data:text/plain;base64,bm8=" },
        ],
      }),
    });
    expect(traversal.status).toBe(400);
  });

  it("rejects import paths that collide on case-insensitive filesystems", async () => {
    const app = createStudioServer({} as never, root);
    const manifest = Buffer.from([
      "---",
      "name: portable-skill",
      "description: Portable skill folder.",
      "---",
      "Use the static reference.",
    ].join("\n")).toString("base64");

    const response = await app.request("/api/v1/skills/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [
          { path: "portable-skill/SKILL.md", dataUrl: `data:text/markdown;base64,${manifest}` },
          { path: "portable-skill/References/rubric.md", dataUrl: "data:text/plain;base64,b25l" },
          { path: "portable-skill/references/RUBRIC.md", dataUrl: "data:text/plain;base64,dHdv" },
        ],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_SKILL_IMPORT" } });
  });
});
