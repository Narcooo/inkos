import {
  PipelineRunner,
  StateManager,
  createInteractionToolsFromDeps,
  type InteractionRuntimeTools,
} from "@actalk/inkos-core";
import { buildPipelineConfig, loadConfig } from "../utils.js";

type CliPipelineLike = Pick<PipelineRunner, "writeNextChapter" | "reviseDraft">;
type CliStateLike = Pick<StateManager, "ensureControlDocuments" | "bookDir" | "loadBookConfig" | "loadChapterIndex" | "saveChapterIndex" | "listBooks">;
type CliInteractionToolHooks = {
  readonly onChatTextDelta?: (text: string) => void;
  readonly onDraftTextDelta?: (text: string) => void;
  readonly getChatRequestOptions?: () => {
    readonly temperature?: number;
    readonly maxTokens?: number;
  };
};

export function createCliInteractionToolsFromDeps(
  pipeline: CliPipelineLike,
  state: CliStateLike,
  hooks?: CliInteractionToolHooks,
): InteractionRuntimeTools {
  return createInteractionToolsFromDeps(pipeline, state, hooks);
}

// Backward-compatible export for the current CLI tests during the extraction phase.
export function createInteractionToolsFromDepsCompat(
  _projectRoot: string,
  pipeline: CliPipelineLike,
  state: CliStateLike,
  hooks?: CliInteractionToolHooks,
): InteractionRuntimeTools {
  return createInteractionToolsFromDeps(pipeline, state, hooks);
}

export { createInteractionToolsFromDepsCompat as createInteractionToolsFromDeps };

export async function createInteractionTools(
  projectRoot: string,
  hooks?: CliInteractionToolHooks,
): Promise<InteractionRuntimeTools> {
  const config = await loadConfig({ projectRoot });
  const pipeline = new PipelineRunner(buildPipelineConfig(config, projectRoot));
  const state = new StateManager(projectRoot);
  return createInteractionToolsFromDeps(pipeline, state, hooks);
}
