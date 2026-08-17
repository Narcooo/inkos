import { z } from "zod";

export const AgentSkillSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(1024),
  body: z.string().default(""),
  source: z.enum(["builtin", "project", "user", "external"]).default("external"),
  baseDir: z.string().min(1).optional(),
}).strict();
export type AgentSkill = z.infer<typeof AgentSkillSchema>;

export interface SkillResolutionInput {
  readonly requestedSkills?: ReadonlyArray<string>;
  readonly disabledSkills?: ReadonlyArray<string>;
}

export interface SkillResolutionResult {
  readonly usedSkills: ReadonlyArray<AgentSkill>;
  readonly forcedSkillIds: ReadonlyArray<string>;
  readonly missingSkillIds: ReadonlyArray<string>;
  readonly disabledSkillIds: ReadonlyArray<string>;
  readonly availableSkills: ReadonlyArray<AgentSkill>;
  readonly availableSkillIds: ReadonlyArray<string>;
}

export interface SkillRegistry {
  listSkills(): ReadonlyArray<AgentSkill>;
  getSkill(id: string): AgentSkill | undefined;
  resolveSkills(input: SkillResolutionInput): SkillResolutionResult;
}
