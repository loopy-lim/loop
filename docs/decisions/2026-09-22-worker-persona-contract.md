# 워커 페르소나 계약 — id·폴백·설정 위치·경계 규칙

- **Date:** 2026-09-22
- **Status:** decided
- **Kind:** decision
- **Read scope:** `AGENTS.md`, `config/*.toml`, `crates/loop-bridge/src/commands.rs`, `docs/adr/**`, `docs/decisions/persona-benchmark-subsystem.md`, `docs/decisions/persona-ux.md`, `packages/orchestrator/src/**`, `packages/protocol/src/generated/types.ts`, `packages/providers/src/prompt.ts`, `packages/providers/src/types.ts`, `pi-extensions/persona.ts`, `pi-extensions/personas/**`
- **Write scope:** 본 문서.
- **근거:** 저장소 코드 재검증 (아래 배경 팩트) + 승인된 옵션 B (워커별 페르소나).

## 배경 팩트 (결정의 전제)

1. **프롬프트 생성은 단일 통로다.** 모든 provider 어댑터가 `packages/providers/src/prompt.ts`의 `buildWorkerPrompt`를 호출한다 — pi(`pi/adapter.ts`), codex(`codex/adapter.ts`), antigravity(`antigravity/adapter.ts`, `antigravity/persistent.ts`), zai api·cli(`zai/api.ts`, `zai/cli.ts`), herdr(`herdr-agent.ts`). 어댑터별 분기 없이 한 곳만 고치면 전 워커 레인에 균일 적용된다.
2. **TaskSpecInput은 Lead→브리지→컨텍스트로 왕복한다.** Rust `TaskSpecInput`(`crates/loop-bridge/src/commands.rs`)이 codegen으로 TS `TaskSpecInput`이 되고, `TaskContextOutput.task`가 동일 타입이므로(`crates/loop-bridge/src/execution.rs`) 필드 하나 추가로 오케스트레이터까지 전달된다. 왕복을 위해 loop-core `Task`가 opaque 메타데이터로 값을 보관해야 한다.
3. **pi-extensions 빌트인 페르소나는 4종이다.** `pi-extensions/persona.ts`: implementer, reviewer(security|performance|spec|readability 모드), debugger, architect. `pi-extensions/personas/*.md`는 이의 문서화이며, 실제 주입 문구는 TS 상수에 있다. Lead 세션 페르소나는 `before_agent_start`로 주입되고 `persona-state` 세션 엔트리로 영속화된다.
4. **D2(persona-ux.md)는 buildWorkerPrompt 페르소나 주입을 기각했다.** 기각 사유 3가지: (a) provider 어댑터가 pi 확장 개념을 알게 되는 경계 위반, (b) persona 영속화가 pi 세션 엔트리 의존이라 이식 불가, (c) pi `before_agent_start`의 중복 구현. 당시 대안 채널은 TaskSpec requirements 자유 텍스트였다.
5. **설정 위치 규칙 선례.** 모델 ID·엔드포인트는 `config/models.toml`, `config/providers.example.toml`에 두고 코드에서 배제한다(AGENTS.md: "Put model IDs and provider endpoints only in configuration or adapter construction"). 오케스트레이터 `config.ts`가 파일시스템에서 TOML을 읽는 유일한 지점이다.
6. **워커는 세션이 없다.** pi 워커는 `--no-session -p <prompt>`로 실행되어(`pi/adapter.ts`) 세션 엔트리 영속화 채널이 애초에 존재하지 않는다.

## 결정

### D1. 페르소나 id 집합 — 문서상 폐집합 4종, 레지스트리 수준에서 확장 가능

- **정규 id:** `implementer`, `reviewer`, `debugger`, `architect` — pi-extensions 빌트인과 1:1 정렬. Lead(loop_run)는 이 4종을 문서화된 선택지로 사용한다.
- **권위 소스는 레지스트리다:** `config/personas/*.md`의 파일 스템 = 유효 id, 파일 본문 = 주입 텍스트. 4종 빌트인 파일을 저장소에 커밋하므로 기본 설치는 폐집합처럼 동작하고, 파일을 추가하면 추가 id도 유효해진다(모델 ID가 config에 사는 것과 같은 패턴).
- **대안 및 기각 이유:**
  - Rust enum으로 폐집합 강제 → 기각. 프롬프트 어휘가 loop-core에 유입되고, 페르소나 하나 추가에 Rust 변경 + codegen + 재배포가 필요하다. 설정 파일만 고치면 되는 일을 컴파일 계약으로 승격시키는 과잉 제약.
  - 레지스트리 없이 임의 문자열 허용 → 기각. 텍스트 소스가 없는 id는 검증도 문서화도 불가능해 `Option<String>`이 쓰레기 값 통로가 된다.

