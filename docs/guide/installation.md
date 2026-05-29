# OpenAgent installation guide

Install OpenAgent for GitHub Copilot CLI and VS Code Copilot with this one-command bootstrap:

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/samcharles93/openagent/main/scripts/install-openagent.cjs | node
```

**Windows PowerShell**

```powershell
(Invoke-WebRequest "https://raw.githubusercontent.com/samcharles93/openagent/main/scripts/install-openagent.cjs").Content | node
```

## What the installer does

1. Clones `https://github.com/samcharles93/openagent.git` into `~/.copilot/openagent/repo`
2. Runs `bun install`
3. Runs `bun run setup:copilot -- --force`
4. Installs a user-scoped Copilot extension wrapper at `~/.copilot/extensions/openagent/extension.mjs`
5. Installs native custom agent profiles at `~/.copilot/agents/*.agent.md`
6. Installs `copilot-oa` in `%APPDATA%\npm` on Windows or `~/.local/bin` on Unix-like systems

GitHub Copilot CLI discovers user extensions from `~/.copilot/extensions/<name>/extension.mjs`, so the installer configures that directory before any `/oa-*` command is available. Copilot CLI and VS Code discover native custom agents from `~/.copilot/agents`, and this repository also ships workspace-level profiles under `.github/agents`.

## Requirements

- GitHub Copilot CLI already installed (`npm install -g @github/copilot`)
- Bun 1.0+ for the SDK extension (`copilot-oa` wrapper)
- Node.js 20+ for native agents only
- `git`
- `bun`

## After installation

1. Restart `copilot`, or run `/clear` if you already have a session open
2. Reload VS Code windows that should pick up OpenAgent custom agents
3. Confirm the extension loaded with `/env` if you want a quick check
4. Start with `/oa-start <request>` or select a custom agent (e.g. `conductor`, `architect`)

### SDK extension (full features)

The SDK extension provides `/oa-*` commands, tools, hooks, routing, and workspace persistence. It requires Bun 1.0+ and running Copilot CLI via Node.js instead of the native binary:

```bash
copilot-oa
```

The native Copilot binary uses itself as `process.execPath`, which breaks `child_process.fork()` when launching SDK extensions. The `copilot-oa` wrapper runs Copilot through Node so fork() works correctly.

### Native agents only

If you only need the custom agent personas (no commands/tools/hooks), use the standard binary:

```bash
copilot --agent conductor
```

## Optional overrides

- `OPENAGENT_REPO_URL=https://github.com/<owner>/<repo>.git` overrides the managed checkout source
- `OPENAGENT_INSTALL_ROOT=/custom/path` changes where the managed repo checkout lives
- `COPILOT_EXTENSIONS_DIR=/custom/extensions` changes where the user-scoped extension wrapper is written
- `COPILOT_AGENTS_DIR=/custom/agents` changes where native custom agent profiles are written
- `OPENAGENT_BIN_DIR=/custom/bin` changes where `copilot-oa` is installed (default: `%APPDATA%\npm` on Windows, `~/.local/bin` elsewhere)

## Refreshing the install

Run the same command again. The installer recreates the managed checkout and refreshes the Copilot wrapper.

For local development, run `bun run setup:copilot` after moving the checkout. Run `bun run setup:agents` when you only need to refresh native custom agent profiles.
