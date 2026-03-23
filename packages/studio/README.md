# InkOS Studio (Simple GUI)

This is a minimal local GUI that wraps the InkOS CLI. It runs a tiny HTTP server and calls the CLI in the configured project directory.

Current Studio highlights:
- edit `project/brief.md` directly in the GUI
- generate a volume outline preview from the create-book form
- reload, regenerate, and save `volume_outline.md` for an existing book
- chat against `brief`, `volume_outline.md`, or a chapter file and apply the revised text back

## Prerequisites

1. Build the CLI (from repo root):

```bash
pnpm build
```

2. Ensure your InkOS project is initialized and has a valid `.env` (LLM config).

## Run

From the repo root:

```bash
# Option A: direct node
node packages/studio/server.cjs

# Option B: pnpm script
pnpm -C packages/studio dev
```

Then open:

```
http://127.0.0.1:8799
```

## Build EXE (Windows)

This produces a portable launcher EXE that still expects the InkOS repo (and built CLI) on disk.

```bash
pnpm -C packages/studio install
pnpm -C packages/studio build:exe
```

Output:

```
packages\studio\dist\inkos-studio.exe
```

Usage notes:
- Run the EXE from the repo root so it can find `packages/cli/dist/index.js`
- Or set `INKOS_REPO_ROOT` to the repo path

```bash
$env:INKOS_REPO_ROOT="D:\Codex\inkOS"
```

If the EXE cannot find your Node binary, set:

```bash
$env:INKOS_NODE_PATH="C:\Program Files\nodejs\node.exe"
```

Auto-open browser can be toggled:

```bash
$env:INKOS_AUTO_OPEN=0
```

## Project Root

By default the GUI targets:

```
d:\Codex\inkOS\project
```

To point to a different InkOS project directory:

```bash
# PowerShell
$env:INKOS_PROJECT_ROOT="D:\path\to\your\inkos-project"

# CMD
set INKOS_PROJECT_ROOT=D:\path\to\your\inkos-project
```

## Proxy (optional)

If you need a local proxy (e.g. 7890):

```bash
# PowerShell
$env:HTTP_PROXY="http://127.0.0.1:7890"
$env:HTTPS_PROXY="http://127.0.0.1:7890"

# CMD
set HTTP_PROXY=http://127.0.0.1:7890
set HTTPS_PROXY=http://127.0.0.1:7890
```

## Troubleshooting

- **CLI not found**: run `pnpm build` in the repo root so `packages/cli/dist/index.js` exists.
- **No books / cannot create book**: verify the project directory contains `inkos.json` and `.env`.
- **API errors**: confirm `.env` has valid `INKOS_LLM_*` values and the base URL is reachable.
