# kind 기본 페르소나 매핑 설정화 — 안 C 실행 결정

- **일자:** 2026-09-24
- **상태:** 결정됨; 실행은 후속 태스크
- **결정 종류:** `decision` (decision-persona-defaults)
- **선행 결정:** `docs/decisions/2026-09-22-worker-persona-contract.md` (D1–D7) — 본 문서는 그 D2의 kind 기본 매핑 상수를 설정으로 이동하되 해석의 단일 지점(오케스트레이터)은 유지한다. `docs/decisions/2026-09-24-evolution-roadmap.md`의 simplify f1 잔여(단일 소스 파생)와 동일 뿌리.
- **읽기 범위:** `AGENTS.md`, `config/*.toml`, `config/personas/**`, 선형 결정 문서 2편, `packages/orchestrator/src/{config,index,persona}.ts`, `packages/pi-loop/src/{extension.ts, lead/prompts.ts}` + 소비 지점 전수 grep(아래 C5)
- **쓰기 범위:** 본 문서만
- **근거:** 저장소 코드 정적 읽기·grep 재검증(유료 모델 호출 없음)

## 배경 팩트 (결정의 전제 — 현재 HEAD 검증)

1. **매핑 상수의 현주소.** `packages/orchestrator/src/persona.ts:20-26`의 `KIND_DEFAULT_PERSONAS`(implementation→implementer, verification→reviewer, research→debugger, decision→architect, integration→architect), `:29`의 `EXPLICIT_ONLY_PERSONA_IDS = ["designer"]`, `:32-34`의 `PERSONA_IDS`(앞二者의 합집합, 삽입 순서 = 정렬 순서 계약). `resolvePersona`(`:54`)가 `KIND_DEFAULT_PERSONAS[kind]`를 직접 참조한다.
2. **레지스트리와 어휘 목록의 잠재 드리프트(현행 결함).** D1의 권위 소스는 `config/personas/*.md` 파일 스템이지만, Lead 제출 검증(`normalizePersonas`, extension.ts)은 레지스트리 키가 아니라 상수 도출 `PERSONA_IDS`를 본다. 사용자가 `config/personas/pirate.md`를 추가하면 오케스트레이터 resolver는 `persona: "pirate"`를 수용(레지스트리 히트)하지만 Lead는 제출 시점에 거부한다. 본 설정화가 이 어긋남을 수습할 기회다.
3. **pi-loop는 이미 config를 등록 시점에 적재한다.** `packages/pi-loop/src/extension.ts:115`의 `limits: OutputLimits = loadLoopConfig().output` 기본 인자 — pi 세션 시작(확장 등록) 시 1회. `packages/pi-loop/test/lead.test.ts:304`가 "설정 없으면 등록 실패"를 명시적으로 테스트한다. 즉 pi-loop의 설정 적재 수명 주기(프로세스 시작, D4와 동일)는 이미 확립되어 있으며, Lead 자식 프로세스는 CLI가 `LOOP_CONFIG_DIR`을 전파한다(`packages/cli/src/main.ts:659`).
4. **설정 디렉터리는 하나다.** `resolveConfigDirectory`(explicit → `LOOP_CONFIG_DIR` → `XDG_CONFIG_HOME/loop` → `~/.config/loop`)가 유일한 해석 통로이며, 저장소 `config/`는 그 내용의 출발점(기본 제공 분)이다. conf.d식 계층 병합은 존재하지 않는다.
5. **kind는 닫힌 집합이다.** `TaskKind`는 Rust bridge enum 5종(research, decision, implementation, verification, integration)이며 generated protocol에도 동일하게 굳는다. 새 kind는 Rust 변경 + codegen + 오케스트레이터 동반을 필수로 하는 버전Skew다.
6. **`config.ts`가 설정 디렉터리를 읽는 유일한 지점인 규칙은 유효하다.** 런타임 설정 디렉터리 TOML 판독기는 `packages/orchestrator/src/config.ts`뿐(`benchmark.ts`는 호출자가 명시적으로 준 벤치마크 프로파일 파일만 읽는 주변부). `loadPersonaRegistry`는 `.md`만 보고 `defaults.toml`과 충돌하지 않는다.
7. **서브패스 수출이 이미 열려 있다.** `packages/orchestrator/package.json` exports: `"./persona"`, `"./config"` — pi-loop의 리프 임포트(bun:ffi 무관) 제약을 그대로 만족한다.

