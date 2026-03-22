# Length Governance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add conservative chapter-length governance so InkOS treats user-specified chapter size as a bounded runtime target across writer and reviser passes without hard truncation.

**Architecture:** Introduce a shared `LengthSpec` plus counting helpers, then thread that spec through writer, reviser, and `PipelineRunner`. Add a dedicated `LengthNormalizerAgent` that can run once after writer and once after reviser when output drifts outside the soft range.

**Tech Stack:** TypeScript, Node.js, Commander, Vitest, existing agent pipeline, Markdown chapter output

---

### Task 1: Define runtime length-governance types

**Files:**
- Create: `packages/core/src/models/length-governance.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/models.test.ts`

**Step 1: Write the failing test**

Add model tests for:

- `LengthSpec`
- `LengthTelemetry`
- `LengthWarning`

Example assertion:

```ts
const spec = LengthSpecSchema.parse({
  target: 2200,
  softMin: 1900,
  softMax: 2500,
  hardMin: 1600,
  hardMax: 2800,
  countingMode: "zh_chars",
  normalizeMode: "compress",
});

expect(spec.softMin).toBe(1900);
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @actalk/inkos-core test -- src/__tests__/models.test.ts`

Expected: missing imports/schema failures because the length-governance model does not exist yet.

**Step 3: Write minimal implementation**

- Create `LengthSpecSchema`
- Add lightweight telemetry/warning schemas
- Export the new types from `packages/core/src/index.ts`

**Step 4: Run test to verify it passes**

Run the same test command and confirm green.

**Step 5: Commit**

```bash
git add packages/core/src/models/length-governance.ts packages/core/src/index.ts packages/core/src/__tests__/models.test.ts
git commit -m "feat: add length governance models"
```

### Task 2: Add counting and range helpers

**Files:**
- Create: `packages/core/src/utils/length-metrics.ts`
- Create: `packages/core/src/__tests__/length-metrics.test.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Write the failing test**

Add tests for:

- Chinese chapter counting uses `zh_chars`
- English chapter counting uses `en_words`
- `buildLengthSpec(target, language)` derives conservative soft/hard ranges

Example assertions:

```ts
expect(countChapterLength("他抬头看天。", "zh_chars")).toBe(6);
expect(countChapterLength("He looked at the sky.", "en_words")).toBe(5);

const spec = buildLengthSpec(2200, "zh");
expect(spec.softMin).toBeLessThan(spec.target);
expect(spec.hardMax).toBeGreaterThan(spec.softMax);
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @actalk/inkos-core test -- src/__tests__/length-metrics.test.ts`

Expected: module missing / helper missing failures.

**Step 3: Write minimal implementation**

- Implement `countChapterLength()`
- Implement `buildLengthSpec()`
- Implement helper predicates such as:
  - `isOutsideSoftRange()`
  - `isOutsideHardRange()`
  - `chooseNormalizeMode()`

**Step 4: Run test to verify it passes**

Run the same targeted test command and confirm green.

**Step 5: Commit**

```bash
git add packages/core/src/utils/length-metrics.ts packages/core/src/__tests__/length-metrics.test.ts packages/core/src/index.ts
git commit -m "feat: add length counting helpers"
```

### Task 3: Thread LengthSpec into writer prompts and output accounting

**Files:**
- Modify: `packages/core/src/agents/writer.ts`
- Modify: `packages/core/src/agents/writer-prompts.ts`
- Modify: `packages/core/src/agents/writer-parser.ts`
- Modify: `packages/core/src/__tests__/writer-prompts.test.ts`
- Modify: `packages/core/src/__tests__/writer-parser.test.ts`

**Step 1: Write the failing test**

Add tests asserting:

- writer prompt uses target-range wording instead of `不少于 X 字`
- parser/output accounting can use shared counting helpers instead of raw `.length`

Example prompt assertion:

```ts
expect(prompt).toContain("目标字数");
expect(prompt).toContain("允许区间");
expect(prompt).not.toContain("不少于2200字");
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @actalk/inkos-core test -- src/__tests__/writer-prompts.test.ts src/__tests__/writer-parser.test.ts`

Expected: old wording and old counting behavior still present.

**Step 3: Write minimal implementation**

- Extend writer input to accept `LengthSpec`
- Replace minimum-only wording with target-range wording
- Use counting helpers for reported chapter length
- Keep token ceiling logic as a ceiling, but stop presenting it as the real length control

**Step 4: Run tests to verify they pass**

Run the same targeted test command and confirm green.

**Step 5: Commit**

```bash
git add packages/core/src/agents/writer.ts packages/core/src/agents/writer-prompts.ts packages/core/src/agents/writer-parser.ts packages/core/src/__tests__/writer-prompts.test.ts packages/core/src/__tests__/writer-parser.test.ts
git commit -m "refactor: thread length spec into writer"
```

### Task 4: Build the LengthNormalizerAgent

**Files:**
- Create: `packages/core/src/agents/length-normalizer.ts`
- Create: `packages/core/src/__tests__/length-normalizer.test.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Write the failing test**

