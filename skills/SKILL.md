---
name: inkos
description: Autonomous novel CLI agent — generates, audits, and revises multi-chapter fiction with long-term memory and anti-AI-detection.
version: 1.6.0
metadata: { "openclaw": { "emoji": "📖", "requires": { "bins": ["inkos", "node"], "env": [] }, "primaryEnv": "", "homepage": "https://github.com/Narcooo/inkos", "install": [{ "id": "npm", "kind": "node", "package": "@actalk/inkos", "label": "Install InkOS (npm)" }] } }
---

# InkOS - Autonomous Novel Writing Agent

InkOS is a CLI tool for autonomous fiction writing powered by LLM agents. It orchestrates a **6-step layered pipeline** (S0: TaskCard → S1: ContextRouter → S2: Writer → S3: Review → S4: Correction → S5: Settlement+TruthGuard) via a modular `LayeredPipelineRunner`, with atomic settlement writes, externalized prompt templates, and unified telemetry.

The pipeline maps to 5 core agents: **Architect** (S0 task card + outline), **Writer** (S2 creative write), **Auditor** (S3 review — post-write validator + fault detection), **Reviser/Correction** (S4 correction + S5 settlement), and **TruthGuard** (S5 semantic truth validation). The Radar agent runs separately via `inkos radar scan`.

The Writer uses a two-phase architecture: Phase 1 (creative writing) produces the chapter text with **dynamic temperature** (0.6–0.85, auto-tuned by chapter type), then Phase 2 (state settlement, temp 0.3) updates all truth files for long-term consistency. Word count is also auto-adjusted per chapter type (e.g., climax chapters get +20% words).

## When to Use InkOS

- **Novel writing**: Create and continue writing novels/books in Chinese web novel genres
- **Batch chapter generation**: Generate multiple chapters with consistent quality
- **Import & continue**: Import existing chapters from a text file, reverse-engineer truth files, and continue writing
- **Style imitation**: Analyze and adopt writing styles from reference texts
- **Spinoff writing**: Write prequels/sequels/spinoffs while maintaining parent canon
- **Quality auditing**: Detect AI-generated content and perform 33-dimension quality checks
- **Genre exploration**: Explore trends and create custom genre rules
- **Analytics**: Track word count, audit pass rate, and issue distribution per book

## Initial Setup

**Requires**: Node.js >= 20.0.0

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

## Quick Decision Tree

Use this to pick the right command for a given task:

| User intent | Command | Workflow |
|---|---|---|
| Write a brand new novel from scratch | `inkos book create` → `inkos write next` | WF1 |
| Continue writing an existing novel | `inkos write next` | WF2 |
| Import existing text and continue | `inkos import chapters` → `inkos write next` | WF3 |
| Imitate a specific author's style | `inkos style import` → `inkos write next` | WF4 |
| Write a spinoff/prequel/fanfic | `inkos import canon` or `inkos fanfic init` → `inkos write next` | WF5 |
| Manually control draft/audit/revise | `inkos draft` → `inkos audit` → `inkos revise` | WF6 |
| Make targeted edits to one chapter | `inkos revise-light` → `inkos settle` | WF10 |
| Re-generate a chapter from scratch | `inkos write rewrite` | Command table |
| Detect AI-generated content | `inkos detect` | WF8 |
| Check quality metrics | `inkos analytics` | WF9 |
| Scan market trends | `inkos radar scan` | WF7 |

## Common Workflows

### Workflow 1: Create a New Novel

1. **Initialize and create book**:
   ```bash
   inkos book create --title "My Novel Title" --genre xuanhuan --chapter-words 3000
   # Or with a creative brief (your worldbuilding doc / ideas):
   inkos book create --title "My Novel Title" --genre xuanhuan --chapter-words 3000 --brief my-ideas.md
   ```
   - **Chinese genres** (fully supported): `xuanhuan` (玄幻), `xianxia` (仙侠), `urban` (都市), `horror` (恐怖), `other` (通用)
   - **English genres** (genre rules ready; prompts/audit rules still being localized): `cozy`, `epic-fantasy`, `litrpg`, `progression`, `scifi`
   - Returns a `book-id` for all subsequent operations

2. **Generate initial chapters** (e.g., 5 chapters):
   ```bash
   inkos write next book-id --count 5 --words 3000 --context "young protagonist discovering powers"
   ```
   - The `write next` command runs the full Layered 6-step pipeline (S0→S5)
   - `--context` provides guidance to the Architect and Writer agents
   - `--legacy` falls back to the pre-v1.6 single-agent pipeline
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

### Workflow 5: Spinoff/Prequel/Fanfic Writing

1. **Import parent canon** (spinoff — shares world state):
   ```bash
   inkos import canon spinoff-book-id --from parent-book-id
   ```
   - Creates links to parent book's world state, characters, and events
   - Reviser enforces canon consistency

2. **Or initialize fanfic** (supports 4 modes):
   ```bash
   inkos fanfic init fanfic-book-id --from parent-book-id --mode canon
   # Modes: canon (faithful), au (alternate universe), ooc (out-of-character), cp (relationship-focused)
   ```
   - Creates `story/fanfic_canon.md` with parent constraints
   - Use `inkos fanfic show` to view current canon, `inkos fanfic refresh --from parent-book-id` to sync after parent updates

3. **Continue writing**:
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

### Workflow 10: Lightweight Revision + Post-Hoc Settle

When you only need targeted text edits without the full audit pipeline (avoids context overload):