## 결정

### C1. 위치·형식 — `config/personas/defaults.toml`의 `[kind_defaults]` 테이블

```toml
# config/personas/defaults.toml
[kind_defaults]
implementation = "implementer"
verification = "reviewer"
research = "debugger"
decision = "architect"
integration = "architect"
```

- **적재:** `packages/orchestrator/src/config.ts`에 `loadPersonaKindDefaults(configDirectory)` 추가. 파일 부재 → 빈 오버라이드(기능 선택적). `loadLoopConfig`가 결과를 `LoopConfig.personaKindDefaults`로 노출. 모델·라우팅 설정과 같은 수명 주기(프로세스 시작 1회).
- **저장소 기본 파일:** 위 내용 그대로 `config/personas/defaults.toml`을 커밋한다(현재 상수와 값 동일 — 기본 설치 불변, 아래 §기본 설치 동작 불변 참조).

**대안 및 기각 이유:**

- **안 B `config/policy.toml`에 `[personas]` 섹션** → 기각. 새 파일·새 판독 경로가 없다는 장점은 있으나, 페르소나 설정이 `personas/`(텍스트)와 `policy.toml`(매핑) 둘로 쪼개진다. D1이 "권위 소스는 레지스트리 디렉터리"로 선언한 응집을 훼손하고, 사용자의 policy 편집(스케줄러·출력 예산)과 페르소나 기본값의 업그레이드 병합이 서로 오염된다.
- **안 C′ `config/personas/*.md` 프론트매터(`default-for: implementation` 등)** → 기각. D4가 "프론트매터 없음, 본문이 그대로 주입 텍스트"를 명시적으로 계약했다. 주입 텍스트의 순수성(문서성 주석 혼입 금지와 같은 이유)을 깬다.
- **안 D `config/models.toml` 확장** → 기각. 모델 라우팅 설정과 무관한 관심사를 같은 파일에 얹는 것은 분류 오류이다.

**채택 근거 요약:** 페르소나 도메인의 자기완결성(D1 권위 디렉터리 안에 텍스트·매핑이 공존), 선택적 파일 의미론(레지스트리 부재 정숙과 동일 선상의 "미설치" 상태), `loadPersonaRegistry` 무변경(md 필터가 이미 toml을 무시), policy.toml 편집과 독립적인 업그레이드 경로.

### C2. 우선순위 — 키별 오버라이드, 컴파일 상수는 완전한 바닥

- **우선순위:** `config/personas/defaults.toml`의 해당 kind 키 > `KIND_DEFAULT_PERSONAS` 상수(현재 값 그대로 유지, 역할 재정의: "컴파일 시점 폴백"). 파일에 없는 kind는 상수 값을 그대로 쓴다. **전면 교체가 아니다.**
- **단일 파일 계층:** 활성 디렉터리는 하나뿐(팩트 4)이므로 "기본 제공 파일 vs 사용자 오버라이드"는 별도 계층이 아니라 같은 파일의 출발 내용(저장소 기본)과 사용자 편집이다. 오버라이드 단위는 키(kind)다.
- **상수 존속 근거:** (a) 요구된 상수 폴백, (b) 파일·디렉터리 미설치 시에도 제출 검증 어휘와 산문이 붕괴하지 않는 바닥, (c) 기본 설치 불변의 비교 기준점.

**대안 및 기각 이유:**

