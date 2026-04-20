#!/usr/bin/env bash
# copilot-oa: Run GitHub Copilot CLI via Node.js for full SDK extension support.
#
# The native Copilot binary uses itself as process.execPath, which breaks
# child_process.fork() when launching SDK extensions. Running via Node keeps
# process.execPath pointing at the Node binary, allowing fork() to work.
#
# Requires: node >= 24, @github/copilot installed via npm
#
# Usage:
#   copilot-oa                # interactive session
#   copilot-oa --agent X      # start with a specific agent
#   copilot-oa --version      # show version

set -euo pipefail

COPILOT_JS=""

# 1. Try npm global root
if command -v npm &>/dev/null; then
  NPM_ROOT="$(npm root -g 2>/dev/null)" || true
  if [[ -n "${NPM_ROOT:-}" && -f "${NPM_ROOT}/@github/copilot/index.js" ]]; then
    COPILOT_JS="${NPM_ROOT}/@github/copilot/index.js"
  fi
fi

# 2. Fallback: common global install locations
if [[ -z "$COPILOT_JS" ]]; then
  for candidate in \
    "${HOME}/.npm-global/lib/node_modules/@github/copilot/index.js" \
    "/usr/local/lib/node_modules/@github/copilot/index.js" \
    "/usr/lib/node_modules/@github/copilot/index.js"; do
    if [[ -f "$candidate" ]]; then
      COPILOT_JS="$candidate"
      break
    fi
  done
fi

if [[ -z "$COPILOT_JS" ]]; then
  echo "Error: Could not find @github/copilot npm package." >&2
  echo "Install it with: npm install -g @github/copilot" >&2
  exit 1
fi

# Verify node version (copilot JS path requires >= 24)
NODE_MAJOR="$(node -e 'process.stdout.write(process.versions.node.split(".")[0])')"
if [[ "$NODE_MAJOR" -lt 24 ]]; then
  echo "Error: Copilot CLI JS mode requires Node.js >= 24 (found v$(node --version))." >&2
  exit 1
fi

exec node "$COPILOT_JS" "$@"
