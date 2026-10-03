# Connect 디자인·인체공학 — 최종 검증 (task `trio-final-verification`)

- **일자:** 2026-xx (attempt 0)
- **범위:** (1) 게이트웨이 launchd 서비스 라벨 `kr.ll3.loop.gateway` 3중 프로브, (2) 디자인 자산(문서+스킬) 존재·스펙 정합, (3) visibility-touch-ergonomics 감사 테이블 완결, (4) 동작·경계 불변, (5) 저장소 전체 체크
- **제약 준수:** 유료 모델 호출 0, 실기기 불필요 — 전부 결정론적 검증만 수행

## 1. 게이트웨이 서비스 라벨

| 항목 | 결과 |
| --- | --- |
| `launchctl list` → `8873  0  kr.ll3.loop.gateway` (state=running, 구 `dev.loop.gateway` 소멸) | **PASS** |
| `plutil -lint ~/Library/LaunchAgents/kr.ll3.loop.gateway.plist` → OK, Label = `kr.ll3.loop.gateway` | **PASS** |
| 프로브 `http://localhost:18477/v1/runs` → 200 | **PASS** |
| 프로브 `http://127.0.0.1:18477/v1/runs` → 200 | **PASS** |
| 프로브 `http://100.80.133.120:18477/v1/runs` (Tailscale) → 200 | **PASS** |

문서·스크립트 정합: `scripts/gateway-launchd-install.sh`(`LABEL="kr.ll3.loop.gateway"`, 구 라벨 제거 로직), `docs/research/app-device-install.md`(§개요/§D-A4/운영 명령 전반), `docs/findings/gateway-service-label-rename.md`. 과거 실행 기록(`docs/research/simulator-showcase/**`의 `dev.loop.gateway` 참조)은 당시 evidence 원문 유지 정책에 따라 보존.

## 2. 디자인 자산 존재·정합

| 자산 | 상태 | 정합 근거 |
| --- | --- | --- |
| `docs/design/design-system.md` (캐논 스펙) | 존재 | 클로즈드 스케일(type 26/17/15/12+glyph, space, radius), 잉크 3단, 스테이터스 트라이어드, 44pt 플로어 |
| `~/.agents/skills/ui-design/SKILL.md` | 존재 | 스펙을 운영 진입점으로 참조("Conflict → spec wins"), AA 4.5:1 / 44pt / 등록 모션 4종 명시 |
| `docs/decisions/2026-xx-minimal-design-spec.md` | 존재 | S5(float 유일 elevation) 등 토큰 테스트가 핀으로 고정 |
| `apps/loop-mobile/src/ui/tokens.ts` | 단일 소스 | `press.activeOpacity=0.7` 등록, 역할 이름 전용 호출 |

스킬·스펙·토큰 간 수치 불일치 0건.

## 3. 인체공학 감사 테이블 (완결)

감사 항목별 최종 상태 — 소스 대조 + 기계 게이트로 확인:

| # | 항목 | 수정 내용 | 기계 게이트 | 결과 |
| --- | --- | --- | --- | --- |
| C1 | 눌림 상태 | 하드코딩 0.7(App.tsx:294)·토큰 누락(ConversationScreen.tsx:525,544) → 전부 `press.activeOpacity` 등록 토큰으로 (호출점 17곳 전수) | `test/ergonomics.test.ts` — 숫자 리터럴 0 + TouchableOpacity↔activeOpacity 개수 대칭 | **PASS** |
| C2 | 비활성 상태 | 정적 행·로딩 refresh·세션 미선택 open에 `disabled` + `refreshDisabled`/`rowDisabled`(opacity 0.5)/`attachDisabled` 시각 dim (run-list.tsx:73,150,182,251-253) | dim 스타일 상수 존재 + 주석으로 visibility contract 명시 | **PASS** |
| C3 | 대비비 | WCAG AA 4.5:1 게이트를 토큰 수학으로 고정(rgba 합성 모델 포함) | `test/contrast.test.ts` — 잉크 3단×전 표면 | **PASS** |
| C4 | 44pt 타깃 | 주요 탭 가능 요소 44pt 플로어(pad 계산 ~45-46pt, ui-ux-guidance §8; App.tsx:287, composer.tsx:69,133,203, SubmitScreen.tsx:127, RunScreen.tsx:17) | 소스 주석 + 토큰 간격 규칙 | **PASS** |
| C5 | 최소 폰트 | 터미널 리드아웃이 어드혹 크기 없이 `type.mono`(12pt) 등록 스텝에 탑재 | `ergonomics.test.ts` — `TERMINAL_FONT_SIZE === typeScale.mono.fontSize ≥ 12` | **PASS** |
| C6 | 주요 액션 어포던스 | steer 마크가 placeholder 소실 후에도 `steerMode`로 상주(`{glyph.steer} {STEER_MARK_LABEL}`), 복사 상수 등록 | `ergonomics.test.ts` — composer 렌더 조건 핀 | **PASS** |

## 4. 동작·경계 불변

- 모바일 전 스위트: `bun test` (apps/loop-mobile) → **246 pass / 0 fail** (1293 expect) — UI 모듈 소스 검사 방식(react-native 미로드) 기존 규칙 유지.
- 등록 모션 4종·모션 예산(≤400ms)·팔레트 클로저 회귀 테스트 통과 → 신규 타이머/이징/색 없음.
- `tests/architecture-boundaries.test.ts` 통과(bun run check 내) → core/store/bridge 경계 불변. 검증 작업 자체는 소스 변경 없음(write scope = 본 문서뿐).

## 5. 전체 체크

| 명령 | 결과 |
| --- | --- |
| `bun run check` | **exit 0** — TS 패키지 566 pass / 0 fail (65 files, 3861 expect) |
| `cargo test --workspace` | **exit 0** — 25개 타깃 전부 `test result: ok`, 실패 0 (ignored 1: 성능 프로젝션) |

## 6. 수용 기준 요약

| 기준 | 판정 |
| --- | --- |
| 서비스 라벨 `kr.ll3.loop.gateway` + 3중 프로브 200 | **PASS** |
| 디자인 문서 + ui-design 스킬 존재·스펙 정합 | **PASS** |
| 인체공학 감사 테이블 완결(C1-C6 전부 적용+게이트) | **PASS** |
| 동작 불변 / 경계 불변 | **PASS** |
| `bun run check` + `cargo test --workspace` | **PASS** |

## 미해결 리스크

- C4(44pt)는 런타임 측정 게이트가 아니라 pad 계산 + 소스 주석 근거 — 실기기/시뮬레이터 측정은 별도 evidence.
- 구 라벨 참조가 `simulator-showcase` 과거 evidence에 원문 유지 — 정책상 의도된 사항이나 신규 문서 작성 시 혼동 주의.
- 게이트웨이 프로브는 검증 시점 스냅샷 — 서비스는 KeepAlive로 상시 재기동되지만 포트 점유 충돌 시 재확인 필요.