- **전면 교체(파일이 곧 매핑, 미기술 kind는 기본 없음)** → 기각. 부분 파일을 쓴 사용자가 언급 안 된 kind의 기본을 조용히 잃는다. `resolvePersona`는 defaultId 부재 + 레지스트리 비었지 않음인 경로에서 **경고 없이** 페르소나 없이 진행하므로(현행 구현), 페르소나가 조용히 사라지는 실패 양상이 된다. 키별 오버라이드는 상수가 5 kind 전체의 완전한 바닥이 되게 한다.
- **상수 삭제·파일만 남기기** → 기각. 파일 분실/미설치 환경에서 어휘·검증·산문의 원천이 사라진다. 선택적 기능 파일이 필수 파일로 승격된다.

### C3. 검증 의미론 — 구조는 엄격, 의미는 advisory(D3 유지)

- **적재 시점(엄격, ConfigError):** `[kind_defaults]` 값은 비지 않은 문자열(기존 `text()` 허용), 키는 닫힌 `TaskKind` 5종(팩트 5)이어야 한다. 미지 kind 키·잘못된 타입은 `config.unknown_task_kind`/`config.invalid`로 즉시 실패 — `computeClass()`가 미지 compute class를 즉시 실패시키는 것과 같은 선례이며, 운영자 오타를 시작 시점의 정확한 메시지로 알리는 것이 무시보다 나은 피드백이다. kind 집합은 config.ts에 `computeClasses` Set과 동일한 방식의 상수로 둔다(generated TS가 집합을 수출하지 않는다; Rust enum의 TS측 검증 테이블 — bridge 왕복 타입이 아니므로 "핸드라이트 사본 금지"와 무관).
- **런타임(Advisory, D3 무변경):** 설정된 기본 id가 레지스트리에 없으면 기존 `resolvePersona`의 경고 + 섹션 생략 경로 그대로. 성공 판정·스케줄링·completion checks·attention에 영향 없음. 적재 시점에 id 값의 liveness(레지스트리 조회)를 검사하지 **않는다** — 레지스트리와 매핑은 독립적으로 편집될 수 있고, D3 체인이 이미 그 갭을 경고로 수습한다.
- **`EXPLICIT_ONLY_PERSONA_IDS` 하드코딩 폐지 — 도출로 대체.** "명시 전용"은 정의상 "어떤 kind도 기본으로 삼지 않는 id"다. `explicitOnly = 유효 id 집합 − Object.values(유효 kind 기본 매핑)`로 도출한다. `유효 id 집합`은 (레지지스트리 키 ∪ 기본 매핑 값), 레지스트리가 비었으면(미설치) 종전 상수 도출 집합(implementer, reviewer, debugger, architect, designer)을 쓴다. 기본 설치에서 도출 결과는 현행과 동일(designer)하므로 동작 불변이며, 사용자가 `decision = "designer"`로 바꾸면 designer는 자동으로 명시 전용을 그만둔다.

**대안 및 기각 이유:**

- **기본 id가 레지스트리에 없으면 적재 실패** → 기각. D3 위반. 페르소나는 advisory이며 설정 오타 하나가 `loop status`조차 죽이게 된다. 단, 이 "advisory"는 **id 값의 의미**에만 적용되고 파일 구조(타입·kind 키)의 엄격함과 대치되지 않는다 — 위 구분 참조.
- **`EXPLICIT_ONLY_PERSONA_IDS = ["designer"]` 상수 유지** → 기각. 사용자가 페르소나 파일을 추가하거나 kind 매핑을 바꿀 때마다 드리프트한다(배경 팩트 2와 동형). 코드에 남는 마지막 페르소나 리터럴이기도 하다.
- **`explicit_only = [...]` 설정 키 추가** → 기각. 도출 가능한 사실의 이중 소스. 어느 쪽이 거짓말을 하는지 판정할 계점이 없어진다.

### C4. pi-loop 동적화 — 등록 시점 1회 적재에서 어휘 파생

