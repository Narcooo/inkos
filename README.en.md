<p align="center">
  <img src="assets/logo.svg" width="120" height="120" alt="InkOS Logo">
  <img src="assets/inkos-text.svg" width="240" height="65" alt="InkOS">
</p>

<h1 align="center">Autonomous Novel Writing CLI Agent</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@actalk/inkos"><img src="https://img.shields.io/npm/v/@actalk/inkos.svg?color=cb3837&logo=npm" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg" alt="Node.js"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.x-3178C6.svg?logo=typescript&logoColor=white" alt="TypeScript"></a>
</p>

<p align="center">
  <a href="README.md">中文</a> | English
</p>

---

Open-source CLI agent that autonomously writes, audits, and revises novels — with human review gates that keep you in control.

## Quick Start

### Install

```bash
npm i -g @actalk/inkos
```

### Use via OpenClaw 🦞

InkOS is published as an [OpenClaw](https://clawhub.ai) Skill, callable by any compatible agent (Claude Code, OpenClaw, etc.):

```bash
clawhub install inkos          # Install from ClawHub
```

If you installed via npm or cloned the repo, `skills/SKILL.md` is already included — 🦞 can read it directly without a separate ClawHub install.

Once installed, Claw can invoke all InkOS atomic commands (`draft`/`audit`/`revise`/`write next`) via `exec`, with `--json` output for structured decision-making. You can also browse it on [ClawHub](https://clawhub.ai) by searching `inkos`.

### Configure

**Option 1: Global config (recommended, one-time setup)**

```bash
inkos config set-global \
  --provider <openai|anthropic|custom> \
  --base-url <API endpoint> \
  --api-key <your API key> \
  --model <model name>

# Example: OpenAI
# inkos config set-global --provider openai --base-url https://api.openai.com/v1 --api-key sk-xxx --model gpt-4o
# Example: Any OpenAI-compatible endpoint (proxies, Zhipu, Gemini, local models)
# inkos config set-global --provider custom --base-url https://your-proxy.com/v1 --api-key sk-xxx --model gpt-4o
# Example: Anthropic
# inkos config set-global --provider anthropic --base-url https://api.anthropic.com --api-key sk-ant-xxx --model claude-sonnet-4-20250514
```

Saved to `~/.inkos/.env`, shared by all projects. New projects just work without extra config.

**Option 2: Per-project `.env`**

```bash
inkos init my-novel     # Initialize project
# Edit my-novel/.env
```

```bash
# Required
INKOS_LLM_PROVIDER=                               # openai / anthropic / custom (use custom for any OpenAI-compatible API)
INKOS_LLM_BASE_URL=                               # API endpoint (proxies, Zhipu, Gemini, local models all supported)
INKOS_LLM_API_KEY=                                 # API Key
INKOS_LLM_MODEL=                                   # Model name

# Optional
# INKOS_LLM_TEMPERATURE=0.7                       # Default temperature (Writer auto-tunes 0.6-0.85 by chapter type)
# INKOS_LLM_MAX_TOKENS=8192                        # Max output tokens
# INKOS_LLM_THINKING_BUDGET=0                      # Anthropic extended thinking budget
```

Project `.env` overrides global config. Skip it if no override needed.

**Option 3: Multi-model routing (optional)**

Assign different models to different agents — balance quality and cost:

```bash
# Writer uses Claude (stronger creative), Auditor uses GPT-4o (cheaper & fast)
inkos config set-model writer claude-sonnet-4-20250514 --provider anthropic --base-url https://api.anthropic.com --api-key-env ANTHROPIC_API_KEY
inkos config set-model auditor gpt-4o --provider openai
inkos config show-models        # View current routing
```

Agents without explicit overrides fall back to the global model.

### Write Your First Book

```bash
inkos book create --title "Devouring Emperor" --genre xuanhuan  # Create a book
inkos write next my-book          # Write next chapter (full pipeline: draft → audit → revise)
inkos status                      # Check status
inkos review list my-book         # Review drafts
inkos review approve-all my-book  # Batch approve
inkos export my-book              # Export full book
inkos export my-book --format epub  # Export EPUB (read on phone/Kindle)
```

<p align="center">
  <img src="assets/screenshot-terminal.png" width="700" alt="Terminal screenshot">
</p>

---

## Why InkOS?

Writing a novel with AI isn't just "prompt and paste." Long-form fiction breaks down fast: characters forget things, items appear from nowhere, the same adjectives repeat every paragraph, and plot threads silently die. InkOS treats these as engineering problems.

- **Canonical truth files** — track the real state of the world, not what the LLM hallucinates
- **Anti-information-leaking** — characters only know what they've actually witnessed
- **Resource decay** — supplies deplete and items break, no infinite backpacks
- **Vocabulary fatigue detection** — catches overused words before readers do
- **Auto-revision** — fixes math errors and continuity breaks before human review

## How It Works

Each chapter is produced by five agents in sequence:

<p align="center">
  <img src="assets/screenshot-pipeline.png" width="800" alt="Pipeline diagram">
</p>

| Agent | Responsibility |
|-------|---------------|
| **Radar** | Scans platform trends and reader preferences to inform story direction (pluggable, skippable) |
| **Architect** | Plans chapter structure: outline, scene beats, pacing targets |
| **Writer** | Produces prose from the plan + current world state |
| **Continuity Auditor** | Validates the draft against canonical truth files |
| **Reviser** | Fixes issues found by the auditor — auto-fixes critical problems, flags others for human review |

If the audit fails, the pipeline automatically enters a revise → re-audit loop until all critical issues are resolved.

### Canonical Truth Files

Every book maintains 7 truth files as the single source of truth:

| File | Purpose |
|------|---------|
| `current_state.md` | World state: character locations, relationships, knowledge, emotional arcs |
| `particle_ledger.md` | Resource accounting: items, money, supplies with quantities and decay tracking |
| `pending_hooks.md` | Open plot threads: foreshadowing planted, promises to readers, unresolved conflicts |
| `chapter_summaries.md` | Per-chapter summaries: characters, key events, state changes, hook dynamics |
| `subplot_board.md` | Subplot progress board: A/B/C line status tracking |
| `emotional_arcs.md` | Emotional arcs: per-character emotion tracking and growth |
| `character_matrix.md` | Character interaction matrix: encounter records, information boundaries |

The Continuity Auditor checks every draft against these files. If a character "remembers" something they never witnessed, or pulls a weapon they lost two chapters ago, the auditor catches it. Legacy books without new truth files are automatically compatible.

<p align="center">
  <img src="assets/screenshot-state.png" width="800" alt="Truth files snapshot">
</p>

### Writing Rule System

The Writer agent has ~25 universal writing rules (character craft, narrative technique, logical consistency, language constraints, de-AI-ification), applicable to all genres.

On top of that, each genre has dedicated rules (prohibitions, language rules, pacing, audit dimensions), and each book has its own `book_rules.md` (protagonist personality, numerical caps, custom prohibitions) and `story_bible.md` (worldbuilding), auto-generated by the Architect agent.

See [CHANGELOG](CHANGELOG.md) for details.

## Three Usage Modes

InkOS provides three interaction modes, all sharing the same atomic operations:

### 1. Full Pipeline (One Command)

```bash
inkos write next my-book              # Draft → audit → auto-revise, all in one
inkos write next my-book --count 5    # Write 5 chapters in sequence
```

### 2. Atomic Commands (Composable, External Agent Friendly)

```bash
inkos draft my-book --context "Focus on master-disciple conflict" --json
inkos audit my-book 31 --json
inkos revise my-book 31 --json
```

Each command performs a single operation independently. `--json` outputs structured data. Can be called by external AI agents via `exec`, or used in scripts.

### 3. Natural Language Agent Mode

```bash
inkos agent "Write an urban cultivation novel with a programmer protagonist"
inkos agent "Write the next chapter, focus on master-disciple conflict"
inkos agent "Scan market trends first, then create a new book based on results"
```

13 built-in tools (write_draft, audit_chapter, revise_chapter, scan_market, create_book, get_book_status, read_truth_files, list_books, write_full_pipeline, web_fetch, import_style, import_canon, import_chapters), with the LLM deciding call order via tool-use.

## CLI Reference

| Command | Description |
|---------|-------------|
| `inkos init [name]` | Initialize project (omit name to init current directory) |
| `inkos book create` | Create a new book (`--genre`, `--platform`, `--chapter-words`, `--target-chapters`, `--brief <file>` for creative brief) |
| `inkos book update [id]` | Update book settings (`--chapter-words`, `--target-chapters`, `--status`) |
| `inkos book list` | List all books |
| `inkos genre list/show/copy/create` | View, copy, or create genres |
| `inkos write next [id]` | Full pipeline: write next chapter (`--words` to override, `--count` for batch, `-q` quiet mode) |
| `inkos write rewrite [id] <n>` | Rewrite chapter N (restores state snapshot, `--force` to skip confirmation, `--words` to override) |
| `inkos draft [id]` | Write draft only (`--words` to override word count, `-q` quiet mode) |
| `inkos audit [id] [n]` | Audit a specific chapter |
| `inkos revise [id] [n]` | Revise a specific chapter |
| `inkos agent <instruction>` | Natural language agent mode |
| `inkos review list [id]` | Review drafts |
| `inkos review approve-all [id]` | Batch approve |
| `inkos status [id]` | Project status |
| `inkos export [id]` | Export book (`--format txt/md/epub`, `--output <path>`, `--approved-only`) |
| `inkos radar scan` | Scan platform trends |
| `inkos config set-global` | Set global LLM config (~/.inkos/.env) |
| `inkos config show-global` | Show global config |
| `inkos config set/show` | View/update project config |
| `inkos config set-model <agent> <model>` | Set model override for a specific agent (`--base-url`, `--provider`, `--api-key-env` for multi-provider routing) |
| `inkos config remove-model <agent>` | Remove agent model override (fall back to default) |
| `inkos config show-models` | Show current model routing |
| `inkos doctor` | Diagnose setup issues (API connectivity test + provider compatibility hints) |
| `inkos detect [id] [n]` | AIGC detection (`--all` for all chapters, `--stats` for statistics) |
| `inkos style analyze <file>` | Analyze reference text to extract style fingerprint |
| `inkos style import <file> [id]` | Import style fingerprint into a book |
| `inkos import canon [id] --from <parent>` | Import parent canon for spinoff writing |
| `inkos import chapters [id] --from <path>` | Import existing chapters for continuation (`--split`, `--resume-from`) |
| `inkos analytics [id]` / `inkos stats [id]` | Book analytics (audit pass rate, top issues, chapter ranking, token usage) |
| `inkos update` | Update to latest version |
| `inkos revise-light [id] [n]` | Lightweight revision (chapter text + instructions only, no truth files). `--context` or `--context-file` |
| `inkos settle [id] [n]` | Post-hoc truth file sync. Reads confirmed chapter and updates state/hooks/ledger |
| `inkos up / down` | Start/stop daemon (`-q` quiet mode, auto-writes `inkos.log`) |

`[id]` is auto-detected when the project has only one book. All commands support `--json` for structured output. `draft`/`write next` support `--context` for writing guidance and `--words` to override per-chapter word count. `book create` supports `--brief <file>` to pass a creative brief (your brainstorming/worldbuilding doc) — the Architect builds from your ideas instead of generating from scratch.

## Key Features

### State Snapshots + Chapter Rewrite

Every chapter automatically creates a state snapshot. Use `inkos write rewrite <id> <n>` to roll back and regenerate any chapter — world state, resource ledger, and plot hooks all restore to the pre-chapter state.

### Write Lock

File-based locking prevents concurrent writes to the same book.

### Pre-Write Checklist + Post-Write Settlement

The Writer agent outputs a pre-write checklist before writing (context scope, current resources, pending hooks, conflict overview, risk scan), and a settlement table after writing (resource changes, hook changes). The Auditor cross-validates the settlement table against prose content.

### Pluggable Radar

Radar data sources are pluggable via the `RadarSource` interface. Built-in sources for Tomato Novel and Qidian. Custom data sources or skipping radar entirely are both supported.

### Daemon Mode

`inkos up` starts an autonomous background loop that writes chapters on a schedule. The pipeline runs fully unattended for non-critical issues, but pauses for human review when the auditor flags problems it cannot auto-fix. All logs are written to `inkos.log` (JSON Lines format) in the project root. Use `-q` to suppress stderr and keep only file logging.

### Notifications

Telegram, Feishu, WeCom, and Webhook. In daemon mode, get notified on your phone when a chapter is done or an audit fails. Webhook supports HMAC-SHA256 signing and event filtering.

### External Agent Integration

Atomic commands + `--json` output make InkOS callable by external AI agents (OpenClaw, Claude Code, etc.). Agents execute `inkos draft`/`audit`/`revise` via `exec`, read JSON results, and decide next steps.

## Architecture

```
inkos/
├── packages/
│   ├── core/              # Agent runtime, pipeline, state management
│   │   ├── agents/        # architect, writer, continuity, reviser, radar, ai-tells, post-write-validator, sensitive-words, detector, style-analyzer
│   │   ├── pipeline/      # runner, agent (tool-use), scheduler, detection-runner
│   │   ├── state/         # File-based state manager (7 truth files + snapshots)
│   │   ├── llm/           # OpenAI + Anthropic dual SDK (streaming)
│   │   ├── notify/        # Telegram, Feishu, WeCom, Webhook
│   │   └── models/        # Zod schema validation
│   └── cli/               # Commander.js CLI (22 commands)
│       └── commands/      # init, book, write, draft, audit, revise, agent, review, detect, style...
└── (planned) studio/      # Web UI for review and editing
```

TypeScript monorepo managed with pnpm workspaces.

## Roadmap

- [x] Full pipeline (radar → architect → writer → auditor → reviser)
- [x] Canonical truth files + continuity audit
- [x] Built-in writing rule system
- [x] Full CLI (22 commands)
- [x] State snapshots + chapter rewrite
- [x] Daemon mode
- [x] Notifications (Telegram / Feishu / WeCom)
- [x] Atomic commands + JSON output (draft / audit / revise)
- [x] Natural language agent mode (tool-use orchestration)
- [x] Pluggable radar (RadarSource interface)
- [x] External agent integration (OpenClaw, etc.)
- [x] Genre customization + per-book rules (genre CLI + book_rules.md)
- [x] 33-dimension continuity audit (including AI-tell detection + spinoff dims + outline adherence)
- [x] De-AI-ification rules + style fingerprint injection
- [x] Spinoff writing (canon import + 4 audit dimensions + info boundary control)
- [x] Style cloning (statistical fingerprint + LLM style guide + Writer injection)
- [x] Post-write validator (11 hard rules + auto spot-fix)
- [x] Audit-revise loop hardening (AI marker guard + temperature lock)
- [x] Multi-LLM provider (OpenAI + Anthropic + compatible endpoints)
- [x] AIGC detection + anti-detect rewrite pipeline
- [x] Webhook notifications + smart scheduler (quality gates)
- [x] Cross-chapter coherence (chapter summaries + subplot/emotion/character matrices)
- [x] Continuation writing (import chapters + auto reverse-engineer truth files + resumable import)
- [x] Multi-provider agent routing (different agents use different API endpoints and keys, `inkos config set-model --base-url --provider`)
- [x] Analytics (`inkos analytics`: audit pass rate, top issues, chapter ranking, token usage stats)
- [x] EPUB export (`inkos export --format epub`, read on phone/Kindle)
- [x] Structured logging (ANSI colors, JSON Lines file logging, quiet mode, LLM streaming heartbeat)
- [x] Stream auto-fallback (auto sync retry when SSE fails — compatible with Zhipu, Gemini proxies, etc.)
- [x] Local model compatibility (fallback parsing + partial response recovery on stream interruption)
- [x] Creative brief (`book create --brief` — pass your brainstorming doc, Architect builds from it)
- [x] Lightweight revision + post-hoc settlement (`revise-light` + `settle`, decouple editing from state sync)
- [x] Dynamic temperature (auto-tunes 0.6–0.85 by chapter type: climax→high, dialogue→low)
- [x] Chapter-aware word count (climax +20%, transition -15%, auto-adjusts per-chapter target)
- [x] Pipeline dry run (zero LLM cost config verification, token estimation, budget decisions)
- [x] Truth file read cache (4 reads → 1 per chapter pipeline, reduced IO)
- [x] Writer prompt compression (~18% token savings, merged methodology + compact tables)
- [ ] `packages/studio` Web UI for review and editing (Vite + React + Hono)
- [ ] Partial chapter intervention (rewrite half a chapter + cascade truth file updates)
- [ ] Full English novel support (English genre profiles, prompts, audit rules, post-write validator)
- [ ] Custom agent plugin system
- [ ] Platform-specific export (Qidian, Tomato, etc.)

## Contributing

Contributions welcome. Open an issue or PR.

```bash
pnpm install
pnpm dev          # Watch mode for all packages
pnpm test         # Run tests
pnpm typecheck    # Type-check without emitting
```

## License

[MIT](LICENSE)
