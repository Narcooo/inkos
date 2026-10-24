import {createHash} from 'node:crypto';
import type {AgentMessage} from '@mariozechner/pi-agent-core';

/** Read bodies belong to the operation that consumed them. Later requests get
 * their source identity and can re-read that version; the transcript keeps the
 * full observation. This also keeps legacy binary-as-text reads out of prompts. */
export function historicalReadReference(message:AgentMessage,args:unknown):string|undefined {
  if(message.role!=='toolResult'||message.isError||!['read','workspace__read'].includes(message.toolName))return;
  if(!args||typeof args!=='object')return;
  const target=args as Record<string,unknown>;
  if(typeof target.path!=='string'&&typeof target.artifactId!=='string')return;
  const details=message.details&&typeof message.details==='object'?message.details as Record<string,unknown>:{};
  const artifactId=details.artifactId??target.artifactId,workId=details.workId??target.workId;
  // Artifact IDs are only unique within a Work. Retain legacy observations
  // that cannot be addressed again without guessing their original Work.
  if(typeof target.path!=='string'&&(typeof artifactId!=='string'||typeof workId!=='string'))return;
  const source=typeof artifactId==='string'&&typeof workId==='string'
    ?{artifactId,workId,...Object.fromEntries(['revisionId','startLine','lineCount'].filter(key=>(details[key]??target[key])!==undefined).map(key=>[key,details[key]??target[key]]))}
    :{path:target.path};
  const fields=['kind','workId','artifactId','revisionId','path','status','checksum','mimeType','byteLength','startLine','endLine','totalLines','contentScope'];
  const receipt=Object.fromEntries(fields.filter(key=>details[key]!==undefined).map(key=>[key,details[key]]));
  return JSON.stringify({kind:'historical_read_reference',target:source,
    receipt,observationHash:createHash('sha256').update(JSON.stringify(message.content)).digest('hex'),contentOmitted:true,contentAccess:'Read the recorded source again when its content is needed. A path-only source may have changed; compare its checksum.'});
}

export function projectHistoricalReads(messages:readonly AgentMessage[]):AgentMessage[]{
  const calls=new Map<string,unknown>();
  return messages.map(message=>{
    if(message.role==='assistant')for(const block of message.content)if(block.type==='toolCall')calls.set(block.id,block.arguments);
    if(message.role!=='toolResult')return message;
    const reference=historicalReadReference(message,calls.get(message.toolCallId));
    return reference?{...message,content:[{type:'text' as const,text:reference}]}:message;
  });
}
