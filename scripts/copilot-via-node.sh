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

# 1. ~/.copilot/pkg/<platform>-<arch>/<version>/index.js — the native binary's own JS,
#    always in sync with whatever version `copilot update` installed.
_find_pkg_js() {
  local platform arch pkg_dir latest
  case "$(uname -s)" in
    Linux*)  platform="linux" ;;
    Darwin*) platform="darwin" ;;
    *)       return ;;
  esac
  case "$(uname -m)" in
    x86_64)        arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *)             return ;;
  esac
  pkg_dir="${HOME}/.copilot/pkg/${platform}-${arch}"
  [[ -d "$pkg_dir" ]] || return
  latest="$(ls -1 "$pkg_dir" 2>/dev/null | sort -V | tail -1)"
  [[ -n "$latest" && -f "${pkg_dir}/${latest}/index.js" ]] || return
  echo "${pkg_dir}/${latest}/index.js"
}

COPILOT_JS="$(_find_pkg_js || true)"

# 2. npm global root
if [[ -z "$COPILOT_JS" ]] && command -v npm &>/dev/null; then
  NPM_ROOT="$(npm root -g 2>/dev/null)" || true
  if [[ -n "${NPM_ROOT:-}" && -f "${NPM_ROOT}/@github/copilot/index.js" ]]; then
    COPILOT_JS="${NPM_ROOT}/@github/copilot/index.js"
  fi
fi

# 3. Common npm global install locations
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
  echo "Error: Could not find Copilot CLI JS entry point." >&2
  echo "The native copilot binary hasn't run yet (no ~/.copilot/pkg/), or install via:" >&2
  echo "  npm install -g @github/copilot" >&2
  exit 1
fi

# Verify node version (copilot JS path requires >= 24)
NODE_MAJOR="$(node -e 'process.stdout.write(process.versions.node.split(".")[0])')"
if [[ "$NODE_MAJOR" -lt 24 ]]; then
  echo "Error: Copilot CLI JS mode requires Node.js >= 24 (found v$(node --version))." >&2
  exit 1
fi

exec node "$COPILOT_JS" "$@"
