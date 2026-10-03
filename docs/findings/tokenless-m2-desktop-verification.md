# 토큰리스 인증 + M2 + 데스크톱 패리티 + simplify 최종 검증

- 작업: `tokenless-final-verification` (kind=verification)
- 날짜: 2026-09-26
- 결론: **전체 패스** — 수용 기준 7개 항목 모두 통과, 미해결 리스크 없음(1건 관찰 사항)

## 수용 기준별 결과

### 1. 토큰 없는 첫 실행 — Tailscale 바인딩 게이트웨이: PASS

- 라이브 게이트웨이가 tokenless Tailscale 리스너로 기동 중임을 확인:
  `curl -o /dev/null -w '%{http_code}' http://100.80.133.120:18477/v1/runs` → `200` (bearer 헤더 없음)
- 단위/통합 테스트: `bun test packages/gateway/test/bind-auth.test.ts` → **19 pass / 0 fail**
  - "tokenless tailscale mode (decision §D-A1)": bearer 없이 /v1 서빙
  - tailscale 인터페이스(`100.80.133.120` / utun4) 바인딩 허용, 비-tailnet 호스트 바인딩 거부
- 시연 아티팩트: `docs/research/simulator-showcase/v7/01-tokenless-first-launch-chats.png`
  (시뮬레이터 런치 → 토큰 입력 없이 채팅 목록 도달, showcase-v7 워커 캡처 성공)

### 2. [credential] redaction 여전히 테스트됨: PASS

- `bun test packages/gateway/test/pane-stream.test.ts` → **12 pass / 0 fail**, 포함:
  - `(pass) credential-bearing pane text leaves as [credential]=[redacted]`
- 추가: `bind-auth.test.ts`의 `(pass) bearer still gates the body endpoint (no credential-free bypass in fallback mode)` — fallback 모드에서 첨부 바디 엔드포인트 인증 우회 없음.
- 전체 `bun run check`에서도 동일 테스트 통과 확인.

### 3. 이미지/파일 렌더 (대화 내): PASS

- 시연 아티팩트: `docs/research/simulator-showcase/v7/02-attachment-conversation.png`
  (대화 안 인라인 이미지 + 파일 카드 렌더, showcase-v7 워커 캡처 성공)
- 첨부 파이프라인 테스트(green): `packages/gateway/test/session-attachments.test.ts`
  - attachment body ingress(D5), byte 정확성 서빙, 오버사이즈/예산 드롭, 미인증 바디 차단
- 전체 `bun run check`에 포함되어 통과.

### 4. 데스크톱 패리티 — 실행 가능 아티팩트: PASS

- 아티팩트 존재: `apps/loop-desktop/src-tauri/target/release/bundle/macos/Loop Desktop.app`
- 재빌드 신선도: Rust 마지막 변경 `crates/loop-bridge/src/lib.rs` = 09-26 01:36,
  데스크톱 `deps` 재빌드 = 09-26 15:09 → **현재 Rust 기준으로 빌드된 아티팩트**
- 시연 아티팩트: `docs/research/simulator-showcase/v7/03-desktop-app.png` (데스크톱 앱 구동 화면)
- 모바일 쪽도 동일: `apps/loop-mobile/ios/build/.../LoopMobile.app` = 09-26 14:59 빌드
  (마지막 Rust 변경 이후) — 01/02 스크린샷은 이 빌드에서 캡처됨.

### 5. 계층 구조 강제 검사: PASS

- `bun run test:architecture` → **8 pass / 0 fail**, 포함:
  - `(pass) both apps follow the decided layered layout with enforced import directions`
  - `(pass) loop-core exports only provider-neutral orchestration modules`
  - `(pass) keychain/keyring/credential-store references stay confined to the auth layer`
  - `(pass) provider, Pi, SQLite, and generated protocol dependencies do not invert`

### 6. simplify 동작 불변 (테스트 동일): PASS

- simplify 패스 이후 전체 스위트 동일 통과:
  - `bun run check`: **528 pass / 0 fail** (63 files, 2685 expect())
  - `cargo test --workspace`: exit 0, 모든 타깃 `ok` (0 failed)
- 테스트 코드가 기대값 변경 없이 동일하게 통과 → 동작 불변 확인.
  (git status상 테스트 파일 변경은 이전 기능 커밋 사이클의 것; 본 검증은 현재 트리 기준 전량 green)

### 7. 경계 (loop-core provider 금지, codegen:check, 아키텍처): PASS

- `bun run codegen:check` → **PASS** (생성 파일이 Rust 도메인 타입과 일치)
- `tests/architecture-boundaries.test.ts` 전부 통과(위 5번 참조) — loop-core의 provider 개념 금지, 의존성 역전 금지 강제.

## 실행한 전체 검증

| 검사 | 결과 |
| --- | --- |
| `bun run check` (codegen:check + typecheck + architecture + test) | 528 pass / 0 fail |
| `cargo test --workspace` | exit 0, 전 타깃 ok |
| 게이트웨이 라이브 확인 (`GET http://100.80.133.120:18477/v1/runs`) | HTTP 200, bearer 없음 |
| `bun test packages/gateway/test/bind-auth.test.ts` | 19 pass / 0 fail |
| `bun test packages/gateway/test/pane-stream.test.ts` | 12 pass / 0 fail |

## 네이티브 브리지 재빌드 확인

- Rust 변경 존재(loop-bridge/loop-core/loop-store) → 데스크톱 Tauri `deps` 15:09,
  모바일 시뮬레이터 앱 14:59 빌드로 **양쪽 모두 변경 후 재빌드됨**. 스크린샷(15:02–15:10)은 재빌드된 아티팩트에서 캡처.

## 변경 파일 (본 검증 워커)

- `docs/findings/tokenless-m2-desktop-verification.md` (신규, 선언된 쓰기 범위 내 유일)

## 관찰 사항 / 리스크

- 본 세션의 모델은 이미지 열람 미지원으로 PNG 내용을 직접 육안 검증하지 못함.
  대신 (a) 3개 스크린샷 파일 존재·타임스탬프 확인, (b) showcase-v7 의존성 워커의 캡처 성공 보고,
  (c) 대응 테스트(토큰리스 인증/첨부/redaction) green을 근거로 판정함. 육안 최종 확인은 리뷰어 권장.
- 작업 트리에 아직 커밋되지 않은 구현 변경 다수 존재(bridge/orchestrator/protocol 등) —
  본 검증은 현재 작업 트리 상태 기준이며, 커밋 전 별도 리뷰 필요.
- 로컬/fake provider만 사용, 유료 모델 호출 없음. 실기기 검증은 범위 외(의도대로 제외).
