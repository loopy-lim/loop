#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
user_home=${HOME:?HOME is required}
bin_dir=${LOOP_INSTALL_BIN_DIR:-"$user_home/.local/bin"}
config_dir=${LOOP_CONFIG_DIR:-"$user_home/.config/loop"}
pi_extension_dir=${LOOP_PI_EXTENSION_DIR:-"$user_home/.pi/agent/extensions/loop"}

cd "$repo_root"
bun run check
bun run build:cli

install -d "$bin_dir" "$config_dir" "$pi_extension_dir"
if [ ! -e "$bin_dir/loop" ] || [ ! "$repo_root/dist/loop" -ef "$bin_dir/loop" ]; then
  install -m 0755 "$repo_root/dist/loop" "$bin_dir/loop"
fi

if [ -f "$repo_root/dist/libloop_bridge.dylib" ]; then
  install -m 0644 "$repo_root/dist/libloop_bridge.dylib" "$bin_dir/libloop_bridge.dylib"
elif [ -f "$repo_root/dist/libloop_bridge.so" ]; then
  install -m 0644 "$repo_root/dist/libloop_bridge.so" "$bin_dir/libloop_bridge.so"
elif [ -f "$repo_root/dist/loop_bridge.dll" ]; then
  install -m 0644 "$repo_root/dist/loop_bridge.dll" "$bin_dir/loop_bridge.dll"
fi

install -m 0644 "$repo_root/dist/loop-pi-extension.js" "$pi_extension_dir/index.js"

[ -f "$config_dir/models.toml" ] || install -m 0644 "$repo_root/config/models.toml" "$config_dir/models.toml"
[ -f "$config_dir/policy.toml" ] || install -m 0644 "$repo_root/config/policy.toml" "$config_dir/policy.toml"
[ -f "$config_dir/providers.toml" ] || install -m 0600 "$repo_root/config/providers.example.toml" "$config_dir/providers.toml"

echo "Installed Loop CLI: $bin_dir/loop"
echo "Installed Pi extension: $pi_extension_dir/index.js"
echo "Configuration: $config_dir"
