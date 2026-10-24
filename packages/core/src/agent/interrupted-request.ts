import { readTranscriptEvents } from "../interaction/session-transcript.js";
import { interruptedToolExchanges } from "../interaction/session-transcript-restore.js";
import type { SessionKind } from "../interaction/session.js";
import { ActionResultSchema, type ActionResult } from "../harness/contracts.js";
import { readArtifactRevision } from "../harness/artifact-reader.js";

/** Warm delivery state only from verified, still-current artifact operations. */
export async function recoverInterruptedActionResults(
  root: string,
  sessionId: string,
  input: string,
  sessionKind?: SessionKind,
) {
  const exchanges = interruptedToolExchanges(await readTranscriptEvents(root, sessionId), sessionKind, input);
  const recovered: Array<{ toolName: string; parameters: unknown; result: ActionResult }> = [];
  for (const exchange of exchanges) {
    const message = exchange.result.message as Record<string, unknown>;
    if (message.isError === true || !message.details || typeof message.details !== "object") continue;
    const details = message.details as Record<string, unknown>;
    const host = details.hostExecution as { risk?: unknown; status?: unknown; artifacts?: unknown } | undefined;
    if (!host || host.status !== "success" || !["recoverable-write", "destructive-write"].includes(String(host.risk))) continue;
    const parsed = ActionResultSchema.safeParse({
      status: host.status,
      summary: typeof details.displayText === "string" && details.displayText.trim()
        ? details.displayText : "Recovered completed operation",
      artifacts: host.artifacts,
      observations: Array.isArray(details.observations) ? details.observations : [],
      ...(details.operationReceipts ? { operationReceipts: details.operationReceipts } : {}),
      data: details,
    });
    if (!parsed.success || !parsed.data.artifacts.length) continue;
    let current = true;
    for (const reference of parsed.data.artifacts) {
      if (!reference.revisionId) { current = false; break; }
      try {
        const source = await readArtifactRevision({ projectRoot: root, ...reference });
        if (source.artifact?.currentRevisionId !== reference.revisionId) { current = false; break; }
      } catch {
        // Missing or unverifiable snapshots cannot establish delivery.
        current = false;
        break;
      }
    }
    if (current) recovered.push({ toolName: String(exchange.call.name), parameters: exchange.call.arguments, result: parsed.data });
  }
  return recovered;
}
