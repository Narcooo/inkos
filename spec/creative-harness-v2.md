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
  successful execution are separate results.
- Local revisions preserve content outside the author's permitted range. The
  request's original baseline remains available across retries for comparison.
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
- Derivative works retain registered source-version references. Source selection
  and confirmation preserve the requested output constraints.

## Interactive and visual output

World state, events, choices, and scene presentation are persisted together at
their domain boundaries. Prose-only scene revisions preserve world state and
choices. Player actions retain the actual player input; bounded context includes
earlier narrative evidence as well as the current state. Interactive-film edits
receive the complete graph's authoring context while keeping write scope bounded.

Image revisions can send the previous image as a provider reference. Image
generation waits outside the Work mutation lock, then commits against its
captured moment. A failed replacement retains the previous successful image.
Provider credentials are only retried for image downloads on that provider's
own origin.

## Compatibility

Node.js 22.16.0 or later is required. Core, Studio, and CLI package versions are
aligned at 2.0.0. Legacy migration is available through `inkos work migrate`;
preview before applying with `--apply`. Migration preserves legacy source files
and reports conflicts rather than overwriting them.

Model cards declare request constraints independently of the gateway protocol.
Text-producing workers and tool-producing workers share the final payload
normalizer across the Pi SDK and custom HTTP transports.
When a model requires automatic tool selection, streaming and non-streaming
requests use that wire setting while the host still requires the originally
selected tool result. Missing results exhaust the bounded retry and fail with
`MODEL_REQUIRED_TOOL_MISSING`. Models that prohibit sampling overrides receive
their server defaults. Sonnet 5.5's documented limits and request constraints
apply through both native Claude and OpenAI-compatible gateways.

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
