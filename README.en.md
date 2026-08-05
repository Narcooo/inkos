<p align="center">
  <img src="assets/logo.svg" width="120" height="120" alt="InkOS Logo">
  <img src="assets/inkos-text.svg" width="240" height="65" alt="InkOS">
</p>

<h1 align="center">Story Creation AI Agent<br><sub>Creation system for long-form and short fiction, scripts, interactive film/games, IP content, and multilingual translation</sub></h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@actalk/inkos"><img src="https://img.shields.io/npm/v/@actalk/inkos.svg?color=cb3837&logo=npm" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue.svg" alt="License: AGPL-3.0"></a>
  <a href="https://github.com/Narcooo/inkos/stargazers"><img src="https://img.shields.io/github/stars/Narcooo/inkos?style=flat&logo=github&color=yellow" alt="GitHub stars"></a>
  <a href="https://www.npmjs.com/package/@actalk/inkos"><img src="https://img.shields.io/npm/dm/@actalk/inkos?color=cb3837&logo=npm&label=downloads" alt="npm downloads"></a>
  <a href="https://clawhub.ai/narcooo/inkos"><img src="https://img.shields.io/badge/🦞%20ClawHub-Skill-FF6B35?labelColor=1a1a1a" alt="ClawHub Skill"></a>
</p>

<p align="center">
  <a href="README.md">中文</a> | English | <a href="README.ja.md">日本語</a>
</p>

---

InkOS is an AI Agent system for story creation and multilingual translation: long-form novels, standalone short fiction, scripts, storyboards, fan fiction, spinoffs, style imitation, continuation, interactive film projects, interactive worlds, and long-document translation all start from the same workbench. Studio Chat, CLI, and TUI share the same action surface for discussion, confirmed actions, generation, review, persistent editing, and cross-language delivery.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://kimi-file.moonshot.cn/prod-chat-kimi/kfs/4/1/2026-06-05/1d8h69mt3v89kkekg24gg">
    <img alt="Kimi Open Source Friends" width="760" src="https://kimi-file.moonshot.cn/prod-chat-kimi/kfs/4/1/2026-06-05/1d8h69fudcmosb3pipls0">
  </picture>
</p>

<p align="center">
  <a href="https://www.kimi.com/code/?aff=inkos"><img src="https://gcdn.moonshot.cn/growth-cdn/sponsor/kimi-en.png" width="900" alt="Kimi sponsors InkOS"></a>
</p>

