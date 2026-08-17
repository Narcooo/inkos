# Changelog

[中文](CHANGELOG.md) | English

## v1.8.0

### Release Focus

Unified Pi Agent Harness and professional creation kernel. Studio Chat, TUI, external agents, and every production worker now share the same pi-agent tool loop, typed action/result boundary, Skill binding, retrieval, and run observation. Pipelines remain deterministic production capabilities instead of forming a parallel natural-language decision system.

### Agent Harness And Skills

- Added one production harness for long fiction, short fiction, scripts, storyboards, interactive film, Play, and translation, with shared run snapshots, observations, cancellation, recovery, and atomic commit semantics
- Shipped 15 standard `SKILL.md` expertise packages for long-form writing/review, commercial shorts, Play, scripts, storyboards, interactive film, translation, analysis, market research, import, covers, and semantic de-slopping
- Production workers bind medium-specific Skills inside the pi-agent harness. Formats share the Skill architecture and execution foundation without mechanically reusing long-form prompts
- Added standard run, tool, and model trajectory metadata for observing kkaiapi and other model calls, tool results, and evidence-backed completion

### Context, Retrieval, And Persistence

- Added one SQLite FTS5 / BM25 local retrieval kernel for story memory, archived materials, and Skill references. Indexes are rebuildable and source files remain authoritative
- Added book-bound references so imported material can declare intended uses and be retrieved by Planner, Composer, Writer, and other task contexts
- Added safe chapter workspaces and atomic file-set commits. Prose, state, hooks, and run snapshots are persisted together only after validation
- Improved stale chapter-state recovery, governed long-form context, and inactive-stream handling to keep old state and old tool results out of current production

### Production And Workbench

- Multi-chapter writing now runs sequentially as one background task with cancellation, progress, and recovery rather than bypassing the per-book lock with concurrent writes
- Short, script, storyboard, interactive-film, Play, and translation runs now share Skill binding, length observations, run snapshots, and long-output completion strategies
- Studio adds a safe chapter rewrite workspace with candidate text, review issues, and persistence status, plus wider chapter previews, external canon import, and persistent dynamic model catalogs
- Added LM Studio, user-added model IDs, custom cover Base URLs, and more reliable first-token / stream-idle deadlines
- TUI adds explicit `/new`, `/short`, `/play`, `/cover`, and `/write` surfaces, structured `/confirm` / `/cancel`, session-level `/model`, and adaptive terminal colors while leaving ordinary free text to the Agent
- The minimum runtime is now Node.js 22; CI and Release matrices now cover Node 22 / 24

## v1.7.2

### Release Focus

Agent Skills compatibility and a single Skill runtime. InkOS now consumes standard `SKILL.md` packages directly. The Chat Agent can activate a Skill from user intent, while users can force one from the composer `+` button or with `@skill-id`. The former InkOS-private Skill protocol, keyword triggers, and parallel context planner have been removed instead of being layered beside the new system.

### Agent Skills

- Added the typed `use_skill` tool to the pi-agent loop: the model sees available Skill names and descriptions, then activates professional guidance through a structured tool call
- Studio can import a complete folder containing `SKILL.md`; static references are preserved under the project's `.agents/skills/`, while external scripts are never executed automatically
- Added standard project discovery from `skills/` and `.agents/skills/`, plus user discovery from `~/.agents/skills/` and `~/.openclaw/skills/`
- Users can select and force a Skill in the Chat composer; one-turn intent activation expires instead of leaking into later turns or another book
- Project Settings shows each Skill's source and can delete project imports; deletion immediately removes the Skill from both the Agent catalog and composer

### Compatibility

- Removed the legacy `.inkos/skills` loader and InkOS-only fields such as `whenToUse`, `promptPacks`, `toolHints`, and `contextNeeds`
- Prompt packs remain a separate, Studio-editable subsystem under Project Settings instead of masquerading as Skills
- Migrate old Skills to a standard folder containing `SKILL.md` and static references, then import it in Studio or place it under `.agents/skills/`

## v1.7.1

### Release Focus

Narrative forecasting and non-blocking Studio collaboration. Long-form authors can generate, compare, and re-check multiple non-canonical futures before committing to the next chapter. Selecting a branch saves a candidate plan only; it does not change prose, outlines, or canon. Production work such as chapter writing now runs as a background task, so users can keep chatting, restore progress after refresh, retry failed messages, and rely on clearer task and data boundaries.

### Major Features

- Added long-form narrative forecasts: generate 2-5 isolated futures from current canon and compare chapter beats, character decisions, projected changes, risks, author-intent alignment, and uncertainties
- Added an inline Studio Chat comparison card with branch selection and stale-forecast re-checking. Selection writes only `selected-branch-plan.md`; prose, foundations, outlines, and runtime canon remain unchanged
- Added `inkos forecast create / show / select` to the CLI, sharing the same forecast schema, store, context fingerprints, agent, runner, and non-canonical boundary as Core
- Added whole-book backup / restore and safe latest-chapter deletion with chapter-state rollback, preventing prose and runtime state from drifting apart

### Collaboration And Task Reliability

- Moved `write_next` onto Studio's background-task system, allowing conversation to continue while production work runs instead of occupying the entire Chat request
- Tagged and persisted task progress by execution id, restored the correct task card after refresh, and prevented terminal task snapshots from closing a still-streaming chat response
- Added failed-message retry, production-task abort when its session is deleted, and cleanup of zombie running snapshots after server restart
- Reserved the single production slot atomically and blocked conflicting book mutations while still allowing read-only tools and narrative forecasts
- Fixed direct terminal tool calls disappearing from restored sessions; completion remains derived from real tool results

### Data Safety And Compatibility

- Chapter patch edits now update index word counts so persisted prose and statistics stay aligned
- Aligned short-fiction length validation between confirmation and runner, and made output language follow the user's current request
- Fixed stale Play choices reviving during task switching or replay and stopped deleted sessions from receiving new transcript messages
- Updated the Xiaomi MiMo API endpoint and improved Studio event classification so id-less or compaction events do not pollute background task cards

## v1.7.0

### Release Focus

Major multilingual creation and long-task reliability release. InkOS gains a complete long-form translation and localization workflow, while English support now extends through short fiction, scripts, storyboards, interactive film, Studio, and the CLI. Chat-driven novel import, configurable review and revision, automatic write-lock recovery, and abort propagation make long-form collaboration and cross-platform use more reliable.

### Major Features

