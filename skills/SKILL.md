---
name: inkos
description: Autonomous novel writing CLI agent - use for creative fiction writing, novel generation, style imitation, chapter continuation/import, EPUB export, AIGC detection, and fan fiction. Native English support with 10 built-in English genre profiles (LitRPG, Progression Fantasy, Isekai, Cultivation, System Apocalypse, Dungeon Core, Romantasy, Sci-Fi, Tower Climber, Cozy Fantasy). Also supports Chinese web novel genres (xuanhuan, xianxia, urban, horror, other). Multi-agent pipeline, two-phase writer (creative + settlement), 33-dimension auditing, token usage analytics, creative brief input, structured logging (JSON Lines), multi-model routing, and custom OpenAI-compatible provider support.
version: 2.0.0
metadata: { "openclaw": { "emoji": "📖", "requires": { "bins": ["inkos", "node"], "env": [] }, "primaryEnv": "", "homepage": "https://github.com/Narcooo/inkos", "install": [{ "id": "npm", "kind": "node", "package": "@actalk/inkos", "label": "Install InkOS (npm)" }] } }
---

# InkOS - Autonomous Novel Writing Agent

InkOS is a CLI tool for autonomous fiction writing powered by LLM agents. It orchestrates a multi-agent pipeline (Radar → Planner → Composer → Architect → Writer → Observer → Reflector → Normalizer → Auditor → Reviser) to generate, audit, and revise novel content with zero human intervention per chapter.

The pipeline operates in three phases:
- **Phase 1 (Creative Writing, temp 0.7)**: Planner generates chapter intent with hook agenda, Composer selects relevant context, Writer produces prose with length governance and dialogue-driven guidance.
- **Phase 2 (State Settlement, temp 0.3)**: Observer over-extracts 9 categories of facts, Reflector outputs a JSON delta (not full markdown), code-layer applies Zod schema validation and immutable state update. Hook operations use upsert/mention/resolve/defer semantics.
- **Phase 3 (Quality Loop)**: Normalizer adjusts chapter length, Auditor runs 33-dimension check including hook health analysis, Reviser auto-fixes critical issues. Self-correction loop runs until all critical issues clear.

Truth files are persisted as schema-validated JSON (`story/state/*.json`) with markdown projections for human readability. SQLite temporal memory database (`story/memory.db`) enables relevance-based retrieval on Node 22+.

## When to Use InkOS

- **English novel writing**: Native English support with 10 genre profiles (LitRPG, Progression Fantasy, Isekai, etc.). Set `--lang en`
- **Chinese web novel writing**: 5 built-in Chinese genres (xuanhuan, xianxia, urban, horror, other)
- **Fan fiction**: Create fanfic from source material with 4 modes (canon, au, ooc, cp)
- **Batch chapter generation**: Generate multiple chapters with consistent quality
- **Import & continue**: Import existing chapters from a text file, reverse-engineer truth files, and continue writing
- **Style imitation**: Analyze and adopt writing styles from reference texts
- **Spinoff writing**: Write prequels/sequels/spinoffs while maintaining parent canon
- **Quality auditing**: Detect AI-generated content and perform 33-dimension quality checks
- **Genre exploration**: Explore trends and create custom genre rules
- **Analytics**: Track word count, audit pass rate, and issue distribution per book

## Initial Setup

### First Time Setup
```bash
# Initialize a project directory (creates config structure)
inkos init my-writing-project

# Configure your LLM provider (OpenAI, Anthropic, or any OpenAI-compatible API)
inkos config set-global --provider openai --base-url https://api.openai.com/v1 --api-key sk-xxx --model gpt-4o
# For compatible/proxy endpoints, use --provider custom:
# inkos config set-global --provider custom --base-url https://your-proxy.com/v1 --api-key sk-xxx --model gpt-4o
```

### Multi-Model Routing (Optional)
```bash
# Assign different models to different agents — balance quality and cost
inkos config set-model writer claude-sonnet-4-20250514 --provider anthropic --base-url https://api.anthropic.com --api-key-env ANTHROPIC_API_KEY
inkos config set-model auditor gpt-4o --provider openai
inkos config show-models
```
Agents without explicit overrides fall back to the global model.