Add tests for:

- compress mode shortens a long draft while preserving a required marker
- expand mode lengthens a short draft without inserting forbidden markers
- agent exposes a single-pass correction contract

Example assertion:

```ts
expect(result.normalizedContent.length).toBeGreaterThan(0);
expect(result.applied).toBe(true);
expect(result.mode).toBe("compress");
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @actalk/inkos-core test -- src/__tests__/length-normalizer.test.ts`

Expected: module missing / agent missing.

**Step 3: Write minimal implementation**

- Create `LengthNormalizerAgent`
- Input:
  - chapter content
  - `LengthSpec`
  - chapter intent / reduced control block when available
- Output:
  - normalized content
  - final count
  - applied/not-applied
  - warning string if still outside range

**Step 4: Run test to verify it passes**

Run the same targeted test command and confirm green.

**Step 5: Commit**

```bash
git add packages/core/src/agents/length-normalizer.ts packages/core/src/__tests__/length-normalizer.test.ts packages/core/src/index.ts
git commit -m "feat: add length normalizer agent"
```

### Task 5: Normalize once after writer when draft leaves the soft band

**Files:**
- Modify: `packages/core/src/pipeline/runner.ts`
- Modify: `packages/core/src/__tests__/pipeline-runner.test.ts`

**Step 1: Write the failing test**

Add tests asserting:

- writer output above `softMax` triggers one post-writer normalize pass
- writer output below `softMin` triggers one post-writer normalize pass
- normalized content replaces the original draft before audit

Example assertion:

```ts
expect(normalizeSpy).toHaveBeenCalledTimes(1);
expect(auditorSpy).toHaveBeenCalledWith(
  expect.anything(),
  "normalized body",
  expect.anything(),
  expect.anything(),
  expect.anything(),
);
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @actalk/inkos-core test -- src/__tests__/pipeline-runner.test.ts`

Expected: pipeline currently sends raw writer output straight into audit.

**Step 3: Write minimal implementation**

- Build `LengthSpec` at pipeline entry
- Count writer output with the shared helper
- If outside soft range, run `LengthNormalizerAgent` once
- Record telemetry fields for writer count and post-normalize count

**Step 4: Run test to verify it passes**

Run the same targeted test command and confirm green.

**Step 5: Commit**

```bash
git add packages/core/src/pipeline/runner.ts packages/core/src/__tests__/pipeline-runner.test.ts
git commit -m "feat: normalize draft length before audit"
```

### Task 6: Enforce shared length governance in reviser and spot-fix paths

**Files:**
- Modify: `packages/core/src/agents/reviser.ts`
- Modify: `packages/core/src/pipeline/runner.ts`
- Modify: `packages/core/src/__tests__/pipeline-runner.test.ts`

**Step 1: Write the failing test**

Add tests asserting:

- reviser receives `LengthSpec`
- reviser prompt includes target-range preservation
- post-revise output outside soft range triggers one final normalize pass

Example assertion:

