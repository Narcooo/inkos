import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLLMClient } from "../llm/provider.js";
import { PipelineRunner } from "../pipeline/runner.js";
import { createWorkManifest, loadWorkManifest, saveWorkManifest } from "../harness/work-store.js";
import { syncWorkSourceArtifacts } from "../harness/source-sync.js";
import { readArtifactRevision } from "../harness/artifact-reader.js";
import { executeExplicitCapabilityTool } from "../harness/explicit-action.js";
import { createShortProductionStageTools } from "../harness/tools/short-production.js";
import { createArtifactMethodTools } from "../harness/tools/artifact-methods.js";
import { createAdoptWorkRevisionTool } from "../harness/tools/work-artifacts.js";

// Exercise native tools, workers, validation, persistence and episode receipts;
// substitute only the provider boundary. No socket or live model is used.
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../utils/proxy-fetch.js", () => ({ fetchWithProxy: mocks.fetch }));

const roots: string[] = [];
const rewritten = "# Fixture outline\n\nThe revised opening.\nThe preserved ending.\n";
type Request = { tools: Array<{ function: { name: string } }>; messages: Array<{ role: string; content: string }> };
let requests: Request[];
let beforeRevision: (() => Promise<void>) | undefined;

beforeEach(() => {
  requests = [];
  beforeRevision = undefined;
  mocks.fetch.mockImplementation(async (_url: string, options: { body: string }) => {
    const body = JSON.parse(options.body) as Request;
    requests.push(body);
    const name = body.tools[0]!.function.name;
    let args: unknown;
    switch (name) {
      case "submit_short_outline":
        args = { storyTitle: "Fixture", planMarkdown: "A fixture premise.", chapter_1_plan: "The opening.", chapter_2_plan: "The ending." };
        break;
      case "submit_author_edit_scope":
        args = { wholeDocument: true, selections: [], reason: "The fixture author explicitly requested the entire outline." };
        break;
      case "submit_artifact_revision":
        await beforeRevision?.();
        args = { range_0_content: rewritten };
        break;
      case "submit_artifact_review":
        const input = JSON.parse([...body.messages].reverse().find(message => message.role === "user")!.content);
        args = { summary: "Fixture source checked.", observations: [{ code: "FIXTURE_SOURCE", category: "quality", assessment: "observation",
          summary: "The supplied first line is cited.", sourceRefs: [{ sourceId: input.sources[0].sourceId, startLine: 1, endLine: 1 }] }] };
        break;
      default: throw new Error(`Unexpected model request: ${name}`);
    }
    return new Response(JSON.stringify({ choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ id: `fixture-${requests.length}`,
      type: "function", function: { name, arguments: JSON.stringify(args) } }] } }] }));
  });
});
afterEach(async () => {
  mocks.fetch.mockReset();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "inkos-candidate-lifecycle-"));
  roots.push(root);
  await saveWorkManifest(root, createWorkManifest({ id: "fixture", title: "Fixture", profileId: "short-fiction", language: "en",
    metadata: { intent: "A two-scene test outline. Generate only the outline." } }));
  await mkdir(join(root, "works/fixture/source"), { recursive: true });
  await syncWorkSourceArtifacts({ projectRoot: root, workId: "fixture", accept: true,
    writes: [{ relativePath: "works/fixture/source/brief.md", content: "Preserve this fixture brief." }] });
  const config = { provider: "openai" as const, service: "custom", configSource: "studio" as const, apiKey: "fixture",
    model: "fixture", baseUrl: "https://fixture.invalid/v1", apiFormat: "chat" as const, stream: false,
    temperature: 0, thinkingBudget: 0, maxTokens: 8192 };
  const pipeline = new PipelineRunner({ client: createLLMClient(config), model: "fixture", projectRoot: root, defaultLLMConfig: config });
  const [review, revise] = createArtifactMethodTools(pipeline, root, "fixture");
  const adopt = createAdoptWorkRevisionTool(root, "fixture");
  const run = (tool: AgentTool<any, any>, parameters: unknown, authorRequest: string, signal?: AbortSignal) => executeExplicitCapabilityTool({
    projectRoot: root, workId: "fixture", tool, parameters, authorRequest, signal,
    binding: { capabilityId: tool.name === "plan_short_fiction" ? "short-fiction" : "workspace", actionId: tool.name,
      profileId: "short-fiction", risk: "recoverable-write" },
  });
  await run(createShortProductionStageTools(pipeline, root, "fixture")[0]!, { workId: "fixture", chapters: 2 }, "Create only the two-scene outline.");
  const work = await loadWorkManifest(root, "fixture");
  const artifact = work.artifacts.find(item => item.revisions.some(revision => revision.path === "source/outline/v001.md"))!;
  const candidate = artifact.revisions.at(-1)!;
  expect(artifact.currentRevisionId).toBeNull();
  const candidateText = (await readArtifactRevision({ projectRoot: root, workId: "fixture", artifactId: artifact.id, revisionId: candidate.id })).bytes.toString();
  return { root, run, review: review!, revise: revise!, adopt, artifact, candidate, candidateText };
}