- **적재 시점:** `registerLoopExtension` 호출 시 1회(팩트 3의 기존 기본 인자 선례를 일반화). `loadLoopConfig()`를 한 번 호출해 `limits`와 페르소나 어휘를 **함께** 파생한다(이중 디스크 읽기·분기하는 실패 회피). 도구 호출마다 재적재하지 않는다 — D4의 "프로세스 시작 시 적재" 수명 주기와 동일하며, 설정 변경은 Lead 세션 재시작이 필요함을 문서 계약으로 명시한다.
- **파생물:** `LeadPersonaVocabulary { ids: string[], kindDefaults: Record<string, string>, explicitOnly: string[] }` — `config.personas`(레지스트리) + `config.personaKindDefaults`(C2 병합 결과)에서 C3의 도출 규칙으로 계산. 상수는 레지스트리/파일 미설치 바닥으로만 사용.
- **소비 교체:**
  - `normalizePersonas(tasks)` → `normalizePersonas(tasks, vocabulary)` — 검증 집합을 상수 도출 `PERSONA_IDS`에서 어휘 `ids`로. 이것이 배경 팩트 2의 드리프트(신규 `pirate.md` 거부)를 수습한다.
  - `extension.ts`의 도구 설명(`PERSONA_KIND_DEFAULTS_PROSE`, PERSONA_IDS 문구)과 `prompts.ts`의 `PERSONA_LIST_PROSE`/`KIND_DEFAULTS_PROSE` **모듈 상수 산문 삭제** — `taskSpecInputDescription(vocabulary)`, `decompositionPrompt(intent, vocabulary)`로 파라미터화. 정적 임포트에서 미리 계산된 산문은 회귀이며 금지한다.
  - 테스트 주입: 기존 테스트가 `limits`를 명시 전달하듯 어휘도 fixture 주입(디스크 무의존 유지). `lead.test.ts:304`의 "설정 없으면 등록 실패" 테스트가 기본 인자 경로의 계약을 계속 담보한다.
- **번들 제약 무변경:** `@loop/orchestrator/config`·`/persona` 서브패스(팩트 7) 그대로 — bun:ffi 무관 리프.

**대안 및 기각 이유:**

- **도구 호출마다 `loadLoopConfig` 재적재** → 기각. D4 수명 주기 위반, 호출별 디스크 I/O, 그리고 한 세션 안에서 프롬프트 산문이 시각에 따라 달라지는 비결정성.
- **pi-loop가 `config/personas/`를 직접 스캔** → 기각. config.ts 경로 해석의 이중화. D4가 provider 직접 읽기를 기각한 것과 동형의 경계 침해다.
- **오케스트레이터가 유효 id 목록을 스냅샷·이벤트로 노출하고 pi-loop는 그것을 읽기** → 기각. 워커 시작 전에는 조회 시점이 없고(제출은 실행 선행), 표면 확장이 요구보다 크다.

### C5. 소비 지점 전수 목록(grep 검증)과 변경 지점

`KIND_DEFAULT_PERSONAS|PERSONA_IDS|EXPLICIT_ONLY_PERSONA_IDS|PERSONA_KIND_DEFAULTS|KNOWN_PERSONA_IDS` 전수 grep 결과 — 제품 코드·테스트·문서 기록 전부:

| # | 지점 | 형태 | 변경 |
|---|---|---|---|
| 1 | `packages/orchestrator/src/persona.ts:20-34,54` | 정의 + `resolvePersona` 직접 참조 | 상수는 컴파일 폴백으로 재문서화. `ResolvePersonaInput`에 `defaults?: Record<string,string>` 추가(기본값 = 상수). `EXPLICIT_ONLY_PERSONA_IDS`·상수 도출 `PERSONA_IDS`는 폐지 또는 내부 폴백으로 강등 |
| 2 | `packages/orchestrator/src/index.ts:8` | `export * from "./persona"` 재수출 | 무변경(수출 표면 유지; 폐지 심볼은 후속 태스크에서 정리 여부 별도 판단) |
| 3 | `packages/orchestrator/src/task-execution.ts:5,34` | `resolvePersona` 호출(간접 소비) | `defaults: config.personaKindDefaults` 전달. `Options`에 `personaKindDefaults?` 추가 |
| 4 | `packages/orchestrator/src/config.ts:187,199-213` | `personas` 레지스트리 적재·노출 | `loadPersonaKindDefaults` + `LoopConfig.personaKindDefaults` + C3 검증 추가 |
| 5 | `packages/orchestrator/src/coordinator.ts:23,51,60,107`, `runtime.ts:25,52` | `personas?: PersonaRegistry` 배관 | `personaKindDefaults?` 병렬 추가( additive. `PersonaSettings` 번들 묶음은 대안으로만 — 기존 서명·테스트 전면 교체 비용이 덤보다 큼) |
| 6 | `packages/pi-loop/src/extension.ts:8-12,29-31,128,478-480` | 임포트·산문·도구 설명·`normalizePersonas` | C4 대로 어휘 파생·파라미터화 |
| 7 | `packages/pi-loop/src/lead/prompts.ts:3,31-33` + description 함수 | 모듈 상수 산문 | 파라미터화, 상수 산문 삭제 |
| 8 | `packages/orchestrator/test/persona.test.ts:14,90-109` | 매핑 테이블 단언·designer 단언 | 상수 바닥 단언 유지 + 적재 병합(tmpdir fixture)·repo 기본 파일≡상수 등식 단언 추가; designer 단언은 도출 규칙 단언으로 교체 |
| 9 | `packages/pi-loop/test/task-spec-description.test.ts:3,11,20-40` | 산문 순서 단언 | fixture 어휘 기준으로 갱신 + 오버라이드 반영 단언(회귀 금지) |
| 10 | `packages/pi-loop/test/persona.test.ts:26` | 리터럴 `"implementer, reviewer, debugger, architect, designer"` | 기본 어휘 fixture 기준 유지(문자열 리터럴 자체는 계약 아님) |
| 11 | `docs/research/**`, `docs/audits/**`, `docs/decisions/2026-09-24-evolution-roadmap.md` | 기록 언급 | 소비자 아님(역사 기록) — 무변경 |

**명시적으로 무변경인 비(非)소비자:** `packages/providers/src/prompt.ts`·`types.ts`(`personaInstructions` 렌더만 — D4 경계 그대로), `pi-extensions/**`(D7: Lead 세션 페르소나는 독립 채널), `crates/loop-core`·`loop-bridge`(persona은 여전히 opaque `Option<String>`), `packages/cli/src/main.ts`(configDirectory·LOOP_CONFIG_DIR 전달만).

## 선행 계약과의 정합성

- **D1:** 레지스트리 권위(`config/personas/*.md` 스템) 무변경. `defaults.toml`은 md 필터로 레지스트리에 섞이지 않는다. 유효 id 판정이 레지스트리 키를 포함하게 되어 권위 소스와의 정합이 오히려 강화된다(팩트 2 수습).
- **D2:** 해석(요청 id → 기본 → 폴백)은 여전히 오케스트레이터 `resolvePersona` 단일 지점. 바뀌는 것은 그 조회 테이블의 **출처**(상수 → 병합 결과)뿐이다. loop-core·bridge 무변경.
- **D3:** 경고 표면(워커 결과 요약 선두 1행)·advisory 성격 무변경. 적재 시점 엄격성은 구조(타입·kind 키)에 한정되며 id 값의 의미 검증은 계속 런타임 경고다.
- **D4:** providers는 여전히 `personaInstructions` 문자열 렌더만. 파일시스템·설정·페르소나 어휘 비노출 유지. config.ts가 설정 디렉터리의 유일한 판독기라는 규칙도 유지(새 로더도 config.ts 안).
- **D7:** Lead 세션 페르소나(pi-extensions), `~/.pi/agent/personas` 병합, reviewer 하위 모드, 벤치마크 연동 — 모두 논골 유지. `persona-benchmark.example.toml` 프로파일이 persona를 지정하는 확장은 본 매핑과 독립적이다.

## 기본 설치 동작 불변 증명

