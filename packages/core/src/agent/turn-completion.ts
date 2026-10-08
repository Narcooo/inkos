import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { ActionResult } from "../harness/contracts.js";
import { loadWorkManifest } from "../harness/work-store.js";
import { readArtifactRevision } from "../harness/artifact-reader.js";
import { posix } from "node:path";

export const TURN_COMPLETION_TOOL = "finish_turn";
export const TurnCompletionSchema = Type.Object({
  status: Type.Union([Type.Literal("answered"), Type.Literal("delivered"), Type.Literal("needs_input"), Type.Literal("blocked")]),
  message: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export type TurnCompletion = Static<typeof TurnCompletionSchema>;

export const TURN_COMPLETION_GUIDANCE = `## Turn completion
Use finish_turn to return the final response after answering the request, delivering its requested actions, or identifying a concrete blocker or necessary user decision.
Announcing planned work is not completion. When work remains possible, call the relevant execution tool and continue from saved results.
Use answered only for information or discussion; delivered for completed action results; needs_input for a necessary user decision; blocked when the request cannot currently proceed.
Call finish_turn alone after other operations finish. Ground delivery claims in actual tool results. A recoverable tool error does not complete the original request.`;

/** Current-version reviews and exports become stale when their source changes.
 * Historical reviews are intentional snapshots and create no refresh obligation.
 */
export class TurnArtifactDeliveries {
  private readonly receipts = new Map<string, {workId: string; artifactId: string; revisionId: string; operation: string; scopeIssues?: ActionResult["observations"]}>();
  private readonly requiredCovers = new Set<string>();

  observe(result: ActionResult, parameters: unknown = {}) {
    const data = result.data as Record<string, unknown> | undefined;
    if (!data || typeof data !== "object" || typeof data.workId !== "string") return;
    const delivery = data.delivery as {target?:{coverRequired?:boolean}} | undefined;
    if (delivery?.target?.coverRequired === true) this.requiredCovers.add(data.workId);
    const historical = parameters && typeof parameters === "object" && "revisionId" in parameters;
    const chapterReview=data.kind==='chapter_review'&&data.reviewedArtifact&&typeof data.reviewedArtifact==='object'
      ? data.reviewedArtifact as {artifactId?:unknown;revisionId?:unknown}:undefined;
    const operations = data.kind === "artifact_delivered" ? ["review", "export"]
      : data.kind === "work_exported" ? ["export"]
      : chapterReview || data.kind === "artifact_reviewed" && !historical ? ["review"] : [];
    const artifactId = chapterReview?.artifactId ?? (data.kind === "work_exported" ? data.sourceArtifactId : data.artifactId);
    const revisionId = chapterReview?.revisionId ?? (data.kind === "work_exported" ? data.sourceRevisionId : data.revisionId);
    if (typeof artifactId !== "string" || typeof revisionId !== "string") return;
    const observations=Array.isArray(data.observations)?data.observations as ActionResult["observations"]:result.observations;
    const scopeIssues=observations.filter(item=>item.category==='scope'&&item.assessment==='issue');
    for (const operation of operations) this.receipts.set(JSON.stringify([data.workId, artifactId, operation]), {
      workId: data.workId, artifactId, revisionId, operation,
      ...(operation==='review'?{scopeIssues}:{}),
    });
  }

  async validate(projectRoot: string) {
    const works = new Map<string, Awaited<ReturnType<typeof loadWorkManifest>>>();
    for (const workId of this.requiredCovers) {
      const work = await loadWorkManifest(projectRoot, workId);
      works.set(workId, work);
      const cover = work.artifacts.find(artifact => artifact.revisions.some(revision => {
        const path = posix.parse(revision.path);
        return revision.id === artifact.currentRevisionId && revision.contentType.startsWith("image/")
          && path.name === "cover" && ["source", "source/final"].includes(path.dir);
      }));
      if (!cover) throw Object.assign(new Error("The saved production request requires a cover image. Generate the registered cover or report the concrete blocker before claiming delivery."), {
        code: "TURN_REQUIRED_ARTIFACT_MISSING", workId, artifactRole: "cover",
      });
      const {bytes} = await readArtifactRevision({projectRoot,workId,artifactId:cover.id});
      if (!bytes.length) throw Object.assign(new Error("The required cover image is empty."), {code:"TURN_REQUIRED_ARTIFACT_MISSING",workId,artifactRole:"cover"});
    }
    const stale: Array<{workId: string; artifactId: string; revisionId: string; operation: string; currentRevisionId: string | null | undefined}> = [];
    for (const receipt of this.receipts.values()) {
      if (!works.has(receipt.workId)) works.set(receipt.workId, await loadWorkManifest(projectRoot, receipt.workId));
      const work = works.get(receipt.workId)!;
      const currentRevisionId = work.artifacts.find(artifact => artifact.id === receipt.artifactId)?.currentRevisionId;
      if (currentRevisionId !== receipt.revisionId) stale.push({...receipt, currentRevisionId});
    }
    if (stale.length) throw Object.assign(new Error(JSON.stringify({
      code: "TURN_DELIVERY_STALE", stale,
      instruction: "The source changed after these operations. Refresh their current-version results before claiming delivery, or report the concrete blocker.",
    })), {code: "TURN_DELIVERY_STALE"});
    const scopeViolations=[...this.receipts.values()].filter(receipt=>receipt.scopeIssues?.length);
    if(scopeViolations.length)throw Object.assign(new Error(JSON.stringify({
      code:'TURN_REVISION_SCOPE_UNRESOLVED',scopeViolations,
      instruction:'The current review identifies changes outside the author-authorized region. Restore the protected material and re-review the current revision before claiming delivery. If the finding is disputed, verify the before/current sources and obtain a corrected review; do not broaden permission to satisfy a content suggestion.',
    })),{code:'TURN_REVISION_SCOPE_UNRESOLVED'});
  }
}

export function createTurnCompletionTool(options: {
  readonly state: () => { readonly activeActions: number; readonly hasDelivery: boolean; readonly deliveryFailed: boolean };
  readonly complete: (result: TurnCompletion) => void;
  readonly validateDelivery?: () => Promise<void>;
}): AgentTool<typeof TurnCompletionSchema> {
  return {
    name: TURN_COMPLETION_TOOL,
    label: "Finish response",
    description: "Return the terminal response after fulfilling the author request or identifying a concrete blocker. Never use this merely to announce planned work.",
    parameters: TurnCompletionSchema,
    async execute(_id, input, signal) {
      signal?.throwIfAborted();
      if (!input.message.trim()) throw Object.assign(new Error("A terminal response must have meaningful text."), { code: "TURN_RESPONSE_EMPTY" });
      const state = options.state();
      if (state.activeActions > 0) throw Object.assign(new Error("Operations are still running. Wait for their results before finishing."), { code: "TURN_ACTIONS_RUNNING" });
      if (input.status === "delivered" && (!state.hasDelivery || state.deliveryFailed)) {
        throw Object.assign(new Error("Delivery requires successful production or artifact results. Continue unfinished work or report the concrete blocker."), { code: "TURN_DELIVERY_UNPROVEN" });
      }
      if (input.status === "delivered") await options.validateDelivery?.();
      options.complete(input);
      return { content: [{ type: "text", text: input.message }], details: { kind: "turn_completion", ...input } };
    },
  };
}
