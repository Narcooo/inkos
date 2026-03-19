import { z } from "zod";
import yaml from "js-yaml";

const ProtagonistSchema = z.object({
  name: z.string(),
  personalityLock: z.array(z.string()).default([]),
  behavioralConstraints: z.array(z.string()).default([]),
}).optional();

const GenreLockSchema = z.object({
  primary: z.string(),
  forbidden: z.array(z.string()).default([]),
}).optional();

const NumericalOverridesSchema = z.object({
  hardCap: z.union([z.number(), z.string()]).optional(),
  resourceTypes: z.array(z.string()).default([]),
}).optional();

const EraConstraintsSchema = z.object({
  enabled: z.boolean().default(false),
  period: z.string().optional(),
  region: z.string().optional(),
}).optional();

export const BookRulesSchema = z.object({
  version: z.string().default("1.0"),
  protagonist: ProtagonistSchema,
  genreLock: GenreLockSchema,
  numericalSystemOverrides: NumericalOverridesSchema,
  eraConstraints: EraConstraintsSchema,
  prohibitions: z.array(z.string()).default([]),
  chapterTypesOverride: z.array(z.string()).default([]),
  fatigueWordsOverride: z.array(z.string()).default([]),
  additionalAuditDimensions: z.array(z.union([z.number(), z.string()])).default([]),
  enableFullCastTracking: z.boolean().default(false),
  fanficMode: z.enum(["canon", "au", "ooc", "cp"]).optional(),
  allowedDeviations: z.array(z.string()).default([]),
});

export type BookRules = z.infer<typeof BookRulesSchema>;

export interface ParsedBookRules {
  readonly rules: BookRules;
  readonly body: string;
}

export function parseBookRules(raw: string): ParsedBookRules {
  // Strip markdown code block wrappers if present (LLM often wraps output in ```md ... ```)
  const stripped = raw.replace(/^```(?:md|markdown|yaml)?\s*\n/, "").replace(/\n```\s*$/, "");

  // Try to find YAML frontmatter anywhere in the text (not just at the start)
  const fmMatch = stripped.match(/---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (fmMatch) {
    try {
      const frontmatter = yaml.load(fmMatch[1]) as Record<string, unknown>;
      const rules = BookRulesSchema.parse(frontmatter);
      const body = fmMatch[2].trim();
      return { rules, body };
    } catch {
      // YAML parse failed — fall through to default
    }
  }

  // No valid frontmatter found — return default rules with the raw content as body
  const rules = BookRulesSchema.parse({});
  return { rules, body: stripped.trim() };
}
