import type { DiagramPlugin, MathPlugin } from "streamdown";

let mathPluginPromise: Promise<MathPlugin> | null = null;
let mermaidPluginPromise: Promise<DiagramPlugin> | null = null;

export const loadStreamdownMathPlugin = () => {
  mathPluginPromise ??= import("@streamdown/math").then((module) => module.math);
  return mathPluginPromise;
};

export const loadStreamdownMermaidPlugin = () => {
  mermaidPluginPromise ??= import("@streamdown/mermaid").then(
    (module) => module.mermaid,
  );
  return mermaidPluginPromise;
};
