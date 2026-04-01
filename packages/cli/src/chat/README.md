# InkOS Chat Interface

Interactive chat interface using **Ink** (React-like terminal UI framework) with full keyboard support including Tab autocomplete.

## Usage

```bash
# Start interactive chat
inkos chat <book-id>

# Auto-detect if only one book exists
inkos chat
```

## Features

### Interactive Commands

Type `/` and press **Tab** to see available commands with autocomplete:

- `/write` - Write next chapter
- `/audit [chapter]` - Audit chapter (latest if not specified)
- `/revise [chapter] --mode [polish|rewrite|rework]` - Revise chapter
- `/status` - Show book status
- `/clear` - Clear chat history
- `/help` - Show help information
- `/switch <book-id>` - Switch to another book
- `/exit` or `/quit` - Exit chat

### Tab Autocomplete ✨

**How it works:**
1. Type `/` to start a command
2. Press **Tab** to see matching commands
3. Use **↑↓ arrows** to navigate suggestions
4. Press **Tab** again to autocomplete selected command

**Example:**
```
> /w<Tab>
━━ Commands ━━
▶ /write - 写下一章（自动续写最新章之后的一章）
  /write --guidance - 带创作指导
  Tab: autocomplete | ↑↓: navigate
```

### Natural Language

You can also type naturally, and InkOS agent will understand your intent:

```
> 写下一章，增加一些动作戏
> 审计最新章节
> 这本书目前有多少字了？
```

## Architecture

Built with **Ink** (React for terminals):

```
packages/cli/src/chat/
├── index.tsx         # Main React components (Ink)
├── types.ts          # Type definitions
├── history.ts        # ChatHistoryManager (persistence)
├── session.ts        # ChatSession (agent integration)
├── commands.ts       # Slash command parser
└── errors.ts         # Error handling utilities
```

**Key Components:**
- `ChatInterface` - Main app container
- `MessageDisplay` - Render chat messages
- `TextInput` - Input with autocomplete support

## Technical Stack

**Framework**: Ink (React-like terminal UI)
- React hooks: useState, useEffect, useInput
- Component-based architecture
- Rich terminal rendering

**Dependencies**:
- `ink` - Core framework
- `react` - Component model
- `ink-text-input` - Input component
- `ink-spinner` - Loading indicator

## Key Features

### 1. Modern UI Framework

**Why Ink?**
- Full keyboard interactivity (Tab, arrows, etc.)
- React-like component system
- Modern ESM-native codebase
- Active maintenance & community

### 2. Tab Autocomplete

Real-time command discovery:
- Instant filtering as you type
- Arrow key navigation
- Visual highlighting of selected command
- Command descriptions shown inline

### 3. Rich Components

- **Spinner** for processing status
- **Colored output** (cyan, green, blue, etc.)
- **Bold/dim text** for emphasis
- **Dynamic updates** without flickering

### 4. Streaming Support

Real-time feedback during agent execution:
- Tool execution status
- Progress indicators
- Streaming message chunks

### 5. Auto History Management

- Automatic message pruning (configurable limit)
- Token usage tracking
- Per-book isolation (`.inkos/chat_history/<book-id>.json`)

### 6. Error Recovery

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

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| **Tab** | Autocomplete command |
| **↑** | Previous suggestion |
| **↓** | Next suggestion |
| **Esc** | Exit chat |
| **Enter** | Submit message |

## Differences from Old Implementations

| Feature | blessed | @clack/prompts | Ink |
|---------|---------|----------------|-----|
| Tab Autocomplete | ✅ | ❌ | ✅ |
| ESM Compatibility | ❌ Issues | ✅ | ✅ |
| Rendering Stability | ❌ Problems | ✅ Stable | ✅ Stable |
| Input Focus | ❌ Manual | ✅ Auto | ✅ Auto |
| Component Model | Low-level | Imperative | React-like |
| Modern Architecture | ❌ | ✅ | ✅ |
| Maintenance | Difficult | Easy | Easy |

## Future Enhancements

Now possible with Ink:
- [ ] Multi-line input support
- [ ] Rich text formatting
- [ ] Custom keybindings (Ctrl+C, Ctrl+L, etc.)
- [ ] Progress bars for long operations
- [ ] Interactive prompts (confirm, select)
- [ ] Split-screen layouts
- [ ] Export chat history to Markdown
- [ ] Book switching within chat

## Development

**Building**:
```bash
pnpm build
```

**Running in development**:
```bash
node packages/cli/dist/index.js chat <book-id>
```

## Known Limitations

**Terminal Size**: Ink adapts to terminal size but very small terminals (<80 cols) may have layout issues.
