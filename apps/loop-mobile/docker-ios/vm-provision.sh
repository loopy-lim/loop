#!/usr/bin/env bash
#
# docker-ios/vm-provision.sh — one-time toolchain bootstrap inside the macOS
# VM. Invoked over SSH by apps/loop-mobile/scripts/build-ios-docker.sh; the
# xcodes Apple ID / 2FA and sudo prompts surface in the caller's terminal.
#
# Idempotent: every step checks before installing, so re-running is safe.
#
# NOTE — deliberately Homebrew-free: Homebrew dropped Intel macOS (hard-fails
# on x86_64 since 2026). This VM is Intel, so everything comes from official
# distribution channels instead:
#   xcodes     GitHub release (universal binary)     → ~/bin
#   Xcode 26   via xcodes (last Intel-capable major; RN 0.88 floor) → /Applications
#   node       nodejs.org darwin-x64 tarball          → ~/tools/node
#   bun        bun.sh installer                       → ~/.bun
#   ruby       source build (zlib/libyaml/openssl first) → ~/tools/ruby
#   cocoapods  gem from the fresh ruby                → ~/tools/ruby
#
# Env overrides:
#   XCODE_MAJOR_VERSION  Xcode major to install (default 26)

set -euo pipefail

XCODE_MAJOR_VERSION="${XCODE_MAJOR_VERSION:-26}"
SRC="$HOME/tools/src"
LOCAL="$HOME/tools/local" # zlib / libyaml / openssl

say() { printf 'vm-provision: %s\n' "$1"; }

export PATH="$HOME/bin:$HOME/tools/node/bin:$HOME/.bun/bin:$HOME/tools/ruby/bin:$PATH"
NPROC="$(sysctl -n hw.ncpu)"

# ── 1) xcodes (standalone binary — no brew) ─────────────────────────────────
if ! command -v xcodes >/dev/null 2>&1; then
  say "installing xcodes (standalone release)..."
  mkdir -p "$HOME/bin"
  curl -fsSL -o /tmp/xcodes.zip \
    "https://github.com/XcodesOrg/xcodes/releases/latest/download/xcodes.zip"
  rm -rf /tmp/xcodes-extract && ditto -x -k /tmp/xcodes.zip /tmp/xcodes-extract
  mv /tmp/xcodes-extract/xcodes "$HOME/bin/xcodes"
  chmod +x "$HOME/bin/xcodes"
fi
command -v xcodes >/dev/null 2>&1 || { say "ERROR: xcodes missing"; exit 1; }

# ── 2) Xcode 26.x (Apple ID + 2FA + sudo prompts appear HERE) ───────────────
# /usr/bin/xcodebuild is a stub even with no Xcode — verify real output.
XCODE_PRESENT="$(xcodebuild -version 2>/dev/null | head -1 || true)"
if [ -n "$XCODE_PRESENT" ] && [ -z "${FORCE_XCODE:-}" ]; then
  say "Xcode already present: $XCODE_PRESENT"
else
  say "installing Xcode $XCODE_MAJOR_VERSION.x — Apple ID + 2FA prompts appear HERE."
  say "The xip download (~8-12GB) and unpack take a long while on this VM."
  xcodes install "$XCODE_MAJOR_VERSION" || {
    say "ERROR: xcodes install '$XCODE_MAJOR_VERSION' failed. Available majors:"
    xcodes list | awk '{print $1}' | cut -d. -f1 | sort -u | tr '\n' ' '
    echo
    exit 1
  }
  INSTALLED="$(xcodes installed | sort -V | tail -1 | awk '{print $1}')"
  say "selecting Xcode $INSTALLED and running first launch (license)..."
  sudo xcodes select "$INSTALLED"
  sudo xcodes runfirstlaunch \
    || say "runfirstlaunch failed — first xcodebuild run may re-ask the license."
  say "installed: $(xcodebuild -version | head -1)"
fi

# ── 3) node (official darwin-x64 tarball — Podfile resolves through node) ───
if ! command -v node >/dev/null 2>&1; then
  say "installing node v22.14.0 (darwin-x64)..."
  mkdir -p "$HOME/tools"
  curl -fsSL -o /tmp/node.tar.gz \
    "https://nodejs.org/dist/v22.14.0/node-v22.14.0-darwin-x64.tar.gz"
  tar xzf /tmp/node.tar.gz -C "$HOME/tools"
  rm -rf "$HOME/tools/node"
  mv "$HOME/tools/node-v22.14.0-darwin-x64" "$HOME/tools/node"
