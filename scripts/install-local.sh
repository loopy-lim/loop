#!/bin/sh
set -eu

# Preflight: fail fast with an actionable message before any build or install
# step when the toolchain is missing or too old. POSIX sh only.

version_ge() (
  # Succeed when the dot-separated numeric version in $1 is >= the one in $2.
  awk -v current="$1" -v required="$2" 'BEGIN {
    nc = split(current, cur, ".")
    nr = split(required, req, ".")
    total = (nc > nr) ? nc : nr
    for (i = 1; i <= total; i++) {
      c = (i <= nc) ? cur[i] + 0 : 0
      r = (i <= nr) ? req[i] + 0 : 0
      if (c != r) {
        exit (c < r) ? 1 : 0
      }
    }
    exit 0
  }'
)

installed_version() (
  # Print the first version-looking token from "$1 --version" (e.g. "1.4.1",
  # "cargo 1.88.0 (...)").
  "$1" --version 2>/dev/null | awk '{
    for (i = 1; i <= NF; i++) {
      if ($i ~ /^[0-9]+(\.[0-9]+)+([-+][A-Za-z0-9.-]+)?$/) {
        print $i
        exit
      }
    }
  }'
)

require_version() {
  tool_name=$1
  required_version=$2
  install_hint=$3

  if ! command -v "$tool_name" >/dev/null 2>&1; then
    echo "error: $tool_name was not found in PATH; Loop requires $tool_name >= $required_version." >&2
    echo "       Install: $install_hint" >&2
    exit 1
  fi

  found_version=$(installed_version "$tool_name")
  if [ -z "$found_version" ]; then
    echo "error: could not read a version from '$tool_name --version'; Loop requires $tool_name >= $required_version." >&2
    echo "       Install: $install_hint" >&2
    exit 1
  fi

  if ! version_ge "$found_version" "$required_version"; then
    echo "error: $tool_name $found_version is too old; Loop requires >= $required_version." >&2
    echo "       Install: $install_hint" >&2
    exit 1
  fi
}

require_version bun 1.4.1 "https://bun.sh (curl -fsSL https://bun.sh/install | bash, or your package manager)"
require_version cargo 1.88 "https://rustup.rs (rustup keeps cargo and rustc current)"
require_version rustc 1.88 "https://rustup.rs (rustup update stable)"

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
user_home=${HOME:?HOME is required}
bin_dir=${LOOP_INSTALL_BIN_DIR:-"$user_home/.local/bin"}
config_dir=${LOOP_CONFIG_DIR:-"$user_home/.config/loop"}
legacy_pi_extension_dir="$user_home/.pi/agent/extensions/loop"

cd "$repo_root"
bun run check
bun run build:cli

install -d "$bin_dir" "$config_dir"
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

install -m 0644 "$repo_root/dist/loop-pi-extension.js" "$bin_dir/loop-pi-extension.js"

if [ -f "$legacy_pi_extension_dir/index.js" ]; then
  rm -f "$legacy_pi_extension_dir/index.js"
fi
if [ -d "$legacy_pi_extension_dir" ]; then
  rmdir "$legacy_pi_extension_dir" 2>/dev/null || true
fi

if herdr plugin unlink loop.project >/dev/null 2>&1; then
  :
fi
herdr plugin link "$repo_root/plugins/loop-agent" --enabled

[ -f "$config_dir/models.toml" ] || install -m 0644 "$repo_root/config/models.toml" "$config_dir/models.toml"
[ -f "$config_dir/policy.toml" ] || install -m 0644 "$repo_root/config/policy.toml" "$config_dir/policy.toml"
[ -f "$config_dir/providers.toml" ] || install -m 0600 "$repo_root/config/providers.example.toml" "$config_dir/providers.toml"
LOOP_CONFIG_DIR="$config_dir" sh "$repo_root/scripts/install-personas.sh"

echo "Installed Loop CLI: $bin_dir/loop"
echo "Installed Loop Lead extension: $bin_dir/loop-pi-extension.js"
echo "Linked Herdr plugin: loop.agent"
echo "Configuration: $config_dir"