### View System Status
```bash
# Check installation and configuration
inkos doctor

# View current config
inkos status
```

## Common Workflows

### Workflow 1: Create a New Novel

1. **Initialize and create book**:
   ```bash
   inkos book create --title "My Novel Title" --genre xuanhuan --chapter-words 3000
   # Or with a creative brief (your worldbuilding doc / ideas):
   inkos book create --title "My Novel Title" --genre xuanhuan --chapter-words 3000 --brief my-ideas.md
   ```
   - Genres: `xuanhuan` (cultivation), `xianxia` (immortal), `urban` (city), `horror`, `other`
   - Returns a `book-id` for all subsequent operations

2. **Generate initial chapters** (e.g., 5 chapters):
   ```bash
   inkos write next book-id --count 5 --words 3000 --context "young protagonist discovering powers"
   ```
   - The `write next` command runs the full pipeline: draft → audit → revise
   - `--context` provides guidance to the Architect and Writer agents
   - Returns JSON with chapter details and quality metrics

3. **Review and approve chapters**:
   ```bash
   inkos review list book-id
   inkos review approve-all book-id
   ```

4. **Export the book** (supports txt, md, epub):
   ```bash
   inkos export book-id
   inkos export book-id --format epub
   ```

### Workflow 2: Continue Writing Existing Novel

1. **List your books**:
   ```bash
   inkos book list
   ```

2. **Continue from last chapter**:
   ```bash
   inkos write next book-id --count 3 --words 2500 --context "protagonist faces critical choice"
   ```
   - InkOS maintains 7 truth files (world state, character matrix, emotional arcs, etc.) for consistency
   - If only one book exists, omit `book-id` for auto-detection

3. **Review and approve**:
   ```bash
   inkos review approve-all
   ```

### Workflow 2.5: Steering Chapter Focus Before Writing

Use this when the user says things like "pull focus back to the mentor conflict", "pause the merchant guild subplot", or "change what the next chapter should prioritize".

1. **Update the book-level control docs when needed**:
   - Use `update_author_intent` to change the long-horizon identity of the book
   - Use `update_current_focus` to change the next 1-3 chapters' focus

2. **Compile the next chapter intent**:
   ```text
   plan_chapter(bookId, guidance?)
   ```
   - Generates `story/runtime/chapter-XXXX.intent.md`
   - Use this to verify what the system thinks the next chapter should do

3. **Compose the actual runtime input package**:
   ```text
   compose_chapter(bookId, guidance?)
   ```
   - Generates `story/runtime/chapter-XXXX.context.json`
   - Generates `story/runtime/chapter-XXXX.rule-stack.yaml`
   - Generates `story/runtime/chapter-XXXX.trace.json`

4. **Only then write**:
   - `write_draft` if the user wants intermediate review
   - `write_full_pipeline` if they want the usual write → audit → revise flow

Recommended orchestration:
- user asks to redirect focus
- `update_current_focus`
- `plan_chapter`
- `compose_chapter`
- inspect the resulting intent/paths
- `write_draft` or `write_full_pipeline`

### Workflow 3: Import Existing Chapters & Continue

Use this when you have an existing novel (or partial novel) and want InkOS to pick up where it left off.

1. **Import from a single text file** (auto-splits by chapter headings):
   ```bash
   inkos import chapters book-id --from novel.txt
   ```
   - Automatically splits by `第X章` pattern
   - Custom split pattern: `--split "Chapter\\s+\\d+"`

2. **Import from a directory** of separate chapter files:
   ```bash
   inkos import chapters book-id --from ./chapters/
   ```
   - Reads `.md` and `.txt` files in sorted order

3. **Resume interrupted import**:
   ```bash
   inkos import chapters book-id --from novel.txt --resume-from 15
   ```

