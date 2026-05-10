import { cjk } from "@streamdown/cjk";
import type { MathPlugin, DiagramPlugin, PluginConfig } from "streamdown";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

let mathPluginPromise: Promise<MathPlugin> | null = null;
let mermaidPluginPromise: Promise<DiagramPlugin> | null = null;

const textFromChildren = (children: ReactNode): string => {
  if (typeof children === "string") return children;
  if (typeof children === "number" || typeof children === "bigint") return String(children);
  if (Array.isArray(children)) return children.map(textFromChildren).join("");
  return "";
};

const containsMath = (content: string) =>
  /\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\]/.test(content)
  || /(^|[^\\])\$[^$\n]{1,200}([^\\])\$/.test(content);

const containsMermaid = (content: string) =>
  /```(?:mermaid|mmd)\b/i.test(content)
  || /^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline|quadrantChart|gitGraph)\b/m.test(content);

const loadMathPlugin = () => {
  mathPluginPromise ??= import("@streamdown/math").then((module) => module.math);
  return mathPluginPromise;
};

const loadMermaidPlugin = () => {
  mermaidPluginPromise ??= import("@streamdown/mermaid").then((module) => module.mermaid);
  return mermaidPluginPromise;
};

export const useStreamdownPlugins = (children: ReactNode): PluginConfig => {
  const content = useMemo(() => textFromChildren(children), [children]);
  const needsMath = useMemo(() => containsMath(content), [content]);
  const needsMermaid = useMemo(() => containsMermaid(content), [content]);
  const [mathPlugin, setMathPlugin] = useState<MathPlugin | null>(null);
  const [mermaidPlugin, setMermaidPlugin] = useState<DiagramPlugin | null>(null);

  useEffect(() => {
    if (!needsMath || mathPlugin) return;

    let active = true;
    loadMathPlugin().then((plugin) => {
      if (active) setMathPlugin(plugin);
    });

    return () => {
      active = false;
    };
  }, [mathPlugin, needsMath]);

  useEffect(() => {
    if (!needsMermaid || mermaidPlugin) return;

    let active = true;
    loadMermaidPlugin().then((plugin) => {
      if (active) setMermaidPlugin(plugin);
    });

    return () => {
      active = false;
    };
  }, [mermaidPlugin, needsMermaid]);

  return useMemo(
    () => ({
      cjk,
      ...(needsMath && mathPlugin ? { math: mathPlugin } : {}),
      ...(needsMermaid && mermaidPlugin ? { mermaid: mermaidPlugin } : {}),
    }),
    [mathPlugin, mermaidPlugin, needsMath, needsMermaid]
  );
};
