# Length Governance Redesign

## Goal

Reduce chapter-length drift in InkOS without resorting to hard truncation, so user-specified targets like `--words 2200` converge toward a reasonable range instead of expanding unpredictably across writer and reviser passes.

## Problem Statement

Issue `#58` is not a single prompt bug. It is a system-level drift problem caused by multiple layers:

1. Writer prompts currently frame length as a lower bound (`不少于 X 字`) instead of a target range.
2. Writer runtime budgeting uses a loose token ceiling, not an explicit output-governance mechanism.
3. Length accounting currently uses raw string length, which is not a stable user-facing counting model.
4. Reviser and spot-fix passes can expand or compress the chapter again, but they do not share a common length guardrail with the writer.

Observed behavior on merged `master` confirmed the drift:

- `draft --words 500` produced `1186`
- a later revise pass expanded the same chapter to `1805`

This makes length control a combined model-capability and system-governance problem, not something that can be solved by lowering `maxTokens` or chopping the tail off the chapter.

## External Constraint

The 2026 ecosystem direction is consistent:

- model APIs expose upper bounds, not exact output length controls
- prompt wording alone is not enough for precise length following
- stable length control requires runtime feedback or structured planning

For InkOS, that means the right fix is an inference-time governor inside the pipeline, not hard truncation.

## Scope

In scope:

- introduce a conservative `LengthSpec`
- unify counting semantics for Chinese and English
- enforce the same length policy across writer and reviser
- add a single-pass length normalization step when output leaves the allowed band
- record length drift in logs/results

Out of scope:

- exact-length generation
- paragraph/scene-level budget planning
- provider-specific fine-tuning
- hard-cut truncation of finished chapters

## Chosen Approach

Use a conservative runtime governor shared by the full chapter pipeline.

Three approaches were considered:

1. Prompt-only range wording
2. Conservative runtime governor
3. Planner-driven scene budgets

Approach `2` is the chosen design because it materially reduces drift without requiring a large planner/writer rewrite. Approach `3` remains the long-term path if tighter control is needed later.

## Design Principles

1. User target length remains authoritative.
2. The system should aim for a band, not an exact number.
3. Quality and continuity take priority over exact length.
4. Normalization is corrective, not recursive.
5. Counting must match user expectations as closely as possible.

## LengthSpec

Introduce a lightweight runtime object shared by pipeline stages:

```ts
interface LengthSpec {
  target: number;
  softMin: number;
  softMax: number;
  hardMin: number;
  hardMax: number;
  countingMode: "zh_chars" | "en_words";
  normalizeMode: "expand" | "compress" | "none";
}
```

### Source of Truth

`target` must come from user-visible inputs in this order:

1. `--words`
2. `book.chapterWordCount`
3. project default

The system must not invent a target independently of user or book configuration.

### Conservative Defaults

Example for `target = 2200`:

- `softMin = 1900`
- `softMax = 2500`
- `hardMin = 1600`
- `hardMax = 2800`

The exact ratios can be implementation details, but the behavior should remain conservative: pull drift inward without over-correcting.

## Counting Model

Length accounting must stop using raw `.length` as the user-facing truth.

Use:

- `zh_chars` for Chinese writing
- `en_words` for English writing

Definitions:

- `zh_chars`: count CJK characters as the primary unit and ignore Markdown headings/metadata outside chapter body
- `en_words`: count word tokens in prose, not raw characters

This gives InkOS a stable public contract for what “2200 字” or “2200 words” actually means.

## Runtime Flow

### 1. Pipeline entry

`PipelineRunner.writeDraft()` and `PipelineRunner.writeNextChapter()` build a `LengthSpec` before invoking writer or reviser.

### 2. Writer pass

Writer receives `LengthSpec` and shifts the prompt contract from:

- `正文不少于 X 字`

to something equivalent to:

- target `X`
- acceptable range `[softMin, softMax]`
- keep the chapter complete while staying near the target band

### 3. Post-writer normalization

If the draft lands outside the soft range, the pipeline runs one corrective `normalize-length` pass:

- if too long: compress without deleting required plot beats
- if too short: expand without adding new branches or consuming future outline nodes

### 4. Audit / revise

Reviser must consume the same `LengthSpec`. Fixes must preserve the target band unless the requested correction genuinely forces a change.

### 5. Post-reviser normalization

If revise/spot-fix pushes the chapter back outside the soft range, run one final normalization pass.

### 6. Final persistence

Persist the chapter even if it still misses the hard range, but emit a visible warning instead of silently pretending the target was met.

## Single Normalize Rule

`normalize-length` is itself an LLM pass, so it must not recurse.

Rule:

- at most one normalization after writer
- at most one normalization after reviser
- no loops
- if a normalization pass still fails to re-enter the desired band, save the chapter and attach a warning

This prevents runaway cost and “rewrite forever to chase a number” behavior.

## Normalizer Responsibilities

The normalizer is not another reviser. It has a narrower contract:

- preserve chapter intent
- preserve hard facts
- preserve current plot beats
- preserve final hook / scene completeness
- change length only through local compression or elaboration

It must not:

- add a new subplot
- consume a future reveal
- retcon facts
- silently delete a required resolution beat

## Logging and Telemetry

Each chapter should expose a compact length trace:

- `target`
- `softMin`
- `softMax`
- `hardMin`
- `hardMax`
- `countingMode`
- `writerCount`
- `postWriterNormalizeCount`
- `postReviseCount`
- `finalCount`
- `normalizeApplied`
- `lengthWarning`

This should be visible enough for debugging and issue triage, even if the full trace stays internal.

## Failure Strategy

Conservative failure policy:

1. outside soft range -> try one normalize pass
2. still outside soft range -> continue
3. outside hard range at final save -> persist plus warning

InkOS should not hard-truncate the prose and should not re-run the whole chapter indefinitely.

## Testing Strategy

Minimum coverage:

1. Writer over target triggers normalization
2. Reviser drift triggers post-revise normalization
3. Normalizer runs at most once per boundary
4. Chinese and English counting modes differ correctly
5. Final hard-range miss records a warning instead of causing destructive fallback

## Rollout

This should ship as default pipeline behavior, not as a separate user feature flag.

Reason:

- issue `#58` affects baseline usability
- the conservative governor is additive and low risk
- the system already accepts that length is approximate, so tightening approximation is a compatibility improvement

## Future Work

If the conservative governor is still too loose, the next step is not more prompt tweaking. The next step is scene-level planning:

- planner-generated scene budgets
- scene-aware writer generation
- explicit remaining-budget tracking inside the write loop

That is intentionally deferred out of this MVP.