1. 저장소 `config/personas/defaults.toml` 값 == 현행 상수 값(동일 5항목) → 병합 결과 해석 불변.
2. 레지스트리(5개 md)·상수 바닥 무변경 → 미설치 환경도 불변.
3. 도출 명시 전용 집합 == `{designer}` → 제출 검증 집합 불변.
4. **등식 단언 테스트:** `loadPersonaKindDefaults(repoConfigDir)` deep-equal `KIND_DEFAULT_PERSONAS` — 기본 파일과 상수의 드리프트를 CI에서 경보한다(어느 쪽이 먼저 바뀌어도 실패).

## 구현 순서(후속 태스크용; 코드젠 접점 0)

TaskSpecInput·bridge·protocol 무변경이므로 `bun run codegen` 불필요, Rust 무접점. 순서 권장:

1. 오케스트레이터: config.ts 로더+검증, `LoopConfig.personaKindDefaults`, persona.ts `defaults` 파라미터화, task-execution/coordinator/runtime 배관, `config/personas/defaults.toml` 커밋(상수와 동일 커밋 — 불변 증명의 원자성).
2. pi-loop: 어휘 파생·`normalizePersonas`/prompts 파라미터화·산문 상수 삭제.
3. 테스트: 위 표 8·9·10 갱신 + 회귀 금지(오버라이드 fixture가 도구 설명·검증에 반영)·등식 단언.

1과 2는 서로 다른 패키지 접점이라 병렬 가능하나, 어휘 파생 규칙(C3)을 양쪽이 공유하므로 1 선행 권장.

## 테스트 전략(유료 호출 없음)

- **config.ts 단위:** 파일 부재→빈 오버라이드, 키별 병합(부분 파일), 미지 kind 키→ConfigError, 빈 문자열 값→ConfigError, repo 기본 파일≡상수 등식.
- **resolvePersona 단위:** 오버라이드된 기본 적중, 오버라이드 id가 레지스트리 부재→경로 3단 경고(문구 그대로), `defaults` 생략 시 상수 바닥(기존 테스트 무변경 통과).
- **pi-loop 단위:** fixture 어휘로 미지 id 거부 문구, 레지스트리 추가 id(pirate 사례) 수용 — 팩트 2 회귀 테스트, 도구 설명·`taskSpecInputDescription`에 오버라이드 반영(정적 산문 회귀 감지), `lead.test.ts:304` 계약 유지.
- **경계:** `bun run test:architecture`(pi-loop의 config 경로·providers 무지 재확인).
- **전체:** `bun test packages`, `bun run check`.

## 검증 커맨드(본 결정 문서)

```bash
test -s docs/decisions/2026-09-24-persona-defaults-config.md
grep -q 대안 docs/decisions/2026-09-24-persona-defaults-config.md
```

구현 태스크: `bun test packages && bun run test:architecture && bun run check`(cargo·codegen 무접점).

## 남은 리스크와 후속 관찰

- **세션 중 설정 편집 미반영:** 어휘는 Lead 세션 시작 시 고정(C4). models·routing과 동일한 기존 제약이며, 문서화로 대응한다(재시작 안내).
- **Lead와 오케스트레이터 자식의 적재 시차:** 제출(Lead 어휘)과 실행(`loop __execute-plan` 적재) 사이 설정이 바뀌면 검증·해석이 어긋날 수 있다. 현행(models 등)과 동일한 창이며, D3 체인이 어긋남을 경고로 수습한다 — hard fail 없음.
- **`PERSONA_IDS` 수출 폐지의 하류 호환:** index.ts 재수출 표면에서 제거될 심볼 사용자는 저장소 내 전수 grep상 #6·#7·#8·#9뿐(전부 본 결정의 변경 지점). 외부 소비자는 비공개 워크스페이스 패키지므로 없다.
- **Human attention:** 없음 — 기존 계약(D1–D7)의 틀 안에서 출처만 옮기는 변경이며, 새 경계·새 영속 형식·이관이 없다.
