#!/usr/bin/env bash
# Thin root-level wrapper for the iOS simulator Release build.
#
# The canonical implementation lives in
# apps/loop-mobile/scripts/build-ios-simulator.sh and resolves its own
# location via BASH_SOURCE, so this wrapper only forwards arguments and
# exit status. Kept at the repo root so tooling that invokes
# `bash scripts/build-ios-simulator.sh` from the workspace root works
# without duplicating build logic.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/../apps/loop-mobile/scripts/build-ios-simulator.sh" "$@"
