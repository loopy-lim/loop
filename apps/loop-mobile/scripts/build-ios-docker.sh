#!/usr/bin/env bash
#
# Docker-iOS build wizard for LoopMobile: boots a macOS VM (dockur/macos) in
# Docker, provisions Xcode inside it, builds apps/loop-mobile/ios, and
# installs to a paired iPhone — no Mac required.
#
# Companion to device-build-wizard.sh, which assumes a real Mac. Human-only
# stages here (macOS first-boot setup, Remote Login, Xcode Apple ID login,
# iPhone trust/pairing) happen in the browser at http://localhost:8006;
# terminal prompts (Apple ID 2FA, sudo) surface in this terminal.
#
# Usage:
#   bash scripts/build-ios-docker.sh [--preflight-only]
#
# Prerequisites and fixes are printed by the preflight (stage 0). Research
# and design: docs/research/2026-10-22-docker-xcode-iphone.md.

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────
# Wizard library: delightful, consistent UX, identical across every wizard.
# ──────────────────────────────────────────────────────────────────────────

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
  BLUE=$(tput setaf 4); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3); RED=$(tput setaf 1)
else
  BOLD=""; DIM=""; RESET=""; BLUE=""; GREEN=""; YELLOW=""; RED=""
fi

# Author sets this at the top of the stages section.
TOTAL_STAGES=0

_STAGE_INDEX=0
ENV_FILE="${ENV_FILE:-.env}"
WRITTEN_ENV=()    # KEYs written to ENV_FILE this run
WRITTEN_SECRET=() # secret NAMEs set this run
SKIPPED=()        # things we couldn't do (e.g. gh missing)

# _clear wipes the terminal so only the current step is on screen. No-op when
# output isn't a terminal, so piped logs stay readable.
_clear() {
  [[ -t 1 ]] || return 0
  if command -v tput >/dev/null 2>&1; then tput clear; else printf '\033[2J\033[3J\033[H'; fi
}

# banner "Title" shows the opening frame: what this wizard does.
banner() {
  _clear
  printf '\n%s%s  %s%s\n' "$BOLD" "$BLUE" "$1" "$RESET"
  printf '%s  %s stages%s\n\n' "$DIM" "$TOTAL_STAGES" "$RESET"
  printf '%s  VM 화면이 필요한 단계는 브라우저 localhost:8006에서 하고, Apple ID·sudo\n' "$DIM"
  printf '  프롬프트는 이 터미널로 옵니다. Ctrl-C로 언제든 멈출 수 있고 다시 실행하면\n' "$DIM"
  printf '  저장된 값과 VM 상태를 이어받습니다.%s\n\n' "$RESET"
  pause "Ready to start?"
}

# stage "Name" clears the screen, then announces a stage and shows progress.
stage() {
  _clear
  _STAGE_INDEX=$((_STAGE_INDEX + 1))
  printf '\n%s%s▸ Stage %s/%s · %s%s\n' \
    "$BOLD" "$BLUE" "$_STAGE_INDEX" "$TOTAL_STAGES" "$1" "$RESET"
}

# say "..." prints a plain instruction line.
say()  { printf '  %s\n' "$1"; }
# step "..." is a numbered-feeling action the human takes in the browser.
step() { printf '  %s•%s %s\n' "$BLUE" "$RESET" "$1"; }
note() { printf '  %s%s%s\n' "$DIM" "$1" "$RESET"; }
warn() { printf '  %s⚠ %s%s\n' "$YELLOW" "$1" "$RESET"; }
fail() { printf '  %s✗ %s%s\n' "$RED" "$1" "$RESET"; }

# open_url URL opens it in the human's browser, cross-platform incl. WSL.
open_url() {
  local url="$1"
  printf '  %s↗ opening%s %s\n' "$GREEN" "$RESET" "$url"
  { if   command -v wslview     >/dev/null 2>&1; then wslview "$url"
    elif command -v explorer.exe >/dev/null 2>&1; then explorer.exe "$url"
    elif command -v xdg-open    >/dev/null 2>&1; then xdg-open "$url"
    else command -v open        >/dev/null 2>&1 && open "$url"
    fi
  } >/dev/null 2>&1 || warn "couldn't open it; visit manually: $url"
}

