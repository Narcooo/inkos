# InkOS Chat Interface

Interactive chat interface using modern `@clack/prompts` library.

## Usage

```bash
# Start interactive chat
inkos chat <book-id>

# Auto-detect if only one book exists
inkos chat
```

## Features

### Interactive Commands

- `/help` - Show available commands
- `/status` - Display current book status
- `/clear` - Clear chat history
- `/exit` or `/quit` - Exit the chat

### Agent Integration

- `/write` - Write next chapter
- `/audit [chapter]` - Audit chapter (latest if not specified)
- `/revise [chapter] --mode [polish|rewrite|rework]` - Revise chapter

### Natural Language

You can also type naturally, and InkOS agent will understand your intent:

```
> 写下一章，增加一些动作戏
> 审计最新章节
> 这本书目前有多少字了？
```

## Architecture

```
packages/cli/src/chat/
├── index.ts          # ChatApp main class
├── types.ts          # Type definitions
├── history.ts        # ChatHistoryManager (persistence)
├── session.ts        # ChatSession (agent integration)
├── commands.ts       # Slash command parser
└── errors.ts         # Error handling utilities
```

## Key Features

### 1. Clean Architecture

- **UI Layer**: ChatApp using @clack/prompts
- **Business Logic**: ChatSession with runAgentLoop integration
- **Data Layer**: ChatHistoryManager for persistence

### 2. ESM Compatible

No more CommonJS/blessed compatibility issues.

### 3. Streaming Support

Real-time feedback during agent execution with spinner and progress messages.

### 4. Auto History Management

- Automatic message pruning (configurable limit)
- Token usage tracking
- Per-book isolation (`.inkos/chat_history/<book-id>.json`)

### 5. Error Recovery

User-friendly error messages with recovery suggestions.

## Testing

```bash
# Run all chat tests
pnpm test -- chat

# Specific test suites
pnpm test -- chat-history
pnpm test -- chat-commands
```

## Configuration

```bash
# Set max messages in history
inkos chat --max-messages 100 <book-id>

# Language preference
inkos chat --lang en <book-id>
```

## Differences from Old blessed TUI

| Feature | Old (blessed) | New (@clack/prompts) |
|---------|---------------|----------------------|
| ESM Compatibility | ❌ Issues | ✅ Native |
| Rendering Stability | ❌ Black screens, artifacts | ✅ Stable |
| Input Focus | ❌ Requires manual refocus | ✅ Automatic |
| Code Complexity | High (blessed widgets) | Low (declarative) |
| Dependencies | blessed + blessed-contrib | @clack/prompts only |
| Maintenance | Difficult | Easy |

## Future Enhancements

- [ ] Tab autocomplete for commands (requires custom readline implementation)
- [ ] Multi-line input support
- [ ] Rich text formatting in messages
- [ ] Auto-suggestions for slash commands
- [ ] Export chat history to Markdown
- [ ] Book switching within chat (using `/switch` command)

## Known Limitations

**Tab Autocomplete**: Not currently supported. Standard terminal prompt libraries (@clack/prompts, inquirer) don't support real-time tab completion like shells or IDEs. Implementing this would require custom readline handling or returning to blessed (which we removed for stability reasons).

**Workaround**: Type `/help` to see all commands, or reference the command list in this README.