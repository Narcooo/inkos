function textFromContentParts(content: unknown): string {
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const item = part as Record<string, unknown>;
      return item.type === "text" && typeof item.text === "string" ? item.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

/** Download only an export revision committed by the host, never a model path. */
export function exportedRevisionDownloads(value:unknown):Array<{workId:string;artifactId:string;revisionId:string;path:string;package:boolean}>{
  if(!value||typeof value!=='object')return[];
  const details=value as Record<string,unknown>;
  const execution=details.hostExecution as {status?:unknown;artifacts?:unknown}|undefined;
  if(execution?.status!=='success'||!Array.isArray(execution.artifacts))return[];
  return execution.artifacts.filter(item=>item&&typeof item==='object'
    &&typeof item.workId==='string'&&(typeof details.workId!=='string'||item.workId===details.workId)
    &&typeof item.path==='string'&&item.path.startsWith('source/exports/')
    &&typeof item.artifactId==='string'&&typeof item.revisionId==='string')
    .map(item=>({workId:item.workId,artifactId:item.artifactId,revisionId:item.revisionId,path:item.path,package:item.path.endsWith('.zip')}));
}

/** Model observations carry control facts; the author sees their display text. */
export function toolResultDisplayText(text: string): string {
  try {
    const observation = JSON.parse(text);
    if (observation?.status === "success" && typeof observation.summary === "string"
      && Array.isArray(observation.artifacts) && Array.isArray(observation.observations)
      && observation.facts && typeof observation.facts === "object") {
      return typeof observation.content === "string" ? observation.content : observation.summary;
    }
  } catch { /* Ordinary source text is already a display value. */ }
  return text;
}

export function summarizeToolResult(result: unknown): string {
  let text = "";

  if (typeof result === "string") {
    text = result;
  } else if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    const details = record.details as { displayText?: unknown } | undefined;
    if (typeof details?.displayText === "string") return details.displayText;
    if (typeof record.content === "string") text = record.content;
    else text = textFromContentParts(record.content);
    if (!text && typeof record.text === "string") text = record.text;
    if (!text && typeof record.message === "string") text = record.message;
  }

  if (!text) {
    if (result === undefined || result === null) return "";
    try {
      text = JSON.stringify(result);
    } catch {
      text = "";
    }
  }

  return toolResultDisplayText(text);
}
