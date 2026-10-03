# Gateway service label rename verification

- **태스크:** `service-label-rename`
- **일시:** 2026-xx (운영자 지시)
- **범위:** launchd 게이트웨이 서비스 라벨 `dev.loop.gateway` → `kr.ll3.loop.gateway`

## 변경 내용

| 항목 | 이전 | 이후 |
| --- | --- | --- |
| launchd Label | `dev.loop.gateway` | `kr.ll3.loop.gateway` |
| plist 경로 | `~/Library/LaunchAgents/dev.loop.gateway.plist` (삭제) | `~/Library/LaunchAgents/kr.ll3.loop.gateway.plist` |

절차: `launchctl bootout gui/$(id -u)/dev.loop.gateway` → 구 plist 삭제 → 신규 plist 작성 → `launchctl bootstrap`. 재기동 후 pid 8873, `state = running`.

## 저장소 변경

- `scripts/gateway-launchd-install.sh` **신규** — `install|uninstall|restart|status` 서브커맨드. install 시 이전 라벨 서비스/plist를 먼저 정리하여 두 라벨이 포트를 두고 경쟁하는 상황을 방지한다. plist에 secret 없음(기존 불변 유지).
- `docs/research/app-device-install.md` — §1 상태 표, §3.1 설치/확인/관리 명령, §3.2 전부 신규 라벨로 갱신 + 라벨 변경 이력 주석 추가.
- `scripts/install-local.sh`, `scripts/gateway-serve.sh` — 라벨 참조 없음(변경 불요).
- 과거 evidence 문서(`docs/findings/abc-verification.md`, `docs/research/simulator-showcase/**`)의 `dev.loop.gateway` 참조는 당시 실행 기록이므로 원문 유지.

## 검증 (완료 조건)

| 조건 | 결과 |
| --- | --- |
| `launchctl print gui/501/kr.ll3.loop.gateway` → `state = running`, `active count = 1` | **PASS** (pid 8873) |
| `http://localhost:18477/v1/runs` → 200 | **PASS** |
| `http://127.0.0.1:18477/v1/runs` → 200 | **PASS** |
| `http://100.80.133.120:18477/v1/runs` → 200 | **PASS** (토큰리스, §D-A1) |
| 구 라벨 소멸 — `launchctl print .../dev.loop.gateway` 실패 + 구 plist 부재 | **PASS** |

유료 모델 호출 없음. 프로브는 bearer 없는 결정론적 GET이다.
