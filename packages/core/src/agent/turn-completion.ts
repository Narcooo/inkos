import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { ActionResult, WorkManifest } from "../harness/contracts.js";
import { loadWorkManifest } from "../harness/work-store.js";
import { readArtifactRevision } from "../harness/artifact-reader.js";
import { posix } from "node:path";
import { StateManager } from "../state/manager.js";
import { readBookExportSource } from "../interaction/export-artifact.js";

export const TURN_COMPLETION_TOOL = "finish_turn";
export const TurnCompletionSchema = Type.Object({
  status: Type.Union([Type.Literal("answered"), Type.Literal("delivered"), Type.Literal("needs_input"), Type.Literal("blocked")]),
  message: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export type TurnCompletion = Static<typeof TurnCompletionSchema>;

export const TURN_COMPLETION_GUIDANCE = `## Turn completion
The host independently identifies explicitly requested professional content reviews and exports from the original request. These requirements appear in request-delivery context after the first production action. Once sources exist, use bind_delivery_sources to bind every intended source to its existing step ID, including all requested chapters or companion artifacts. Keep the requirements through recovery. Structural inspection does not perform professional content review. Do not add unrequested operations.
Use finish_turn to return the final response after answering the request, delivering its requested actions, or identifying a concrete blocker or necessary user decision.
Announcing planned work is not completion. When work remains possible, call the relevant execution tool and continue from saved results.
Use answered only for information or discussion; delivered for completed action results; needs_input for a necessary user decision; blocked when the request cannot currently proceed.
Call finish_turn alone after other operations finish. Ground delivery claims in actual tool results. A recoverable tool error does not complete the original request.`;

/** Current-version reviews and exports become stale when their source changes.
 * Historical reviews are intentional snapshots and create no refresh obligation.
 */
export class TurnArtifactDeliveries {
  private readonly receipts = new Map<string, {workId: string; artifactId: string; revisionId: string; operation: string; scopeIssues?: ActionResult["observations"];qualityIssues?:ActionResult["observations"]}>();
  private readonly requiredOperations = new Map<string, {workId: string; artifactId: string; operation: string}>();
  private readonly requiredCovers = new Set<string>();
  private readonly chaptersWithLengthChecks = new Map<string, Set<number>>();
  private readonly requiredBookExports = new Set<string>();
  private readonly bookExports = new Map<string, string>();

  /** Register valid delivery attempts before execution, so failure cannot erase
   * an obligation and an unrelated successful action cannot fulfill it. */
  async requireOperations(projectRoot: string, workId: string | null, capabilityId: string, actionId: string, parameters: unknown) {
    if (capabilityId === "longform" && actionId === "export_book" && workId) {
      this.requiredBookExports.add(workId);
      this.bookExports.delete(workId);
      return;
    }
    if (capabilityId !== "workspace" || !workId || !parameters || typeof parameters !== "object") return;
    const params = parameters as {artifactId?: unknown; revisionId?: unknown};
    const operations = actionId === "review_and_export_work_artifact" ? ["review", "export"]
      : actionId === "review_work_artifact" && params.revisionId === undefined ? ["review"]
      : actionId === "export_work" ? ["export"] : [];
    if (!operations.length || typeof params.artifactId !== "string") return;
    const work = await loadWorkManifest(projectRoot, workId);
    const artifact = work.artifacts.find(item => item.id === params.artifactId);
    const revision = artifact?.revisions.find(item => item.id === artifact.currentRevisionId);
    if (!artifact || !revision || (params.revisionId !== undefined && params.revisionId !== revision.id)) return;
    if (operations.includes("export") && (!revision.path.endsWith(".md") || revision.path.startsWith("source/exports/"))) return;
    if (operations.includes("review") && !revision.contentType.startsWith("text/") && revision.contentType !== "application/json") return;
    for (const operation of operations) {
      const key = JSON.stringify([workId, artifact.id, operation]);
      this.requiredOperations.set(key, {workId, artifactId: artifact.id, operation});
      this.receipts.delete(key);
    }
  }

  observe(result: ActionResult, parameters: unknown = {}) {
    const data = result.data as Record<string, unknown> | undefined;
    const historical = parameters && typeof parameters === "object" && "revisionId" in parameters;
    const observations=Array.isArray(data?.observations)?data.observations as ActionResult["observations"]:result.observations;
    for(const receipt of result.operationReceipts??[]){
      if(receipt.operation!=='review')continue;
      for(const source of receipt.sources){
        const key=JSON.stringify([source.workId,source.artifactId,'review']);
        if(historical&&!this.requiredOperations.has(key))continue;
        const findings=observations.filter(item=>!item.target||(item.target.workId===source.workId&&item.target.artifactId===source.artifactId&&item.target.revisionId===source.revisionId));
        this.receipts.set(key,{workId:source.workId,artifactId:source.artifactId,revisionId:source.revisionId!,operation:'review',
          scopeIssues:findings.filter(item=>item.category==='scope'&&item.assessment==='issue'),
          qualityIssues:findings.filter(item=>item.category==='quality'&&item.assessment==='issue')});
      }
    }
    if (!data || typeof data !== "object" || typeof data.workId !== "string") return;
    const delivery = data.delivery as {target?:{coverRequired?:boolean}} | undefined;
    if (delivery?.target?.coverRequired === true) this.requiredCovers.add(data.workId);
    if (["chapter_written", "chapters_written", "chapter_revision"].includes(String(data.kind)) && delivery) {
      const chapters = this.chaptersWithLengthChecks.get(data.workId) ?? new Set<number>();
      const items = Array.isArray(data.chapters) ? data.chapters : [data];
      for (const item of items) if (item && typeof item.chapterNumber === "number") chapters.add(item.chapterNumber);
      this.chaptersWithLengthChecks.set(data.workId, chapters);
    }
    if (data.kind === "book_exported" && typeof data.sourceDigest === "string") {
      this.requiredBookExports.add(data.workId);
      this.bookExports.set(data.workId, data.sourceDigest);
    }
    const chapterReview=data.kind==='chapter_review'&&data.reviewedArtifact&&typeof data.reviewedArtifact==='object'
      ? data.reviewedArtifact as {artifactId?:unknown;revisionId?:unknown}:undefined;
    const operations = data.kind === "artifact_delivered" ? ["review", "export"]
      : data.kind === "work_exported" ? ["export"]
      : chapterReview || data.kind === "artifact_reviewed" && (!historical || this.requiredOperations.has(JSON.stringify([data.workId, data.artifactId, "review"]))) ? ["review"] : [];
    const artifactId = chapterReview?.artifactId ?? (data.kind === "work_exported" ? data.sourceArtifactId : data.artifactId);
    const revisionId = chapterReview?.revisionId ?? (data.kind === "work_exported" ? data.sourceRevisionId : data.revisionId);
    if (typeof artifactId !== "string" || typeof revisionId !== "string") return;
    const scopeIssues=observations.filter(item=>item.category==='scope'&&item.assessment==='issue');
    for (const operation of operations) {
      if(operation==='review'&&result.operationReceipts?.some(receipt=>receipt.operation==='review'&&receipt.sources.some(source=>source.workId===data.workId&&source.artifactId===artifactId)))continue;
      this.receipts.set(JSON.stringify([data.workId, artifactId, operation]), {
      workId: data.workId, artifactId, revisionId, operation,
      ...(operation==='review'?{scopeIssues,qualityIssues:observations.filter(item=>item.category==='quality'&&item.assessment==='issue')}:{}),
      });
    }
  }

  async validate(projectRoot: string, creation?: {workId:string;baselineWork:WorkManifest|null;sourceQuote:string}) {
    const missing = [...this.requiredOperations].filter(([key]) => !this.receipts.has(key)).map(([,operation]) => operation);
    for (const workId of this.requiredBookExports) {
      if (!this.bookExports.has(workId)) missing.push({workId, artifactId: "chapters", operation: "export"});
    }
    if (missing.length) throw Object.assign(new Error(JSON.stringify({
      code: "TURN_REQUIRED_OPERATIONS_INCOMPLETE", missing,
      instruction: "These requested artifact operations have not succeeded. Complete them on the current revision or report the concrete blocker; another successful operation does not fulfill them.",
    })), {code: "TURN_REQUIRED_OPERATIONS_INCOMPLETE"});
    const state = new StateManager(projectRoot);
    for (const workId of new Set([...this.chaptersWithLengthChecks.keys(), ...this.requiredBookExports])) {
      const source = await readBookExportSource(state, workId);
      const failures = source.delivery.chapters.filter(chapter => chapter.status === "needs_revision"
        && (this.requiredBookExports.has(workId) || this.chaptersWithLengthChecks.get(workId)?.has(chapter.chapterNumber)));
      if (failures.length) throw Object.assign(new Error(JSON.stringify({
        code: "TURN_DELIVERY_CHECKS_FAILED", workId, chapters: failures,
        instruction: "Current chapter text fails explicit author length bounds. Repair within the authorized editing scope, or report the constraint conflict. Export success alone does not satisfy those bounds.",
      })), {code: "TURN_DELIVERY_CHECKS_FAILED"});
      const exportedDigest = this.bookExports.get(workId);
      if (exportedDigest && exportedDigest !== source.sourceDigest) throw Object.assign(new Error(JSON.stringify({
        code: "TURN_DELIVERY_STALE", workId, operation: "export",
        instruction: "Chapter sources changed after export. Export the current sources before claiming delivery.",
      })), {code: "TURN_DELIVERY_STALE"});
    }
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
    if(creation){
      const baseline=creation.baselineWork;
      const findings=[...this.receipts.values()].filter(receipt=>receipt.workId===creation.workId&&receipt.qualityIssues?.length
        &&!(baseline?.id===receipt.workId&&baseline.artifacts.some(artifact=>artifact.id===receipt.artifactId)));
      if(findings.length)throw Object.assign(new Error(JSON.stringify({
        code:'TURN_NEW_CONTENT_REVIEW_UNRESOLVED',sourceQuote:creation.sourceQuote,findings,
        instruction:'The requested new content still has current review findings. Verify them against the original request, current sources and actual checks. Correct supported defects within scope and re-review; for an unsupported or stylistic claim, obtain a corrected evidence-based review instead of changing the work to satisfy it. Refresh requested exports after changes. Do not alter protected existing content. Report a concrete blocker if resolution cannot proceed.',
      })),{code:'TURN_NEW_CONTENT_REVIEW_UNRESOLVED'});
    }
  }
}

export function createTurnCompletionTool(options: {
  readonly state: () => { readonly activeActions: number; readonly hasDelivery: boolean; readonly deliveryFailed: boolean };
  readonly complete: (result: TurnCompletion) => void;
  readonly validateDelivery?: (signal?:AbortSignal) => Promise<void>;
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
      if (input.status === "delivered" || input.status === "answered" && state.hasDelivery) await options.validateDelivery?.(signal);
      options.complete(input);
      return { content: [{ type: "text", text: input.message }], details: { kind: "turn_completion", ...input } };
    },
  };
}
