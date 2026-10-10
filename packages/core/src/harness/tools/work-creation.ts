import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createBuiltInWorkProfileRegistry } from "../builtin-profiles.js";
import { createInitialWorkManifestWrite } from "../source-sync.js";
import { loadWorkManifest } from "../work-store.js";
import { commitAtomicFileSet } from "../../utils/atomic-file-set.js";
import { StateManager } from "../../state/manager.js";
import { withWorkMutationScope } from "../../utils/work-mutation-scope.js";
import type { CapabilityRegistry } from "../capability-registry.js";
import { CreationSourceReference, CreationSourceReferences, loadCreationSource } from "../../agent/creation-source.js";
import type { AtomicFileWrite } from "../../utils/atomic-file-set.js";
const CreateParameters = Type.Object({ workId: Type.String(), profileId: Type.String(), title: Type.String({ minLength: 1 }), intent: Type.String({ minLength: 1 }), language: Type.Optional(Type.String()),
  source: Type.Optional(CreationSourceReference),
  sources: Type.Optional(CreationSourceReferences),
});
export function createProfileWorkTools(root: string, capabilities: CapabilityRegistry): AgentTool<any>[] {
  return [
    { name: "list_work_profiles", label: "List creative profiles", description: "List installed creative profiles and the methods and actions they compose.", parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: "text", text: JSON.stringify(createBuiltInWorkProfileRegistry(root).list()) }], details: { kind: "work_profiles" } }),
    },
    { name: "create_work", label: "Create work from profile", description: "Create and bind a Work using an installed Profile, persist the user's brief, and activate the Profile's production actions for the next step. For derivation, supply source or ordered sources covering all author-requested material. inspect_work returns sourceSets for complete manuscripts; use their source references when the author requests written content, rather than a brief or plan.", parameters: CreateParameters,
      execute: async (_id, params) => {
        const profile = createBuiltInWorkProfileRegistry(root).require(params.profileId);
        capabilities.forProfile(profile);
        return withWorkMutationScope(root, params.workId, () => new StateManager(root).acquireBookLock(params.workId), async () => {
          try { await loadWorkManifest(root, params.workId); throw Object.assign(new Error("Work already exists"), { code: "WORK_ALREADY_EXISTS" }); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
          const writes: AtomicFileWrite[] = [{ relativePath: `works/${params.workId}/source/brief.md`, content: params.intent }];
          const lineage = [];
          if (params.source || params.sources) {
            const source = await loadCreationSource({projectRoot:root,source:params.source,sources:params.sources,purpose:'reference'});
            writes.push({relativePath:`works/${params.workId}/source/source-material.md`,content:source.text});
            lineage.push(...source.lineage);
          }
          const initial = createInitialWorkManifestWrite({ workId: params.workId, title: params.title, profileId: profile.id, language: params.language ?? "zh", writes, metadata: { intent: params.intent }, lineage });
          await commitAtomicFileSet({ rootDir: root, writes: [...writes, initial.write] });
          return { content: [{ type: "text", text: `Created ${params.title} with profile ${profile.id}.` }], details: { kind: "work_created", workId: params.workId, profileId: profile.id, lineage } };
        });
      },
    },
  ];
}
