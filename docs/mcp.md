# InkOS MCP Mode

InkOS MCP mode adds a stdio MCP server for external agent tools such as Codex and Claude Code. It does not replace Studio, TUI, CLI, or the OpenClaw Skill. Those entrypoints keep their existing behavior and may still use InkOS' internal LLM configuration.

MCP mode is an **external-agent mode**: when a task needs generation, analysis, import settlement, continuation, or truth/state drafting, the connected agent tool's LLM does that work. InkOS MCP is responsible for project discovery, deterministic import, context bundling, file write-back, export, diagnosis, and index repair.

## Install And Configure

The package is published as `@actalk/inkos-mcp` and exposes:

```bash
inkos-mcp
```

Codex MCP config example:

```json
{
  "mcpServers": {
    "inkos": {
      "command": "inkos-mcp",
      "args": [],
      "cwd": "/path/to/your/inkos/project"
    }
  }
}
```

Claude Code stdio MCP config example:

```json
{
  "mcpServers": {
    "inkos": {
      "command": "inkos-mcp",
      "cwd": "/path/to/your/inkos/project"
    }
  }
}
```

Start the MCP server from an InkOS project directory, or configure `cwd` to point at one. Then tell the external agent:

```text
我要通过 MCP 使用 InkOS
```

The agent should first call `inkos_project_status`, then `inkos_list_books`, and then ask what you want to do.

## LLM Policy

Default MCP mode does not require an InkOS LLM API Key. It does not read `.inkos/secrets.json`, project `.env`, or user `.env` secrets, and it does not run model connectivity checks.

The external agent should use these MCP tools for LLM-backed work:

- `inkos_agent_create_book_plan`
- `inkos_agent_commit_book`
- `inkos_agent_import_plan`
- `inkos_agent_continue_plan`
- `inkos_agent_commit_chapter`

In this flow, the MCP server returns a stable task package and expected output shape. The external agent generates the text or truth/state content, then calls the corresponding commit/write tool. This keeps Studio/CLI intact while allowing Codex or Claude Code to perform the LLM portion through their own model session.

Deterministic no-LLM tools are still available:

- `inkos_import_preview`
- `inkos_import_commit`
- `inkos_get_context_bundle`
- `inkos_update_control_doc`
- `inkos_write_agent_chapter`
- `inkos_export_book`
- `inkos_diagnose_import`
- `inkos_repair_project_index`

`inkos_get_context_bundle` uses `maxChars` and `chapterWindow`, and it does not return the whole book by default. If an external agent needs exact full text, it should read a precise chapter resource such as:

```text
inkos://book/{bookId}/chapter/{chapterNumber}
```

## Create A Book

1. Call `inkos_agent_create_book_plan` with a title and optional brief.
2. The external agent generates foundation content such as author intent, current focus, story bible, rules, style notes, current state, and hooks.
3. Call `inkos_agent_commit_book` with the generated foundation files.
4. Call `inkos_inspect_book` to confirm the book is registered and readable.

This provides the MCP equivalent of Studio's guided creation flow without requiring InkOS' internal LLM provider.

## Import Existing Novels

1. Put a `.txt` / `.md` file or a directory of chapter files inside the InkOS project.
2. Call `inkos_import_preview` with `sourcePath`.
3. Review recognized chapter titles, counts, short chapters, duplicates, and suggestions.
4. Call `inkos_import_commit` with `mode: "new-book"`, `"append"`, or `"replace"` to register chapters deterministically.
5. If you want Studio-style import settlement, call `inkos_agent_import_plan`. The external agent uses the returned task and chapter resources to draft truth/state, summaries, hooks, and style notes.
6. Write generated control docs through `inkos_update_control_doc` or subsequent agent commit tools.
7. Call `inkos_inspect_book`.

`needsAgentSettlement: true` means chapters are registered and readable, but fine-grained truth/state extraction still needs an external agent settlement step. In MCP mode, that step should be done by the connected agent tool, not by asking the user to configure an InkOS API Key.

## Continue Existing Books

1. Call `inkos_agent_continue_plan` or `inkos_get_context_bundle`.
2. The external agent writes the next chapter from the bounded context bundle.
3. Call `inkos_agent_commit_chapter` with chapter text, summary, and any generated truth/state updates.
4. Export or inspect as needed.

Chapters written through `inkos_agent_commit_chapter` are recorded as external-agent generated. If the agent does not provide structured truth/state updates, InkOS marks the chapter as needing settlement instead of pretending that settlement happened.

## Resources

MCP mode exposes these resources:

- `inkos://project/manifest`
- `inkos://books`
- `inkos://book/{bookId}/manifest`
- `inkos://book/{bookId}/chapters`
- `inkos://book/{bookId}/chapter/{chapterNumber}`
- `inkos://book/{bookId}/context/continue`

Secrets, `.env`, and `.inkos/secrets.json` are not exposed.

## Prompts

- `inkos_start`: start with project status and a Studio-style operation menu.
- `inkos_import_existing_novel`: preview first, commit deterministic chapters, then run external-agent settlement if needed.
- `inkos_continue_existing_book`: get a bounded context bundle, generate with the external agent, and write back through MCP.

## Current Limits

MCP mode reuses InkOS project files and indexes, but it does not call the internal Studio pipeline by default. The quality of generated foundation files, truth/state settlement, and chapter continuation depends on the external agent's output. Complex extraction can be less precise than a purpose-built InkOS internal agent run unless the external agent is prompted to produce equivalent structured files.