# pause "msg" waits for the human to confirm they've done the manual part.
pause() {
  printf '  %s%s%s ' "$DIM" "${1:-Press Enter to continue}" "$RESET"
  read -r _ || true
}

# confirm "question" is a y/N gate; returns success on yes.
confirm() {
  local reply=""
  printf '  %s? %s [y/N] ' "$YELLOW" "$1"
  read -r reply || true
  [[ "$reply" =~ ^[Yy] ]]
}

# _existing KEY: current value of KEY in ENV_FILE, if any.
_existing() {
  [[ -f "$ENV_FILE" ]] || return 1
  local line; line=$(grep -E "^${1}=" "$ENV_FILE" | tail -n1) || return 1
  printf '%s' "${line#*=}"
}

# ask KEY "Prompt" reads a value into $KEY. Offers the existing .env value as
# a default on re-runs (Enter keeps it). Visible input (non-secret).
ask() {
  local key="$1" prompt="$2" current input
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[Enter keeps current]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -r input || true
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

# write_env KEY VALUE upserts KEY=VALUE into ENV_FILE (creates it; replaces
# any existing line). Idempotent.
write_env() {
  local key="$1" value="$2" tmp
  touch "$ENV_FILE"
  tmp=$(mktemp)
  grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  WRITTEN_ENV+=("$key")
  printf '  %s✓ wrote%s %s → %s\n' "$GREEN" "$RESET" "$key" "$ENV_FILE"
}

# finish clears, then shows a closing summary of everything configured.
finish() {
  _clear
  printf '\n%s%s  ✓ Setup complete%s\n' "$BOLD" "$GREEN" "$RESET"
  (( ${#WRITTEN_ENV[@]} )) && note "wrote ${#WRITTEN_ENV[@]} value(s) to $ENV_FILE: ${WRITTEN_ENV[*]}"
  if (( ${#SKIPPED[@]} )); then
    printf '\n'; warn "still to do by hand:"
    for s in "${SKIPPED[@]}"; do note "  - $s"; done
  fi
  printf '\n'
}

# ──────────────────────────────────────────────────────────────────────────
# Stages.
# ──────────────────────────────────────────────────────────────────────────

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DOCKER_DIR="$APP_DIR/docker-ios"
SSH_KEY="$IOS_DOCKER_DIR/.ssh_ed25519"
KNOWN_HOSTS="$IOS_DOCKER_DIR/.known_hosts"
SSH_PORT="2222"
COMPOSE="docker compose -f $IOS_DOCKER_DIR/docker-compose.yml -p loop-ios"

PREFLIGHT_ONLY=0
[[ "${1:-}" == "--preflight-only" ]] && PREFLIGHT_ONLY=1

# _preflight prints one check's result. Non-zero argument = fatal.
# Usage: _check "라벨" <ok?> [수정 명령] — fatal checks abort via caller.
PREFLIGHT_FATAL=0
check() {
  local label="$1" ok="$2" fix="${3:-}" fatal="${4:-yes}"
  if [[ "$ok" == "ok" ]]; then
    printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$label"
  else
    if [[ "$fatal" == "yes" ]]; then PREFLIGHT_FATAL=1; fail "$label"; else warn "$label (계속 가능)"; fi
    [[ -n "$fix" ]] && note "    → $fix"
  fi
}

preflight() {
  PREFLIGHT_FATAL=0
  printf '\n%s%s프리플라이트 — 이 머신이 macOS VM을 띄울 수 있는지%s\n' "$BOLD" "$BLUE" "$RESET"

  if command -v docker >/dev/null 2>&1; then
    check "docker CLI 있음" ok
  else
    check "docker 미설치" no \
      "WSL 안: sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 && sudo usermod -aG docker \$USER → Windows에서 wsl --shutdown 후 재시작. 또는 Docker Desktop for Windows 설치(WSL integration 켜기)"
  fi

  if docker info >/dev/null 2>&1; then
    check "docker 데몬 접근 가능" ok
  elif command -v docker >/dev/null 2>&1; then
    check "docker 데몬에 접근 불가(소켓 권한)" no \
      "sudo usermod -aG docker \$USER 후 wsl --shutdown → WSL 재시작"
  fi

  if docker compose version >/dev/null 2>&1; then
    check "docker compose v2 있음" ok
  else
    check "docker compose v2 없음" no "sudo apt-get install -y docker-compose-v2"
  fi

  if [[ -e /dev/kvm ]]; then
    check "/dev/kvm 있음 (KVM 가속)" ok
  else
    check "/dev/kvm 없음 — VM이 매우 느려지거나 부팅 불가" no "Windows 가상화 활성화 확인(WSL2 중첩 가상화)" yes
  fi

  if [[ -e /dev/net/tun ]]; then
    check "/dev/net/tun 있음" ok
  else
    check "/dev/net/tun 없음" no "sudo modprobe tun"
  fi

  local avail_kb
  avail_kb=$(df -Pk "$APP_DIR" | awk 'NR==2 {print $4}')
  if (( avail_kb > 60 * 1024 * 1024 )); then
    check "디스크 여유 충분 ($(( avail_kb / 1024 / 1024 ))GB > 60GB)" ok
  else
    check "디스크 여유 부족 — VM 디스크 볼륨이 자랄 공간 필요" no "공간 확보 후 재실행"
  fi

  if command -v ssh-keygen >/dev/null 2>&1 && command -v rsync >/dev/null 2>&1; then
    check "ssh-keygen·rsync 있음" ok
  else
    check "ssh-keygen 또는 rsync 없음" no "sudo apt-get install -y openssh-client rsync"
  fi

  if [[ "$PREFLIGHT_FATAL" -ne 0 ]]; then
    printf '\n%s필수 전제가 빠졌습니다. 위 → 명령으로 설치한 뒤 다시 실행하세요.%s\n' "$RED" "$RESET"
    return 1
  fi
  printf '\n%s프리플라이트 통과%s\n' "$GREEN" "$RESET"
}

if [[ "$PREFLIGHT_ONLY" -eq 1 ]]; then
  preflight || exit 1
  exit 0
fi

preflight || { pause "설치 후 Enter를 누르면 재검사합니다 (Ctrl-C로 끝)"; preflight; } || {
  fail "전제가 여전히 빠져 있습니다 — 설치를 마치고 다시 실행하세요."
  exit 1
}

# SSH helper: batch (non-interactive) command over the VM tunnel.
ssh_vm() {
  ssh -p "$SSH_PORT" -i "$SSH_KEY" -o IdentitiesOnly=yes \
    -o UserKnownHostsFile="$KNOWN_HOSTS" -o StrictHostKeyChecking=accept-new \
    -o BatchMode=yes -o ConnectTimeout=5 \
    "${VM_USER:?VM_USER unset}@localhost" "$@"
}

TOTAL_STAGES=5

banner "LoopMobile Docker-iOS · macOS VM 빌드 · iPhone 설치"

# ── 1. VM 기동 ─────────────────────────────────────────────────────────────
stage "1/5 · macOS VM 기동"
say "dockur/macos 이미지로 VM을 띄웁니다(볼륨 loop-ios-vm — VM 상태는 유지됨)."
$COMPOSE up -d
note "  VM 콘솔 로그: $COMPOSE logs -f macos"
printf '  %s웹 뷰어(8006) 응답 대기%s ' "$DIM" "$RESET"
for i in $(seq 1 60); do
  if curl -fsS --max-time 3 http://localhost:8006 >/dev/null 2>&1; then break; fi
  printf '.'; sleep 10
done
echo
if curl -fsS --max-time 3 http://localhost:8006 >/dev/null 2>&1; then
  say "웹 뷰어가 떠 있습니다: http://localhost:8006"
else
  warn "웹 뷰어가 10분 내에 응답하지 않았습니다. 첫 기동은 macOS 복구 이미지(~1GB)를"
  warn "다운로드하며 더 걸릴 수 있습니다. $COMPOSE logs -f macos 로 진행을 확인하세요."
  SKIPPED+=("웹 뷰어 응답 확인 (로그로 수동 확인)")
fi

# ── 2. 첫 부팅 설정 + SSH (사람) ───────────────────────────────────────────
stage "2/5 · 첫 부팅 설정 + SSH 접속 준비 (사람, 브라우저)"
ask LOOP_IOS_VM_USER "VM 관리자 사용자명 입력 [기본 loop]:"
VM_USER=${LOOP_IOS_VM_USER:-loop}
write_env LOOP_IOS_VM_USER "$VM_USER"

if [[ ! -f "$SSH_KEY" ]]; then
  ssh-keygen -t ed25519 -N '' -C loop-ios-docker -f "$SSH_KEY" >/dev/null
  note "  VM 접속 키를 새로 만들었습니다: $SSH_KEY"
fi
PUBKEY="$(cat "$SSH_KEY.pub")"

step "브라우저에서 http://localhost:8006 열기 (이미 열었으면 건너뛰기)."
open_url "http://localhost:8006"
step "macOS 설치 마법사를 끝내고 관리자 계정을 만드세요 (사용자명: $VM_USER 권장)."
step "시스템 설정 → 일반 → 공유 → '원격 로그인'을 켜세요."
step "VM의 터미널에서 아래 한 줄을 붙여넣어 이 머신의 키를 등록하세요:"
note "    mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '$PUBKEY' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
pause "다 했으면 Enter — SSH가 연결될 때까지 기다립니다 (첫 설치는 수십 분)."

printf '  %sSSH(:%s) 연결 대기%s ' "$DIM" "$SSH_PORT" "$RESET"
SSH_OK=0
for i in $(seq 1 90); do
  if ssh_vm true >/dev/null 2>&1; then SSH_OK=1; break; fi
  (( i % 10 == 0 )) && printf ' (%s분)' $(( i / 2 ))
  printf '.'; sleep 30
done
echo
if [[ "$SSH_OK" -ne 1 ]]; then
  warn "45분 동안 SSH가 연결되지 않았습니다. 단계 2의 설정이 끝났는지 브라우저에서"
  warn "확인하고(8006), 재실행하면 이어서 진행합니다."
  warn "이미지가 게스트 22포트를 전달하지 않는 첫 실행 조합이라면 README의"
  warn "'SSH가 안 열릴 때' 수동 절차(VM 터미널에서 직접 설치·빌드)로 진행할 수 있습니다."
  exit 1
fi
say "SSH 연결 OK (user: $VM_USER)."

# ── 3. 도구체인·Xcode 설치 (자동, 대화형) ──────────────────────────────────
stage "3/5 · 도구체인·Xcode 설치 (자동 — 프롬프트는 이 터미널로)"
say "저장소를 VM(~/loop)으로 동기화합니다 (node_modules·빌드물 제외)."
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env \
  --exclude 'ios/build' --exclude 'ios/Pods' \
  --exclude android --exclude showcase --exclude showcase-captures \
  --exclude '.ssh_ed25519*' --exclude '.known_hosts' \
  -e "ssh -p $SSH_PORT -i $SSH_KEY -o IdentitiesOnly=yes -o UserKnownHostsFile=$KNOWN_HOSTS -o StrictHostKeyChecking=accept-new" \
  "$APP_DIR/" "${VM_USER}@localhost:loop/"
rsync -az -e "ssh -p $SSH_PORT -i $SSH_KEY -o IdentitiesOnly=yes -o UserKnownHostsFile=$KNOWN_HOSTS -o StrictHostKeyChecking=accept-new" \
  "$IOS_DOCKER_DIR/vm-provision.sh" "$IOS_DOCKER_DIR/vm-build.sh" \
  "${VM_USER}@localhost:loop-ios/"
say "vm-provision 실행 — Homebrew·node·CocoaPods·bun·Xcode(xcodes)."
note "  xcodes의 Apple ID·2FA, sudo 암호(= VM 사용자 암호)는 여기에 입력합니다."
note "  Xcode 다운로드는 수 GB라 오래 걸립니다."
ssh -tt -p "$SSH_PORT" -i "$SSH_KEY" -o IdentitiesOnly=yes \
  -o UserKnownHostsFile="$KNOWN_HOSTS" -o StrictHostKeyChecking=accept-new \
  "${VM_USER}@localhost" 'bash ~/loop-ios/vm-provision.sh' \
  || { warn "프로비전 실패 — 위 출력을 확인하고 재실행하세요(멱등)."; exit 1; }

# ── 4. Xcode 계정 로그인 + 팀 (사람, 1회) ──────────────────────────────────
stage "4/5 · Xcode 계정 로그인 + 서명 팀 (사람, VM 화면)"
say "자동 서명(-allowProvisioningUpdates)을 위해 VM의 Xcode에 계정 세션이 필요합니다."
ssh_vm 'open -a Xcode' 2>/dev/null || warn "Xcode 실행 실패 — 브라우저(8006)에서 직접 여세요."
step "브라우저(8006)의 Xcode에서: Settings… (⌘,) → Accounts → ＋ → Apple ID 로그인."
step "LoopMobile 타깃 → Signing & Capabilities → Team 선택 후 오류가 없는지 확인."
note "  팀 이력(device-build-wizard.sh 기록): VMG62K6D6T(SEVEN PICTURES, 프로파일 존재),"
note "  S5W794Z5NN(개인 팀, 7일 유효·기기 3대). 무료 팀은 만료마다 이 단계를 반복합니다."
ask TEAM_ID "서명 팀 ID 입력 [Enter=VMG62K6D6T]:"
TEAM_ID=${TEAM_ID:-VMG62K6D6T}
write_env LOOP_DEVICE_TEAM "$TEAM_ID"

# ── 5. 빌드·설치 (자동) ────────────────────────────────────────────────────
stage "5/5 · Release 빌드 → iPhone 설치·실행 (자동)"
say "팀 $TEAM_ID 로 빌드합니다. (VM 첫 빌드는 매우 느릴 수 있습니다.)"
if confirm "지금 빌드·설치할까요? (--install 포함)"; then
  # 최신 소스를 한 번 더 동기화한 뒤 빌드한다.
  rsync -az --delete \
    --exclude node_modules --exclude .git --exclude .env \
    --exclude 'ios/build' --exclude 'ios/Pods' \
    --exclude android --exclude showcase --exclude showcase-captures \
    -e "ssh -p $SSH_PORT -i $SSH_KEY -o IdentitiesOnly=yes -o UserKnownHostsFile=$KNOWN_HOSTS -o StrictHostKeyChecking=accept-new" \
    "$APP_DIR/" "${VM_USER}@localhost:loop/"
  ssh -tt -p "$SSH_PORT" -i "$SSH_KEY" -o IdentitiesOnly=yes \
    -o UserKnownHostsFile="$KNOWN_HOSTS" -o StrictHostKeyChecking=accept-new \
    "${VM_USER}@localhost" "bash ~/loop-ios/vm-build.sh ~/loop --team $TEAM_ID --install" \
    || warn "빌드/설치 실패 — 출력의 마지막 error를 확인하세요. (기기 미페어링이면 docker-ios/README.md의 USB 페어링 절차)"
else
  SKIPPED+=("빌드·설치 (나중에 다시: bash scripts/build-ios-docker.sh — 앞 단계들은 멱등히 건너뜁니다)")
fi

finish
