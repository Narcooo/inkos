import type { ReactNode } from "react";

export const textFromStreamdownChildren = (children: ReactNode): string => {
  if (typeof children === "string") return children;
  if (typeof children === "number" || typeof children === "bigint") return String(children);
  if (Array.isArray(children)) return children.map(textFromStreamdownChildren).join("");
  return "";
};

export const containsStreamdownMath = (content: string) =>
  /\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\]/.test(content)
  || /(^|[^\\])\$[^$\n]{1,200}([^\\])\$/.test(content);

export const containsStreamdownMermaid = (content: string) =>
  /```(?:mermaid|mmd)\b/i.test(content)
  || /^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline|quadrantChart|gitGraph)\b/m.test(content);
