# OpenAgent for GitHub Copilot CLI

OpenAgent adds orchestration-first planning, routing, handoffs, review workflows, durable workspace notes, and specialist personas to GitHub Copilot CLI.

## Installation

### For humans

Copy and paste this into a terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/samcharles93/oh-my-copilot/main/scripts/install-openagent.cjs | node
```

That command:

1. Clones this repository into `~/.copilot/openagent/repo`
2. Installs dependencies
3. Builds the extension
4. Registers a user-scoped Copilot extension wrapper in `~/.copilot/extensions/openagent`

After it finishes, restart `copilot` or run `/clear`, then start with:

```text
/oa-start <request>
```

### For LLM agents

Give your agent this instruction:

```text
Install and configure OpenAgent for GitHub Copilot CLI by following the instructions here:
https://raw.githubusercontent.com/samcharles93/oh-my-copilot/main/docs/guide/installation.md
```

## Development

For local development from a checked-out repo:

```bash
npm install
npm run setup:copilot
```

## Notes

- The public installer uses Node, `git`, and `npm`.
- Set `OPENAGENT_INSTALL_ROOT` to change where the managed checkout is cloned.
- Set `COPILOT_EXTENSIONS_DIR` if you want Copilot to load user extensions from a non-default directory.