4. **Continue writing** from the imported chapters:
   ```bash
   inkos write next book-id --count 3
   ```
   - InkOS reverse-engineers all 7 truth files from the imported chapters
   - Generates a style guide from the existing text
   - New chapters maintain consistency with imported content

### Workflow 4: Style Imitation

1. **Analyze reference text**:
   ```bash
   inkos style analyze reference_text.txt
   ```
   - Examines vocabulary, sentence structure, tone, pacing

2. **Import style to your book**:
   ```bash
   inkos style import reference_text.txt book-id --name "Author Name"
   ```
   - All future chapters adopt this style profile
   - Style rules become part of the Reviser's audit criteria

### Workflow 5: Spinoff/Prequel Writing

1. **Import parent canon**:
   ```bash
   inkos import canon spinoff-book-id --from parent-book-id
   ```
   - Creates links to parent book's world state, characters, and events
   - Reviser enforces canon consistency

2. **Continue spinoff**:
   ```bash
   inkos write next spinoff-book-id --count 3 --context "alternate timeline after Chapter 20"
   ```

### Workflow 6: Fine-Grained Control (Draft → Audit → Revise)

If you need separate control over each pipeline stage:

1. **Generate draft only**:
   ```bash
   inkos draft book-id --words 3000 --context "protagonist escapes" --json
   ```

2. **Audit the chapter** (33-dimension quality check):
   ```bash
   inkos audit book-id chapter-1 --json
   ```
   - Returns metrics across 33 dimensions including pacing, dialogue, world-building, outline adherence, and more

3. **Revise with specific mode**:
   ```bash
   inkos revise book-id chapter-1 --mode polish --json
   ```
   - Modes: `polish` (minor), `spot-fix` (targeted), `rewrite` (major), `rework` (structure), `anti-detect` (reduce AI traces)

### Workflow 7: Monitor Platform Trends

```bash
inkos radar scan
```
- Analyzes trending genres, tropes, and reader preferences
- Informs Architect recommendations for new books

### Workflow 8: Detect AI-Generated Content

```bash
# Detect AIGC in a specific chapter
inkos detect book-id

# Deep scan all chapters
inkos detect book-id --all
```
- Uses 11 deterministic rules (zero LLM cost) + optional LLM validation
- Returns detection confidence and problematic passages

### Workflow 9: View Analytics

```bash
inkos analytics book-id --json
# Shorthand alias
inkos stats book-id --json
```
- Total chapters, word count, average words per chapter
- Audit pass rate and top issue categories
- Chapters with most issues, status distribution
- **Token usage stats**: total prompt/completion tokens, avg tokens per chapter, recent trend

### Workflow 10: Write an English Novel

```bash
# Create an English LitRPG novel (language auto-detected from genre)
inkos book create --title "The Last Delver" --genre litrpg --chapter-words 3000

# Or set language explicitly
inkos book create --title "My Novel" --genre other --lang en

# Set English as default for all projects
inkos config set-global --lang en
```
- 10 English genres: litrpg, progression, isekai, cultivation, system-apocalypse, dungeon-core, romantasy, sci-fi, tower-climber, cozy
- Each genre has dedicated pacing rules, fatigue word lists (e.g., "delve", "tapestry", "testament"), and audit dimensions
- Use `inkos genre list` to see all available genres

### Workflow 11: Fan Fiction

```bash
# Create a fanfic from source material
inkos fanfic init --title "My Fanfic" --from source-novel.txt --mode canon

# Modes: canon (faithful), au (alternate universe), ooc (out of character), cp (ship-focused)
inkos fanfic init --title "What If" --from source.txt --mode au --genre other
```
- Imports and analyzes source material automatically
- Fanfic-specific audit dimensions and information boundary controls
- Ensures new content stays consistent with source canon (or deliberately diverges in au/ooc modes)

## Advanced: Natural Language Agent Mode

For flexible, conversational requests:

```bash
inkos agent "写一部都市题材的小说，主角是一个年轻律师，第一章三千字"
```
- Agent interprets natural language and invokes appropriate commands
- Useful for complex multi-step requests