### D2. TaskSpecInput.persona — `Option<String>`, 부재 시 kind 기본 매핑

- **Rust 우선:** `crates/loop-bridge/src/commands.rs`의 `TaskSpecInput`에 `pub persona: Option<String>` 추가, `task_from_input`이 loop-core `Task`에 opaque 메타데이터로 보관하고 `get_task_context`가 재출력(왕복 보장). 이어 `bun run codegen` → generated TS는 `persona?: string | null`이 되고 `TaskContextOutput.task`를 타고 오케스트레이터까지 무료로 전달된다(팩트 2). 커밋은 Rust 변경과 generated 파일을 함께.
- **loop-core는 id를 해석하지 않는다.** 저장·왕복만 담당하는 문자열 메타데이터(title과 같은 종류). id의 의미(텍스트, 폴백)는 프롬프트 계층 소유다.
- **kind 기본 매핑(부재/null일 때):**

  | kind | 기본 페르소나 |
  |---|---|
  | implementation | implementer |
  | decision | architect |
  | verification | reviewer |
  | research | debugger |
  | integration | architect |

- **매핑 테이블의 위치는 TS 오케스트레이터다.** "deterministic policy는 Rust" 원칙의 예외이며 근거: persona id는 프롬프트 계층 어휘이고(모델 ID와 동일 범주), 매핑을 Rust에 두면 D1에서 config 레지스트리와 Rust 두 곳에 소스 오브 트루스가 생기고 loop-core가 프롬프트 개념을 알게 된다. 결정적 규칙이지만 그 대상이 프롬프트 구성인 경우는 설정 계층 정책으로 본다.
- **Lead 채널:** `packages/pi-loop`의 loop_run 태스크 스키마에 선택적 `persona` 문자열 추가. Lead 측 검증은 존재·비어있지 않음 수준이며, 의미 검증(레지스트리 조회)은 오케스트레이터가 소유한다.
- **대안 및 기각 이유:**
  - 매핑을 Rust에 두고 TaskSpecInput에 해석된 id를 채워 주는 방식 → 기각. 위 근거와 동일(이중 소스, loop-core 프롬프트 어휘 유입).
  - requirements에 페르소나 텍스트를 섞는 D2 방식 유지 → 기각. Lead마다 텍스트를 재작성해 비결정적이고, 어댑터 무관하게 균일 적용되는 구조적 채널이 없다. (requirements 자유 텍스트는 여전히 허용되는 보조 채널이다.)

### D3. 미지 id — kind 기본 폴백 + 결과 요약 경고, 절대 hard fail 아님

- **해석 체인 (오케스트레이터 resolver):**
  1. 요청 id가 레지스트리에 있으면 그 텍스트 사용.
  2. 없으면 kind 기본 id로 재조회 — 있으면 그 텍스트 + 경고.
  3. 기본 id마저 없으면(예: 사용자가 빌트인 파일 삭제) 페르소나 섹션 없이 프롬프트 구성 + 경고.
- **경고 표면:** 오케스트레이터가 기록되는 워커 결과 요약 선두에 한 줄을 덧붙인다 — 예: `[persona] unknown id 'xyz' — fell back to 'architect' (kind=decision)`. 결과 요약은 Lead에게 회신되고 downstream 의존성 요약으로 흐르므로 별도 이벤트 채널이 필요 없다. 성공 판정, 스케줄링, completion checks, attention 발생에 영향을 주지 않는다.
- **대안 및 기각 이유:**
  - submit_plan에서 미지 id를 검증 실패 → 기각. 페르소나 라벨이 내구 계약(durable plan)을 오염시킨다. 페르소나는 조언적(advisory)이며 AGENTS.md의 "worker success is not verification"과 같은 선에서 실패로 취급하지 않는다.
  - 경고를 워커 프롬프트 안에만 넣기 → 기각. 워커는 경고를 재보고할 의무가 없어 유실된다. 기록 경계(오케스트레이터)에서 붙여야 증거로 남는다.