```ts
expect(reviserSpy).toHaveBeenCalledWith(
  expect.anything(),
  expect.anything(),
  expect.anything(),
  expect.anything(),
  expect.anything(),
  expect.objectContaining({
    lengthSpec: expect.objectContaining({ target: 2200 }),
  }),
);
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @actalk/inkos-core test -- src/__tests__/pipeline-runner.test.ts`

Expected: reviser path ignores any shared length policy.

**Step 3: Write minimal implementation**

- Extend reviser options with `lengthSpec`
- Tell reviser to preserve the target band
- After spot-fix or revise, if the output still leaves the soft band, run a single final normalize pass

**Step 4: Run test to verify it passes**

Run the same targeted test command and confirm green.

**Step 5: Commit**

```bash
git add packages/core/src/agents/reviser.ts packages/core/src/pipeline/runner.ts packages/core/src/__tests__/pipeline-runner.test.ts
git commit -m "feat: apply length governance to reviser"
```

### Task 7: Add single-pass guardrails, warnings, and telemetry output

**Files:**
- Modify: `packages/core/src/pipeline/runner.ts`
- Modify: `packages/core/src/models/chapter.ts`
- Modify: `packages/core/src/__tests__/pipeline-runner.test.ts`

**Step 1: Write the failing test**

Add tests asserting:

- normalizer never runs more than once per boundary
- final hard-range miss does not recurse
- final result includes a visible length warning/telemetry block

Example assertion:

```ts
expect(normalizeSpy).toHaveBeenCalledTimes(1);
expect(result.lengthWarnings).toContain("outside hard range");
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @actalk/inkos-core test -- src/__tests__/pipeline-runner.test.ts`

Expected: no single-pass guard and no structured warning output.

**Step 3: Write minimal implementation**

- Add explicit booleans/counters to prevent recursive normalize loops
- Attach length warning metadata to pipeline results
- Ensure persistence still succeeds even if the final output remains outside the hard band

**Step 4: Run test to verify it passes**

Run the same targeted test command and confirm green.

**Step 5: Commit**

```bash
git add packages/core/src/pipeline/runner.ts packages/core/src/models/chapter.ts packages/core/src/__tests__/pipeline-runner.test.ts
git commit -m "feat: add length drift warnings"
```

### Task 8: Document the new chapter-length behavior

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`

**Step 1: Write the failing documentation checklist**

Create a short checklist in the task notes:

- README explains that `--words` is a target band, not an exact promise
- README explains Chinese vs English counting modes
- README explains that InkOS may run one corrective normalization pass instead of truncating prose

**Step 2: Verify docs are currently missing it**

Run: `rg -n "target band|normalize-length|counting mode|字数区间" README.md README.en.md`

Expected: no relevant matches.

**Step 3: Write minimal documentation**

- Update both READMEs with a short note in CLI usage / writing behavior sections

**Step 4: Verify the docs contain the new guidance**

Run the same `rg` command and confirm matches exist.

**Step 5: Commit**

```bash
git add README.md README.en.md
git commit -m "docs: explain length governance behavior"
```

### Task 9: Run full verification

**Files:**
- No code changes required

**Step 1: Run targeted core tests**

Run: `pnpm --filter @actalk/inkos-core test -- src/__tests__/length-metrics.test.ts src/__tests__/length-normalizer.test.ts src/__tests__/writer-prompts.test.ts src/__tests__/writer-parser.test.ts src/__tests__/pipeline-runner.test.ts`

Expected: all green.

**Step 2: Run core typecheck**

Run: `pnpm --filter @actalk/inkos-core typecheck`

Expected: exit 0.

**Step 3: Run workspace verification**

Run:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Expected: all exit 0.

**Step 4: Optional smoke check**

Run a real CLI path:

```bash
inkos draft <book> --words 2200
inkos revise <book> <chapter>
```

Confirm the final chapter lands inside the conservative band or emits a warning instead of drifting silently.

**Step 5: Commit**

No commit unless verification reveals a missing follow-up fix.