## Input Governance Tools

These tools are the preferred control surface for chapter steering:

- `plan_chapter(bookId, guidance?)`
  - Generates chapter intent for the next chapter
  - Use before writing when the user wants to change focus

- `compose_chapter(bookId, guidance?)`
  - Generates runtime context/rule-stack/trace artifacts
  - Use after planning and before writing

- `update_author_intent(bookId, content)`
  - Rewrites `story/author_intent.md`
  - Use for long-horizon changes to the book's identity

- `update_current_focus(bookId, content)`
  - Rewrites `story/current_focus.md`
  - Use for local steering over the next 1-3 chapters

`write_truth_file` remains available for broad file edits, but prefer the dedicated control tools above for input-governance changes.

## Key Concepts

### Book ID Auto-Detection
If your project contains only one book, most commands accept `book-id` as optional. You can omit it for brevity:
```bash
# Explicit
inkos write next book-123 --count 1

# Auto-detected (if only one book exists)
inkos write next --count 1
```

### --json Flag
All content-generating commands support `--json` for structured output. Essential for programmatic use:
```bash
inkos draft book-id --words 3000 --context "guidance" --json
```

### Truth Files (Long-Term Memory)
InkOS maintains 7 files per book for coherence:
- **World State**: Maps, locations, technology levels, magic systems
- **Character Matrix**: Names, relationships, arcs, motivations
- **Resource Ledger**: In-world items, money, power levels
- **Chapter Summaries**: Events, progression, foreshadowing
- **Subplot Board**: Active and dormant subplots, hooks
- **Emotional Arcs**: Character emotional progression
- **Pending Hooks**: Unresolved cliffhangers and promises to reader

All agents reference these to maintain long-term consistency. Since 0.6.0, truth files are backed by schema-validated JSON in `story/state/` with automatic bootstrap from markdown for legacy books. During `import chapters`, these files are reverse-engineered from existing content via the ChapterAnalyzerAgent.

### Multi-Phase Writer Architecture
The Writer operates across multiple phases with specialized agents:
- **Planner**: Generates chapter intent with structured hook agenda (mustAdvance, eligibleResolve, staleDebt) based on memory retrieval.
- **Composer**: Selects relevant context from truth files by relevance scoring, compiles rule stack and runtime artifacts.
- **Phase 1 (Creative, temp 0.7)**: Generates prose with length governance, English variance brief (anti-repetition), and dialogue-driven guidance.
- **Phase 2a (Observer, temp 0.5)**: Over-extracts 9 categories of facts from the chapter text.
- **Phase 2b (Reflector, temp 0.3)**: Outputs a JSON delta with hookOps (upsert/mention/resolve/defer), currentStatePatch, and chapterSummary. Code-layer validates via Zod schema and applies immutably.
- **Normalizer**: Single-pass compress/expand to bring chapter length into the target band. Safety net rejects destructive normalization (>75% content loss).
- **Auditor**: 33-dimension check including hook health analysis (stale debt, burst detection, no-advance warnings).
- **Reviser**: Auto-fixes critical issues, self-correction loop until clean.

Truth files use structured JSON (`story/state/*.json`) as the authoritative source, with markdown projections for human readability. Hook admission control prevents duplicate/family hooks from inflating the hook table.

### Context Guidance
The `--context` parameter provides directional hints to the Writer and Architect:
```bash
inkos write next book-id --count 2 --context "protagonist discovers betrayal, must decide whether to trust mentor"
```
- Context is optional but highly recommended for narrative coherence
- Supports both English and Chinese

## Genre Management

### View Built-In Genres
```bash
inkos genre list
inkos genre show xuanhuan
```

### Create Custom Genre
```bash
inkos genre create --name "my-genre" --rules "rule1,rule2,rule3"
```

### Copy and Modify Existing Genre
```bash
inkos genre copy xuanhuan --name "dark-xuanhuan" --rules "darker tone, more violence"
```

## Command Reference Summary

