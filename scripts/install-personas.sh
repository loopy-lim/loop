#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
config_dir=${LOOP_CONFIG_DIR:-"${HOME:?HOME is required}/.config/loop"}
install -d "$config_dir/personas"
for source in "$repo_root"/config/personas/*; do
  target="$config_dir/personas/$(basename "$source")"
  if [ ! -e "$target" ] && [ ! -L "$target" ]; then
    install -m 0644 "$source" "$target"
  fi
done
