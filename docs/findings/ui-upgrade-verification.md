# ui-upgrade 최종 검증 — 첨부 이미지 · 구문 강조 · 뷰티 패스 (2026-09-26)

태스크 `ui-upgrade-final-verification`. v9 승격 3종(컴포저 이미지 첨부, 코드블록
구문 강조, 디자인 아름다움 패스)의 최종 검증 결과. **유료 모델 호출 0** — 모든
증거는 유닛/통합 테스트, codegen 대조, 정적 확인, 시뮬레이터 정지 캡처다.

## 수락 기준별 판정

| # | 기준 | 판정 | 핵심 증거 |
| --- | --- | --- | --- |
| 1 | 이미지 첨부 e2e (컴포저 → 게이트웨이 → pi input.images 경로) | **pass** (리포 안 종점까지, 아래 한계 1건) | `bun run check` 내 게이트웨이 통합 테스트 + v9 캡처 02 실측 라운드 트립 |
| 2 | 구문 강조 동작 + 폴백 | **pass** | `apps/loop-mobile/test/syntax.test.ts` 전통과, 미지원 언어 `null` → 모노폰트 폴백 계약 |
| 3 | 뷰티 패스 동작 불변 (테스트 동일) | **pass** | 전체 스위트 통과, 테스트 기대값 변경 0 (신규 게이트만 추가 — 아래 근거) |
| 4 | 경계 불변 | **pass** | `test:architecture` 8 pass + 게이트웨이 M-GC0 게이트 pass |
| 5 | v9 스크린샷 3종 승격 시연 | **pass** | `docs/research/simulator-showcase/v9/` PNG 5장 (257–395 KB) + evidence.md 매핑 |
| 6 | 전체 리포 check + 네이티브 브리지 재빌드 확인 | **pass** | `bun run check` 통과, dylib mtime > 모든 crate 소스 mtime |

## 검증 실행 기록 (명령·출력)

### 1. full-check — `bun run check` (exit 0)

`codegen:check && typecheck && test:architecture && test` 연쇄 전부 통과:

- `bun scripts/rustra-codegen.ts --check` — 재생성 결과가 커밋된 생성 파일과 일치
  (Rust-first 계약 유지: `crates/loop-bridge/src/conversation.rs`의
  `RemoteSessionAssetRef`/`ConversationUserMessage.attachments`가
  `packages/protocol/src/generated/events.ts`에 생성됨 확인).
- `tsc -p tsconfig.json` — 에러 0.
- `bun test tests/architecture-boundaries.test.ts` — **8 pass / 0 fail**
  (layered layout·keychain confine·생성 바인딩 단일 seam 게이트 포함).
- `cargo test --workspace` — 전부 통과 (loop-core/store/bridge 포함).
- `bun test packages tests plugins scripts/...` — **537 pass / 0 fail /
  2818 expect() across 63 files**.

### 2. 앱 테스트 (`bun run test` 범위 밖 — 별도 실행)

- `apps/loop-mobile` — **203 pass / 0 fail** (740 expect, 22 files)
- `apps/loop-desktop` — **57 pass / 0 fail** (218 expect, 7 files)

### 3. 네이티브 브리지 재빌드 확인

Rust 변경(latest: `crates/loop-bridge/src/conversation.rs`, mtime 1790386594) 이후
산출물이 모두 갱신됨을 mtime 대조로 확인:

```
1790386594 crates/loop-bridge/src/conversation.rs   ← 가장 최신 Rust 소스
1790411005 dist/libloop_bridge.dylib                ← 이후 재빌드
1790411008 dist/loop
1790411008 dist/loop-pi-extension.js
```

## 기준 1 — 이미지 첨부 e2e

구간별 증거:

1. **컴포저 → 게이트웨이 업로드**: `POST /v1/sessions/{id}/attachments` —
   `session-attachments.test.ts`: 201 `{attachmentId, mimeType, byteLen}` 참조형
   응답, 404/400(bad type)/413(oversize) 결정적 매핑, 세션별 예산 oldest-first
   퇴거, bearer 게이트(무인증 우회 없음) — 전부 pass.
2. **게이트웨이 → 하류 전달**: `POST /v1/sessions/{id}/input` —
   *"upload → input → collector delivers the image-bearing line; the tap's
   observed frame lands on the stream"* pass. 본문(base64)은 tap 소켓 제어 채널로만
   이동하고 프레임 로그/SSE에는 참조만 재발급됨(`DeliverInputLine`, D5).
   입력 검증(빈 입력 400, 초대 텍스트 413, 참조 초과 400, 미해결 참조 404,
   tap 부재 409) 전부 pass.