| Command | Purpose | Notes |
|---------|---------|-------|
| `inkos init [name]` | Initialize project | One-time setup |
| `inkos book create` | Create new book | Returns book-id. `--brief <file>`, `--lang en/zh`, `--genre litrpg/progression/...` |
| `inkos book list` | List all books | Shows IDs, statuses |
| `inkos write next` | Full pipeline (draft→audit→revise) | Primary workflow command |
| `inkos draft` | Generate draft only | No auditing/revision |
| `inkos audit` | 33-dimension quality check | Standalone evaluation |
| `inkos revise` | Revise chapter | Modes: polish/spot-fix/rewrite/rework/anti-detect |
| `inkos agent` | Natural language interface | Flexible requests |
| `inkos style analyze` | Analyze reference text | Extracts style profile |
| `inkos style import` | Apply style to book | Makes style permanent |
| `inkos import canon` | Link spinoff to parent | For prequels/sequels |
| `inkos import chapters` | Import existing chapters | Reverse-engineers truth files for continuation |
| `inkos detect` | AIGC detection | Flags AI-generated passages |
| `inkos export` | Export finished book | Formats: txt, md, epub |
| `inkos analytics` / `inkos stats` | View book statistics | Word count, audit rates, token usage |
| `inkos radar scan` | Platform trend analysis | Informs new book ideas |
| `inkos config set-global` | Configure LLM provider | OpenAI/Anthropic/custom (any OpenAI-compatible) |
| `inkos config set-model <agent> <model>` | Set model override for a specific agent | `--provider`, `--base-url`, `--api-key-env` for multi-provider routing |
| `inkos config show-models` | Show current model routing | View per-agent model assignments |
| `inkos doctor` | Diagnose issues | Check installation |
| `inkos update` | Update to latest version | Self-update |
| `inkos up/down` | Daemon mode | Background processing. Logs to `inkos.log` (JSON Lines). `-q` for quiet mode |
| `inkos review list/approve-all` | Manage chapter approvals | Quality gate |
| `inkos fanfic init` | Create fanfic from source material | `--from <file>`, `--mode canon/au/ooc/cp` |
| `inkos genre list` | List all available genres | Shows English and Chinese genres with default language |

## Error Handling

### Common Issues

**"book-id not found"**
- Verify the ID with `inkos book list`
- Ensure you're in the correct project directory

**"Provider not configured"**
- Run `inkos config set-global` with valid credentials
- Check API key and base URL with `inkos doctor`

**"Context invalid"**
- Ensure `--context` is a string (wrap in quotes if multi-word)
- Context can be in English or Chinese

**"Audit failed"**
- Check chapter for encoding issues
- Ensure chapter-words matches actual word count
- Try `inkos revise` with `--mode rewrite`

**"Book already has chapters" (import)**
- Use `--resume-from <n>` to append to existing chapters
- Or delete existing chapters first

### Running Daemon Mode

For long-running operations:
```bash
# Start background daemon
inkos up

# Stop daemon
inkos down

# Daemon auto-processes queued chapters
```

## Tips for Best Results

1. **Provide rich context**: The more guidance in `--context`, the more coherent the narrative
2. **Start with style**: If imitating an author, run `inkos style import` before generation
3. **Import first**: For existing novels, use `inkos import chapters` to bootstrap truth files before continuing
4. **Review regularly**: Use `inkos review` to catch issues early
5. **Monitor audits**: Check `inkos audit` metrics to understand quality bottlenecks
6. **Use spinoffs strategically**: Import canon before writing prequels/sequels
7. **Batch generation**: Generate multiple chapters together (better continuity)
8. **Check analytics**: Use `inkos analytics` to track quality trends over time
9. **Export frequently**: Keep backups with `inkos export`

## Support & Resources

- **Homepage**: https://github.com/Narcooo/inkos
- **Configuration**: Stored in project root after `inkos init`
- **Truth files**: Located in `books/<id>/story/` per book, with structured JSON in `story/state/`
- **Logs**: Check output of `inkos doctor` for troubleshooting
