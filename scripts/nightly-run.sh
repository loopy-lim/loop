#!/usr/bin/env bash
set -euo pipefail

# One scheduled pass over unfinished Loop runs. No credentials are read or
# printed here; native providers use their existing authenticated CLI stores.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
loop_bin="$repo_root/dist/loop"
if [ ! -x "$loop_bin" ]; then
  echo "nightly-run: build the packaged Loop CLI first (bun run build:cli)" >&2
  exit 1
fi
export PATH="$HOME/.local/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
args=(nightly --execute --json)
if [ -n "${LOOP_CONFIG_DIR:-}" ]; then args+=(--config "$LOOP_CONFIG_DIR"); fi
if [ -n "${LOOP_NIGHTLY_DATABASE_PATH:-}" ]; then args+=(--database "$LOOP_NIGHTLY_DATABASE_PATH"); fi
if command -v fnm >/dev/null 2>&1; then
  # launchd has no interactive shell profile. `fnm exec` supplies the default
  # Node installation (including pi) to this process and detached workers.
  exec fnm exec --using default -- "$loop_bin" "${args[@]}"
fi
if ! command -v node >/dev/null 2>&1 || ! command -v pi >/dev/null 2>&1; then
  echo "nightly-run: Node and pi are unavailable; install fnm or expose both in PATH" >&2
  exit 1
fi
exec "$loop_bin" "${args[@]}"
