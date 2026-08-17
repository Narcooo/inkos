import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname, relative, isAbsolute, sep } from "node:path";
import { generateImageFromPrompt, resolveCoverGenerationRequest } from "../pipeline/short-fiction-runner.js";
import type { StoryNode } from "./graph-schema.js";
import type { StoryGraphDelta } from "./delta.js";

export interface NodeImageDeps {
  generateImage(prompt: string, size: string): Promise<{ buffer: Buffer; extension: "png" | "jpg" }>;
}

function safeAssetSegment(value: string): string {
  const encoded = encodeURIComponent(value).replace(/[!'()*]/g, (ch) =>
    `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return encoded || "node";
}

function escapesBase(rel: string): boolean {
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

/** posix-style relative path served by GET /api/v1/project/files/<this> */
export function nodeImageRelPath(projectId: string, nodeId: string, ext: string): string {
  return `interactive-films/${projectId}/assets/nodes/${safeAssetSegment(nodeId)}.${ext}`;
}

export function buildSetImageRefDelta(node: StoryNode, prompt: string, assetRef: string): StoryGraphDelta {
  return { nodes: { upsert: [{ ...node, imageSlot: { prompt, assetRef } }], remove: [] }, notes: [] };
}

export async function generateNodeImage(params: {
  projectRoot: string;
  projectId: string;
  node: StoryNode;
  size?: string;
  deps: NodeImageDeps;
}): Promise<{ assetRef: string; delta: StoryGraphDelta }> {
  const prompt = params.node.imageSlot?.prompt?.trim() || params.node.sceneDesc;
  if (!prompt) {
    throw new Error(`node ${params.node.id} has no imageSlot.prompt or sceneDesc to generate an image from`);
  }
  const size = params.size ?? process.env.INKOS_FILM_IMAGE_SIZE ?? "1536x1024";
  const { buffer, extension } = await params.deps.generateImage(prompt, size);
  const assetRef = nodeImageRelPath(params.projectId, params.node.id, extension);
  const abs = join(params.projectRoot, assetRef);
  const rel = relative(params.projectRoot, abs);
  if (!rel || escapesBase(rel)) {
    throw new Error(`unsafe node id for image path: ${params.node.id}`);
  }
  const assetDir = join(params.projectRoot, "interactive-films", params.projectId, "assets", "nodes");
  const relToAssetDir = relative(assetDir, abs);
  if (!relToAssetDir || escapesBase(relToAssetDir)) {
    throw new Error(`unsafe node id for image path: ${params.node.id}`);
  }
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, buffer);
  return { assetRef, delta: buildSetImageRefDelta(params.node, prompt, assetRef) };
}

/**
 * Resolves a NodeImageDeps backed by the repo's existing cover-generation
 * infrastructure. `resolveCoverGenerationRequest` reads project config + env
 * vars to build a ShortFictionCoverRequest, which is then captured in the
 * closure so it's only resolved once per call to defaultNodeImageDeps.
 */
export async function defaultNodeImageDeps(projectRoot: string): Promise<NodeImageDeps> {
  const request = await resolveCoverGenerationRequest({ root: projectRoot });
  return {
    generateImage: (prompt, size) => generateImageFromPrompt(request, prompt, size),
  };
}
