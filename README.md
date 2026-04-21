# OpenAgent for GitHub Copilot

OpenAgent adds orchestration-first planning, routing, handoffs, review workflows, durable workspace notes, and specialist personas to GitHub Copilot CLI and VS Code Copilot.

## Two modes of operation

OpenAgent ships both **native custom agents** (`.agent.md` files) and a full **SDK extension** with commands, tools, hooks, and routing.

| Feature | Native agents | SDK extension |
|---|---|---|
| Custom agent personas (planner, critic, implementer, …) | ✓ | ✓ |
| `/oa-*` slash commands | — | ✓ |
| OpenAgent tools (24 tools) | — | ✓ |
| Hooks (plan bias, guardrails, context loading) | — | ✓ |
| Phase routing and workspace persistence | — | ✓ |
| Continuation loops (`/oa-loop`) | — | ✓ |
| Handoff artifacts | — | ✓ |

Native agents work with the standard `copilot` binary. The SDK extension requires running Copilot via Node (see below).

## Installation

### For humans

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/samcharles93/openagent/main/scripts/install-openagent.cjs | node
```

**Windows PowerShell**

```powershell
(Invoke-WebRequest "https://raw.githubusercontent.com/samcharles93/openagent/main/scripts/install-openagent.cjs").Content | node
```

That command:

1. Clones this repository into `~/.copilot/openagent/repo`
2. Installs dependencies with Bun
3. Installs the Copilot extension wrapper
4. Installs native custom agent profiles in `~/.copilot/agents`
5. Installs `copilot-oa` in `%APPDATA%\npm` on Windows or `~/.local/bin` on Unix-like systems

### Using OpenAgent

**Native agents only** (works with the standard binary):

```bash
copilot --agent openagent-planner
```

**Full SDK extension** (requires Bun and the Node wrapper):

```bash
copilot-oa
# then: /oa-start <request>
```

The `copilot-oa` wrapper runs Copilot CLI via Node instead of the native binary. This is needed because the native binary's `process.execPath` breaks `child_process.fork()` when launching SDK extensions. Running via Node keeps `process.execPath` pointing at the Node binary so fork() works correctly.

### For LLM agents

Give your agent this instruction:

```text
Install and configure OpenAgent for GitHub Copilot CLI by following the instructions here:
https://raw.githubusercontent.com/samcharles93/openagent/main/docs/guide/installation.md
```

## Development

For local development from a checked-out repo:

```bash
bun install
bun run setup:copilot
```

This installs the Copilot extension wrapper, native agents, and the `copilot-oa` wrapper.

## Notes

- The public installer uses Node, `git`, and `npm`.
- Bun 1.0+ is required for the SDK extension (the `copilot-oa` wrapper).
- Native custom agents work with Node.js 20+.
- Set `OPENAGENT_INSTALL_ROOT` to change where the managed checkout is cloned.
- Set `COPILOT_EXTENSIONS_DIR` if you want Copilot to load user extensions from a non-default directory.
- Set `COPILOT_AGENTS_DIR` if you want native custom agents written somewhere other than `~/.copilot/agents`.
- Set `OPENAGENT_BIN_DIR` to change where `copilot-oa` is installed (default: `%APPDATA%\npm` on Windows, `~/.local/bin` elsewhere).
- Run `bun run setup:agents` to refresh only the native custom agent profiles.
