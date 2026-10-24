# Contributing

## Setup

```bash
git clone https://github.com/Narcooo/inkos.git
cd inkos
pnpm install
pnpm build
pnpm test
```

Node ≥ 22.16, pnpm ≥ 9.

## Project Structure

```
packages/
  core/    # Agents, harness, pipeline, state management, LLM providers
  cli/     # Commander.js commands (28 commands)
  studio/  # InkOS Studio web workbench (React client + API server)
```

Monorepo managed with pnpm workspaces. `cli` and `studio` both depend on `core` via `workspace:*`.

## Development

```bash
pnpm dev          # Watch mode (all packages)
pnpm build        # Build once
pnpm test         # Run all tests
pnpm typecheck    # Type-check without emitting
```

## Commit Convention

```
<type>: <description>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

Keep commits atomic — one logical change per commit. Split new files, interface changes, tests, and docs into separate commits when they're non-trivial.

## Pull Request Checklist

- [ ] `pnpm build` passes
- [ ] `pnpm test` passes (all existing + new tests)
- [ ] `pnpm typecheck` passes
- [ ] New features have tests
- [ ] No unrelated formatting changes (keep diffs focused)
- [ ] Commit messages follow the convention above

## Code Style

- TypeScript, strict mode
- 2-space indentation
- Immutable patterns: `{ ...obj, key: value }` over mutation
- Functions < 50 lines, files < 800 lines
- Errors must surface, not be swallowed (`catch { }` without re-throw needs a comment)
- Publishable package manifests must use registry-installable internal versions, not `workspace:*`; `pnpm` links local packages through the workspace config during development.

## Adding a CLI Command

1. Create `packages/cli/src/commands/<name>.ts`
2. Export a `Command` instance
3. Register it in `packages/cli/src/program.ts`
4. Add `--json` output support
5. Support book-id auto-detection when only one book exists

## Adding a Skill

Skills are directories that contain a `SKILL.md` manifest. The YAML frontmatter requires a `name` (normalized into the skill id) and a `description`; everything after the frontmatter is the method body loaded into agent context.

1. Create `packages/core/skills/<id>/SKILL.md`
2. Add YAML frontmatter with a `name` and a `description`
3. Add the method body below the frontmatter

InkOS ships 20 built-in skills from `packages/core/skills/`. A skill in a project directory (`.agents/skills/`, `skills/`), a user directory (`~/.agents/skills`, `~/.openclaw/skills`), or a directory listed in `INKOS_SKILL_DIRS` overrides the built-in method with the same id.

## Testing

Tests live next to source in `__tests__/` directories. We use Vitest.

```bash
pnpm --filter @actalk/inkos-core test    # Core tests only
pnpm --filter @actalk/inkos test         # CLI tests only
pnpm --filter @actalk/inkos-studio test  # Studio tests only
```

For features touching the LLM pipeline, mock the LLM calls — don't make real API requests in tests.

## Questions?

Open an issue or check existing ones: https://github.com/Narcooo/inkos/issues
