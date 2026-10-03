#!/usr/bin/env bash
# Foreground runner for the Loop gateway bound to this machine's Tailscale IP.
#
# Used both for manual runs (`bun run gateway:serve`) and as the launchd
# service program (see docs/research/app-device-install.md). Boot-time
# credentials are read from ~/.loop/gateway.env (0600, user-managed); this
# script never writes or prints them.
#
# Overridable defaults:
#   LOOP_GATEWAY_HOST           100.80.133.120 (Tailscale IP)
#   LOOP_GATEWAY_PORT           18477
#   LOOP_GATEWAY_DATABASE_PATH  ~/.loop/gateway/loop.db
set -euo pipefail

ENV_FILE="${LOOP_GATEWAY_ENV_FILE:-$HOME/.loop/gateway.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

export LOOP_GATEWAY_HOST="${LOOP_GATEWAY_HOST:-100.80.133.120}"
export LOOP_GATEWAY_PORT="${LOOP_GATEWAY_PORT:-18477}"
export LOOP_GATEWAY_DATABASE_PATH="${LOOP_GATEWAY_DATABASE_PATH:-$HOME/.loop/gateway/loop.db}"
export LOOP_GATEWAY_JWT_ISSUER="${LOOP_GATEWAY_JWT_ISSUER:-loop-gateway}"
export LOOP_GATEWAY_JWT_AUDIENCE="${LOOP_GATEWAY_JWT_AUDIENCE:-loop-gateway}"

if [ -z "${LOOP_GATEWAY_JWT_SECRET:-}" ]; then
  {
    echo "gateway-serve: LOOP_GATEWAY_JWT_SECRET is not set."
    echo "Create $ENV_FILE (chmod 600) containing:"
    echo "  LOOP_GATEWAY_JWT_SECRET=<random hex>"
    echo "  LOOP_GATEWAY_JWT_ISSUER=loop-gateway"
    echo "  LOOP_GATEWAY_JWT_AUDIENCE=loop-gateway"
    echo "See docs/research/app-device-install.md §3."
  } >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Resolve bun robustly (launchd runs with a minimal PATH).
BUN_BIN="${BUN_BIN:-$(command -v bun || true)}"
if [ -z "$BUN_BIN" ] && [ -x "$HOME/.bun/bin/bun" ]; then
  BUN_BIN="$HOME/.bun/bin/bun"
fi
if [ -z "$BUN_BIN" ]; then
  echo "gateway-serve: bun executable not found (set BUN_BIN)" >&2
  exit 1
fi

exec "$BUN_BIN" packages/gateway/src/main.ts
