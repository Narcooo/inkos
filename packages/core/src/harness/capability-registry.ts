import type { Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  ActionResultSchema,
  HarnessIdSchema,
  type ActionResult,
  type ActionRisk,
  type CreativeEpisodeEvent,
  type WorkManifest,
  type WorkProfile,
} from "./contracts.js";

export interface CapabilityExecutionContext {
  readonly projectRoot: string;
  readonly episodeId: string;
  readonly work: WorkManifest | null;
  readonly profile: WorkProfile;
  readonly signal?: AbortSignal;
  readonly onUpdate?: (partialResult: unknown) => void;
  readonly appendEvent?: (event: Omit<CreativeEpisodeEvent, "version" | "seq" | "timestamp">) => Promise<void>;
}

export interface CapabilityAction<TParameters extends TSchema = TSchema> {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly risk: ActionRisk;
  readonly requiresConfirmation?: boolean;
  /** Trusted implementation owns short snapshot/commit locks and exact artifact receipts. */
  readonly managesWorkLock?: boolean;
  readonly defaultSkillIds?: ReadonlyArray<string>;
  /** Planning sources consumed when this action starts drafting. */
  readonly draftSourcePaths?: ReadonlyArray<string>;
  readonly parameters: TParameters;
  execute(context: CapabilityExecutionContext, input: Static<TParameters>): Promise<ActionResult>;
}

export function defineCapabilityAction<TParameters extends TSchema>(
  action: CapabilityAction<TParameters>,
): CapabilityAction<TParameters> {
  return action;
}

export interface Capability {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly actions: ReadonlyArray<CapabilityAction>;
}

export interface ResolvedCapabilityAction {
  readonly capability: Capability;
  readonly action: CapabilityAction;
}

export class CapabilityRegistry {
  private readonly capabilities = new Map<string, Capability>();

  register(capability: Capability): void {
    const id = HarnessIdSchema.parse(capability.id);
    if (this.capabilities.has(id)) {
      throw new Error(`Capability already registered: ${id}`);
    }
    const actionIds = new Set<string>();
    for (const action of capability.actions) {
      const actionId = HarnessIdSchema.parse(action.id);
      if (actionIds.has(actionId)) {
        throw new Error(`Duplicate action "${actionId}" in capability "${id}"`);
      }
      actionIds.add(actionId);
    }
    this.capabilities.set(id, capability);
  }

  get(id: string): Capability | undefined {
    return this.capabilities.get(id);
  }

  list(): ReadonlyArray<Capability> {
    return [...this.capabilities.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  forProfile(profile: WorkProfile): ReadonlyArray<Capability> {
    return profile.capabilityIds.map((id) => {
      const capability = this.capabilities.get(id);
      if (!capability) throw new Error(`Profile "${profile.id}" requires unknown capability "${id}"`);
      return capability;
    });
  }

  resolve(capabilityId: string, actionId: string): ResolvedCapabilityAction {
    const capability = this.capabilities.get(capabilityId);
    if (!capability) throw new Error(`Unknown capability: ${capabilityId}`);
    const action = capability.actions.find((candidate) => candidate.id === actionId);
    if (!action) throw new Error(`Unknown action: ${capabilityId}.${actionId}`);
    return { capability, action };
  }

  async invoke(
    capabilityId: string,
    actionId: string,
    context: CapabilityExecutionContext,
    rawInput: unknown,
  ): Promise<ActionResult> {
    const { action } = this.resolve(capabilityId, actionId);
    if (context.signal?.aborted) throw context.signal.reason;
    const input = Value.Decode(action.parameters, rawInput);
    return ActionResultSchema.parse(await action.execute(context, input));
  }
}
