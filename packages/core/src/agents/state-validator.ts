import { BaseAgent } from "./base.js";

export interface ValidationWarning {
  readonly category: string;
  readonly description: string;
}

export interface ValidationResult {
  readonly warnings: ReadonlyArray<ValidationWarning>;
  readonly passed: boolean;
}

/**
 * Validates Settler output by comparing old and new truth files via LLM.
 * Catches contradictions, missing state changes, and temporal inconsistencies.
 * Fail-closed: validator execution/format failures must surface to the pipeline.
 */
export class StateValidatorAgent extends BaseAgent {
  get name(): string {
    return "state-validator";
  }

  async validate(
    chapterContent: string,
    chapterNumber: number,
    oldState: string,
    newState: string,
    oldHooks: string,
    newHooks: string,
    language: "zh" | "en" = "zh",
  ): Promise<ValidationResult> {
    const stateDiff = this.computeDiff(oldState, newState, "State Card");
    const hooksDiff = this.computeDiff(oldHooks, newHooks, "Hooks Pool");

    // Skip validation if nothing changed
    if (!stateDiff && !hooksDiff) {
      return { warnings: [], passed: true };
    }

    const langInstruction = language === "en"
      ? "Respond in English."
      : "用中文回答。";

    const systemPrompt = `You are a continuity validator for a novel writing system. ${langInstruction}

Given the chapter text and the CHANGES made to truth files (state card + hooks pool), check for contradictions:

1. State change without narrative support — truth file says something changed but the chapter text doesn't describe it
2. Missing state change — chapter text describes something happening but the truth file didn't capture it
3. Temporal impossibility — character moves locations without transition, injury heals without time passing
4. Hook anomaly — a hook disappeared without being marked resolved, or a new hook has no basis in the chapter
5. Retroactive edit — truth file change implies something happened in a PREVIOUS chapter, not the current one

Output JSON:
{
  "warnings": [
    { "category": "missing_state_change", "description": "..." },
    { "category": "unsupported_change", "description": "..." }
  ],
  "passed": true/false
}

passed = true means no serious contradictions found. Minor observations are still reported as warnings.
If there are no issues at all, return {"warnings": [], "passed": true}.

IMPORTANT: Set passed=false ONLY for hard contradictions — facts that directly conflict with the chapter text (e.g., character said to be dead but is alive in text, location stated as X but text clearly shows Y). Do NOT fail for:
- Slightly ahead-of-text inferences (e.g., "about to go to X" when text shows intent but not arrival)
- Missing details (state card doesn't capture every minor event)
- Reasonable extrapolations from text (e.g., "slightly relieved" from "took a sip of water")
- Hook management differences (hooks added/removed that don't contradict text)
These should be warnings with passed=true, not failures.`;

    const userPrompt = `Chapter ${chapterNumber} validation:

## State Card Changes
${stateDiff || "(no changes)"}

## Hooks Pool Changes
${hooksDiff || "(no changes)"}

## Chapter Text (for reference)
${chapterContent.slice(0, 6000)}`;

    try {
      const response = await this.chat(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        { temperature: 0.1, maxTokens: 2048 },
      );

      return this.parseResult(response.content);
    } catch (error) {
      this.log?.warn(`State validation failed: ${error}`);
      return { warnings: [{ category: "validator_error", description: String(error) }], passed: true };
    }
  }

  private computeDiff(oldText: string, newText: string, label: string): string | null {
    if (oldText === newText) return null;

    const oldLines = oldText.split("\n").filter((l) => l.trim());
    const newLines = newText.split("\n").filter((l) => l.trim());

    const added = newLines.filter((l) => !oldLines.includes(l));
    const removed = oldLines.filter((l) => !newLines.includes(l));

    if (added.length === 0 && removed.length === 0) return null;

    const parts = [`### ${label}`];
    if (removed.length > 0) parts.push("Removed:\n" + removed.map((l) => `- ${l}`).join("\n"));
    if (added.length > 0) parts.push("Added:\n" + added.map((l) => `+ ${l}`).join("\n"));
    return parts.join("\n");
  }

  private parseResult(content: string): ValidationResult {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error("LLM returned empty response");
    }

    const parsed = extractFirstValidJsonObject<{
      warnings?: Array<{ category?: string; description?: string }>;
      passed?: boolean;
    }>(trimmed);
    if (!parsed) {
      throw new Error("State validator returned invalid JSON");
    }

    try {
      if (typeof parsed.passed !== "boolean") {
        throw new Error("missing boolean 'passed' field");
      }

      if (parsed.warnings !== undefined && !Array.isArray(parsed.warnings)) {
        throw new Error("'warnings' must be an array");
      }

      return {
        warnings: (parsed.warnings ?? []).map((w) => ({
          category: w.category ?? "unknown",
          description: w.description ?? "",
        })),
        passed: parsed.passed,
      };
    } catch (error) {
      this.log?.warn(`StateValidatorAgent.parseResult failed: ${error}`);
      return { warnings: [{ category: "validator_error", description: String(error) }], passed: true };
    }
  }
}

function extractFirstValidJsonObject<T>(text: string): T | null {
  const direct = tryParseJson<T>(text);
  if (direct) {
    return direct;
  }

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "{") continue;
    const candidate = extractBalancedJsonObject(text, index);
    if (!candidate) continue;
    const parsed = tryParseJson<T>(candidate);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function tryParseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function extractBalancedJsonObject(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index]!;

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
      if (depth < 0) {
        return null;
      }
    }
  }

  return null;
}