fi
command -v node >/dev/null 2>&1 || { say "ERROR: node missing"; exit 1; }

# ── 4) bun (repo lockfile is bun.lock) ──────────────────────────────────────
if ! command -v bun >/dev/null 2>&1; then
  say "installing bun..."
  curl -fsSL https://bun.sh/install | bash
fi
command -v bun >/dev/null 2>&1 || { say "ERROR: bun missing"; exit 1; }

# ── 5) ruby 3.3 from source (needs Xcode's clang → after step 2) ────────────
# macOS ships only ruby 2.6, but this repo needs CocoaPods 1.17 (ruby ≥3).
# macOS ships no zlib/libyaml/openssl headers either, so build those first.
need_ruby=1
if command -v ruby >/dev/null 2>&1; then
  RUBY_MAJOR="$(ruby -e 'puts RUBY_VERSION.split(".")[0..1].join(".")')"
  [ "$(ruby -e 'puts RUBY_VERSION >= "3.1" ? 1 : 0')" = "1" ] && need_ruby=0
fi
if [ "$need_ruby" = "1" ]; then
  say "building zlib, libyaml, openssl, ruby from source (~20-40 min)..."
  mkdir -p "$SRC" "$LOCAL" "$HOME/tools/ruby"
  cd "$SRC"
  fetch_build() { # fetch_build NAME URL BUILD_CMDS...
    local name="$1" url="$2"; shift 2
    if [ ! -d "$name" ]; then
      curl -fsSL -o "$name.tar.gz" "$url"
      tar xzf "$name.tar.gz"
    fi
    cd "$name"
    say "building $name..."
    "$@"
    cd "$SRC"
  }
  # All prefixes live under $HOME → plain `make install`, no sudo anywhere here.
  fetch_build zlib-1.3.1 https://github.com/madler/zlib/releases/download/v1.3.1/zlib-1.3.1.tar.gz \
    sh -c './configure --prefix='"$LOCAL"' && make -j'"$NPROC"' && make install' || true
  [ -e "$LOCAL/lib/libz.dylib" ] || { say "ERROR: zlib build failed"; exit 1; }
  fetch_build yaml-0.2.5 https://pyyaml.org/download/libyaml/yaml-0.2.5.tar.gz \
    sh -c './configure --prefix='"$LOCAL"' && make -j'"$NPROC"' && make install'
  [ -e "$LOCAL/lib/libyaml.dylib" ] || { say "ERROR: libyaml build failed"; exit 1; }
  fetch_build openssl-3.3.2 https://github.com/openssl/openssl/releases/download/openssl-3.3.2/openssl-3.3.2.tar.gz \
    sh -c './Configure --prefix='"$LOCAL"' shared no-tests && make -j'"$NPROC"' && make install_sw'
  [ -x "$LOCAL/bin/openssl" ] || { say "ERROR: openssl build failed"; exit 1; }
  fetch_build ruby-3.3.6 https://cache.ruby-lang.org/pub/ruby/3.3/ruby-3.3.6.tar.gz \
    sh -c './configure --prefix='"$HOME/tools/ruby"' --disable-install-doc \
       --with-openssl-dir='"$LOCAL"' --with-yaml-dir='"$LOCAL"' --with-zlib-dir='"$LOCAL"' \
       && make -j'"$NPROC"' && make install'
  command -v ruby >/dev/null 2>&1 || export PATH="$HOME/tools/ruby/bin:$PATH"
  ruby -v || { say "ERROR: ruby build failed"; exit 1; }
fi

# ── 6) cocoapods 1.17 (Podfile.lock requirement) ────────────────────────────
if ! command -v pod >/dev/null 2>&1; then
  say "installing cocoapods (rubygems)..."
  gem install cocoapods --no-document
fi
command -v pod >/dev/null 2>&1 || { say "ERROR: cocoapods missing"; exit 1; }

say "toolchain: $(xcodebuild -version | head -1) / node $(node -v) / bun $(bun -v) / ruby $(ruby -v | cut -d' ' -f2) / pod $(pod --version)"
say "provision complete. Next in the VM (human, one-time): open Xcode →"
say "Settings → Accounts → sign in with the Apple ID that owns the signing team."
