# OpenAgent installation guide

Install OpenAgent for GitHub Copilot CLI with this one-command bootstrap:

```bash
curl -fsSL https://raw.githubusercontent.com/samcharles93/oh-my-copilot/main/scripts/install-openagent.cjs | node
```

## What the installer does

1. Clones `https://github.com/samcharles93/oh-my-copilot.git` into `~/.copilot/openagent/repo`
2. Runs `npm install`
3. Runs `npm run setup:copilot -- --force`
4. Installs a user-scoped Copilot extension wrapper at `~/.copilot/extensions/openagent/extension.mjs`

GitHub Copilot CLI discovers user extensions from `~/.copilot/extensions/<name>/extension.mjs`, so the installer configures that directory before any `/oa-*` command is available.

## Requirements

- GitHub Copilot CLI already installed
- Node.js 20+
- `git`
- `npm`

## After installation

1. Restart `copilot`, or run `/clear` if you already have a session open
2. Confirm the extension loaded with `/env` if you want a quick check
3. Start with `/oa-start <request>`

## Optional overrides

- `OPENAGENT_INSTALL_ROOT=/custom/path` changes where the managed repo checkout lives
- `COPILOT_EXTENSIONS_DIR=/custom/extensions` changes where the user-scoped extension wrapper is written

## Refreshing the install

Run the same command again. The installer recreates the managed checkout and refreshes the Copilot wrapper.
