export interface SpotFixPatch {
  readonly targetText: string;
  readonly replacementText: string;
}

export interface SpotFixPatchApplyResult {
  readonly applied: boolean;
  readonly revisedContent: string;
  readonly rejectedReason?: string;
  readonly appliedPatchCount: number;
  readonly touchedChars: number;
}

const MAX_SPOT_FIX_TOUCHED_RATIO = 0.25;

export function parseSpotFixPatches(raw: string): SpotFixPatch[] {
  const normalized = raw.includes("=== PATCHES ===")
    ? raw.slice(raw.indexOf("=== PATCHES ===") + "=== PATCHES ===".length)
    : raw;

  const patches: SpotFixPatch[] = [];
  const regex = /--- PATCH(?:\s+\d+)? ---\s*TARGET_TEXT:\s*([\s\S]*?)\s*REPLACEMENT_TEXT:\s*([\s\S]*?)\s*--- END PATCH ---/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(normalized)) !== null) {
    patches.push({
      targetText: trimField(match[1] ?? ""),
      replacementText: trimField(match[2] ?? ""),
    });
  }

  return patches.filter((patch) => patch.targetText.length > 0);
}

export function applySpotFixPatches(
  original: string,
  patches: ReadonlyArray<SpotFixPatch>,
): SpotFixPatchApplyResult {
  if (patches.length === 0) {
    return {
      applied: false,
      revisedContent: original,
      rejectedReason: "No valid patches returned.",
      appliedPatchCount: 0,
      touchedChars: 0,
    };
  }

  const touchedChars = patches.reduce((sum, patch) => sum + patch.targetText.length, 0);
  if (original.length > 0 && touchedChars / original.length > MAX_SPOT_FIX_TOUCHED_RATIO) {
    return {
      applied: false,
      revisedContent: original,
      rejectedReason: "Patch set would touch too much of the chapter.",
      appliedPatchCount: 0,
      touchedChars,
    };
  }

  let current = original;

  for (const patch of patches) {
    const start = current.indexOf(patch.targetText);
    if (start === -1) {
      return {
        applied: false,
        revisedContent: original,
        rejectedReason: "Each TARGET_TEXT must match the chapter exactly once.",
        appliedPatchCount: 0,
        touchedChars,
      };
    }

    const another = current.indexOf(patch.targetText, start + patch.targetText.length);
    if (another !== -1) {
      return {
        applied: false,
        revisedContent: original,
        rejectedReason: "Each TARGET_TEXT must match the chapter exactly once.",
        appliedPatchCount: 0,
        touchedChars,
      };
    }

    current = [
      current.slice(0, start),
      patch.replacementText,
      current.slice(start + patch.targetText.length),
    ].join("");
  }

  return {
    applied: current !== original,
    revisedContent: current,
    appliedPatchCount: patches.length,
    touchedChars,
  };
}

function trimField(value: string): string {
  return value.replace(/^\s*\n/, "").replace(/\n\s*$/, "").trim();
}
