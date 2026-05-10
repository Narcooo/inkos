import { cjk } from "@streamdown/cjk";
import type { MathPlugin, DiagramPlugin, PluginConfig } from "streamdown";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  containsStreamdownMath,
  containsStreamdownMermaid,
  textFromStreamdownChildren,
} from "./streamdown-content";
import {
  loadStreamdownMathPlugin,
  loadStreamdownMermaidPlugin,
} from "./streamdown-plugin-loaders";

export const useStreamdownPlugins = (children: ReactNode): PluginConfig => {
  const content = useMemo(() => textFromStreamdownChildren(children), [children]);
  const needsMath = useMemo(() => containsStreamdownMath(content), [content]);
  const needsMermaid = useMemo(() => containsStreamdownMermaid(content), [content]);
  const [mathPlugin, setMathPlugin] = useState<MathPlugin | null>(null);
  const [mermaidPlugin, setMermaidPlugin] = useState<DiagramPlugin | null>(null);

  useEffect(() => {
    if (!needsMath || mathPlugin) return;

    let active = true;
    loadStreamdownMathPlugin().then((plugin) => {
      if (active) setMathPlugin(plugin);
    });

    return () => {
      active = false;
    };
  }, [mathPlugin, needsMath]);

  useEffect(() => {
    if (!needsMermaid || mermaidPlugin) return;

    let active = true;
    loadStreamdownMermaidPlugin().then((plugin) => {
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