Thanks to [Kimi](https://www.kimi.com/code/?aff=inkos) for sponsoring this project! [Kimi K3](https://www.kimi.com/blog/kimi-k3) is Moonshot AI's most capable model and the world's first open 3T-class model, featuring native vision and a 1-million-token context window. With InkOS, K3 can assist with planning, drafting, reviewing, and revising novels, scripts, interactive stories, and multilingual content, while InkOS manages characters, worldbuilding, plot threads, and persistent story state to keep long-form creation coherent and controllable.

**InkOS Studio already supports Moonshot (Kimi). Get an API key from the Kimi Open Platform ([中文站](https://platform.kimi.com/?aff=inkos) | [Global](https://platform.kimi.ai/?aff=inkos)) and start creating.**

> 💡 **One key for global frontier models** — pair InkOS with [**kkaiapi**](https://en.kkaiapi.com/): an OpenAI-compatible gateway for Claude, GPT, Gemini, DeepSeek, Kimi, Qwen, GLM, and image models. Add it as a custom service with base URL `https://api.kkaiapi.com/v1`, then switch models in Studio without juggling multiple provider accounts.

## v1.7 Multilingual Creation, Narrative Forecasts, and Non-Blocking Collaboration

InkOS 1.7 brings cross-language delivery, long-form forecasting, and continuous collaboration into the same Agent workbench. Translate complete works, compare several non-canonical futures, keep chatting while production runs in the background, or ask Chat to read references, import an existing manuscript, adjust prompts, revise chapters, and safely recover the creative state.

- **Model setup** — Studio includes provider settings, model routing, cover-service settings, [kkaiapi](https://en.kkaiapi.com/) / OpenRouter aggregator entries, and custom OpenAI-compatible endpoints.
- **Narrative forecasts**: Studio Chat and the CLI can create, re-check, and select 2-5 isolated futures from current canon, comparing chapter beats, character decisions, projected changes, risks, and author-intent alignment. Selecting one saves a plan only; it does not pre-emptively alter prose, foundations, or story state.
- **Complete translation workbench**: import EPUB, text-based PDF, TXT, and Markdown; translate by chapter and semantic segment; maintain a glossary, generate side-by-side review reports, and export TXT, Markdown, or EPUB. Studio, Chat, and `inkos translate init / run / export` share the same capability.
- **Native cross-language creation**: short fiction, scripts, storyboards, and interactive-film pipelines now include English-native prompt paths, with matching Studio copy and CLI language fallback rather than a translation-only menu.
- **Attachments, material library, and editable prompts**: Chat can read text, Markdown, and images; archive and retrieve external references with evidence traces; and inspect or adjust long-form, Play, and interactive-film prompt packs in Studio.
- **Existing works become real projects**: import chapters from local files, directories, or attachments, reverse-engineer foundation files, and replay chapter state instead of treating a manuscript as temporary context.
- **Keep chatting while InkOS writes**: production runs in the background while conversation remains available. Tasks can be aborted, failed messages retried, and accurate progress, terminal state, and complete tool cards restored after refresh or restart.
- **Controllable review, revision, and continuous writing**: strict, lenient, and always revision gates support project- and book-level overrides, with automatic or manual review per book. The CLI adds `inkos auto` and completion/failure notifications, while rejected revisions show before/after metrics and unresolved issues.
- **Safer creative data and concurrency**: whole-book backup / restore, latest-chapter deletion with state rollback, and synchronized chapter-index counts after patch edits. Stale locks recover, concurrent writes return `BOOK_BUSY`, and completion is grounded only in actual tool results and files.
- **More reliable models, installation, and cross-platform behavior**: the built-in MiniMax integration separates reasoning from prose by default; dynamic services such as OpenRouter and kkaiapi are not blocked by a static model list; npm packages no longer leak `workspace:*` dependencies; action details, notifications, and project paths are more consistent across platforms.

## v1.6.0 Major Update

v1.6.0 expands InkOS from open-world play into interactive-film authoring, scripts, storyboards, Agent Skills, and traceable research:

- **Interactive film/games**: create branching story graphs, choices, variables/flags, relationship state, endings, node images, and exportable interactive project packages.
- **Agent Skills**: standard `SKILL.md` packages provide professional guidance and static references. The Chat Agent can invoke a skill from the user's intent, or the user can force one with `@skill-id`.
- **Traceable web research**: `research_web` creates sourced Markdown reports for worldbuilding, era/profession details, markets, and fact checks. Reports are references only and do not mutate canon or prose by themselves.
- **Script and storyboard authoring**: Studio Chat can propose script, storyboard, and interactive-film creation actions, confirm them, then save artifacts that can be inspected in Studio.
- **Reliability fixes**: targeted chapter edits can survive minor model paraphrases; failed multi-chapter audits no longer erase existing chapter indexes; model/provider switching keeps the active book binding.

This release continues the v1.5 direction: heavy actions are confirmable, completion is derived from tool results and files, and story context is governed instead of blindly stuffing every file into the model.

<p align="center">
  <img src="assets/interactive-film-e2e.png" width="900" alt="InkOS interactive-film story graph E2E screenshot">
</p>

<p align="center">
  <img src="assets/inkos-short-demo-cover.png" width="210" alt="InkOS Short cover example">
  <img src="assets/play-openworld-warcraft.png" width="210" alt="InkOS Play fantasy open-world example">
  <img src="assets/play-openworld-romance.png" width="210" alt="InkOS Play romance example">
  <img src="assets/play-openworld-detective.png" width="210" alt="InkOS Play detective example">
</p>

**Long-form novels** — create from a brief, generate foundations, chapter intent, context packages, prose, review, revision, and state settlement. Context is governed with protected / compressible layers so long books remain steerable.

**Narrative forecast** — before writing the next chapter, generate 2-5 isolated future branches from current canon and compare their chapter beats, character decisions, projected changes, risks, and author-intent alignment directly in Studio Chat. Selecting a branch writes only `selected-branch-plan.md`; it does not change prose, outlines, or canonical state. Forecasts are marked stale when canon changes.

**InkOS Short** — Studio chat and CLI can create a complete standalone short-fiction package: full manuscript, outline records, review records, synopsis, selling points, cover prompt, and an optional cover image when a cover provider is configured.

**InkOS Play** — build open worlds or branching interactive fiction from natural-language world contracts: time flow, character agents, inventory, evidence, relationships, scene state, visual rules, guided choices, free actions, and optional image generation.

**Interactive film/games** — turn an idea, script, or prose reference into branching scenes, variables, endings, image prompts, node images, and an exportable project package.

**Studio Chat** — a persistent chat surface for answering questions, proposing actions, creating books, launching Short / Play, generating covers, and editing text artifacts without pretending an action succeeded before the tool result exists.

**Agent Skills and research** — add standard `SKILL.md` packages under `.agents/skills/` or another AgentSkills directory, force them with `@skill-id`, or ask for web research to generate a sourced Markdown report.

<p align="center">
  <img src="assets/play-item-warcraft.png" width="420" alt="InkOS Play item image example">
</p>

**Native English novel writing now supported！** — 10 built-in English genre profiles with dedicated pacing rules, fatigue word lists, and audit dimensions. Set `--lang en` and go.

## Quick Start

### Install

```bash
npm i -g @actalk/inkos
```

### Use via OpenClaw 🦞

InkOS is published as an [OpenClaw](https://clawhub.ai/narcooo/inkos) Skill, callable by any compatible agent (Claude Code, OpenClaw, etc.):

```bash
clawhub install inkos          # Install from ClawHub
```

If you installed via npm or cloned the repo, `skills/SKILL.md` is already included — 🦞 can read it directly without a separate ClawHub install.

Once installed, Claw should prefer the shared interaction entry:

```bash
inkos interact --json --message "continue the current book, but keep the pacing tighter"
```

This routes through the same conversation executor used by the project TUI, so OpenClaw, TUI, and Studio stay on the same control brain. The current JSON output includes assistant response text and the interaction session; real completion should still be derived from tool results and files, not from prose claims.

Atomic commands (`plan chapter` / `compose chapter` / `draft` / `audit` / `revise` / `write next`) are still available, but they are now lower-level tools rather than the preferred OpenClaw entry. You can also browse it on [ClawHub](https://clawhub.ai) by searching `inkos`.

### Agent Skills

InkOS uses the standard `SKILL.md` format directly and no longer maintains a separate InkOS-specific skill protocol. A skill gives the Chat Agent professional guidance and static references, but no extra execution authority. Creating, writing, editing, and image generation still go through InkOS tools and confirmation gates.

How to use them:

- Use standard AgentSkills / OpenClaw locations: project `skills/` and `.agents/skills/`, plus `~/.agents/skills/` and `~/.openclaw/skills/`. Studio can import a complete folder containing `SKILL.md` and its static references; project imports are saved under `.agents/skills/`.
- Or set `INKOS_SKILL_DIRS=/abs/path/to/skills`; the path may point to one skill directory or a directory containing multiple skill subdirectories. Use the platform path delimiter for multiple paths.
- Force one for a turn with `@skill-id`, for example: `@detective-play create an evidence-chain open world`.
- Without `@skill-id`, the Chat Agent decides from the user's current intent whether to call `use_skill`. Session kinds, trigger phrases, and substring matching no longer activate skills.
- External skills provide instructions and static references only. InkOS never auto-executes their scripts, and a skill cannot bypass existing tool permissions or confirmation gates.
- Prompt configuration is not a skill. Built-in prompt packs are edited separately in **Project Settings → Prompt packs**, with project overrides under `prompt/<pack>/<prompt>.md`.

Minimal `SKILL.md`:

```md
---
name: Detective Play
description: Detective evidence and suspect-board play.
---
Use evidence chains; do not turn clues into generic atmosphere.
```

### Configure

InkOS now separates two configuration paths: **Studio uses visual service settings**, while **CLI / daemon / deployment can still use env overrides**. They do not silently overwrite each other.

**Option 1: Studio service settings (recommended for local writing)**

```bash
inkos init my-novel
cd my-novel
inkos
```

Open Studio, then go to **Model Settings**:

1. Choose a service such as Google Gemini, Moonshot, MiniMax, DeepSeek, kkaiapi, OpenRouter, or a custom endpoint.
2. Paste the API key and test the connection.
3. Pick an available model and save.
4. Return to Studio Chat or your book page.

Studio uses project service settings and `.inkos/secrets.json`. It may show env-detection hints, but env files do not override the Studio-selected service/model/base URL/API key.

MiniMax uses the official OpenAI-compatible `/v1/chat/completions` endpoint. InkOS disables returned thinking by default for `MiniMax-M3*`; M2.x thinking cannot be disabled by the upstream service.

**Option 2: CLI / daemon / deployment env config**

```bash
inkos config set-global \
  --lang en \
  --provider <openai|anthropic|custom> \
  --base-url <API endpoint> \
  --api-key <your API key> \
  --model <model name>

# provider: openai / anthropic / custom (use custom for OpenAI-compatible proxies)
# base-url: your API provider URL
# api-key: your API key
# model: your model name
```

`--lang en` sets English as the default writing language for CLI / daemon runs. Saved to `~/.inkos/.env`.

You can also edit global `~/.inkos/.env` or project `.env` manually:

```bash
# Required
INKOS_LLM_PROVIDER=                               # openai / anthropic / custom (use custom for any OpenAI-compatible API)
INKOS_LLM_BASE_URL=                               # API endpoint
INKOS_LLM_API_KEY=                                 # API Key
INKOS_LLM_MODEL=                                   # Model name

# Language (defaults to global setting or genre default)
# INKOS_DEFAULT_LANGUAGE=en                        # en or zh

# Optional
# INKOS_LLM_TEMPERATURE=0.7                       # Temperature
# INKOS_LLM_THINKING_BUDGET=0                      # Anthropic extended thinking budget
```

CLI resolution starts from Studio/project service settings, then layers service secrets, global env, project env, process env, and CLI flags. That means CLI can reuse the service you configured in Studio, while env and command-line flags remain explicit overrides.

**Option 3: Multi-model routing (optional)**

Assign different models to different agents — balance quality and cost:

```bash
# Assign different models/providers to different agents
inkos config set-model writer <model> --provider <provider> --base-url <url> --api-key-env <ENV_VAR>
inkos config set-model auditor <model> --provider <provider>
inkos config show-models        # View current routing
```

Agents without explicit overrides fall back to the global model.

**Configuration troubleshooting**

```bash
inkos doctor
```

`doctor` prints the current effective config mode, where the service / model / API key come from, and runs an API connectivity check. Common modes:

| Mode | Meaning |
|------|---------|
| `studio-project` | Studio runtime: only Studio/project settings and secrets are used |
| `cli-project` | CLI runtime: Studio settings as the base, with env and CLI flags layered on top |
| `legacy-env` | Legacy env mode: compatibility with old `.env`-only projects |

If a service test fails, first check that the service, model, and protocol match each other. Google Gemini AI Studio API keys work with the Gemini OpenAI-compatible endpoint; InkOS automatically disables the OpenAI `store` parameter that Google does not support. MiniMax defaults to the official OpenAI-compatible `/v1/chat/completions` endpoint and prefers a working non-streaming transport, avoiding streams that return usage but no text; `MiniMax-M3*` disables returned thinking by default, while M2.x thinking cannot be disabled upstream.

### LLM Configuration Notes

- **Studio / CLI config isolation**: Studio always uses the service page settings and `.inkos/secrets.json`; the CLI, daemon, and deployment environments support env overrides and one-off command flags.
- **Provider bank capability table**: built-in baseUrl, protocol, models, and compatibility policies for 15 services — Google Gemini, Moonshot, MiniMax, Zhipu (GLM), Bailian (Alibaba Cloud Model Studio), DeepSeek, SiliconFlow, Volcengine, Tencent Hunyuan, Baidu ERNIE (Wenxin), iFlytek Spark, OpenRouter, kkaiapi, Ollama, and CodingPlan.
- **Model ownership validation**: mismatches like `--service google --model kimi-k2.5` fail immediately, so requests are never sent to the wrong provider.
- **Google Gemini compatibility fix**: AI Studio API keys work directly with the Gemini OpenAI-compatible endpoint; InkOS automatically disables the OpenAI `store` parameter Google does not support.
- **MiniMax transport probing**: MiniMax / MiniMax CodingPlan use the official OpenAI-compatible `/v1` entry and automatically pick a working non-streaming transport, working around streams that report usage but return an empty body.
- **Legacy env compatibility**: the old `INKOS_LLM_BASE_URL + INKOS_LLM_MODEL + INKOS_LLM_API_KEY` combination still works for the CLI; without `INKOS_LLM_SERVICE`, InkOS tries to infer the service from the baseUrl.

### Current Interaction Entry Points

**Studio Chat + CLI + TUI share the same execution surface**

- **Studio Chat**: discuss, create books, run Short, generate covers, launch Play, and edit persistent files from one chat surface; heavy actions show confirmation cards.
- **Creation entries**: Long-form Novel, Short Fiction, Fan Fiction, Spinoff, Style Imitation, Continuation, Branching Interactive, and Open World are available as first-class Studio entries.
- **TUI dashboard**: `inkos tui` opens the terminal full-screen interaction mode for keyboard-first users.
- **External agent entry**: `inkos interact --json --message "..."` remains the structured entry for OpenClaw and other agents.
- **Atomic commands remain**: `plan` / `compose` / `draft` / `audit` / `revise` / `write next` still work for scripting and advanced usage.

### Write Your First Book

English is the default for English genre profiles. Pick a genre and go:

```bash
inkos book create --title "The Last Delver" --genre litrpg     # LitRPG novel (English by default)
inkos write next my-book          # Write next chapter (full pipeline: draft → audit → revise)
inkos status                      # Check status
inkos review list my-book         # Review drafts
inkos review approve-all my-book  # Batch approve
inkos export my-book --format epub  # Export EPUB (read on phone/Kindle)
```

Language is set per-genre by default. Override explicitly with `--lang en` or `--lang zh`. Use `inkos genre list` to see all available genres and their default languages.

### Write Complete Short Fiction

In Studio chat, ask for a complete short-fiction deliverable:

```text
Write a 12-chapter short fiction piece about a modern marriage reversal where the heroine wins with hard evidence.
```

Or run it from the CLI:

```bash
inkos short run \
  --direction "modern short fiction marriage reversal evidence-driven heroine" \
  --chapters 12 \
  --chars 1000
```

Outputs are saved under `shorts/<story-name>/final/`, including `full.md`, `sales-package.md`, `cover-prompt.md`, and `cover.png` when cover generation is configured.

### Generate a Standalone Cover

To generate only a cover for an existing title or synopsis, do not rerun the short-fiction pipeline. Ask Studio chat directly:

```text
Generate a short-fiction cover for "The Divorce Papers He Regretted", modern city, high-drama reversal.
```

The cover tool writes `covers/<title>/cover-prompt.md` and `covers/<title>/cover.png`. If no cover provider is configured yet, set the cover provider and API key in Studio model settings first.

After generation, you can keep editing the cover prompt through chat, for example: "move the character closer, make the title text bigger, and give her a colder smile." InkOS will pass the revised direction as `coverPrompt`, rewrite `cover-prompt.md`, and regenerate the cover without rewriting the story.

<p align="center">
  <img src="assets/inkos-short-demo-cover.png" width="260" alt="InkOS Short cover example">
  <img src="assets/play-openworld-warcraft.png" width="260" alt="InkOS Play open-world example">
  <img src="assets/play-openworld-detective.png" width="260" alt="InkOS Play detective example">
</p>

### Launch an Open World or Branching Story

In Studio Chat, choose **Open World** or **Branching Interactive**, then describe the world in natural language:

```text
Create a Warcraft-like border watchtower open world. Time is not fixed per turn: patrols take an hour, training can take several days. Equipment has rarity, but no stat sheet; show rarity through material, glow, and atmosphere.
```

InkOS creates the world, characters, items, evidence, relationships, current scene, and suggested actions. Open World supports free-form actions; Branching Interactive provides clickable choices. When image generation is configured, characters, items, evidence, and scenes can render images directly inside the chat stream.

---

## English Genre Profiles

InkOS ships with 10 English-native genre profiles. Each includes genre-specific rules, pacing, fatigue word detection, and audit dimensions:

| Genre | Key Mechanics |
|-------|--------------|
| **LitRPG** | Numerical system, power scaling, stat progression |
| **Progression Fantasy** | Power scaling, no numerical system required |
| **Isekai** | Era research, world contrast, cultural fish-out-of-water |
| **Cultivation** | Power scaling, realm progression |
| **System Apocalypse** | Numerical system, survival mechanics |
| **Dungeon Core** | Numerical system, power scaling, territory management |
| **Romantasy** | Emotional arcs, dual POV pacing |
| **Sci-Fi** | Era research, tech consistency |
| **Tower Climber** | Numerical system, floor progression |
| **Cozy Fantasy** | Low-stakes pacing, comfort-first tone |

Also supports 5 Chinese web novel genres (xuanhuan, xianxia, urban, horror, other) for bilingual creators.

Every genre includes a **fatigue word list** (e.g., "delve", "tapestry", "testament", "intricate", "pivotal" for LitRPG) — the auditor flags these automatically so your prose doesn't read like every other AI-generated novel.

---

## Key Features

### Studio Chat + Action Surface

Studio Chat is not just a Q&A box. It can create long-form books, run Short, generate covers, launch Play, edit persistent text artifacts, and ask for confirmation before heavy actions. Plain discussion remains plain text; explicit creation requests become tool actions.

### InkOS Play: Open Worlds and Branching Interaction

Play maintains a durable interactive world state: characters, locations, items, evidence, relationships, time, current scene, HUD, and images. It is not a hard-coded RPG system. A cultivation world may use rarity and realms; a romance story may use emotional stages; a detective story may use evidence lifecycle and credibility. The rules come from the user's world contract and stay in the world state.

### 37-Dimension Audit + De-AI-ification

The Continuity Auditor agent checks every draft across 37 dimensions: character memory, resource continuity, hook payoff, outline adherence, narrative pacing, emotional arcs, and more. Built-in AI-tell detection automatically catches "LLM voice" — overused words, monotonous sentence patterns, excessive summarization. The default long-form write cycle now runs at most one automatic revision pass; unresolved critical findings are kept in the result for human review or later commands.

De-AI-ification rules are baked into the Writer agent's prompts: fatigue word lists, banned patterns, style fingerprint injection — reducing AI traces at the source. `revise --mode anti-detect` runs dedicated anti-detection rewriting on existing chapters.

### Style Cloning

`inkos style analyze` examines reference text and extracts a statistical fingerprint (sentence length distribution, word frequency patterns, rhythm profiles) plus an LLM-readable style guide. `inkos style import` injects this fingerprint into a book — all future chapters adopt the style, and the Reviser audits against it.

### Creative Brief

`inkos book create --brief my-ideas.md` — pass your brainstorming notes, worldbuilding doc, or character sheets. The Architect agent builds from your brief (generating `story_bible.md` and `book_rules.md`) instead of inventing from scratch, and persists the brief into `story/author_intent.md` so the book's long-horizon intent does not disappear after initialization.

### Input Governance Control Surface

Every book now has two long-lived Markdown control docs:

- `story/author_intent.md`: what this book should become over the long horizon
- `story/current_focus.md`: what the next 1-3 chapters should pull attention back toward

Before writing, you can run:

```bash
inkos plan chapter my-book --context "Pull attention back to the mentor conflict first"
inkos compose chapter my-book
```

This generates `story/runtime/chapter-XXXX.intent.md`, `context.json`, `rule-stack.yaml`, and `trace.json`. `intent.md` is the human-readable contract; the others are execution/debug artifacts. `plan` calls the LLM to produce the chapter intent; `compose` only compiles local documents and state, so it can run before you finish API key setup.

### Length Governance

`draft`, `write next`, and `revise` now share the same conservative length governor:

- `--words` sets a target band, not an exact hard promise
- Chinese chapters default to `zh_chars`; English chapters default to `en_words`
- If the chapter drifts outside the soft band, InkOS may run one corrective normalization pass (compress or expand) instead of hard-cutting prose
- If the chapter still misses the hard range after that one pass, InkOS still saves it, but surfaces a visible length warning and telemetry in the result and chapter index

### Continuation Writing

`inkos import chapters` imports existing novel text and rebuilds structured state, chapter summaries, hooks, character relationships, and readable Markdown projections. It supports `Chapter N`, custom split patterns, and resumable import. After import, `inkos write next` can continue the story.

### Fan Fiction

`inkos fanfic init --from source.txt --mode canon` creates a fanfic book from source material. Four modes: canon (faithful continuation), au (alternate universe), ooc (out of character), cp (ship-focused). Includes a canon importer, fanfic-specific audit dimensions, and information boundary controls to keep lore consistent.

### Multi-Model Routing

Different agents can use different models and providers. Writer on Claude (stronger creative), Auditor on GPT-4o (cheaper and fast), Radar on a local model (zero cost). `inkos config set-model` configures per-agent; unconfigured agents fall back to the global model.

### Daemon Mode + Notifications

`inkos up` starts an autonomous background loop that writes chapters on a schedule. The pipeline continues through handleable non-critical issues, pausing with reviewable results when human judgment is needed. Notifications via Telegram, Feishu (Lark), WeCom (Enterprise WeChat), and Webhook (HMAC-SHA256 signing + event filtering). Logs to `inkos.log` (JSON Lines), `-q` for quiet mode.

### Local Model Compatibility

Supports any OpenAI-compatible endpoint (`--provider custom`). Stream auto-fallback — when SSE isn't supported, InkOS retries with sync mode automatically. Fallback parser handles non-standard output from smaller models, and partial content recovery kicks in on stream interruption.

### Reliability

Every chapter creates an automatic state snapshot — `inkos write rewrite` rolls back any chapter to its pre-write state. The Writer outputs a pre-write checklist (context scope, resources, pending hooks, risks) and a post-write settlement table; the Auditor cross-validates both. File locking prevents concurrent writes. Post-write validator includes cross-chapter repetition detection and a dozen hard rules with auto spot-fix.

The hook system uses Zod schema validation — `lastAdvancedChapter` must be an integer, `status` can only be open/progressing/deferred/resolved. JSON deltas from the LLM are processed through `applyRuntimeStateDelta` (immutable update) and `validateRuntimeState` (structural check) before persistence. Corrupted data is rejected, not propagated.

Model output limits are managed by provider model cards in the provider bank. Reserved keys in `llm.extra` (max_tokens, temperature, model, messages, stream, etc.) are stripped to prevent accidental overrides of core request parameters.

---

## How It Works

InkOS now has two main runtime tracks: long-form / short-form production for deliverable text, and Play for persistent interactive worlds. They share Studio Chat, model configuration, action confirmation, artifact preview, and provider handling, but their state models are different.

<p align="center">
  <img src="assets/arch-system.svg" width="900" alt="System architecture">
</p>

Long-form chapters are produced by multiple agents in sequence:

<p align="center">
  <img src="assets/arch-pipeline.svg" width="900" alt="Chapter pipeline">
</p>

| Agent | Responsibility |
|-------|---------------|
| **Radar** | Scans platform trends and reader preferences to inform story direction (pluggable, skippable) |
| **Planner** | Reads author intent + current focus + memory retrieval results, produces chapter intent (must-keep / must-avoid) |
| **Composer** | Selects task-relevant context from structured state, control docs, and Markdown projections, then compiles rule stack and runtime artifacts |
| **Architect** | Generates foundation files during book creation, import, or spinoff setup: story frame, rules, characters, and long-horizon control files |
| **Writer** | Produces prose from the composed context (length-governed, dialogue-driven) |
| **Observer** | Over-extracts 9 categories of facts from the chapter text (characters, locations, resources, relationships, emotions, information, hooks, time, physical state) |
| **Reflector** | Outputs a JSON delta (not full markdown); code-layer applies Zod schema validation then immutable write |
| **Normalizer** | Single-pass compress/expand only when the chapter clearly leaves the hard length range |
| **Continuity Auditor** | Validates the draft against structured state, control docs, and chapter context |
| **Reviser** | Fixes critical issues found by the auditor; the default write cycle runs at most one automatic revision pass and flags the rest for human review |

If the audit fails, the default pipeline runs one revise → re-audit pass. Remaining issues are preserved in the result and state for human review or later commands.

### Long-Term Memory

Each book's canonical memory is split into three layers:

| Layer | Purpose |
|-------|---------|
| `story/state/*.json` | Authoritative structured state: current state, hooks, chapter summaries, and related runtime data, validated with Zod schemas |
| `story/*.md` | Human-readable projections such as `current_state.md`, `pending_hooks.md`, `chapter_summaries.md`, and `character_matrix.md` |
| `story/memory.db` | SQLite temporal memory on Node 22+, used for relevance-based retrieval of facts, hooks, and summaries |

The Continuity Auditor checks drafts against this state. If a character "remembers" something they never witnessed, or pulls a weapon they lost two chapters ago, the auditor catches it.

The Settler no longer asks the model to output full markdown files. It produces a JSON delta, and the code layer applies and validates it immutably before persistence. Markdown remains as a readable projection. Existing books migrate from legacy Markdown on first run.

On Node 22+, a SQLite temporal memory database (`story/memory.db`) is automatically enabled, supporting relevance-based retrieval of historical facts, hooks, and chapter summaries — preventing context bloat from full-file injection.

<p align="center">
  <img src="assets/arch-memory.svg" width="900" alt="Memory and state">
</p>

### Control Surface and Runtime Artifacts

Alongside runtime state, InkOS splits guardrails from customization into reviewable control docs:

- `story/author_intent.md`: long-horizon author intent
- `story/current_focus.md`: near-term steering
- `story/runtime/chapter-XXXX.intent.md`: chapter goal, keep/avoid list, conflict resolution
- `story/runtime/chapter-XXXX.context.json`: the actual context selected for this chapter
- `story/runtime/chapter-XXXX.rule-stack.yaml`: priority layers and override relationships
- `story/runtime/chapter-XXXX.trace.json`: compilation trace for this chapter

That means briefs, outline nodes, book rules, and current requests are no longer mashed into one prompt blob; InkOS compiles them first, then writes.

### Writing Rule System

The Writer agent has ~25 universal writing rules (character craft, narrative technique, logical consistency, language constraints, de-AI-ification), applicable to all genres.

On top of that, each genre has dedicated rules (prohibitions, language constraints, pacing, audit dimensions), and each book has its own `book_rules.md` (protagonist personality, numerical caps, custom prohibitions), `story_bible.md` (worldbuilding), `author_intent.md` (long-horizon direction), and `current_focus.md` (near-term steering). `volume_outline.md` still acts as the default plan, but in v2 input governance it no longer automatically overrides the current chapter intent.

## Usage Modes

InkOS provides four interaction modes, all sharing the same atomic operations:

### 1. Full Pipeline (One Command)

```bash
inkos write next my-book              # Draft → audit → auto-revise, all in one
inkos write next my-book --count 5    # Write 5 chapters in sequence
```

`write next` now uses the `plan -> compose -> write` governance chain by default. If you need the older prompt-assembly path, set this explicitly in `inkos.json`:

```json
{
  "inputGovernanceMode": "legacy"
}
```

The default is now `v2`. `legacy` remains available as an explicit fallback.

### 2. Atomic Commands (Composable, External Agent Friendly)

```bash
inkos plan chapter my-book --context "Focus on the mentor conflict first" --json
inkos compose chapter my-book --json
inkos draft my-book --context "Focus on the dungeon boss encounter and party dynamics" --json
inkos audit my-book 31 --json
inkos revise my-book 31 --json
```

Each command performs a single operation independently. `--json` outputs structured data. `plan` / `compose` govern inputs; `draft` / `audit` / `revise` handle prose and quality checks. They can be called by external AI agents via `exec`, or used in scripts.

### 3. Natural Language Agent Mode

```bash
inkos agent "Write a LitRPG novel where the MC is a healer class in a dungeon world"
inkos agent "Write the next chapter, focus on the boss fight and loot distribution"
inkos agent "Create a progression fantasy about a mage who can only use one spell"
```

Agent mode exposes tools according to the current session kind: book creation, control-surface edits, planning, composition, writing, audit, revision, Short, cover, and Play tools are only made available where they make sense. The recommended agent flow is: adjust the control surface first, then `plan` / `compose`, then choose draft-only or full-pipeline writing.

### 4. Studio Play Mode

Studio's **Open World** and **Branching Interactive** entries launch interactive creation without first creating a book. Describe how the world runs, how time advances, whether characters act as agents, and how items/evidence matter. InkOS writes the result back to a local world state so the session can continue.

## Studio Screenshots and Run Outputs

<p align="center">
  <img src="assets/studio-dashboard.png" width="760" alt="InkOS Studio creation entry screenshot">
</p>

<p align="center">
  <img src="assets/inkos-short-demo-cover.png" width="230" alt="Short-fiction cover output">
  <img src="assets/play-openworld-romance.png" width="230" alt="Romance interactive-world output">
  <img src="assets/play-openworld-detective.png" width="230" alt="Detective interactive-world output">
  <img src="assets/play-item-warcraft.png" width="230" alt="Interactive-world item image output">
</p>

The first image is a local Studio screenshot. The other images are real local outputs from InkOS Short and InkOS Play: mobile-first short-fiction covers, open-world scenes, detective evidence visuals, and item imagery.

## CLI Reference

| Command | Description |
|---------|-------------|
| `inkos init [name]` | Initialize project (omit name to init current directory) |
| `inkos book create` | Create a new book (`--genre`, `--chapter-words`, `--target-chapters`, `--brief <file>`, `--lang en/zh`) |
| `inkos book update [id]` | Update book settings (`--chapter-words`, `--target-chapters`, `--status`, `--lang`) |
| `inkos book list` | List all books |
| `inkos book delete <id>` | Delete a book and all its data (`--force` to skip confirmation) |
| `inkos genre list/show/copy/create` | View, copy, or create genres |
| `inkos plan chapter [id]` | Generate the next chapter's `intent.md` (`--context` / `--context-file` for current steering) |
| `inkos compose chapter [id]` | Generate the next chapter's `context.json`, `rule-stack.yaml`, and `trace.json` |
| `inkos write next [id]` | Full pipeline: write next chapter (`--words` to override, `--count` for batch, `-q` quiet mode) |
| `inkos write rewrite [id] <n>` | Rewrite chapter N (restores state snapshot, `--force` to skip confirmation) |
| `inkos draft [id]` | Write draft only (`--words` to override word count, `-q` quiet mode) |
| `inkos audit [id] [n]` | Audit a specific chapter |
| `inkos revise [id] [n]` | Revise a specific chapter |
| `inkos agent <instruction>` | Natural language agent mode |
| `inkos review list [id]` | Review drafts |
| `inkos review approve-all [id]` | Batch approve |
| `inkos status [id]` | Project status |
| `inkos export [id]` | Export book (`--format txt/md/epub`, `--output <path>`, `--approved-only`) |
| `inkos radar scan` | Scan market / trend inputs for new-book direction |
| `inkos fanfic init` | Create a fanfic book from source material (`--from`, `--mode canon/au/ooc/cp`) |
| `inkos short run` | Generate a standalone short-fiction package |
| `inkos eval [id]` | Generate a quality evaluation report (`--json`, chapter ranges) |
| `inkos consolidate [id]` | Consolidate chapter summaries for long-book context control |
| `inkos forecast create/show/select` | Create, re-check, and select non-canonical long-form branches; selection saves a candidate plan only |
| `inkos interact` | External-agent / CLI natural-language entry (`--json`, `--message`, `--book`) |
| `inkos config set-global` | Set the global CLI / daemon / deployment LLM env config (`~/.inkos/.env`) |
| `inkos config show-global` | Show the global config |
| `inkos config set/show` | View or update project configuration |
| `inkos config set-model <agent> <model>` | Per-agent model override (`--base-url`, `--provider`, `--api-key-env`) |
| `inkos config remove-model <agent>` | Remove a per-agent model override (fall back to the default) |
| `inkos config show-models` | Show current model routing |
| `inkos doctor` | Diagnose setup issues (API connectivity test + provider compatibility hints) |
| `inkos detect [id] [n]` | AIGC detection (`--all` for all chapters, `--stats` for statistics) |
| `inkos style analyze <file>` | Analyze reference text to extract style fingerprint |
| `inkos style import <file> [id]` | Import style fingerprint into a book |
| `inkos import canon [id] --from <parent>` | Import parent canon into a spinoff book |
| `inkos import chapters [id] --from <path>` | Import existing chapters for continuation (`--split`, `--resume-from`) |
| `inkos analytics [id]` / `inkos stats [id]` | Book analytics (audit pass rate, top issues, chapter ranking, token usage) |
| `inkos update` | Update to the latest version |
| `inkos` / `inkos studio` | Start web workbench (`-p` for port, default 4567) |
| `inkos tui` | Start terminal full-screen TUI |
| `inkos up / down` | Start/stop daemon (`-q` quiet mode, auto-writes `inkos.log`) |

`[id]` is auto-detected when the project has only one book. All commands support `--json` for structured output. `draft` / `write next` / `plan chapter` / `compose chapter` accept `--context` for steering, and `--words` overrides the target chapter size. `book create` supports `--brief <file>` to pass a creative brief — the Architect builds from your ideas instead of generating from scratch. `plan chapter` calls the LLM to create chapter intent; `compose chapter` does not require a live LLM, so you can inspect governed inputs before finishing API setup.

The CLI also accepts one-off LLM override flags at runtime: `--service`, `--model`, `--api-key-env`, `--base-url`, `--api-format <chat|responses>`, `--stream`, `--no-stream`. For example:

```bash
inkos write next --service google --model gemini-2.5-flash
inkos up --service moonshot --model kimi-k2.5 --api-key-env MOONSHOT_API_KEY
```

## Roadmap

- [x] ~~`packages/studio` Web UI workbench (Vite + React + Hono)~~ — shipped, run `inkos` or `inkos studio`
- [x] ~~Interactive fiction / open worlds (branching choices + free actions + generated images)~~ — shipped in Studio Play
- [ ] Partial chapter intervention (rewrite half a chapter + cascade truth file updates)
- [ ] Custom agent plugin system
- [ ] Platform-format export (Qidian, Fanqie, etc.)

## Contributing

Contributions welcome. Open an issue or PR.

Development is moving quickly. More features and writing-quality improvements will keep landing. Feedback, feature requests, and project follow-up are all welcome. The goal is to build the strongest AI novel-writing Agent.

```bash
pnpm install
pnpm dev          # Watch mode for all packages
pnpm test         # Run tests
pnpm typecheck    # Type-check without emitting
```

## Star History

<a href="https://www.star-history.com/#Narcooo/inkos&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Narcooo/inkos&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Narcooo/inkos&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Narcooo/inkos&type=date&legend=top-left" />
 </picture>
</a>

## Skills Download History

<div align="center">

<a href="https://skill-history.com/narcooo/inkos">
  <img alt="Skills Download History" src="https://skill-history.com/chart/narcooo/inkos.svg" />
</a>

</div>

## Repobeats

![Alt](https://repobeats.axiom.co/api/embed/024114415c1505a8c27fb121e3b392524e48f583.svg "Repobeats analytics image")

## Contributors

<a href="https://github.com/Narcooo/inkos/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Narcooo/inkos" />
</a>

## Acknowledgments

InkOS's agent runtime is built on [pi](https://github.com/badlogic/pi-mono) (`@mariozechner/pi-ai` and `@mariozechner/pi-agent-core`) by Mario Zechner. Thanks to pi for the solid foundation.

## License

[AGPL-3.0](LICENSE)
