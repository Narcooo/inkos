import { fileURLToPath } from "node:url";
import {
  loadConfiguredAgentSkills,
  loadExternalAgentSkills,
  type ExternalSkillDiagnostic,
  type LoadConfiguredAgentSkillsInput,
} from "./external-loader.js";
import type { AgentSkill } from "./types.js";

export interface LoadAvailableAgentSkillsResult {
  readonly skills: ReadonlyArray<AgentSkill>;
  readonly diagnostics: ReadonlyArray<ExternalSkillDiagnostic>;
}

export async function loadBuiltinAgentSkills(
  builtinRoot = builtinSkillsRoot(),
): Promise<LoadAvailableAgentSkillsResult> {
  return loadExternalAgentSkills({
    externalDirs: [builtinRoot],
    source: "builtin",
  });
}

export async function loadAvailableAgentSkills(
  input: LoadConfiguredAgentSkillsInput,
): Promise<LoadAvailableAgentSkillsResult> {
  const [builtin, configured] = await Promise.all([
    loadBuiltinAgentSkills(),
    loadConfiguredAgentSkills(input),
  ]);
  return {
    // Registry de-duplication is last-write-wins, so project/user skills can
    // intentionally replace an InkOS default with the same AgentSkills id.
    skills: [...builtin.skills, ...configured.skills],
    diagnostics: [...builtin.diagnostics, ...configured.diagnostics],
  };
}

function builtinSkillsRoot(): string {
  return fileURLToPath(new URL("../../skills", import.meta.url));
}