1. **Light revision** (only chapter text + your instructions, no truth files loaded):
   ```bash
   # Inline instructions
   inkos revise-light book-id 5 --context "把第三段的对话改成更口语化的表达"

   # Instructions from file
   inkos revise-light book-id 5 --context-file ./revisions.md
   ```
   - Directly overwrites the chapter file (previous version archived for rollback)
   - Does NOT update truth files — prompt stays minimal and focused

2. **Post-hoc settle** (sync truth files from confirmed content):
   ```bash
   inkos settle book-id 5
   ```
   - Reads the current chapter text + existing truth files
   - Updates: state card, hooks, ledger, summaries, subplots, emotional arcs, character matrix
   - Does NOT modify the chapter text

## Advanced: Natural Language Agent Mode

For flexible, conversational requests:

```bash
inkos agent "写一部都市题材的小说，主角是一个年轻律师，第一章三千字"
```
- Agent interprets natural language and invokes appropriate commands
- Useful for complex multi-step requests

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

All agents reference these to maintain long-term consistency. Settlement writes use **atomic file operations** (temp dir + rename) to prevent inconsistency if the process crashes mid-write. During `import chapters`, these files are reverse-engineered from existing content via the ChapterAnalyzerAgent.

### Two-Phase Writer Architecture
The Writer agent operates in two phases:
- **Phase 1 (Creative)**: Generates the chapter text with **dynamic temperature** (0.6–0.85) auto-tuned by chapter type (climax → high temp/+20% words, dialogue → low temp/−15% words). Manual overrides via `--temp` and `--words` take priority.
- **Phase 2 (Settlement)**: Updates all truth files at temperature 0.3 for precise state tracking. Ensures world state, character arcs, and plot hooks stay consistent.

This separation allows creative freedom in writing while maintaining rigorous continuity tracking.

### Dry Run Mode
Programmatic API (`pipeline.dryRunChapter()`) to verify pipeline configuration without consuming LLM tokens. Returns chapter type detection, token estimates, budget decisions, and story file sizes. Useful for cost estimation before batch generation.

### Architecture Notes
Settlement writes use **atomic file operations** (temp dir + rename) to prevent partial truth file states on crash. Prompt templates are externalized to `prompts/*.md` — you can edit them without recompiling. Context budget adapts dynamically to the model's token window (`maxModelTokens × 0.6`).

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
| `inkos book create` | Create new book | Returns book-id. `--brief <file>` for creative brief |
| `inkos book list` | List all books | Shows IDs, statuses |
| `inkos write next` | Full Layered 6-step pipeline (S0→S5) | Primary workflow command. `--count`, `--words`, `--context`, `--legacy` |
| `inkos write rewrite [id] <n>` | Re-generate chapter N | Restores state snapshot, then re-runs pipeline. `--force`, `--words` |
| `inkos draft` | Full pipeline, draft-only output | Same Layered pipeline as `write next`, returns only draft fields. `--legacy` for pre-v1.6 path |
| `inkos audit` | 33-dimension quality check | Standalone evaluation |
| `inkos revise` | Revise chapter (full context) | Modes: polish/spot-fix/rewrite/rework/anti-detect |
| `inkos revise-light` | Lightweight revision (chapter + instructions only) | `--context` or `--context-file`. No truth files loaded |
| `inkos settle` | Post-hoc truth file settlement | Syncs state from confirmed chapter. Does not modify text |
| `inkos agent` | Natural language interface | Flexible requests |
| `inkos style analyze` | Analyze reference text | Extracts style profile |
| `inkos style import` | Apply style to book | Makes style permanent |
| `inkos import canon` | Link spinoff to parent | For prequels/sequels |
| `inkos import chapters` | Import existing chapters | Reverse-engineers truth files for continuation |
| `inkos fanfic init` | Initialize fanfic from parent book | `--from <parent-id>` `--mode canon/au/ooc/cp` |
| `inkos fanfic show` | View current fanfic canon | Shows `fanfic_canon.md` contents |
| `inkos fanfic refresh` | Refresh fanfic canon from parent | `--from <parent-id>`. Re-reads parent after new chapters |
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

## JSON Output Examples

All content-generating commands support `--json`. On error, output is `{ "error": "<message>" }` with exit code `1`.

### `inkos write next --json` (array, one per chapter)
```json
[
  {
    "chapterNumber": 5,
    "title": "第五章 暗流涌动",
    "wordCount": 3200,
    "status": "approved",
    "revised": true,
    "auditResult": {
      "passed": true,
      "summary": "All checks passed.",
      "issues": []
    }
  }
]
```

### `inkos audit --json`
```json
{
  "chapterNumber": 5,
  "passed": false,
  "summary": "2 issues found.",
  "issues": [
    { "severity": "critical", "category": "continuity", "description": "Character Lin used weapon lost in ch3" },
    { "severity": "warning", "category": "vocabulary-fatigue", "description": "'瞳孔骤缩' used 3 times" }
  ]
}
```

### `inkos draft --json`
```json
{
  "chapterNumber": 5,
  "title": "第五章 暗流涌动",
  "wordCount": 3200,
  "filePath": "books/my-novel/chapters/0005-暗流涌动.md"
}
```

## Error Handling

All commands exit with code `0` on success and `1` on error. With `--json`, errors output `{ "error": "<message>" }`.

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
10. **Leverage chapter types**: Ensure your `volume_outline` includes keywords (高潮/冲突/过渡/对话/收束) for optimal dynamic temperature and word count tuning
11. **Dry run before batch**: Use the programmatic `dryRunChapter()` API to estimate token costs before generating many chapters

## Support & Resources

- **Homepage**: https://github.com/Narcooo/inkos
- **Configuration**: Stored in project root after `inkos init`
- **Truth files**: Located in `.inkos/` directory per book
- **Logs**: Check output of `inkos doctor` for troubleshooting
