# InkOS 2.0 creative workflow contracts

## Work and execution identity

Studio, CLI, and agent tools operate on a canonical Work under `works/<id>/`.
`work.json` records its profile and registered artifacts; `source/` contains its
working files. Sessions bind to the created Work before subsequent production
or recovery. A conversation finishing is not evidence that its deliverables
have been produced.

Actions return structured execution status, artifact revisions, observations,
and recovery information. The main agent and delegated workers receive the
original author request. Specialized creative methods live in the applicable
Skills; they do not replace the author's requested scope.

## Artifacts, edits, and recovery

- Read, review, and export resolve registered artifact versions and verify their
  checksums. A missing artifact returns a recoverable, typed lookup error.
- Review-and-export fixes one version for both operations. Content findings and
  successful execution are separate results. Valid current-artifact delivery
  attempts retain their review/export obligations through failure. Export alone
  cannot fulfill a failed review; completion requires each operation's current
  revision receipt. Explicit historical reviews remain snapshot evidence.
- Reviewers submit individual findings with source addresses, then select the
  accepted finding codes for their final report. The host validates each finding
  and assembles the report. A final report cannot reference an unaccepted finding;
  corrections replace the same code. Independent findings may share one model
  response. The host returns the actual selected excerpts, and finalization must
  occur in a later response after that readback. Resolving a source address does
  not prove a finding. Prior critique and delegated suggestions are rechecked
  against current text and author constraints, not promoted to new requirements.
  The review session has a bounded number of model turns.
- Local revisions preserve content outside the author's permitted range. The
  request's original baseline remains available across retries for comparison.
  Conversational agents edit through the scoped revision action; raw artifact
  replacement is an internal commit primitive or an explicit host operation.
  The same boundary covers raw chapter patches and replacements. Generated
  chapter revisions default to source-bound edits with the persisted length
  contract; a whole-chapter rewrite is an explicit authoring choice.
- Short-fiction reviews receive the persisted length requirements and a verified
  request-baseline comparison. Changed chapters have citable earlier text;
  unchanged chapters are compared in full without duplicating their text in the
  model context. Review state records both artifact versions and checksums.
- Atomic file sets journal multi-file writes. Interrupted operations can recover
  without treating an unfinished candidate as an accepted version.
- Filesystem discovery, pending writes, acceptance scopes, and image receipts
  use the same `/`-separated artifact identity on all platforms. One native path
  and its registered path must not create competing updates to one artifact.
- Short-fiction revision checkpoints carry a stable operation identity and
  completed chapter progress. A changed instruction cannot silently reset that
  operation; source changes are detected before resuming.
- Successful recovery writes bind an unbound session to their canonical Work
  and refresh its tools. Reading another Work does not change the session target.
- Short-fiction production retains a requested cover across draft checkpoints.
  Delivery requires a readable, checksum-verified current cover artifact; a
  cover prompt alone does not satisfy that requirement.
- Derivative works retain registered source-version references. Source selection
  and confirmation preserve the requested output constraints.

## Interactive and visual output

World state, events, choices, and scene presentation are persisted together at
their domain boundaries. Prose-only scene revisions preserve world state and
choices. Player actions retain the actual player input; bounded context includes
earlier narrative evidence as well as the current state. Interactive-film edits
receive the complete graph's authoring context while keeping write scope bounded.
New graph display text is checked before persistence; wholly Unicode-escaped
labels receive a field-addressed error for model correction. Opaque state values
and mixed prose/code are preserved. Full-graph validation also protects exports.
Players and the graph editor resolve registered speaker IDs to character names.

Image revisions can send the previous image as a provider reference. Image
generation waits outside the Work mutation lock, then commits against its
captured moment. A failed replacement retains the previous successful image.
Provider credentials are only retried for image downloads on that provider's
own origin.
Background illustration progress and failures remain visible beside the chat
input when the world inspector is collapsed. The inspector offers a retry for
the enabled missing illustrations and suppresses duplicate in-flight requests.

## Compatibility

Node.js 22.16.0 or later is required. Core, Studio, and CLI package versions are
aligned at 2.0.0. Legacy migration is available through `inkos work migrate`;
preview before applying with `--apply`. Migration preserves legacy source files
and reports conflicts rather than overwriting them.

Model cards declare request constraints independently of the gateway protocol.
Text-producing workers and tool-producing workers share the final payload
normalizer across the Pi SDK and custom HTTP transports.
Requests use the protocol default for tool selection, while the host requires
the originally selected tool result. Sampling parameters are omitted by default;
only explicit configuration or per-call user overrides supply a temperature.
Creative agents do not inject stage-specific sampling presets. A missing result receives explicit tool-contract feedback
on its bounded retry; another missing result fails with
`MODEL_REQUIRED_TOOL_MISSING`. Models that prohibit sampling overrides receive
their server defaults. Sonnet 5.5's documented limits and request constraints
apply through both native Claude and OpenAI-compatible gateways.
Malformed structured results receive bounded schema feedback with field paths,
expected and received types, and native JSON container instructions when needed.
The host does not rewrite malformed prose into a passing result.

## Verification recorded on 2026-09-25

The frozen `delivery-verification-2026-09-25` candidate has source digest
`7fe5443820cf7e566c68765ce9f3d86ca6820c76d7fdb5b5874d52d011456232`.
Its 758 source files match implementation commit `7e60e13`. Subsequent Windows
integration fixes normalize artifact identities before deduplication and scope
checks, and close cached test sessions before deleting their temporary projects.
The frozen candidate remains unchanged; its real-model evidence describes that
baseline, while GitHub CI checks the current integration commit.

- Node 22 and Node 24 each passed 1,093 checks: Core 701, Studio 304, CLI 88.
- Fresh installation matched all 1,779 packaged production files.
- Configured migration preserved the legacy files and chapter content.

Full real-model acceptance for all 13 creative types on this same frozen
candidate remains in progress. Earlier candidates' completed journeys do not
count as this candidate's acceptance. Content, cover, and market acceptance
remain separate from the engineering checks above. Merging this implementation
does not assert that stable-release acceptance has completed.