- Added a translation and localization workflow for EPUB, text-based PDF, TXT, and Markdown sources, with chapter-aware semantic segmentation, glossary management, chapter review, and TXT / Markdown / EPUB export
- Added the Studio Translation workbench for human-readable source and target languages, project creation, translation runs, side-by-side source and translated text review, review reports, and complete-file export
- Added `inkos translate init / run / export` to the CLI. Studio Chat can also propose a confirmed translation action without requiring users to know language codes such as `zh` or `en`
- Added English prompt branches for short fiction, scripts, storyboards, and interactive film, plus bilingual dynamic Studio copy and corrected CLI environment-language fallback
- Added the Chat `import_chapters` tool: existing novels from local files, directories, or chat attachments can become real book chapters, with settings reverse-engineered and chapter state replayed. This is distinct from `ingest_material`, which only stores reference material (#324)

### Collaboration And Control

- Added configurable `writing.revisionGate` policies: strict, lenient, and always, with project-level and per-book overrides. Rejected revisions now report before/after review metrics and remaining issues (#326)
- The CLI now respects per-book `writing.reviewMode`; new `inkos auto [book-id] <target-chapter>` writes continuously to a target chapter (#307)
- Notification channels support plain text, and `write next / write rewrite / auto / revise / audit` can send completion or failure notifications with `--notify` (#308)
- Studio can expand action details by default, including read / grep tool results, making completed work directly inspectable (#306)

### Reliability And Compatibility

- Replaced fragile write-lock files with owned, heartbeating cross-process leases. Locks left by the same process, dead processes, or expired leases recover automatically; active conflicts return `BOOK_BUSY` instead of asking users to delete `.write.lock` manually (#337)
- Studio abort actions now propagate through pi-agent, the writing pipeline, and model requests, preventing background writes after the UI has stopped a task
- Dynamic model services such as OpenRouter, NewAPI, kkaiapi, PPIO, and SiliconCloud no longer reject user models through static allowlists; OpenRouter probing now uses the long-lived `openrouter/auto` model (#300)
- MiniMax responses use reasoning separation by default, with a shared fallback that removes complete leading think blocks before they enter chapters or chat prose (#329)
- Uploaded attachments and translation sources now return portable POSIX project-relative paths across Windows and Unix systems

## v1.6.3

### Hotfix

- Fixed `@actalk/inkos@1.6.2` / `@actalk/inkos-studio@1.6.2` leaking `workspace:*` into the registry manifest when published to npm; for Windows / npm global upgrades, install `1.6.3` directly or update to `latest`
- Release validation now rejects `workspace:` dependencies in publishable manifests, preventing this class of install failure from recurring
- The MiniMax official OpenAI-compatible integration adds a `MiniMax-M3` model card and sends `thinking: { "type": "disabled" }` by default for `MiniMax-M3*`, reducing the API's default behavior of returning thinking content

## v1.6.2

### Release Focus

Chat collaboration and tunable prompt hot-updates: building on v1.6.0's interactive film / Skill system, this release adds user file uploads, image attachments, long-task interruption, material archiving and retrieval, and Studio prompt pack editing. The core goal is to make Chat feel like a real creation workbench: it can read the materials the user provides, stop long tasks, turn external references into retrievable material, and let users adjust key prompts directly.

### Improvements

- Studio Chat supports uploading text / Markdown / image attachments; text materials enter the LLM context, and images are passed as multimodal input to vision-capable models
- Added long-task interruption: users can actively stop the current agent turn from Chat, no longer forced to refresh when a long task stalls
- Added material archiving and retrieval tools: external materials can be saved to the project material library and retrieved with evidence traces in later writing / discussion
- Added the Studio prompt pack editor: inspect and adjust built-in prompt packs such as longform, Play, and interactive film under "Project Settings → Prompts"; edits are saved as project-level override files without changing built-in defaults
- Runtime Skills can still provide prompt packs, context needs, and professional rules; the prompt pack editor makes those rules directly inspectable and tunable by humans
- Fixed Studio Chat losing the current conversation's requirements when revising an old chapter: `sub_agent(reviser)` now passes the user's "rewrite / re-revise / change direction" message from this turn into the long-form pipeline as a one-off revision brief
- When a revision is not saved to disk, the result now returns more specific verdict information: it shows before/after blocking / critical / AI-tell metrics, the applied gate, and remaining issues, instead of only returning a vague "kept original chapter"
- Adjusted the fallback for "chapter prose suspected not saved": it no longer defaults to suggesting "write the next chapter", and avoids misclassifying "chapter N revision instructions / rewrite plans" as prose

### Verification Notes

- Real-model verification: `kkaiapi / deepseek-v4-flash` can return the unique code word from an uploaded Markdown file in its answer, proving that document content enters the LLM context
- Real-model verification: `kkaiapi / gpt-5.5` can identify the dominant color of an uploaded PNG, proving that image attachments enter the multimodal input chain

## v1.6.0

### Release Focus

Major interactive film and Skill system release: extends InkOS creation entries from "novels + Play" to interactive film/games, scripts, storyboards, and pluggable professional capabilities. Studio Chat can now invoke external / built-in skills based on user intent, and generate traceable research reports when real facts are needed; this release also fixes several stability issues affecting long-task continuation and collaborative user editing.

### Major Features

- Added interactive film/game creation and workbench capabilities: branching plots, variables / flags, character relationships, endings, node images, and exportable interactive project packages
- Added the runtime Skill system: built-in / external skills can be auto-matched or explicitly forced by the user, injecting professional rules, prompt packs, and context needs into Chat / creation entries
- Added the web research tool `research_web`: usable for worldbuilding, eras, professions, regions, markets, and fact checks, producing Markdown reference reports with sources / queryLog / unknowns / confidence
- The Studio Skill UI supports selecting, forcing, and adding external skills, so professional capabilities no longer have to be hard-coded into the system prompt
- Script, storyboard, and interactive-film entries are aligned with the Chat action surface: heavy actions still go through confirmation cards, and generated results can be viewed and exported inside Studio

### Reliability And Fixes

- Fixed `patch_chapter_text` only matching exact text; slightly paraphrased target passages can now be located with a high-confidence paragraph fallback, and it still fails explicitly when the target cannot be confirmed, avoiding wrong edits
- Fixed audit / multi-chapter operation failures possibly writing `chapters/index.json` as an empty array; the save layer now rebuilds the index from on-disk chapter files, preventing existing chapters from disappearing in the UI
- Fixed the regression risk of sessions losing the bookId after switching to the same model on a different channel, and added tests locking down session-bound bookId passing
- Research reports are saved as reference material under `.inkos/research/`, and do not directly contaminate story truth, character cards, or prose

## v1.5.0

### Release Focus

Major InkOS Play and creation workbench release: pushes InkOS from a "write the next chapter automatically" pipeline tool toward a more complete Story Creation AI Agent. Long-form novels, short fiction, fanfic, spinoffs, style imitation, continuation, covers, and open-world interaction now share the same Studio Chat / CLI / TUI interaction core, with systematic work on instruction following, context management, and the visual experience.

### Major Features

- Added the **InkOS Play** open-world / branching interaction entry: free-form actions, clickable choices, world contracts, non-fixed time advancement, character agents, item / evidence / relationship state, HUD, and automatic illustration
- Studio creation entries reorganized as first-class entries: long-form novel, short fiction, fan fiction, spinoff, style imitation, continuation, branching interactive, and open world can all be launched directly from the workbench
- Play world-state visualization upgraded: the side HUD shows world time, current location, who you are facing, inventory, relationships, and illustrations; generated images enter the conversation stream and can be scrolled back through
- Added / improved the spinoff, style imitation, and continuation creation chains, so existing IPs, settings, and writing styles can keep spawning new content
- Studio Chat, TUI, and CLI unified onto the action surface: plain discussion, confirmed book creation, short fiction, covers, Play, long-form chapter writing, and rewrite/continuation no longer race on scattered keywords

### Context And Reliability

- Long-form context now uses protected / compressible layering: high-priority content such as author intent, the current focus, and active hooks is never silently compressed away; old history and low-relevance background only get semantic compression when over budget
- The Composer adds outline section-level selection, so whole foundation files no longer blow up the context window
- Session restore switched to summary + recent messages, reducing old tool results and history drowning out the current instruction
- Context-window guards added at the provider / Studio main Chat network boundary: over-limit requests now fail with a clear error instead of waiting for an upstream 400
- Weak-model format robustness improved: the Planner / Architect model output protocol moved from fragile YAML front matter to more tolerant Markdown / host-side extraction, reducing hard aborts caused by format drift on models like MiniMax
- Review, revision, and failure states lean toward exposing real problems, no longer treating the model's verbal claims as completed results

### Studio UX

- The Studio left navigation, Play conversation area, view-world panel, illustration buttons, artifact previews, and font sizes were reorganized as a whole
- Play illustration supports characters, items, evidence, moments, and other objects; images render inside the conversation context instead of only appearing in a fixed panel preview
- Model settings, cover services, aggregator API entries, and error messages are further separated: InkOS execution errors, model provider errors, and image generation errors are no longer mixed together
- The README and Skill docs were updated to the Story Creation AI Agent positioning, showing real v1.5.0 Studio Play screenshots

### Bug Fixes

- Fixed inconsistent execution caused by TUI / Studio / Chat natural-language entries each interpreting user intent on their own
- Fixed incomplete book creation possibly being treated as a successful creation downstream; completion is now derived from real artifacts and tool results
- Fixed Play HUD issues with inventory, relationship edges, state-value localization, image display, and duplicated choice buttons
- Fixed the long-form writer / reviewer / reviser possibly mistaking a format-parsing failure for a prose problem and continuing to revise the draft
- Fixed several UI screenshots, README architecture diagrams, the Kimi partnership banner, and the 1.5.0 release image rendering incorrectly in the GitHub README

## v1.4.1

### Release Focus

Windows / provider hotfix plus configurable long-form writing speed: fixes the unreachable MiniMax default endpoint, keeps the speed benefit of the default single automatic revision pass for long-form writing, and allows projects to configure automatic revision passes back to 3.

### Improvements

- Long-form chapter writing gains the `writing.reviewRetries` project setting for automatic review/revision passes; the default remains 1, and you can run `inkos config set writing.reviewRetries 3` when stronger revision is needed
- The Studio chapter-writing chain reads the same project setting, keeping CLI and Studio behavior consistent
- README / development notes updated for the v1.4.1 MiniMax and long-form writing configuration changes

### Bug Fixes

- Fixed the MiniMax default provider still pointing at a no-longer-available Anthropic endpoint, which made connection tests fail in native Windows environments
- Fixed MiniMax endpoint metadata overrides being too broad, potentially affecting routing decisions for other services

## v1.4.0

### Release Focus

Major short-fiction and Studio Chat collaboration release: adds a public short-fiction production chain, cover-making tools, persistent plain-chat sessions and artifact previews, and fixes long-form length normalization possibly being truncated by the output limit.

### Improvements

- Added a standalone short-fiction writing chain: Studio Chat and the CLI can generate the complete short manuscript, outline records, review records, synopsis / selling points, and a cover prompt
- Added cover-making capability: covers can be generated / regenerated on their own, with the generated cover image previewed directly in Studio messages
- Studio plain chat supports project-level persistent sessions; after a refresh or restart you can keep viewing, switching, renaming, and deleting sessions
- Chat can directly edit generated text artifacts inside the project, which is handy for adjusting chapters, cover prompts, synopses, and other files before continuing with the InkOS writing chain
- The service settings page adds a cover-generation section, separating the cover text model and image model more clearly

### Bug Fixes

- Fixed image paths in short-fiction / cover tool results only showing as text without rendering a preview
- Fixed Studio tool-call details being lost after message restore
- Fixed `LengthNormalizerAgent` explicitly setting `maxTokens`, which could truncate long-chapter compression / expansion output

## v1.3.12

### Release Focus

Small Studio service-settings UX release: moves the aggregator service entries to a handier position, adds quick access to official sites / docs / model pages, and unifies the service group label as "Aggregator API".

### Improvements

- The Studio service list and service detail pages add external quick links for key aggregator services, so you can open the official site, docs, and model list before configuring
- The aggregator service group heading is unified as "Aggregator API", avoiding misleading wording

## v1.3.11

### Release Focus

Studio service and aggregator model integration update: adds the kkaiapi service option; fixes custom/local OpenAI-compatible service tests wrongly using the fallback model, connection crashes caused by Chinese characters in API keys, and the missing service-config deletion entry; also completes radar history, genre-management refresh, and long-form multi-thread ratios being reflected in structure.

### Improvements

- Added the kkaiapi aggregator model service option; Studio / CLI service settings can select and test it directly
- Studio new-book creation now goes through the shared conversation interaction core, avoiding behavior divergence between the book-creation entry and the real creation chain
- Radar scan results are persisted as history records; Studio can browse existing scan results
- Long-form outlines / chapter outlines now more explicitly carry the user-specified multi-thread ratios, reducing cases where "the ratio was written down but the structure doesn't reflect it"

### Bug Fixes

- Fixed custom service connection tests wrongly using the global fallback model or the wrong protocol, causing llama.cpp / local OpenAI-compatible services to be misjudged as unavailable
- Fixed ByteString conversion exceptions triggered when the API key or request headers contain Chinese or other non-ASCII characters
- Fixed Studio missing an entry to delete custom service / model configurations
- Fixed genre management: after saving, the file was generated but the Studio list did not refresh
- Fixed hook ids in `hooks.json` possibly containing duplicated hyphens or abnormal punctuation

## v1.3.10

### Release Focus

Book-creation platform hotfix: fixes the `sub_agent.platform` parameter possibly failing schema validation on Chinese/alias inputs during web and CLI book creation, and funnels the new-book creation chain into legal platform values.

### Bug Fixes

- Fixed tool calls during book creation failing with `Validation failed for tool "sub_agent": - platform: must be equal to constant`, which prevented book files from being generated
- Unified platform alias normalization across the Studio, CLI, TUI, and agent create-book chains; inputs like `番茄` / `fanqie` / `番茄小说` now resolve to a legal enum value
- Unknown platform values degrade to `other`, preventing a wrong platform id from being written into the book config and affecting later flows
- Updated the README WeChat group QR code to group 13

## v1.3.9

### Release Focus

Studio book creation and book settings hotfix: fixes the new-book creation chain being hijacked by an existing book's session, and restores a visible entry to the book settings page.

### Bug Fixes

- Fixed Studio new-book creation `/new`, `/create` not binding an independent orphan session, which let book-creation requests be taken over by the current book workbench session
- Fixed unreliable navigation to the new book's Chat workbench after creation completes
- Restored the book settings route: `#/book/:id` remains the Chat workbench, and `#/book/:id/settings` is for editing book configuration
- Fixed "Book Settings" in the Dashboard book menu actually opening the Chat workbench

## v1.3.8

### Release Focus

Local model hotfix: fixes the post-1.3.7 configuration regressions for Ollama / local OpenAI-compatible endpoints in the book-creation and continuation chains, ensuring both Studio and CLI can keep using local models with no API key.

### Bug Fixes

- Fixed Studio service tests, model lists, and the book-creation chain requiring an API key, which made Ollama / local endpoints unusable
- Fixed the Studio new-book page's actual `/agent` creation path not correctly passing the empty-key local model client
- Fixed dynamic Ollama model names in the CLI / Studio being wrongly blocked by the built-in model table
- Fixed `write next --context` not actually reaching the chapter-planning and prose-writing prompts

## v1.3.7

### Release Focus

Tightened long-form writing quality: recently validated web-fiction writing rules are wired into the Writer, Planner, Architect, and post-write validation, focusing on gripping openings, chapter density, hook payoff, paragraph rhythm, and foundation completeness.

### Improvements

- **Web-fiction writing rules in the chain**: the Writer prompt adds constraints on highlight density, mobile-friendly paragraphs, the opening first screen, chapter cliffhangers, and character action motivation, so the model writes less idle build-up and report-style prose
- **Planner / Architect aligned with writing goals**: chapter planning and the book foundation more explicitly carry the golden opening, chapter goals, hook ledger, and paragraph-style foundation output requirements
- **More concrete hook payoff**: the hook ledger requires advance / resolve items to have locatable actions, objects, dialogue, or events in the prose, reducing the gap of "in the ledger but not in the text"
- **Tighter paragraph density rules**: density must come from meaning and scene advancement, not from chopping prose into telegraph style; consecutive short paragraphs are caught by post-write rules

### Bug Fixes

- Fixed the Architect possibly dropping the 5 foundation SECTION blocks when extending output
- Fixed the hook ledger payoff check being too lenient, which let indirect hints be misjudged as payoff
- Fixed the writing prompt describing paragraph size too vaguely, causing the model to over-fragment paragraphs under the "1-3 beats of density" rule

## v1.3.6

### Release Focus

v13 book-creation flow migration: creation output upgraded to a paragraph-style foundation draft, a volume-level map, and a one-card-per-character role directory, with an upgrade path for old books.

### Improvements

- **Paragraph-style foundation**: the Architect generates `outline/story_frame.md`, `outline/volume_map.md`, and `roles/` character cards, keeping a legacy shim compatible with old read paths
- **Old-book upgrade path**: agent architect supports `revise=true`, converting old bullet-style foundations to the Phase 5 layout; the original foundation is backed up before upgrade, and runtime state files are not reset during upgrade
- **Truth file injection**: the agent injects the current book's truth files into context; books on the old layout get a hint that they can upgrade to the paragraph-style foundation
- **Foundation output budget fix**: separated the `maxTokens` fallback from the `maxTokensCap` hard limit, so large Architect outputs are no longer clipped by the default config
- **README stats**: added the Skills Download History chart, synced across the Chinese, English, and Japanese READMEs

### Bug Fixes

- Fixed information loss caused by reading the shim during a second Phase 5 upgrade
- Fixed reviseFoundation resetting `current_state` / `pending_hooks` / runtime logs
- Fixed stale role cards remaining after characters are renamed or deleted

## v1.3.5

### Improvements

- **Session / sidebar experience refactor**: Studio introduces a per-session runtime; `pendingBookArgs` moved down to session level; session SSE listening extracted from `App.tsx`; the sidebar supports per-book collapsing, deferred display of draft sessions, and the session list no longer reorders on click
- **Simplified session titles**: session titles are no longer LLM-generated; the first user message directly becomes the session title, with lazy migration for existing sessions
- **Draft session workflow**: new sessions are only persisted at the first message; draft sessions with no sent message are not written to disk and do not appear in the sidebar
- **Session list performance**: `listBookSessions` now reads concurrently and returns lightweight summaries, avoiding the sidebar loading many full session files at once

### Bug Fixes

- **Model list cache fix**: the cache key for `/services/:service/models` now includes `resolvedBaseUrl`; custom services no longer wrongly reuse the old model list after switching endpoints
- **Session delete confirmation dialog positioning**: `ConfirmDialog` now renders through a portal, so it is no longer locked inside the sidebar's containing block
- **Test cleanup**: removed the obsolete `updateSessionTitle` mock leftovers in `server.test.ts`

## v1.3.4

### Bug Fixes

- **Dependency pinning**: pinned `@mariozechner/pi-ai` / `pi-agent-core` to `0.67.1`, lowering the chance of global-install failures caused by npm mirror lag
- **Faster service probing and model lists**: `GET /models` is back on the fast path; `knownModels` services no longer run the slow probe; when `/models` is unavailable, the service's own `knownModels` are returned
- **More reliable service validation**: `/models` returning `401/403` now short-circuits directly; the service detail page validates the key with `/test` before saving, and page load also uses `/test` to verify the real connection state
- **Full model list returned**: the service test endpoint no longer trims the list to 50 models by default

### Improvements

- **Restored the agent's general file tool surface**: `edit` is back on the normal tool surface, and a new `write` tool creates/overwrites files, with paths still restricted to `books/`
- **`sub_agent` minimal control-surface extension**: added `writer.chapterWordCount`, `reviser.mode`, `exporter.format`, `exporter.approvedOnly`
- **Unified revision entry**: in book mode, whole-chapter revision converges on `sub_agent(reviser)`, reducing the model wavering between `revise_chapter` and `sub_agent`

## v1.3.3

### Bug Fixes

- **Explicit titles for chat book creation**: agent book creation now requires an explicit `title`; `initBook` / `book.json` consume the structured title directly, and initialization with an empty title is no longer allowed
- **Unified real EPUB export**: the CLI, Studio downloads, the shared interaction layer, and the agent exporter all reuse the same real EPUB implementation, ending the split state of one real EPUB, one fake HTML, and one unimplemented path
- **High-risk writing actions funneled**: the book-mode agent prefers deterministic tools for setting changes, renames, partial text fixes, and chapter rewrite/polish, no longer defaulting back to the fragile general-purpose `edit`

### Improvements

- **TUI plain chat aligned with agent/session**: plain TUI input now goes through a local agent session, keeping a few local control-command fast-paths, moving further toward Studio's interaction model
- **Clearer writing control surface**: the agent prompt explicitly distinguishes heavy-action subagents from high-risk deterministic writing tools, reducing gaps where "the model understood, but no tool could execute it"

## v1.3.2

### Bug Fixes

- **Restored the `architect` foundation output budget**: re-pinned `maxTokens: 16384`, lowering the chance of local models and LM Studio truncating output and losing foundation sections during book creation
- **Restored the old OpenAI-compatible path**: `provider=openai + custom compatible baseUrl` is no longer wrongly routed into the more aggressive `custom fetch` path; legacy compatibility scenarios like Google/Gemma work again
- **Native Anthropic-compatible transport for custom services**: `service=custom` with `provider=anthropic` also uses the native request chain, no longer hard-bound to the SDK
- **Windows Studio startup fix**: `inkos studio` no longer crashes on Windows because the absolute-path loader was treated as an invalid ESM URL
- **Bootstrap projects fall back to env config**: Studio projects auto-initialized in an empty directory fall back to the global `.inkos/.env` when no service is configured; `book create` no longer dies immediately on a missing key
- **Unified service routing truth**: `config-loader`, `service-resolver`, Studio service probing, and `doctor` all read provider/api/chatBaseUrl/modelsBaseUrl from the same `service-presets`, reducing each chain guessing the same service on its own

### Improvements

- **Start directly from an empty directory**: `inkos` / `inkos studio` now auto-initialize a minimal project skeleton and start Studio, no longer requiring an explicit `init` first
- **Studio auto-detects transports**: service tests automatically try combinations of candidate models, `chat/responses`, and streaming toggles to match a working configuration
- **`doctor` enhanced**: no longer fixates on the current single model/combination; supports multi-model, multi-protocol, multi-streaming probes
- **Fresh session for book-creation chat**: re-entering "Create book" clears the old conversation instead of reusing the previous creation chat history
- **Chat model picker search**: the Studio model picker supports search filtering
- **More restrained sidebar refreshes**: read operations no longer trigger pointless sidebar refreshes; refresh only happens after write operations
- **More realistic service save flow**: saving an API key runs a real `/test` probe instead of relying only on `/models`

## v1.3.1

### Bug Fixes

- **MiniMax baseUrl corrected**: from `api.minimax.chat` to `api.minimaxi.com` (the current OpenAI-compatible endpoint)
- **Multi-service baseUrl isolation**: choosing a non-default service in agent chat no longer leaks the default service's baseUrl (e.g. the moonshot URL being wrongly used for minimax requests)
- **resolveServiceModel always uses the preset**: no longer uses the pi-ai built-in model object directly (which may point to international endpoints or the wrong API format); models are always constructed with the preset's baseUrl and api format
- **Sidebar refresh after agent book creation**: the sidebar book list refreshes automatically after a book is created through agent chat (previously only POST /books/create broadcast `book:created`)
- **`pnpm dev` parallel startup**: added `--parallel`, fixing core tsc --watch blocking studio startup

### Improvements

- **MiniMax knownModels**: MiniMax does not support `GET /models`, so 7 models are hard-coded instead (M2.7/M2.5/M2.1 plus their highspeed variants + M2)
- **Connection tests no longer send messages**: removed the chat-completion test; validation goes through `/models` + fallback only and returns instantly
- **Custom service URLs auto-append /v1**: `https://example.com`, `https://example.com/`, and `https://example.com/v1` are equivalent
- **Agent system prompt**: bans emoji, requires lists/tables for structured content, adds chapter-index management guidance

### Tests

- Added regression tests: service-presets (MiniMax baseUrl + knownModels), service-resolver (preset overrides pi-ai), normalizeBaseUrl

## v1.3.0

### Release Focus

Studio 2.0 official release. `inkos` now starts Studio directly by default; the local web workbench becomes the main entry, and the TUI is kept as `inkos tui`.

### New Features

- **Studio 2.0 as the default entry**: `inkos` starts Studio directly; the home page, provider management, and writing workbench are unified as the new main interaction entry
- **Custom OpenAI-compatible services**: Studio now supports a custom `baseUrl`, protocol type (`chat` / `responses`), and streaming toggle, compatible with more proxies and aggregation gateways
- **Config source switching**: Studio adds an explicit switch between `.env` and Studio configuration, no longer passively overridden by `INKOS_LLM_*` in the directory
- **Native custom transport**: a native fetch request chain for `custom` services, reducing single-point dependence on the SDK path and improving compatibility

### Improvements

- **More realistic service tests**: the service page test no longer only checks `/models`; it also runs a minimal generation probe, avoiding false positives where "connection test passes but chat fails"
- **Improved service save flow**: after a successful save, Studio returns to the provider management page automatically; the top home and back entries are more prominent
- **Key backfill**: the service detail page reloads the saved key, so reopening the page no longer looks like the key was lost
- **Better error visibility**: Studio chat no longer masks empty replies with `Acknowledged.`; the real upstream error is shown directly

### Bug Fixes

- Fixed `llm.services + defaultModel + secrets` being inconsistent with the runtime loading contract
- Fixed inconsistent chains for `custom:*` services across connection tests, model lists, and `/api/v1/agent`
- Fixed `inkos` starting Studio throwing the `llm.model` validation error directly when no default model was set
- Fixed non-streaming / SSE responses from custom services being wrongly parsed as plain JSON

## v1.2.0

### Release Focus

Unified interaction core — the TUI, Studio, `inkos interact`, and the OpenClaw Skill share the same natural-language understanding and execution runtime.

### New Features

- **Shared interaction runtime** (`packages/core/src/interaction/`): natural-language router (15+ intents), session management, edit transaction controller, event tracing, stage telemetry
- **Ink TUI dashboard**: `inkos` opens a full-screen Ink + React dashboard directly, with conversational creation, slash-command Tab completion, themed animations (writing/auditing/revising/planning each with their own), and bilingual Chinese/English i18n
- **Studio assistant panel**: the right-side AI assistant connects to the shared interaction core, operating books in natural language (write chapters, rename, audit, export), with SSE real-time status push and execution stage icons
- **Conversational book creation**: brainstorm the book concept, setting, and target chapter count step by step through the Studio assistant, then create with one click once the draft is ready
- **Whole-book entity rename**: `把林烬改成张三` / `/rename 林烬 => 张三`, a full scan of chapters + truth files replaced in one pass
- **Single-chapter text replacement**: `/replace 5 old-text => new-text`, precise patching of a specific chapter
- **`inkos interact --json`**: the shared interaction JSON entry, returning request / response / session / events, callable directly by OpenClaw and external agents
- **Thinking-model temperature clamping** (PR #174): thinking models like kimi-k2.5 automatically get temperature=1, compatible with per-call temperature tuning, warning once per model

### Improvements

- Studio ChatBar dedup: `executeCommand()` extracts the shared logic, removing 80 duplicated lines between handleSubmit/handleQuickCommand
- The Studio ChatBar SSE effect uses `loadingRef` instead of a stale closure
- Studio dropdown z-index fix: removed the paper-sheet transform (eliminating the stacking context); the card is raised to z-50 while the menu is open
- Studio agent response fix: uses `result.responseText` instead of `session.messages.at(-1)`
- TUI theme extension: semantic colors (success/error/active/idle) + role colors (user/assistant/system)
- TUI status badges: ✓ done / ✗ failed / ✎ writing / ◇ planning / ◈ awaiting decision
- TUI i18n fix: `stageLabels` moved into TuiCopy, removing hardcoded status strings
- Studio dead-code cleanup (PR #176): removed unused shadcn components, `dotenv`, `shadcn`, `tw-animate-css`, `class-variance-authority`, -2800 lines

### Bug Fixes

- Studio ChatBar assistant replies lost: a session-history overwrite silently dropped the response
- Studio BookMenu dropdown hidden behind lower cards: the fadeIn animation's transform created a stacking context
- Studio GenreManager `window.confirm` replaced with `ConfirmDialog`
- Studio BookDetail Nav `toTruth` type-assertion hack fixed
- Studio ChapterReader/Dashboard approve/reject missing error handling
- ChatBar curly-quote encoding breaking esbuild parsing

---

## v1.1.1

### Release Focus

- Rolled back to the stable `v6 + bugfix` mainline, replacing the unstable latest `v8`

### Bug Fixes

- **#151** — Architect section parsing tolerates heading drift like `book-rules` / `Book Rules` / full-width colons; creation no longer fails because a `book_rules` section is slightly deformed
- **#152** — The state validator is now fail-closed: empty responses raise an error directly, and multi-line JSON balanced extraction is restored, so a missing `passed` field is no longer misjudged
- **#154** — Post-write rules add detection of chapter-number references in prose, blocking narration like `第33章` / `Chapter 33`
- **#155** — `repair-state` supports same-chapter recomputation of the latest `state-degraded` chapter, no longer failing with `delta chapter N goes backwards`

### Improvements

- `ai-tells` / `sensitive-words` add bilingual Chinese/English rule paths; the revision chain for English books no longer mixes in Chinese issues
- Prompts and language passing for import / continuation / series were completed; foundation reviewer results now feed back more reliably
- The reviser revision chain re-attaches `hookDebtBlock`, so partial revisions can see hook-debt evidence

---

## v1.1.0

Full writing-pipeline upgrade. Driven by multiple rounds of autoresearch experiments under the Meta-Harness methodology, from-scratch mode quality rose from 75 to 92, and fanfic mode from 39 to 82+.

### New Features

- **Foundation Reviewer**: an independent review agent added at book creation, scoring 5 dimensions on a 100-point scale (original-work DNA preservation, new narrative space, core conflict, opening pacing, pacing feasibility); below 80 it rejects automatically and feeds the review comments back to the Architect for regeneration
- **New-timeline requirement**: fanfic modes (canon/au/ooc/cp) must design an original divergence point; retelling the original plot is not allowed
- **Hook Seed Excerpt**: at hook payoff time, the Composer extracts the original seed scene's text from chapter_summaries and injects it into the Writer context, replacing the complex lifecycle pressure system
- **Review Reject rollback**: `inkos review reject` rolls state back to the snapshot before the rejected chapter, discarding downstream chapters and memory indexes
- **State Validation Recovery**: failed state validation automatically retries the settler; if it still fails, the state is saved in degraded mode, with `inkos write repair-state` for manual repair
- **Audit drift isolation**: audit corrections are written to a standalone `audit_drift.md`, no longer appended to `current_state.md`
- **Title collapse fix**: detects theme clustering in recent titles and regenerates titles from new keywords extracted from the prose
- **Hook budget hint**: a budget warning is shown at ≥10 active hooks, steering toward paying off old debt first
- **Chapter-ending summaries**: the ending sentences of the last 3 chapters are extracted into context, preventing structural repetition
- **Mood/pacing detection**: mood-monotony and title-clustering detection; sequence-level warnings do not count toward the revision blockingCount
- **Fanfic style extraction**: `fanfic init` and `import chapters` automatically generate style_guide.md + style_profile.json
- **Governed path completion**: parent_canon.md and fanfic_canon.md for continuation/fanfic are injected into the Writer through the governed path
- **Custom HTTP headers**: the `INKOS_LLM_HEADERS` environment variable injects custom HTTP headers

### Bug Fixes

- Chapter-number contamination fix: numbers in narrative text are no longer misparsed as chapter progress
- Hook ordering fix: mustAdvance corrected from descending to ascending (choosing the least recently advanced)
- Outline matching fix: supports chapter-range formats, preventing Chapter 1 from wrongly matching Chapter 10
- approve no longer overwrites snapshots, style extraction degrades gracefully, Studio hot-reloads LLM config, theme persistence

---

## v1.0.2

### Bug Fixes

- **#127** — Fixed false failure reports when creating books from Studio Web: while background creation is still running asynchronously, the frontend extends its waiting window and no longer prematurely reports `Book not found`
- Paragraph fragment detection ignores pure dialogue lines, reducing false positives

---

## v1.0.0

InkOS Studio + stability hardening. Upgraded from a CLI tool to CLI + web workbench.

### InkOS Studio

- `inkos studio` starts the local web workbench (Vite + React + Hono, default port 4567)
- Book management: create, delete, export (TXT/MD/EPUB), configure
- Chapter review and editing: approve/reject, inline editing, multi-mode revision (polish/spot-fix/rewrite/anti-detect)
- Real-time writing progress: SSE-pushed generation status
- Market radar: AI-driven platform/genre trend analysis
- Analytics: word counts, audit pass rate, chapter ranking, token usage
- AI detection: scan chapters for AI-generation traces
- Style analysis and import: analyze reference text, inject writing style
- Genre management: create/customize genres (fatigue words, pacing rules, audit dimensions)
- Daemon control: start/stop background writing, view event logs
- Truth file editor: view and edit the knowledge base per book
- Config editor: LLM providers, model routing, notifications

### Bug Fixes

- Unknown hooks no longer throw on resolve/defer; they are skipped instead
- Studio waits for completion before route navigation after creating a book
- Async creation failures in Studio are exposed to the user
- Validator false positives: fail only on hard contradictions, reducing noise

### Chore

- Cleaned up unrelated files brought in by the studio merge (.playwright-cli/, .superpowers/, promo docs)
- Untracked docs/ and autoresearch/, added them to .gitignore
- SKILL.md upgraded to v2.2.0 with a new Studio workflow section
- Trilingual READMEs updated with the Studio release announcement and roadmap

---

## v0.6.3

### Bug Fixes

- **#113/#109** — StateValidator JSON parsing switched from a greedy regex to a balanced-bracket parser; markdown appended by the LLM no longer breaks parsing
- **#114** — The status command counts actual chapter files, no longer affected by poisoned runtime state
- **#110** — Book creation is now atomic (temp directory → rename); failures leave no half-created books
- **#92/#93** — Agent execution-layer hard limits: write_draft validates sequential writes, revise_chapter validates that the target chapter exists, write_truth_file blocks progress tampering, import_chapters requires ≥2 chapters
- **#90** — Paragraph-shape detection moved before persistence (covering the final content after normalize + auto revise)
- **#94** — Title dedup: writer prompt constraint + post-write validator detection + automatic renaming

### Improvements

- **#111** — SKILL.md adds 13 missing commands (eval, consolidate, write rewrite, book update/delete, plan/compose, studio, fanfic show/refresh, genre create/copy)
- **#95** — The doctor command adds version migration detection (identifying pre-v0.6 legacy-format books)
- **#103** — Added an end-to-end rewrite regression test (rewrite 2 → next should be 3)
- Added the `inkos eval` command — structured quality evaluation report
- SKILL.md version bumped to 2.1.0

## v0.6.2

### Bug Fixes

- **Hook crash** (#99/#101/#104) — duplicate active hook families no longer crash; they are absorbed and merged automatically, and a new hook arbitration mechanism reduces duplication frequency
- **Local LLM** (#100) — local/self-hosted OpenAI-compatible endpoints (Ollama etc.) no longer require an API key
- **Zero-character chapters** (#105) — truth rebuild no longer overwrites final chapter content
- **Wrong chapter numbers** (#108/#98) — poisoned manifests are automatically normalized to real progress at bootstrap
- **Bad chapter writes** (#88) — the state validator errors directly on empty responses, and chapter file saving moved to after validation passes
- **Provider 400** (#91) — improved error message for the streaming provider fallback

### Improvements

- **Paragraph quality** (#90) — added short-paragraph detection and paragraph-density drift warnings
- **Agent tool constraints** (#92/#93) — strengthened boundary constraints in agent tool descriptions, added prohibitive rules to the system prompt
- Windows compatibility: tar commands get --force-local
- README description updated; the OpenClaw link points to the skill page

## v0.6.1

- Fixed emphasized hook id normalization
- Fixed poisoned runtime state recovery

## v0.6

Structured state + hook governance + length governance.

Focuses on three systemic long-form writing problems: **context bloat after 20+ chapters slowing writing down or even causing 400 errors**, **hooks only being added and never paid off, with a payoff rate near 0%**, and **50%+ word-count drift with a normalizer that could destroy chapters**.

### Architecture

- The pipeline is upgraded to 10 agents: added Planner, Composer, Observer, Reflector, Normalizer
- Truth files migrated to `story/state/*.json` (Zod-validated); the Settler outputs a JSON delta instead of full markdown; old books migrate automatically
- The SQLite temporal memory database (`story/memory.db`) is enabled on Node 22+, retrieving historical facts by relevance
- `createRequire` fixes node:sqlite loading under ESM

### Hook Governance

- The Planner generates a `hookAgenda` (mustAdvance / eligibleResolve / staleDebt), scheduling hook advancement and payoff
- The Settler working set expands to `selected ∪ recent ∪ agenda ∪ dormant debt`, closing the retrieval blind spot
- hookOps adds `mention` semantics — "merely being mentioned" no longer updates `lastAdvancedChapter`, preventing fake advancement
- `analyzeHookHealth`: active count over the cap / consecutive no-advance / stale unhandled / new hooks without payoff → audit warnings
- `evaluateHookAdmission`: duplicate hook families are intercepted automatically, preventing hook bloat

### Length Governance

- `LengthSpec` (target / softMin-softMax / hardMin-hardMax) + `countingMode` (zh_chars / en_words)
- One normalization opportunity before audit + one after revision, no brutal truncation
- Safety nets: normalization output under 25% of the original is rejected directly; `stripCommonWrappers` removing more than 50% falls back to the original

### Quality

- Cross-chapter repetition detection (Chinese 6-character ngrams / English 3-word phrases)
- Dialogue-driven guidance (interactive scenes prefer dialogue exchanges)
- English variance brief (anti-repetition phrase/opening/ending injection)
- Multi-character scene resistance requirement (at least one direct exchange with resistance)

### Bug Fixes

- The user's `INKOS_LLM_MAX_TOKENS` now takes effect as the global cap (#87)
- `stripReservedKeys` prevents `llm.extra` from overriding max_tokens / temperature
- Chapter summary dedup: dedup before append + dedup on bootstrap load + JSON auto-repair
- The `consolidate` regex supports full-width bracket volume-boundary formats
- Bilingual CLI output and logs
- Runtime state poisoning recovery

---

## v0.5.0

Native English writing + system stability fixes.

### English Novel Writing

- 10 English genres (LitRPG, Progression Fantasy, Isekai, Romantasy, Sci-Fi, Cozy Fantasy, Tower Climber, Dungeon Core, System Apocalypse, Cultivation)
- `--lang en` flows through the whole pipeline: the Architect generates English foundations, the Writer writes English prose, the Settler produces English truth files, the Auditor audits in English, and the Reviser revises in English
- English post-write validator: AI-tell word detection (delve/tapestry/testament etc.), paragraph length, fatigue words
- Automatic chapter title switching: `Chapter X:` vs `第X章`
- EPUB export lang tag adaptation

### System Stability

- Atomic write lock: `acquireBookLock` switched from stat+write to `open("wx")` exclusive creation, eliminating the race
- Scheduler re-entrancy guard: new ticks are skipped while the previous writing/radar round is still running
- Revision consistency: the revision chain uses `finalContent` instead of the original content; spot-fix results are no longer lost
- Agent override client isolation: agents with different API keys no longer share connections
- Daemon pid cleanup: stale pid files are removed automatically when startup fails
- Studio startup fix: built JS starts with node instead of tsx
- Import resume count fix: `--resume-from` reports the actual number processed

### CLI Enhancements

- `inkos book delete <id>`: delete a book and all its data (`--force` skips confirmation)
- `inkos status --chapters`: shows per-chapter status and critical issues for failed chapters
- Audit JSON parsing tolerance (#51)
- `write_truth_file` agent tool (#53)
- Audit drift corrections auto-injected into the state card (#52)

---

## v0.4.6

Logging system + streaming compatibility + local model tolerance + CLI enhancements.

### Structured Logging

- New Logger module: ANSI-colored output (INFO=cyan, WARN=yellow, ERROR=red), JSON Lines file logging
- `inkos up` automatically writes `inkos.log`; daemon restarts are traceable
- `write next`, `draft`, and `up` support the `-q, --quiet` quiet mode
- LLM streaming heartbeat: progress is reported every 30 seconds while the model is thinking (characters received, Chinese character count)
- 17 `process.stderr.write` calls in the pipeline replaced with the structured logger

### Streaming Compatibility

- Stream auto-fallback: failed streaming automatically retries with sync, so proxies without SSE support still work
- Partial-content recovery on stream interruption: with ≥500 characters already received, the truncated content is returned instead of an error (#21)
- Improved error diagnostics: 400/401/403/429/Connection errors include baseUrl, model context, and troubleshooting hints
- `inkos doctor` provides targeted hints on failure (check the baseUrl, try stream:false, check the API key)

### Bug Fixes

- `rewrite` snapshot restore: `particle_ledger.md` changed from required to optional; non-numeric genres no longer error (#37)
- `rewrite` for chapter 1: `initBook` generates snapshot-0 at the end, so chapter 1 can be restored correctly (#34)
- Empty chapters from small local models: `parseCreativeOutput` gains a 3-level fallback (markdown heading → prose tag → longest prose block); Qwen/Ollama no longer return empty content (#13)

### CLI Enhancements

- `book create --brief <file>`: pass in a creative brief; the Architect generates the foundation from your ideas (#43)
- `write rewrite` for chapter 1 correctly restores snapshot-0 (previously restore was skipped)

---

## v0.4 (v0.4.0 – v0.4.5)

Continuation + spinoff writing + style imitation + multi-provider routing + post-write validator + hardened audit loop.

### Continue an Existing Work

Import an existing novel (single file or a chapter directory) into InkOS; the system splits chapters automatically and reverse-engineers the full set of truth files (world state, hooks, character matrix, etc.), after which `write next` continues directly.

```bash
inkos import chapters 我的小说 --from 已有章节/        # import from a directory
inkos import chapters 我的小说 --from 全书.txt          # import from a single file (auto-split on "第X章")
inkos import chapters 我的小说 --from 全书.txt --split "Chapter\\s+\\d+"  # custom chapter-split regex
inkos write next 我的小说                               # continue seamlessly
```

Single-file mode splits chapters on `第X章` automatically, and `--split <regex>` supports custom patterns. Interrupted imports can resume with `--resume-from <n>`.

### Spinoff Writing

Create a prequel, sequel, side story, or what-if line based on an existing book. The spinoff and the parent share the worldview and characters but have an independent plot line.

```bash
inkos import canon 烈焰前传 --from 吞天魔帝   # import the parent canon into the spinoff
inkos write next 烈焰前传                     # the writer automatically reads the canon constraints
```

Import generates `story/parent_canon.md`, containing the parent's world rules, character snapshots (with information boundaries), key-event timeline, and hook status. The writer consults the canon before writing, and the auditor automatically activates 4 spinoff-specific dimensions:

| Dimension | What it checks |
|------|----------|
| Parent event conflicts | Whether spinoff events contradict the canon constraint table |
| Future information leaks | Whether characters reference information revealed only after the divergence point |
| Cross-book world-rule consistency | Whether the spinoff violates the parent's world rules (power system, geography, factions) |
| Spinoff hook isolation | Whether the spinoff oversteps and resolves parent hooks |

Activated automatically when `parent_canon.md` is detected — no extra configuration needed.

### Style Imitation

Feed in excerpts from a human-written novel; the system extracts a statistical fingerprint + generates a style guide, automatically injected into the writer prompt for every subsequent chapter.

```bash
inkos style analyze 参考小说.txt                     # analyze: sentence length, TTR, rhetorical features
inkos style import 参考小说.txt 吞天魔帝 --name 某作者  # import the style into a book
```

Two files are produced:
- `style_profile.json` — statistical fingerprint (sentence-length distribution, paragraph length, lexical diversity, rhetorical density)
- `style_guide.md` — an LLM-generated qualitative style guide (rhythm, tone, word preferences, taboos)

The writer reads the style guide for every chapter, and the auditor cross-checks against it in the style dimension.

### Post-Write Validator

11 deterministic rules, zero LLM cost, triggered immediately after each chapter is written:

| Rule | Description |
|------|------|
| Banned sentence pattern | 「不是……而是……」 |
| Banned dash | 「——」 |
| Transition-word density | 仿佛/忽然/竟然 etc., ≤1 occurrence per 3,000 characters |
| High-fatigue words | genre fatigue words, ≤1 occurrence per word per chapter |
| Meta-narrative | screenwriter-style narration |
| Report jargon | analysis-framework terms must not enter prose |
| Authorial preaching | 显然/不言而喻 and the like |
| Collective reactions | boilerplate like 「全场震惊」 |
| Consecutive 「了」 | ≥6 consecutive sentences containing 「了」 |
| Overlong paragraphs | ≥2 paragraphs over 300 characters |
| Book-specific taboos | prohibitions from book_rules.md |

When the validator finds an error-level violation, it automatically triggers `spot-fix` mode for a targeted repair, without waiting for the LLM audit.

### Hardened Audit-Revision Loop

Real-world testing found that `rewrite` mode introduced 6x more AI marker words, so now:

- The automatic revision mode changed from `rewrite` to `spot-fix` (only the problem sentences are changed, the rest of the prose untouched)
- After revision, AI marker counts are compared; if the revision actually adds AI traces, it is discarded and the original kept
- Re-audit temperature locked at 0 (removing audit randomness; the same chapter no longer fluctuates between 0 and 6 criticals)
- `polish` mode boundaries hardened (no adding/removing paragraphs, no renaming characters, no new plot)

### Multi-Provider Routing

Different agents can use different API providers — not just different model names, but entirely different API endpoints and keys. For example, the writer can use a cheap model for fast drafting while the auditor uses a strong model for careful review:

```bash
inkos config set-model writer gpt-4o-mini                                    # simple model override
inkos config set-model auditor gemini-2.5-flash \
  --base-url https://generativelanguage.googleapis.com/v1beta/openai \
  --provider openai \
  --api-key-env GEMINI_API_KEY                                                # route through the Gemini API
inkos config set-model reviser claude-sonnet-4-20250514 \
  --base-url https://api.anthropic.com \
  --provider anthropic \
  --api-key-env ANTHROPIC_API_KEY                                             # route through the Anthropic API
inkos config show-models                                                      # view the full routing picture
```

Each agent independently configures `--base-url`, `--provider`, `--api-key-env`, `--no-stream`. Agents without overrides use the project's default model.

### Analytics

```bash
inkos analytics 吞天魔帝          # audit pass rate, most frequent issue categories, chapters with the most issues
inkos analytics 吞天魔帝 --json   # structured output
```

### Other v0.4 Changes

- Audit dimensions expanded from 26 to 33 (+4 spinoff dimensions + dim 27 sensitive words + dim 32 reader-expectation management + dim 33 outline-deviation detection)
- Auditor web search: era-research genres can verify real events/people/geography online (native search capability)
- Scheduler rewritten: AI pacing (one round every 15 minutes by default), parallel book processing, immediate retry, daily caps
- The reviser gains `spot-fix` mode (targeted repair)
- `additionalAuditDimensions` in `book_rules.md` supports Chinese-name matching
- All 5 genres activate dims 24-26 (subplot stagnation / flat arcs / monotonous pacing)
- `inkos export` supports `--format md`, `--output <path>`, `--approved-only`
- The post-write validator's "consecutive 了" threshold raised from 4 sentences to 6 (fewer false positives in Chinese narration)
- Security hardening: overwrite-protection checks for `init`/`book create`/`import chapters`, type inference + key validation for `config set`, downgrade protection for `update`, `doctor` can test the API outside a project, status display consistency, `genre show` rejects invalid IDs

---

## v0.3

Three-layer creative rule separation + cross-chapter memory + AIGC detection + Webhook.

### Cross-Chapter Memory and Writing Quality

The Writer automatically generates a summary for each chapter and updates the subplot/emotion/character matrices, all appended to the truth files. Later chapters load the full context, so long-running hooks are no longer lost.

| Truth file | Purpose |
|----------|------|
| `chapter_summaries.md` | Per-chapter summaries: characters present, key events, state changes, hook dynamics |
| `subplot_board.md` | Subplot progress board: A/B/C line status tracking |
| `emotional_arcs.md` | Emotional arcs: per-character emotions, trigger events, arc direction |
| `character_matrix.md` | Character interaction matrix: encounter records, information boundaries |

### AIGC Detection

| Feature | Description |
|------|------|
| AI-trace audit | Pure rule-based detection (no LLM): equal-length paragraphs, boilerplate density, formulaic transitions, list-style structure, automatically merged into audit results |
| AIGC detection API | External API integration (GPTZero / Originality / custom endpoints), the `inkos detect` command |
| Style fingerprint learning | Extracts a StyleProfile from reference text (sentence length, TTR, rhetorical features), injected into the Writer prompt |
| Anti-detection rewriting | ReviserAgent `anti-detect` mode: detect → rewrite → re-detect loop |
| Detection feedback loop | `detection_history.json` records every detection/rewrite result; `inkos detect --stats` shows statistics |

```bash
inkos style analyze reference.txt         # analyze the reference text's style
inkos style import reference.txt 吞天魔帝  # import the style into a book
inkos detect 吞天魔帝 --all               # whole-book AIGC detection
inkos detect --stats                      # detection statistics
```

### Webhook + Smart Scheduling

Pipeline events are POSTed as JSON to a configured URL (HMAC-SHA256 signed), with event filtering (`chapter-complete`, `audit-failed`, `pipeline-error`, etc.). The daemon gains quality gating: failed audits are retried automatically (with raised temperature), and books with consecutive failures are paused.

### Genre Customization

5 built-in genres, each with a complete set of creative rules: chapter types, taboo lists, fatigue words, iron language rules, audit dimensions.

| Genre | Built-in rules |
|------|----------|
| Xuanhuan | Numerical system, power hierarchy, homogeneous-devour decay formula, face-slap/level-up/reward pacing |
| Xianxia | Cultivation/enlightenment pacing, artifact system, heavenly-dao rules |
| Urban | Era research, business/social-driven plots, era-matched legal terminology, no numerical system |
| Horror | Atmospheric escalation, fear hierarchy, restrained narration, no power audit |
| General | Minimal fallback |

Specify the genre at book creation, and the corresponding rules take effect automatically:

```bash
inkos book create --title "吞天魔帝" --genre xuanhuan
```

Genre rules can be inspected, copied into a project for editing, or created from scratch:

```bash
inkos genre list                      # view all genres
inkos genre show xuanhuan             # view the complete xuanhuan rules
inkos genre copy xuanhuan             # copy into the project; edit freely
inkos genre create wuxia --name 武侠   # create a new genre from scratch
```

After copying into a project, add or remove taboos, adjust fatigue words, change pacing rules, or customize the iron language rules — the changes take effect automatically on the next chapter.

Each genre has its own iron language rules (with ✗→✓ examples), enforced by both the writer and the auditor:

- **Xuanhuan**: ✗ "火元从12缕增加到24缕" → ✓ "手臂比先前有力了，握拳时指骨发紧"
- **Urban**: ✗ "迅速分析了当前的债务状况" → ✓ "把那叠皱巴巴的白条翻了三遍"
- **Horror**: ✗ "感到一阵恐惧" → ✓ "后颈的汗毛一根根立起来"

### Per-Book Rules

Every book has its own `book_rules.md`, generated automatically by the architect agent at book creation and editable by hand at any time. Rules written here are injected into every chapter's prompt:

```yaml
protagonist:
  name: 林烬
  personalityLock: ["强势冷静", "能忍能杀", "有脑子不是疯狗"]
  behavioralConstraints: ["不圣母不留手", "对盟友有温度但不煽情"]
numericalSystemOverrides:
  hardCap: 840000000
  resourceTypes: ["微粒", "血脉浓度", "灵石"]
prohibitions:
  - 主角关键时刻心软
  - 无意义后宫暧昧拖剧情
  - 配角戏份喧宾夺主
fatigueWordsOverride: ["瞳孔骤缩", "不可置信"]   # overrides the genre default
```

Protagonist personality lock, numerical caps, custom prohibitions, fatigue-word overrides — each book's rules are tuned independently without touching the genre template.

### 33-Dimension Audit

The audit is refined into 33 dimensions, with the relevant subset enabled automatically per genre:

OOC checks, timeline, setting conflicts, power-scaling collapse, numerical checks, hooks, pacing, style, information overreach, lexical fatigue, broken benefit chains, era research, side-character dumbing-down, side-character tool-ification, diluted payoff, unrealistic dialogue, event-log prose, knowledge-base contamination, POV consistency, equal-length paragraphs, boilerplate density, formulaic transitions, list-style structure, subplot stagnation, flat arcs, monotonous pacing, sensitive-word checks, parent event conflicts, future information leaks, cross-book world-rule consistency, spinoff hook isolation, reader-expectation management, outline-deviation detection

Dims 20-23 (AI traces) + dim 27 (sensitive words) are detected by the pure rule engine with no LLM calls. Dims 28-31 (spinoff dimensions) activate automatically when `parent_canon.md` is detected. Dim 32 (reader-expectation management) and dim 33 (outline-deviation detection) are always on.

### De-AI-ification

5 universal rules + genre-specific language rules control AI marker-word density and narration habits:

- AI marker-word frequency cap: 仿佛/忽然/竟然/不禁/宛如/猛地, ≤1 occurrence per 3,000 characters
- The narrator does not draw conclusions for the reader; write actions only
- No analysis-report language ("核心动机", "信息落差" must not enter prose)
- The same imagery is not rendered more than twice
- Methodology jargon must not enter prose

Lexical-fatigue audit + AI-trace audit (dims 20-23) provide double detection. Style fingerprint injection further reduces AI text characteristics.

### Other v0.3 Changes

- Supports OpenAI + native Anthropic + all OpenAI-compatible endpoints
- The reviser supports five modes: polish / rewrite / rework / anti-detect / spot-fix
- Genres without a numerical system do not generate a resource ledger
- All commands support `--json` structured output, directly parseable by OpenClaw / external agents
- book-id auto-detection: the book-id can be omitted when the project has only one book
- `inkos update` for one-command updates, `inkos init` supports initializing the current directory
- API errors come with Chinese diagnostic hints, and `inkos doctor` includes an API connectivity test
