# Loop 디자인 파운데이션 — design.md

## 1. 메타·상태

- **일자:** 2026-09-24 KST
- **상태:** `draft` — 승인 대기 (accepted 전환 조건은 아래 참조)
- **에픽:** design-foundations (디자인 파운데이션 — 표현 어휘·시맨틱 토큰·일관성 강제)
- **승인 태스크 id:** 미배정 — 본 문서의 승인은 별도 리드 리뷰 게이트에서 수행된다. accepted 전환 시 이 필드에 승인 태스크 id를 기재한다.
- **작성 태스크:** `write-loop-design-md` (kind=integration, attempt 0) — 이번 실행에서는 본 문서만 작성하며 **코드 변경은 없다.** §7의 실행 태스크는 전부 승인 대기 상태다.
- **디자인 논의·수정 제안:** [`design-language.md`의 진입 경로](design-language.md#디자인-논의수정-제안-방법)에서 시작한다([근거 ADR](../decisions/design-md-workflow.md#후속-결정--디자인-논의-진입점과-read-model-편집-프로토콜)).
- **선행 근거 문서:**
  - `docs/design/design-foundations.md` — 권고 D1–D3, 2주 계획 S1–S8, 후속 결정 D-1–D-6
  - `docs/design/research/loop-ui-audit.md` — 현재 UI 감사, 문제 P1–P4 (worktree `86413fa` 기준)
  - `docs/design/research/oss-agent-ui-survey.md` — 에이전트/TUI 6개 프로젝트 사례 (pi, opencode, gemini-cli, aider, crush, claude-code)
  - `docs/design/research/design-system-practices.md` — 업계 디자인 시스템 관행 (W3C 토큰 스펙, Primer, Polaris, Ink, Ratatui, Lipgloss)
  - `docs/design/research/design-md-practices.md` — design.md 워크플로 업계 조사 (§7.2 EARS 예시 출발점)
  - `docs/decisions/design-md-workflow.md` — 본 문서의 형식(9절 골격)을 규정한 ADR
- **accepted 전환 조건 (ADR `design-md-workflow.md` §결정-7의 조건 인스턴스화):**
  1. 승인 decision 태스크(리드 리뷰) 완료.
  2. `[NEEDS CLARIFICATION]` 0개 — 현재 0개.
  3. §8 미해결 질문 없음 또는 attention 승격 완료 — §8의 D-1·D-3·D-4는 승인 리뷰에서 §5의 제안 해소를 채택·수정하는 것으로 종결하고(수정 시 해당 결정 태스크 추가), D-2·D-5·D-6은 답변 책임과 재질의 트리거가 확정된 연기 항목으로 분류한다.

## 2. 배경과 범위

Loop의 UI 표면은 2026-09-24 감사(worktree `86413fa`) 기준으로 다음과 같다.

- **표면 인벤토리:** 공통 축약 헬퍼 `packages/presentation/src/compact.ts`(47줄), 스냅샷 렌더러 `packages/presentation/src/snapshot.ts`(207줄), CLI 진입점·포맷터 `packages/cli/src/main.ts`(909줄), 관찰 루프 `packages/cli/src/dispatcher.ts`(50줄), 터미널 세션 어댑터 `packages/herdr/src/client.ts`(691줄, 표시 라벨 규칙 포함).
- **줄 수 예산 정책은 존재한다.** `config/policy.toml [output]` 5키 → `packages/orchestrator/src/config.ts:165-175` → 렌더러 파라미터로 전달되며 `docs/decisions/ui-output-limits.md`와 일치한다.
- **시각 언어 정책과 표현 어휘의 단일 원천은 없다.** 전 코드베이스에서 유일한 ANSI 이스케이프는 `packages/cli/src/main.ts:188`의 화면 클리어(`"\x1b[2J\x1b[H"`)이고, 색상 의존성·`NO_COLOR` 처리·TTY 탐지가 전무하다. 성공/경고 글리프(`✓`/`!`/`-`)는 포맷터마다 하드코딩되고, overflow 문구는 인라인 람다 12개 변종으로 중복되며, 빈 상태 문자열은 표면별로 독립 정의된다(상세는 §4 각 요구사항의 근거).
- **표시 명명 규칙은 세 곳에 분산돼 있다.** 스냅샷 라인 어휘는 `snapshot.ts`, CLI 리포트 포맷은 `main.ts`, 워커 탭 라벨(`<taskId>·<kind>·a<attempt>`, 32자 예산)은 `packages/herdr/src/client.ts:548-591`.
- **제품 내 시각 체계 이중화:** pi 내부 표면(pi-extensions)은 pi theme 토큰 8종을 경유하는 반면 CLI/presentation은 무색 텍스트다(`docs/decisions/persona-ux.md` 배경 팩트 3).
- **문서 공백:** `docs/design/`에 UI/디자인 관련 문서가 없었고, 디자인 지식은 `docs/decisions/`의 정책 결정 6건에 파편화돼 있었다(감사 §1.4).

**범위:** TypeScript 프레젠테이션 계층(`packages/presentation/**`, `packages/cli/**`, 관련 테스트, `tests/architecture-boundaries.test.ts`)과 문서. **범위 밖:** Rust crates·`loop-bridge`·생성된 protocol(무변경, `bun run codegen` 대상 없음), `packages/pi-loop/**`·`pi-extensions/**`, `packages/herdr/**`(규격 문서화만, §5 참조).

## 3. 목표와 비목표

**목표:**

1. 표현 어휘(글리프·구분자·빈 상태·overflow 문구)의 단일 원천을 `@loop/presentation`에 확립한다 — 감사 P2 전체(P2-1~P2-6) 해소.
2. 최소 시맨틱 색 역할과 환경 가드(`NO_COLOR`·비-TTY)를 도입한다 — P1-1(상태 색), P1-3(비-TTY 클리어 방출) 해소.
3. CLI 리포트 포맷터의 소유권을 presentation으로 정리해 `main.ts`를 디스패치 중심으로 축소한다 — P4-1 구조 해소.
4. 일관성을 도구(경계 테스트·무결성 테스트·계약 테스트)로 강제해 P2/P4의 재발을 기계적으로 차단한다.
5. 분산된 디자인 결정 문서를 링크하는 단일 진입점을 본 문서로 확립한다 — P3-3의 문서 반쪽.
6. 1주차 이관(어휘·포맷터)은 출력 바이트 동일을 원칙으로 수행해 회귀 위험을 최소화한다.

**비목표 (명시적 제외):**

- 터미널 폭 인식 `lineTextLimit` 구현 — `config/policy.toml` 정책 변경을 수반하므로 D-5 결정 전 불가(§8). 폭 관찰 설계안 작성도 후속 결정 태스크의 입력으로 이관했다(ADR의 양방향 완전성 규칙: R 대응 없는 태스크는 범위 밖).
- herdr 워커 라벨 규칙의 presentation 이관 — D-2. 본 에픽에서는 규격을 §5의 표로 문서화만 한다(권고안 §4.1-C 대안 (b) 채택, (a)는 트리거 후).
- watch 부분 갱신·플리커 제거의 렌더링 반쪽 — 본 에픽은 클리어 가드(P1-3)까지. P3-1의 잔여는 관찰 증거(T8) 후 별도 설계.
- W3C JSON 토큰 포맷·변환 체인, 라이트/다크 다중 테마 파일 — D-6 트리거(§8)까지 연기.
- pi 표면(pi-extensions)의 색·어휘 변경 — pi theme 토큰과의 개념 정합(역할 이름)만 유지한다.
- VHS/PTY 시각 회귀, 컴포넌트 카탈로그 — 표면 규모 대비 과잉(권고안 §4.6).

## 4. 요구사항

EARS 형식(`WHEN <조건> THE SYSTEM SHALL <동작>`). 각 요구사항은 감사 근거(파일:줄, `loop-ui-audit.md` 기준)와 권고·사례 근거를 갖는다. 구현 방법(파일 배치·기술 스택)은 §5가 담당한다.

### R1 — 어휘 단일 원천

- **EARS:** WHEN CLI·스냅샷·리포트 표면이 상태 글리프·구분자·빈 상태 문구를 출력할 때, THE SYSTEM SHALL presentation 계층이 소유하는 어휘 상수를 통해서만 해당 값을 결정한다.
- **감사 근거:** P2-1(`packages/cli/src/main.ts:574`,`:617`의 `✓`/`!` vs `:549`,`:552`의 `-`/`!`), P2-3(`main.ts:142`,`:598` / `packages/presentation/src/snapshot.ts:24,56,75,88` — `No runs` 두 패키지 이중 정의), P2-6(`snapshot.ts:63`의 `←`, `·` 다수 vs `main.ts:617`의 `: `).
- **권고·사례 근거:** D1; Primer 단일 출처 원칙, pi-tui 극소 프리미티브+조합, opencode `dialog-*` 조합 컴포넌트, Ratatui 위젯 경계 지침("명시적 입력 구조체").
- **검증:** `bun test packages`(어휘 무결성 테스트 R12) + `bun run test:architecture`(R11 확장 규칙) + 관찰: presentation 밖 글리프·빈 상태 리터럴 grep.

### R2 — overflow 문구 계약

- **EARS:** WHEN 축약으로 줄이 생략될 때, THE SYSTEM SHALL `… {omitted} more {noun}` 계약(`docs/decisions/ui-output-limits.md` 규칙 2)을 준수하는 단일 팩토리의 출력으로 overflow 문구를 생성한다.
- **감사 근거:** P2-2 — 인라인 람다 12개 변종(`snapshot.ts:28,51,70,81,111,120,139,149` / `main.ts:558,590,602,623`), 형식 제각각(`more lines` / `more report lines (use --json …)` / `more checks (F failed, P passed)`).
- **권고·사례 근거:** D1; ui-output-limits 계약의 기계적 준수, Ink `lastFrame`·Ratatui 스냅샷 관행의 전제(문구가 안정적이어야 스냅샷이 회귀 망이 됨).
- **검증:** `bun test packages` — 무결성 테스트가 모든 팩토리 출력의 계약 정규식 준수를 단언.

### R3 — 리포트 포맷터 소유권

- **EARS:** WHEN CLI가 doctor·benchmark·models·cleanup 출력을 생성할 때, THE SYSTEM SHALL 진입점이 아닌 presentation 계층의 명시적 입력 포맷터를 호출하여 생성한다.
- **감사 근거:** P4-1 — `main.ts` 909줄 모놀리스, 포맷터군 `main.ts:532-625`, help `:791`, 프로세스 스폰까지 포함.
- **권고·사례 근거:** D1; Ratatui 커스텀 위젯 지침(전역 상태 참조 헬퍼 대신 입력 필드가 선언된 구조체), AGENTS.md "Keep TypeScript adapters thin".
- **검증:** `bun test packages`(기존 계약 테스트) + `bun run check`(typecheck 포함).

### R4 — runs 렌더링 단일 구현

- **EARS:** WHEN runs 목록이 어떤 표면에서든 렌더링될 때, THE SYSTEM SHALL 동일한 단일 구현을 재사용한다.
- **감사 근거:** P2-4 — CLI가 `renderRuns`를 쓰지 않고 동일 로직(라벨 포맷·overflow 문구 포함)을 인라인 복제(`main.ts:130` vs `snapshot.ts:23-31`).
- **권고·사례 근거:** D1; Primer 단일 출처(같은 의미는 같은 코드).
- **검증:** `bun test packages` + 관찰: CLI 측 인라인 runs 렌더링 부재 grep.

### R5 — 출력 역직렬화 금지

- **EARS:** WHEN 호출자가 렌더 결과의 표현을 바꿔야 할 때, THE SYSTEM SHALL 렌더 입력 파라미터로 해결하고 완성된 문자열을 사후 수정하지 않는다.
- **감사 근거:** P2-5 — presentation이 `Next: /loop`로 렌더한 안내줄을 CLI가 `replace("Next: /loop", "Next: loop")`로 재작성(`main.ts:530` ↔ `snapshot.ts:99`).
- **권고·사례 근거:** D1; 명시적 입력 원칙(문자열 출력의 역직렬화는 인터페이스 결함).
- **검증:** 관찰(포맷 후 `replace(` 수술 부재 grep) + `bun test packages`.

### R6 — 이관 단계 출력 보존

- **EARS:** WHEN 어휘·포맷터 이관이 승인된 의도적 변경을 수반하지 않는 한, THE SYSTEM SHALL 이관 전과 바이트 동일한 출력을 계약 테스트로 입증한다.
- **감사 근거:** 호출점 교체의 회귀 위험 — 기존 계약 테스트 `packages/cli/test/cli.test.ts`(expect 66건, 감사 시점 64단언)가 안전망.
- **권고·사례 근거:** design-foundations §5 1주차 원칙; Ink `lastFrame`(문자열 비교) 관행.
- **검증:** `bun test packages` — 교체 커밋에서 기존 계약 테스트 전건 통과(스냅샷 갱신 없음).

### R7 — 색 역할 폐쇄 집합

- **EARS:** WHEN 색이 적용될 때, THE SYSTEM SHALL 폐쇄된 시맨틱 색 역할 집합(success·warning·error + accent·muted·dim·text)을 통해서만 적용한다.
- **감사 근거:** P1-2(스타일 프리미티브 0개, 유일 ANSI는 `main.ts:188` 클리어), P1-4(pi theme 토큰 표면과 무색 CLI의 이중화).
- **권고·사례 근거:** D2; pi `Theme.fg()` 접근 강제·`vars→colors` 2계층, gemini-cli `SemanticColors`(상태 3종 타입 수준 보장), Primer functional 계층(용도 규칙).
- **검증:** `bun test packages`(역할 매핑 무결성 R12) + `bun run test:architecture`(R11 — 밖 리터럴 금지).

### R8 — NO_COLOR 준수

- **EARS:** WHEN `NO_COLOR` 환경변수가 비어 있지 않은 값으로 설정될 때, THE SYSTEM SHALL 색 이스케이프를 방출하지 않는다.
- **감사 근거:** P1-3 — `NO_COLOR` 처리 부재.
- **권고·사례 근거:** D2; no-color.org 규약, Lipgloss 색 프로파일 다운샘플링(환경 적응은 한 곳).
- **검증:** 단위 테스트 — 환경변수 주입 시 출력에 색 이스케이프 부재 단언.

### R9 — 비-TTY 클리어 가드

- **EARS:** WHEN 표준 출력이 대화형 터미널이 아닐 때, THE SYSTEM SHALL 화면 클리어 이스케이프를 방출하지 않는다.
- **감사 근거:** P1-3/P3-1 — watch 비-JSON 경로가 비-TTY(파이프·로그 캡처)에서도 `"\x1b[2J\x1b[H"`를 무조건 방출(`main.ts:188`).
- **권고·사례 근거:** D2; TUI 프레임워크 공통 분리(값/환경감지는 프레임워크 계층 한 곳의 관심사).
- **검증:** 단위 테스트(비-TTY 모의 출력에 클리어 부재) + 파이프 캡처 관찰(T8이 증거 기록).

### R10 — 상태 색 조회

- **EARS:** WHEN task 상태가 목록·스냅샷에 렌더링될 때, THE SYSTEM SHALL 상태→색 역할 조회 테이블을 경유하여 상태를 시각적으로 구분한다.
- **감사 근거:** P1-1 — 상태(running/failed/attention/done 등)가 단어로만 구분, 우선순위 정렬(`taskPriority`)은 있으나 렌더링에 반영 안 됨(`snapshot.ts:160-171`, `:126-145`). task 상태는 9종(`pending/ready/running/verifying/attention/blocked/done/failed/cancelled`, `packages/protocol/src/generated/frame-codecs.ts:1067`).
- **권고·사례 근거:** D2; Primer 상태 축(이름에 상태가 박혀 컴포넌트가 해석하지 않음), 6개 사례 중 5개+가 상태 색을 1급 어휘로 포함.
- **검증:** 단위 테스트 — 9종 상태 전부에 역할 매핑 존재 단언 + 텍스트 스냅샷은 ANSI 제거 후 비교(색 어설션 별도).

### R11 — 경계 테스트 강제

- **EARS:** WHEN 아키텍처 경계 검사가 실행될 때, THE SYSTEM SHALL presentation 밖 TypeScript 파일의 ANSI 이스케이프·색 리터럴을 위반으로 보고한다.
- **감사 근거:** P2/P4의 재발 방지 — 구조적 원인이 호출점 재발명이므로 기계적 차단 필요.
- **권고·사례 근거:** D3; Polaris `color/color-no-hex`(린트로 우회 거부), pi 커스텀 check 스크립트, 이 저장소 기존 패러다임(`tests/architecture-boundaries.test.ts` 정규식 경계 검사).
- **검증:** `bun run test:architecture` — 위반 샘플 주입 시 실패하는지까지 확인(규칙이 실제로 문다).

### R12 — 어휘·토큰 무결성 테스트

- **EARS:** WHEN 어휘·토큰 모듈이 변경될 때, THE SYSTEM SHALL 무결성 테스트가 (a) 9종 task 상태의 글리프·색 역할 매핑 존재, (b) overflow 팩토리의 계약 준수, (c) 빈 상태 상수의 중복 부재를 검증한다.
- **감사 근거:** P2-1~P2-3의 재발 방지.
- **권고·사례 근거:** D3; opencode 순환 참조·중복 이름 거부 테스트, Primer `lint:tokens`, crush의 "조용한 대체 금지"(내장 표면에는 엄격 모드가 적합).
- **검증:** `bun test packages`.

### R13 — 디자인 문서 단일 진입점

- **EARS:** WHEN 표시 규격·어휘·디자인 정책의 원천을 조회할 때, THE SYSTEM SHALL 본 문서가 관련 결정 6건·감사·조사 3건을 링크하는 단일 진입점을 제공한다.
- **감사 근거:** P3-3(단일 "Loop 표시 규격" 문서 부재 — herdr 32자 예산 vs CLI 160 grapheme 예산이 별개 체계로 병존), 감사 §1.4(문서 공백).
- **권고·사례 근거:** design-foundations §4.4-4; Primer/Polaris의 "문서가 아니라 코드가 import하는 상수" 원칙에 대한 문서 반쪽(규격·근거·변경 이력 보관소).
- **검증:** 관찰 — §5의 링크 대상 파일 존재 확인(T10 완료 확인).

### 감사 문제 → 요구사항 커버리지

| 감사 문제 | 대응 | 비고 |
| --- | --- | --- |
| P1-1 상태가 단어로만 구분 | R10 | |
| P1-2 스타일 프리미티브 0개 | R7 | |
| P1-3 NO_COLOR·비-TTY 미처리 | R8, R9 | |
| P1-4 pi 표면과 시각 체계 이중화 | R7 | pi 측 변경은 비목표, 역할 이름 정합만 |
| P2-1 글리프 하드코딩 | R1, R12 | |
| P2-2 overflow 문구 12변종 | R2, R12 | |
| P2-3 빈 상태 이중 정의 | R1, R12 | |
| P2-4 runs 렌더 이중 구현 | R4 | |
| P2-5 `replace()` 문자열 수술 | R5 | |
| P2-6 구분자 관행 불일치 | R1 | |
| P3-1 전체 하드 클리어 | R9(가드 반쪽) | 렌더링 반쪽(부분 갱신)은 비목표, T8 증거 후 별도 |
| P3-2 터미널 폭 미탐지 | 비목표 | D-5 결정 대기(§8) |
| P3-3 표시 규격 문서 부재 | R13 + §5 규격 표 | |
| P4-1 `main.ts` 모놀리스 | R3 | |
| P4-2 워커 라벨이 herdr 소유 | 비목표 | D-2 — §5 규격 문서화만(§8) |

## 5. 설계

### 5.1 영향받는 계층과 무결 계층

| 계층 | 영향 | 내용 |
| --- | --- | --- |
| `packages/presentation` | **변경(신규 모듈 포함)** | 어휘·색 역할 토큰 모듈(`tokens.ts` 상당), 리포트 포맷터 4종 이관, 환경 가드, 상태→역할 조회 |
| `packages/cli` | **변경(축소)** | `main.ts`는 인자 파싱·디스패치·프로세스 스폰 중심으로 잔여(포맷터·글리프·문구 제거) |
| `packages/*/test`, `tests/architecture-boundaries.test.ts` | **변경(확장)** | 무결성 테스트 신규, 경계 규칙 1건 추가, 계약 테스트 회귀 망으로 승격 |
| `crates/loop-core`·`loop-store`·`loop-bridge`·`packages/protocol`(생성물) | **무변경** | Rust bridge 타입 변경 없음 → `bun run codegen` 대상 없음(`bun run codegen:check`로 무변경 확인) |
| `packages/herdr` | **무변경** | 라벨 규칙은 현 위치 유지, 규격만 §5.5 표에 문서화(D-2) |

### 5.2 데이터 흐름과 모듈 구조 (인터페이스 스케치)

```text
protocol 스냅샷/리포트 타입(생성물, 읽기 전용)
  → presentation 포맷터(스냅샷 렌더러·리포트 포맷터 4종)
      · 어휘·색 역할은 tokens 조회(점 경로 상수)
      · 줄 수·글자수 예산은 파라미터로 주입(policy.toml → orchestrator config)
  → 환경 가드(색 모드·클리어 조건을 렌더 진입 한 곳에서 판정)
  → stdout
```

핵심 인터페이스(시그니처 스케치 — 전체 코드가 아니라 경계면):

- `moreLines(omitted: number, noun: string, suffix?: string): string` — R2. `… {omitted} more {noun}` 계약의 단일 팩토리. doctor의 `(F failed, P passed)` 부가 정보는 `suffix` 인자로.
- `renderDoctorChecks(input) / renderModelList(input) / renderBenchmarkReport(input) / renderCleanupReport(input)` — R3. 입력은 필요한 데이터 구조만 갖는 읽기 전용 뷰 모델(예: `ReadonlyArray<DoctorCheckView>`), 정렬·글리프 로직 포함.
- `formatSnapshot(command, snapshot, limits, options?: { commandDisplayName?: string })` — R5. 표시명을 파라미터로 받아 `replace()` 삭제.
- `colorRoleFor(state: TaskState): ColorRole` + `ColorRole = "success"|"warning"|"error"|"accent"|"muted"|"dim"|"text"` — R7, R10. 폐쇄 집합.
- `colorMode(env, isTty): ColorMode` — R8, R9. `NO_COLOR` 비어있지 않으면 색 off, 비-TTY면 클리어·색 off. 보수적 폴백(판단 불가 → 무색).

### 5.3 명명 규칙 — D-1 제안 해소 (승인 시 확정)

토큰·어휘 이름은 점 경로 상수(제안): `status.<state>.glyph`(9종 상태), `status.neutral.glyph`, `separator.list = "·"` / `separator.label = ": "` / `separator.depends = "←"`, `empty.<surface>`(예: `empty.runs = "No runs"`), `color.role.<role>`. 근거: Polaris 네이밍 문법·Primer 이름 제약이 선례이고, W3C JSON 승격(D-6) 시 `$value/$type` 참조 경로와 호환된다. 확정 시 T1이 ADR로 기록한다(영속 결정은 ADR 원칙).

### 5.4 글리프·색 범위 — D-3·D-4 제안 해소 (승인 시 확정)

- **D-3(불릿 어휘):** 성공 `✓` / 경고 `!` / 중립 `-`의 3역할 분리를 채택한다. **값은 현행과 동일하므로 출력 변화가 0이다** — doctor `✓`/`!`는 success/warning, cleanup 제거 항목 `-`는 neutral(제거됨), 스킵 `!`는 warning으로 의미가 부여된다. 3종 분리는 상태 색 3역할(R7)과 평행 구조가 된다.
- **D-4(색 1차 범위):** 최소 범위 — task 상태색(R10)과 watch 클리어 가드(R9)만. ANSI 16색에서 시작하고 truecolor 확장은 열어둔다(pi `ColorMode` 근사, Lipgloss 다운샘플링의 최소 버전).

### 5.5 표시 규격 통합 표 (P3-3의 문서 반쪽)

| 표면 | 예산 | 소유 |
| --- | --- | --- |
| 스냅샷/목록 논리 줄 | status 8 / attention 6 / findings 5 / list 8 (`config/policy.toml [output]`) | orchestrator config → 렌더러 파라미터 |
| 논리 줄 길이 | 기본 160 grapheme, `…` 종결 | orchestrator config(폭 인식은 D-5) |
| herdr 워커 탭 라벨 | 32자, `<taskId>·<kind>·a<attempt>`, taskId 우선 보존 | herdr 어댑터(`client.ts:548-591`) |

소유권 분할: **예산은 운영 정책**(policy.toml → config → 파라미터), **어휘·역할은 디자인 결정**(presentation 상수). `loop-core`는 양쪽 모르게 유지한다.

### 5.6 AGENTS.md 경계 준수 확인 + 관련 ADR

- **경계 준수:** 어휘·토큰은 `@loop/protocol` 타입(예: task 상태 유니언)만 참조한다. 기존 경계 테스트가 `packages/presentation/src`의 `@loop/(providers|pi-loop|herdr)` import·`Provider|PiRuntime|Herdr` 참조 금지와 `crates/loop-core/src`의 `OutputLimits|compactLines|line_text_limit` 유입 금지를 이미 강제한다(`tests/architecture-boundaries.test.ts:62-70`). 본 설계는 두 규칙을 전부 존중하며 herdr→presentation 의존도 신설하지 않는다(D-2 연기).
- **직렬화:** 결정 노드(T1)와 통합 노드(본 문서 작성, T10)는 직렬화한다. 구현 태스크 중 쓰기 범위가 비중첩인 것(예: T3↔T4)은 병렬 가능하다.
- **Rust bridge 타입 변경 없음** → codegen 커밋 극결 불필요. 모델 ID·엔드포인트·자격 증명 무관.
- **관련 ADR:** `ui-output-limits.md`(줄 수 예산 계약 — R2/R6의 상위 계약), `run-visibility.md`(watch 갱신 정책 — R9 맥락), `persona-ux.md`(pi theme 토큰 팩트 — R7 어휘 정합), `2026-09-23-worker-visibility.md`, `worker-tab-placement.md`, `pi-worker-pane-visibility.md`(워커 표시 정책 — §5.5 규격의 근거), `design-md-workflow.md`(본 문서 형식).

## 6. 검토된 대안

각 채택안에 대해 기각 대안과 이유를 남긴다. 워크플로 형식 자체(9절 골격 vs 현행 유지 vs Kiro/Spec Kit 전면 채택)의 대안 검토는 ADR `design-md-workflow.md`가 이미 수행했으므로 여기서는 내용 설계의 대안만 다룬다.

1. **어휘 상수 모듈(presentation) 채택** — 기각: (a) 호출점 유지 + 코딩 규약 문서만: P2의 원인 구조(호출점 재발명)를 그대로 두고 기계 검증도 불가하다. (b) JSON 토큰 데이터 파일 + 해석기: 현재 소비자가 전혀 없어 해석기·검증기만 남는다(design-foundations §4.1-A; W3C 승격은 D-6 트리거까지 연기).
2. **리포트 포맷터 presentation 이관 채택** — 기각: `main.ts` 유지 + 어휘 상수만 import: 포맷터가 계층 밖에 남아 표면별 스타일 분기(P4-1)와 스냅샷/리포트 회귀망 이중 유지가 지속된다. 이관은 로직 이동이 아니라 소유권 정리다(AGENTS.md thin adapter).
3. **폐쇄 색 역할 + 진입 가드 채택** — 기각: (a) chalk류 의존성 도입: 유일 ANSI가 클리어 1곳인 규모에서 과잉이며 `NO_COLOR`/TTY 정책은 여전히 직접 필요하다. (b) 전면 테마 엔진(다중 테마 파일): 테마가 1개뿐 — 확장 지점은 비용이 낮을 때만 만든다(AGENTS.md).
4. **경계 테스트 정규식 확장 채택** — 기각: (a) ESLint 커스텀 규칙: 저장소의 기존 강제 패러다임(정규식 경계 테스트) 밖에 신규 도구 사슬이 생긴다. (b) 리뷰 규율만: 우회가 감지되지 않는다(Polaris의 교훈 — 일관성은 도구여야 함).
5. **herdr 라벨 (b) 규격 문서화 채택** — 기각(연기): (a) presentation 이관: 어휘 단일화의 완성형이지만 1주차 호출점 교체량을 늘려 회귀 위험이 커진다. 이관은 D-2 트리거 후 별도 결정으로 남긴다(변경은 기존 경계를 존중하는 방향으로 분할).
6. **무결성 테스트·계약 테스트 승격 채택** — 기각: (a) 스냅샷 도구(별도 골든 파일 체인) 신규 도입: 기존 `cli.test.ts` 문자열 계약이 이미 동일 패턴 위에 있다 — 부족한 것은 패턴이 아니라 테스트 대상의 단일화다.

## 7. 요구사항–태스크 역추적 표

> **본 표의 모든 태스크는 승인 대기 상태다.** 이번 실행(`write-loop-design-md`)에서는 코드를 변경하지 않았으며, 각 태스크의 착수는 본 문서 승인(§1 조건) 이후 별도 승인 단계에서 진행한다. 각 행 = Loop 태스크 1개(ADR 규칙). 유래는 design-foundations §5의 S단계/D-항목이다. 완료 확인 명령 통과가 곧 완료 근거다("워커 성공"은 완료 근거가 아니다).

| R | 설계 요소(§5) | 태스크 id | kind | read scope | write scope | 의존 | 완료 확인 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1, R7 | §5.3 명명 규칙 ADR 기록 | `decide-token-naming-adr` (D-1) | decision | `docs/design/design.md`, `docs/design/research/design-system-practices.md` | `docs/decisions/`(신규 ADR) | 본 문서 승인 | ADR 존재 + `bun run check` |
| R1, R2, R12 | §5.2 어휘·overflow 팩토리 | `add-presentation-vocabulary-module` (S1) | implementation | `packages/presentation/**`, `docs/decisions/ui-output-limits.md` | `packages/presentation/src/`(신규 토큰 모듈), `packages/presentation/test/` | `decide-token-naming-adr` | `bun test packages`(무결성 테스트 포함) |
| R1, R2, R6 | §5.2 스냅샷 렌더러 | `migrate-snapshot-to-vocabulary` (S2) | implementation | `packages/presentation/src/` | `packages/presentation/src/snapshot.ts` | `add-presentation-vocabulary-module` | `bun test packages`(바이트 동일 — 스냅샷 갱신 없음) |
| R3, R4, R5, R6 | §5.2 리포트 포맷터·formatSnapshot | `move-cli-report-formatters` (S3) | implementation | `packages/cli/src/main.ts`, `packages/presentation/**` | `packages/presentation/src/`(리포트 포맷터), `packages/cli/src/main.ts`, `packages/cli/test/` | `add-presentation-vocabulary-module` | `bun test packages` + `bun run check` |
| R1, R6 | §5.4 글리프 3역할(값 불변 단계) | `route-glyphs-through-token-lookup` (S4 전반) | implementation | T3·T4 산출물 | 리포트 포맷터 호출점(glyph 상수 참조로 전환) | `migrate-snapshot-to-vocabulary`, `move-cli-report-formatters` | `bun test packages`(바이트 동일) |
| R1 | §5.4 D-3 확정 후 의미 부여 | `unify-neutral-glyph-vocabulary` (S4 후반) | implementation | T5 산출물, §5.4 | 리포트 포맷터 글리프 값(필요 시) | `route-glyphs-through-token-lookup` + D-3 확정(승인 리뷰에서 §5.4 채택이 기본) | `bun test packages`(의도적 스냅샷 갱신 1회 + 무결성) |
| R7, R8, R9, R10, R12 | §5.2 색 역할·환경 가드·상태색 | `add-color-roles-and-environment-guards` (S5) | implementation | `packages/presentation/**`, `packages/cli/src/main.ts` | `packages/presentation/src/`(색 역할·가드), `packages/presentation/src/snapshot.ts`, `packages/cli/src/main.ts` | `add-presentation-vocabulary-module` + D-4 확정(승인 리뷰에서 §5.4 채택이 기본) | `bun test packages`(NO_COLOR·비-TTY·9종 매핑 단위 테스트; ANSI 제거 스냅샷) |
| R9 | §5.2 가드의 관찰 증거 | `verify-non-tty-watch-output` (S6 잔여) | research | `packages/cli/**` | `docs/design/research/`(비-TTY 파이프 캡처 관찰 기록) | `add-color-roles-and-environment-guards` | 관찰 기록 파일 존재 + 클리어 이스케이프 부재 기록 |
| R1, R7, R11 | §5.6 경계 규칙 | `extend-boundary-tests-for-ansi-literals` (S7) | implementation | `tests/architecture-boundaries.test.ts`, `packages/**` | `tests/architecture-boundaries.test.ts` | `move-cli-report-formatters`, `add-color-roles-and-environment-guards`(예외 구간 최소화) | `bun run test:architecture` + 위반 주입 케이스 실패 확인 |
| R13 | §5.5·§5.6 링크 확정 | `finalize-design-entrypoint-links` (S8) | integration | `docs/design/**`, `docs/decisions/**` | `docs/design/design.md`(상태·링크), `docs/decisions/`(상호 링크) | T1–T9 전부 | 관찰(링크 대상 존재) + `bun run check` |

**병렬성 판정(쓰기 범위 비중첩):** `migrate-snapshot-to-vocabulary` ↔ `move-cli-report-formatters` 병렬 가능(snapshot.ts vs 리포트 포맷터+main.ts). 결정(`decide-token-naming-adr`)·통합(`finalize-design-entrypoint-links`) 노드는 직렬화한다.

**범위 이탈 기록(양방향 완전성 규칙 적용):** design-foundations S6의 "터미널 폭 인식 `lineTextLimit` 설계안 작성"은 요구사항 대응이 없어(R 대응 없는 태스크 = 범위 밖) 본 에픽에서 제외하고 §8 D-5의 후속 결정 태스크 입력으로 이관했다.

**양방향 완전성:** R1→6개 태스크, R2→2, R3→1, R4→1, R5→1, R6→3, R7→3, R8→1, R9→2, R10→1, R11→1, R12→2, R13→1. 모든 R에 태스크 ≥1, 모든 태스크에 R ≥1.

## 8. 미해결 질문·위험

### 흡수된 후속 결정 (design-foundations §6 D-1–D-6)

| ID | 질문 | 답변 책임 | 상태 |
| --- | --- | --- | --- |
| D-1 | 토큰·어휘 이름 규칙(점 경로 문법) 확정 | 설계 승인 리뷰가 §5.3 제안을 채택·수정 → `decide-token-naming-adr` 태스크가 ADR으로 기록 | 제안 제시(§5.3) — 승인 시 종결 |
| D-2 | herdr 라벨 규칙(`workerLabel` 등, 32자 예산) 소유권 — presentation 이관 vs herdr 유지+규격화 | 후속 결정 태스크(별도 ADR). 재질의 트리거: 본 에픽 완료 후 | 1차 답변 확정: (b) 규격 문서화(§5.5 표) — 이관은 트리거 후 |
| D-3 | cleanup `-` 불릿과 doctor `✓`/`!`의 통일 어휘 | 설계 승인 리뷰가 §5.4 제안(3역할, 값 불변)을 채택·수정 | 제안 제시(§5.4) — 승인 시 종결, 수정 시 결정 태스크 추가 |
| D-4 | 색 1차 소비자 범위와 ANSI 16색 시작점 | 설계 승인 리뷰가 §5.4 제안(최소: 상태색+클리어 가드)을 채택·수정 | 제안 제시(§5.4) — 승인 시 종결 |
| D-5 | 터미널 폭 인식 `lineTextLimit` 상한 정책(`policy.toml` 개정 동반) | 후속 결정 태스크(입력: 폭 관찰 설계안). 착수 조건: P3-2가 체감 문제로 재확인될 때 | 연기(트리거 확정) — 본 에픽 범위 밖 |
| D-6 | W3C JSON 토큰 포맷 승격 | 트리거 시 결정 태스크. 트리거: Rust/TS 토큰 공유 필요(bridge/codegen 경유) | 연기(트리거 확정) |

### 위험

- **경계 테스트 신규 규칙의 오탐** — 테스트 픽스처 내 이스케이프 문자 등이 걸릴 수 있다. 완화: 예외 목록을 만들지 않고 해당 호출점을 토큰으로 교체한다(R11 검증에 위반 주입 케이스 포함).
- **문자열 스냅샷은 색을 검증하지 못한다**(Ratatui 공식 한계, ratatui#1402) — 완화: 텍스트 스냅샷은 ANSI 제거 후 비교하고 색 어설션(역할→이스케이프 매핑)을 별도 단위 테스트로 분리한다.
- **바이트 동일 원칙과 의도적 변경의 혼재** — 커밋 단위를 분리한다(교체 커밋은 갱신 없음, `unify-neutral-glyph-vocabulary`에서 1회 갱신).
- **pi 표면과의 어휘 정합 한계** — pi theme 토큰과 Loop 색 역할의 이름이 완전히 같지 않을 수 있다. 본 에픽은 개념 정합(역할 기반)까지만 담보하고 매핑 표는 만들지 않는다(pi 측 변경이 비목표이므로).

## 9. 검증 계획

### 명령 목록

- **전체:** `bun run check` — `codegen:check` + `typecheck` + `test:architecture` + `test`(cargo workspace + loop-bridge 빌드 + `bun test packages tests plugins scripts/rustra-codegen.test.ts`).
- **집중:** `bun test packages`(계약·무결성·환경 가드 단위 테스트), `bun run test:architecture`(경계 규칙).
- **Rust 대상:** 해당 없음 — 본 에픽은 crates·bridge 무변경. `bun run codegen:check`가 생성물 무변경을 기계 확인한다.
- **유료 모델 호출 금지:** 모든 태스크의 검증은 위 명령으로 완결된다(AGENTS.md — 유닛/마일스톤 테스트는 유료 호출 불가).

### 부분 롤백 경계

- `add-presentation-vocabulary-module`: 신규 모듈 — 기존 동작 무변경, 롤백은 파일 삭제.
- `migrate-snapshot-to-vocabulary` / `move-cli-report-formatters` / `route-glyphs-through-token-lookup`: 순수 교체·이동 — 이전 커밋 revert로 바이트 복원(R6).
- `add-color-roles-and-environment-guards`: 가드가 보수적(판단 불가 → 무색)이므로 최악의 결과는 현행과 동일한 무색 출력.
- `extend-boundary-tests-for-ansi-literals`: 규칙 제거로 롤백(호출점에는 영향 없음).
- 각 태스크는 독립 머지 가능해야 한다(design-foundations §5 원칙).

### 완료 판정 규칙

태스크의 완료는 §7의 완료 확인 명령의 실제 출력으로만 판정한다. 워커의 자기 보고("성공했습니다")를 완료 근거로 인정하지 않는다(ADR `design-md-workflow.md` §결정-2의 9번 절대 규칙).