it("plans a candidate, reviews it, explicitly adopts it, revises it and reviews the saved new version", async () => {
  const { root, run, review, revise, adopt, artifact, candidate, candidateText } = await fixture();
  const staged = await syncWorkSourceArtifacts({ projectRoot: root, workId: "fixture", accept: false,
    writes: [{ relativePath: "works/fixture/source/notes.md", content: "An unrelated candidate note." }] });
  const notes = staged.artifacts.find(item => item.revisions.some(revision => revision.path === "source/notes.md"))!;
  const firstReview = await run(review, { artifactId: artifact.id, revisionId: candidate.id, instruction: "Review this candidate." }, "Review this candidate only.");
  expect(firstReview.status).toBe("success");
  expect(firstReview.data).toMatchObject({ revisionId: candidate.id, targetHash: candidate.checksum });
  expect((await loadWorkManifest(root, "fixture")).artifacts.find(item => item.id === artifact.id)!.currentRevisionId).toBeNull();
  const callCount = requests.length;
  await expect(run(revise, { artifactId: artifact.id, revisionId: candidate.id, instruction: "Revise the entire outline." }, "Revise the entire outline."))
    .rejects.toMatchObject({ code: "ARTIFACT_REVISION_CONFLICT" });
  expect(requests).toHaveLength(callCount);

  await run(adopt, { artifactId: artifact.id, revisionId: candidate.id, expectedCurrentRevisionId: null }, "Adopt this inspected candidate.");
  const result = await run(revise, { artifactId: artifact.id, revisionId: candidate.id, instruction: "Revise the entire outline." }, "Revise the entire outline.");
  const saved = await readArtifactRevision({ projectRoot: root, workId: "fixture", artifactId: artifact.id });
  expect(result.status).toBe("success");
  expect(result.data).toMatchObject({ previousRevisionId: candidate.id, revisionId: saved.revision.id });
  expect(saved.revision.id).not.toBe(candidate.id);
  expect(saved.revision.parentRevisionId).toBe(candidate.id);
  expect(saved.bytes.toString()).toBe(rewritten);
  expect(await readFile(join(root, "works/fixture/source/outline/v001.md"), "utf8")).toBe(rewritten);
  expect((await readArtifactRevision({ projectRoot: root, workId: "fixture", artifactId: artifact.id, revisionId: candidate.id })).bytes.toString()).toBe(candidateText);

  const checked = await run(review, { artifactId: artifact.id, instruction: "Review the revised outline." }, "Review the revised outline.");
  expect(checked.data).toMatchObject({ revisionId: saved.revision.id, targetHash: saved.revision.checksum });
  const reportPath = (checked.data as { path: string }).path;
  const report = JSON.parse(await readFile(join(root, "works/fixture", reportPath), "utf8"));
  expect(report).toMatchObject({ revisionId: saved.revision.id, targetHash: saved.revision.checksum,
    observations: [{ target: { artifactId: artifact.id, revisionId: saved.revision.id } }] });
  const reviewInput = JSON.parse([...requests.at(-1)!.messages].reverse().find(message => message.role === "user")!.content);
  expect(JSON.stringify(reviewInput.sources[0])).toContain("The revised opening.");
  const after = await loadWorkManifest(root, "fixture");
  expect(after.artifacts.find(item => item.id === notes.id)).toEqual(notes);
  expect(await readFile(join(root, "works/fixture/source/brief.md"), "utf8")).toBe("Preserve this fixture brief.");
  expect(requests.map(request => request.tools[0]!.function.name)).toEqual([
    "submit_short_outline", "submit_artifact_review", "submit_author_edit_scope", "submit_artifact_revision", "submit_artifact_review",
  ]);
});

it.each(["accepted revision", "unregistered edit"])("preserves a %s that arrives while the revision model is running", async (change) => {
  const { root, run, revise, adopt, artifact, candidate } = await fixture();
  await run(adopt, { artifactId: artifact.id, revisionId: candidate.id, expectedCurrentRevisionId: null }, "Adopt this candidate.");
  const later = "A newer author change that must survive.\n";
  beforeRevision = async () => {
    if (change === "accepted revision") await syncWorkSourceArtifacts({ projectRoot: root, workId: "fixture", accept: true,
      writes: [{ relativePath: "works/fixture/source/outline/v001.md", content: later }] });
    else await writeFile(join(root, "works/fixture/source/outline/v001.md"), later);
  };
  await expect(run(revise, { artifactId: artifact.id, revisionId: candidate.id, instruction: "Revise the entire outline." }, "Revise the entire outline."))
    .rejects.toMatchObject({ code: "ARTIFACT_REVISION_CONFLICT" });
  expect(await readFile(join(root, "works/fixture/source/outline/v001.md"), "utf8")).toBe(later);
  const after = await loadWorkManifest(root, "fixture");
  const saved = after.artifacts.find(item => item.id === artifact.id)!;
  expect(saved.revisions).toHaveLength(change === "accepted revision" ? 2 : 1);
  expect(saved.currentRevisionId === candidate.id).toBe(change !== "accepted revision");
});