### D4. 텍스트는 config에 — 오케스트레이터가 해석, providers는 렌더만

- **위치:** `config/personas/*.md`. 4종 빌트인 커밋(초기 내용은 `pi-extensions/persona.ts`의 주입 상수에서 이식). 파일 형식: 프론트매터 없음, 본문이 그대로 주입 텍스트(trim만 적용). 문서성 주석은 파일에 섞지 않는다(문서는 docs에).
- **적재:** `packages/orchestrator/src/config.ts`에 페르소나 레지스트리 로더 추가(id → 텍스트). 설정 디렉터리 해석은 기존 `resolveConfigDirectory`를 재사용. TOML 모델 설정과 같은 수명 주기(프로세스 시작 시 적재)를 따른다.
- **전달:** `StartWorkerInput`(`packages/providers/src/types.ts`)에 **이미 해석된 텍스트** `personaInstructions?: string` 추가. 오케스트레이터 `task-execution.ts`가 resolver 결과를 채운다. providers는 파일시스템·config·페르소나 어휘에 대해 무지하다 — 받은 문자열을 렌더할 뿐.
- **대안 및 기각 이유:**
  - providers가 `config/personas/`를 직접 읽기 → 기각. 어댑터에 파일시스템·설정 경로 해석 관심사가 유입되고 오케스트레이터 config.ts와 경로 로직이 이중화된다.
  - 텍스트를 TS 상수로 내장 → 기각. 텍스트 수정에 재빌드가 필요하고 "ID와 텍스트는 config에 산다" 규칙을 깬다. (빌트인 기본값을 코드에 이중화하는 것도 같은 이유로 기각 — D3 체인 3단이 그 자리를 대신한다.)

### D5. 주입 지점 — buildWorkerPrompt 단일 통로 (전 어댑터 균일)

- `buildWorkerPrompt`가 `Persona` 섹션을 Task 섹션 뒤에 삽입한다: `section("Persona", [instructions])`, 기존 필드와 동일하게 `safe`·`MAX_FIELD_LENGTH` 바운드 적용. `fallbackPrompt`(context 없는 경로)에도 동일 섹션 추가.
- 팩트 1대로 pi·codex·antigravity(2경로)·zai(api/cli)·herdr 전 어댑터가 이 한 함수를 경유하므로 어댑터 코드 변경은 0이다.
- **대안:** 어댑터별 시스템 프롬프트 후크 추가 → 기각. pi `before_agent_start`의 중복이고 6개 호출부를 각각 검증해야 한다.

### D6. persona-ux.md D2와의 관계 — 워커 역할 지시에 한해 대체(supersede)

- **대체되는 것:** D2가 "buildWorkerPrompt에 persona 주입 + 어댑터 extension/system-prompt 후크"를 기각한 판단은 **워커 역할 지시 범위에서** 폐기된다.
- **기각 사유 3가지가 모두 적용되지 않는 이유:**
  - (a) 경계 위반 → 본 설계에서 어댑터가 알게 되는 것은 사전 해석된 불투명 문자열(`personaInstructions`)뿐이다. pi 확장 개념, 페르소나 어휘, 파일시스템 어디에도 어댑터가 닿지 않는다. 페르소나 텍스트는 pi 확장 개념이 아니라 **오케스트레이터 프롬프트 구성으로 들어가는 설정(configuration)**이다 — requirements 텍스트와 정확히 같은 경로, 같은 신뢰 등급.
  - (b) pi 세션 엔트리 의존 → 제거됨. 영속화는 loop-core Task 메타데이터(SQL)이고, 워커는 애초에 `--no-session`이라 세션 엔트리 채널이 없다(팩트 6).
  - (c) `before_agent_start` 중복 → 해당 없음. 그 경로는 Lead 세션 페르소나의 것이며 본 결정은 만지지 않는다.
