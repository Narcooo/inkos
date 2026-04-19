import { z } from "zod";

export const AutomationModeSchema = z.enum(["auto", "semi", "manual"]);

export type AutomationMode = z.infer<typeof AutomationModeSchema>;

export function normalizeAutomationMode(
  mode: string | undefined,
  fallback: AutomationMode = "semi",
): AutomationMode {
  const parsed = AutomationModeSchema.safeParse(mode);
  return parsed.success ? parsed.data : fallback;
}