3. **앱 컴포저**: `attach-flow.test.ts`·`attachment-upload.test.ts`·
   `attachment-render.test.ts` pass — 썸네일/제거/cap 거부/Resend 계약 포함.
   v9 캡처 과정에서 발견된 실기기 결함(RN Blob 생성자가 ArrayBuffer 파트 거부)은
   `uploadSessionAttachment`가 런타임 생성 Blob을 받도록 수정돼
   (`readPhotoBlob`, file://·http(s) 모두) 이번 스위트로 회귀 확인.
4. **관찰 루프**: 전송 라운드 트립은 v9 캡처 02로 실측 — 업로드 201 → input 202 →
   스트림에 관찰된 `user_message` 프레임 → 인라인 이미지 렌더. 관찰된 프레임은
   합성이 아닌 tap 관찰 물이며, `image_count`는 관찰값, `attachments`는 참조 가능
   부분집합이라는 정직성 계약이 `conversation.rs` 테스트로 고정됨.

## 기준 2 — 구문 강조 + 폴백

- `apps/loop-mobile/src/features/syntax.ts`(332 lines) — 의존성 0 폐쇄 문법
  스캐너. 인덱스 기반 span 계약(원본 문자열 위 span → 렌더러가 표시 중인 텍스트를
  그대로 슬라이스, Copy는 원본 코드 유지). 프로필: ts/js(tsx 포함)·rust·
  python·json·bash. `canonicalLanguage`가 미지원 펜스 태그에 `null`을 반환하면
  호출부가 기존 모노폰트 렌더링 유지 — 폴백 계약이 문서·테스트로 고정.
- `test/syntax.test.ts`(209 lines) 전부 pass. v9 캡처 03에서 TS 키워드·숫자·
  문자열 토큰 착색 + 랭글 칩 + Copy code 실측.

## 기준 3 — 뷰티 패스 동작 불변

- 수정된 테스트 파일은 2개뿐이며 **전부 추가-only**:
  - `tests/architecture-boundaries.test.ts` (+100/−2): 신규 앱 레이어 임포트
    방향 게이트 추가, legacy-surface 게이트의 `apps` 전면 금지를 승인된
    `apps/loop-mobile`·`apps/loop-desktop` 예외로 정밀화(기존 금지 경로 유지).
  - `packages/protocol/test/generated-runtime.test.ts` (+61): 생성 타입 신규
    필드(`imageCount` 등) 단언 추가.
- orchestrator/protocol의 기존 테스트 기대값 변경 0. cargo 테스트 기대값 변경도
  전체 스위트 통과로 확인.
- `ui/tokens.ts`·`ui/motion.tsx`는 임포트 0의 표시 전용 모듈(ui 레이어 —
  아무것도 임포트 불가 게이트 통과). 토큰 계약은 `tokens.test.ts` pass.
- v9 캡처 04·05: 대형 타이틀, 카드 elevation, 상태 점 배지, 날짜 경계 헤더,
  꼬리 코너 버블 — 토큰 체계 정비 후 모습 (`docs/design/ui-ux-guidance.md` 준수).

## 기준 4 — 경계 불변

- `test:architecture` 8 pass: loop-core 프로바이더 중립성, 생성 바인딩 단일
  seam, 의존성 역전 금지, 앱 레이어드 레이아웃, keyconfine 전부 pass.
- 게이트웨이 `session-boundary.test.ts`: *"the session/conversation concept
  never enters loop-core (M-GC0 gate)"* + *"the gateway declares no conversation
  frame shapes; it consumes generated types only"* pass.
- 첨부 타입은 `crates/loop-bridge`에 Rust-first 선언 → codegen 생성 → 게이트웨이·
  앱이 생성 타입만 소비 (TS 복제본 없음 — `bun run codegen:check`으로 대조).

## 기준 5 — v9 스크린샷

`docs/research/simulator-showcase/v9/`: PNG 5장(01 컴포저 첨부 썸네일, 02 사용자
이미지 인라인, 03 구문 강조, 04 Chats 신룩, 05 대화 신룩) + `evidence.md`에
스크린샷↔증명 매핑과 재실행 절차(`v9/capture.sh`) 문서화. 세 승격 모두 시연됨.

## 한계 · 미해결 리스크

1. **tap → pi 종점은 리포 밖**: `deliver_input`을 받아
   `pi.sendUserMessage([{type:"text"},{type:"image"}])`로 넘기는 세션 tap(pi 확장
   어댑터)의 소비자 소스는 이 리포에 없다. 리포 안에서는 게이트웨이가
   `deliver_input` 라인(base64 이미지 본문 포함)을 tap 소켓으로 쓰는 것까지
   테스트로 검증됐고, 그 이후 hop은 `session-collector.ts`의 계약 문서만으로
   존재한다. pi 세션 실측(InputEvent.images 도달 확인)은 별도 실기기/실세션
   증거 과제.
2. **PHPicker·카메라 권한 플로우는 헤드리스 재현 불가** — v9 스크립트 훅이 같은
   continuation(같은 `appendPendingAttachment`, 같은 cap 거부)으로 대체.
   `file://` 읽기 경로는 단위 테스트 + http 경로 실측으로 커버.
3. v9 캡처 자체는 demo 게이트웨이 fake 데이터 기반(실게이트웨이 `/v1/runs` 200은
   별도 기록). 프로덕션 게이트웨이 계약은 위 테스트 스위트로 동일하게 고정됨.

## 결론

**최종 판정: pass** — 6개 수락 기준 전부 충족. `bun run check` 전체 통과,
앱 스위트 260 테스트 추가 통과, 네이티브 브리지 재빌드 확인, 경계 게이트
무사. 리포 밖 tap 종점 실측만 후속 과제로 남긴다.