- **유지되는 것:** D2의 나머지(todo 가시성, 색상, Lead 페르소나, 키바인딩)와 "requirements로 역할 맥락 전달" 채널은 유효하다. persona 필드는 그 위의 구조화·균일 채널이지 requirements의 금지가 아니다.
- **문서 정리:** 본 문서가 대체 선언의 권위 소스다. `persona-ux.md` D2 본문에는 각주를 다는 후속 문서 태스크를 권하되, 본 태스크의 write scope를 존중해 여기서 편집하지 않는다.

### D7. 논골(Non-goals)

- **Lead 세션 페르소나 무변경:** `pi-extensions/persona.ts`의 `/persona` 커맨드, auto 모드, 푸터, `before_agent_start` 주입, `persona-state` 영속화는 그대로다. 워커 페르소나와 Lead 페르소나는 독립 채널이다(워커 프롬프트는 config 텍스트, Lead 프롬프트는 pi 확장).
- **워커의 pi 세션 페르소나 영속화 없음:** 워커는 `--no-session`이며 `persona-state` 엔트리를 만들지 않는다.
- **`~/.pi/agent/personas` 사용자 디렉터리 병합 없음:** Lead 확장과 달리 워커 페르소나의 유일한 소스는 `config/personas/`다(저장소 자기완결성 — 러너 환경마다 다른 홈 디렉터리를 신뢰하지 않음).
- **reviewer 하위 모드 없음(v1):** 모드(security 등)는 Lead 확장 기능으로 남긴다. 워커용 reviewer 파일은 단일 블록이며, 모드가 필요해지면 `reviewer-security.md` 같은 별도 id로 확장한다.
- **벤치마크 연동 없음:** `persona-benchmark-subsystem.md`의 워크플로 프로필이 템플릿 태스크에 persona를 지정하는 것은 상위 호환 확장으로 미룬다(본 계약 위에 그대로 얹힌다).

## 경계 방향 (위반 금지선)

- **loop-core:** persona를 `Option<String>` opaque 메타데이터로만 취급. id 해석·기본 매핑·텍스트 적재 금지.
- **providers/adapters:** 파일시스템·config 접근 금지. `personaInstructions` 문자열 렌더만.
- **pi-loop(Lead):** id 존재 검사만. 레지스트리 조회·폴백 로직 금지(오케스트레이터 소유).
- **pi-extensions:** 무변경. 워커 페르소나는 pi 확장 개념이 아니다.
- **설정:** persona 텍스트는 `config/personas/`에만 산다. 코드·프롬프트 빌더에 인라인 금지.

## 구현 순서 (후속 태스크용)

1. Rust: `TaskSpecInput.persona` + loop-core `Task` 메타데이터 + `task_from_input`/`get_task_context` 왕복 → `cargo test -p loop-core -p loop-bridge`.
2. `bun run codegen` → generated TS 커밋(Rust 변경과 동일 커밋).
3. 오케스트레이터: config.ts 페르소나 로더 + resolver(폴백 체인·경고 문자열) + task-execution StartWorkerInput 연결.
4. providers: `types.ts` 필드 + `prompt.ts` Persona 섹션.
5. pi-loop: loop_run 태스크 스키마 `persona` 선택 필드.
6. `config/personas/{implementer,reviewer,debugger,architect}.md` 커밋.

## 테스트 전략 (유료 호출 없음)

- **resolver 단위:** 레지스트리 히트, 미지 id → kind 폴백 + 경고 문구, 기본 id 부재 → 섹션 생략 + 경고, 5종 kind 매핑 테이블 전체 단언.
- **prompt.ts 단위:** Persona 섹션 위치(Task 뒤), 길이 바운드, context 없는 fallbackPrompt 포함.
- **브리지 직렬화:** `Option<String>` 왕복(Some/None) 단언 — `cargo test -p loop-bridge`.
- **codegen:** `bun run codegen:check`.
- **경계:** `bun run test:architecture` — providers의 파일시스템 import 부재, loop-core의 페르소나 어휘 부재 단언 가능 지점 확인.
- **전체 회귀:** `bun run check`.

## 검증 커맨드 (구현 태스크용)

```bash
cargo test -p loop-core && cargo test -p loop-bridge
bun run codegen:check
bun test packages
bun run test:architecture
bun run check
```
