import type { WritingLanguage } from "../models/book.js";
import type { ContextPackage } from "../models/input-governance.js";
import type { HookRecord } from "../models/runtime-state.js";
import { renderHooksProjection } from "../state/state-projections.js";

export function buildGovernedHookWorkingSet(params: {
  readonly hooks: ReadonlyArray<HookRecord>;
  readonly contextPackage: ContextPackage;
  readonly language: WritingLanguage;
}): string {
  if (params.hooks.length === 0) return renderHooksProjection({ hooks: [] }, params.language);

  const selectedIds = new Set(
    params.contextPackage.selectedContext
      .filter((entry) => entry.source.startsWith("story/pending_hooks.md#"))
      .map((entry) => entry.source.slice("story/pending_hooks.md#".length))
      .filter(Boolean),
  );
  if (selectedIds.size === 0) return renderHooksProjection({ hooks: [...params.hooks] }, params.language);

  const workingSet = params.hooks.filter((hook) => selectedIds.has(hook.hookId));
  return workingSet.length > 0
    ? renderHooksProjection({ hooks: workingSet }, params.language)
    : renderHooksProjection({ hooks: [...params.hooks] }, params.language);
}
