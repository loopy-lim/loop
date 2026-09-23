# 문서–코드 불일치 감사 (docs drift audit)

- Task: `fact-docs-drift` (research, attempt 0, 2026-09)
- Question: docs/provider-support.md와 docs/model-routing.md의 주장(어댑터 동작, 모델 레인, compute 클래스 매핑)이 config/models.toml과 packages/providers 코드와 일치하는가?
- Method: 읽기 전용 정적 대조. 근거는 `file:line`. 읽기 범위 밖 구현(orchestrator, @loop/herdr, loop-core, cli)에 속한 주장은 별도 표기.
- Verdict labels: **match** / **mismatch** / **not-in-scope**.

## 1. model-routing.md 대비

| # | Doc claim | Verdict | Evidence |
| --- | --- | --- | --- |
| R1 | 클래스 사다리 D0/S1–S5 이름 (deterministic, typed_decision, tiny, fast, balanced, strong, frontier) — docs/model-routing.md:5-13 | match | models.toml이 정확히 이 7개 `compute_class` 값만 사용: config/models.toml:41,50,58,66,77,85,98,106,115,123,131,143,151,161,169,177 |
| R2 | "Model IDs live in `config/models.toml`" — docs/model-routing.md:35 | match | 모든 모델 id가 [[models]] 엔트리로 선언됨 (config/models.toml:37-177); providers 코드는 id를 하드코딩하지 않고 `--model` 옵션으로만 주입 (pi/adapter.ts:36, codex/adapter.ts:65, antigravity/adapter.ts:67) |
| R3 | Mixed routing(2026-09-23): gpt-6 luna/sol primary lane = pi(openai-codex), codex는 gpt-5.6 luna/terra/sol + gpt-6 fallback, antigravity gemini fallback — docs/model-routing.md:35 | match | pi 레인 gpt-6: config/models.toml:96-106 (`openai-codex/gpt-6-luna` balanced, `openai-codex/gpt-6-sol` frontier); codex gpt-5.6: :113-131; codex gpt-6 fallback: :141-151; antigravity: :159-177; 헤더 주석 동일 서술 :1-8 |
| R4 | "Rust core sees opaque compute candidates and compute classes only; provider names remain in the TypeScript composition root" — docs/model-routing.md:35 | not-in-scope | TS 측에서만 부분 확인: StartWorkerInput에 provider 필드 없음 (types.ts:22-31). loop-core(Rust)는 선언된 읽기 범위 밖이라 미검증 |
| R5 | Risk floor(high→strong, critical→frontier), 검증 실패 시 한 클래스 상향 — docs/model-routing.md:33,41 | not-in-scope | Rust 정책(loop-core) 구현, 읽기 범위 밖 |

## 2. provider-support.md 어댑터 표 대비

| # | Doc claim | Verdict | Evidence |
| --- | --- | --- | --- |
| P1 | Codex: `codex exec --json`, model/cwd/sandbox, normalized events, cancel, resume — docs/provider-support.md:6 | match | codex/adapter.ts:62 (`exec --json -C <cwd>`), :63-65 (`--sandbox`/`--approve-for-me`/`--model`), :70-71 (`exec resume <id> --json`); cancel은 ProcessProvider 상속 (process-provider.ts:47-51); 이벤트 정규화는 process-provider.ts:56-66 |
| P2 | Antigravity(print adapter): runtime model discovery, cwd, sandbox, stream-json, cancel, conversation resume — docs/provider-support.md:7 | match | antigravity/adapter.ts:52-56 (`agy models` probe + parseModels), :62-67 (`--output-format stream-json`, `--sandbox`), :76-79 (`--conversation` resume) |
| P3 | Z.AI API: base/path/model 설정, general vs coding-plan, abort, normalized result, redacted errors, key는 env에서, Authorization 헤더에만, 미설정 시 disabled — docs/provider-support.md:8,20 | match | zai/api.ts:12-21 (baseUrl/generalPath/codingPlanPath/model), :15+37-40 (mode 분기), :54 (`available: apiKey.length > 0`), :55+92-96 (AbortController), :128 (Authorization 헤더가 유일한 키 사용처), :105+138 (redact). env 변수명은 config/providers.example.toml:62 (`ZAI_API_KEY`), :63 (`enabled = false`)와 일치 |
| P4 | Z.AI CLI: availability, cwd, model, JSON output, cancel — docs/provider-support.md:9 | match | zai/cli.ts:35 (`--help` probe), :45 (`--output-format json`), :46 (`--cwd`), :47 (`--model`); cancel은 ProcessProvider 상속 |
| P5 | Fake/scripted: delay, failure scripts, concurrency evidence, cancel — docs/provider-support.md:10 | match | fake.ts:50 (`delayMs`), :53+88-92 (`failures` 스크립트), :87-88+86 (`active`/`maxConcurrent`), :95-105 (cancel) |
| P6 | Pi (worker): `pi -p` 헤드리스, 모델 패턴(`zai/glm-5.3-flash`, `zai/glm-5.3-flashx`), tools, cancellation — docs/provider-support.md:12 | match | pi/adapter.ts:17+60 (`--no-session -p`), :34 (`tools: true`); 패턴 id 존재: config/models.toml:64-85; 패턴 문법 해석은 pi/models-json.ts:157-177 |
| P7 | Pi (worker): "default route for the zai volume classes, with balanced/strong/frontier escalating through the codex exec lane (`gpt-5.6` luna/terra/sol)" — docs/provider-support.md:12 | **mismatch** | 2026-09-23 mixed routing 이후 스테일. pi 레인이 balanced를 자체 수용(zai/glm-5.3-flashx:high config/models.toml:75-77, zai/glm-5.3-flash :83-85, openai-codex/gpt-6-luna :96-98)하고 frontier도 pi가 수용(openai-codex/gpt-6-sol :104-106). codex exec gpt-5.6 라인은 여전히 존재(:113-131)하나 "유일한 escalation 경로" 서술은 더 이상 참이 아님. model-routing.md:35는 갱신된 서술 |
| P8 | Pi (worker) auth: "pi auth store (`pi auth check --provider zai`)" — docs/provider-support.md:12 | **mismatch** | pi 레인이 gpt-6 luna/sol(ChatGPT native login, pi의 openai-codex provider)도 수행(config/models.toml:90-95; providers.example.toml:33-40)하는데 auth 셀은 zai만 기술. pi openai-codex 인증 경로가 어느 표 행에도 없음 |
| P9 | Antigravity 행: "Herdr `agent kind=agy` by default; `agy` print adapter available"만 기술 — docs/provider-support.md:7 | **mismatch** | 세 번째 구현체 AgyPersistentProvider(영속 stream-json 드라이버)가 누락: antigravity/persistent.ts:43-56, antigravity/driver.ts:19-28. 실제 예시 설정이 이 드라이버를 선택(config/providers.example.toml:52-58 `mode = "persistent"`)하며 models.toml:157 주석도 "영속 드라이버 후보"로 지칭. 어댑터 표에 미등재 |
| P10 | Herdr: JSON CLI 기반 lifecycle, 어댑터 kind=codex/agy/pi — docs/provider-support.md:6,7,12,14 | match | herdr-agent.ts:16-24 (`HerdrWorkerRuntime` + kind), :69 (kind에 따른 vision), :70-84 (runtime.start로 pane 실행). 상세 lifecycle은 @loop/herdr(범위 밖) |
| P11 | Failure contract: 단일 `AgentProvider` 인터페이스, non-zero exit → typed failure, 7개 실패 종류 구분 — docs/provider-support.md:18 | match | types.ts:53-63 (인터페이스; 모든 어댑터가 구현), :5-13 (unavailable/authentication/quota/cancelled/timeout/incomplete_output/process_error 7종), process-provider.ts:79-88+199-206 (exitCode 분류) |
| P12 | Failure contract: "Secrets are redacted from summaries and streamed chunks" — docs/provider-support.md:18 | **mismatch** (조건부) | ProcessProvider 계열은 요약·청크 모두 redact(process-provider.ts:57,141-160; redact.ts:1-6). 그러나 HerdrAgentProvider는 `runtime.read()` 결과 요약을 redact 없이 반환/발행(herdr-agent.ts:208+216-219 성공, :222+228-231 실패; 유일한 redact 사용처는 에러 메시지 :118). @loop/herdr의 read() 내부 redact 여부는 읽기 범위 밖이라 미확인 — 확인 필요한 잠재 결함 |
| P13 | Custom model id를 pi models.json fragment로 sync — docs/provider-support.md:28 | match | pi/models-json.ts:352-366 (`syncPiModelsJson`), :296-318 (`mergeModelsJson` upsert, 기존 내용 보존), :251-253 (metadata 없는 id는 fragment 미생성); 메타데이터 선언은 config/models.toml:21-33, 정책 주석 :11-18와 일치 |
| P14 | Jev 미지원: disabled stanza 무시, enabled면 `config.unsupported_provider` — docs/provider-support.md:24 | not-in-scope | 구현 위치 packages/orchestrator/src/config.ts:255(범위 밖, rg으로 위치만 확인). providers 패키지 내 흔적은 빈 디렉터리 src/jev/뿐으로 제거 서술과 모순 없음 |
| P15 | `loop doctor --auth` (Pi Lead, Codex, AGY 점검) — docs/provider-support.md:26 | not-in-scope | cli 패키지 구현, 읽기 범위 밖 |

## 3. compute 클래스 매핑 교차 확인 (config ↔ providers 기본값)

| # | 항목 | Verdict | Evidence |
| --- | --- | --- | --- |
| C1 | pi 어댑터 기본 클래스 [tiny..frontier] ⊇ models.toml pi 레인 클래스(typed_decision 제외 전부) | match | pi/adapter.ts:39 대비 models.toml pi 엔트리들(tiny:58, fast:66, balanced:77,85,98, frontier:106). typed_decision(bare glm-5.3-flashx, :50)은 조합 루트에서 computeClasses 주입 시 명시 필요 — 기본값만 보면 부족하나 설정 레이어에서 해결되는 사항 |
| C2 | codex 어댑터 기본 [balanced,strong,frontier] = models.toml codex 레인 클래스 집합 | match | codex/adapter.ts:41 대비 models.toml:115,123,131,143,151 |
| C3 | AgyPersistentProvider 기본 [balanced,strong,frontier] = models.toml antigravity 레인 클래스 집합 | match | antigravity/persistent.ts:56 대비 models.toml:161,169,177 |
| C4 | AntigravityProvider(print) 기본 [fast,balanced,strong]은 antigravity frontier 후보(gemini-3.1-pro-low)를 기본값으로 지원 안 함 | mismatch (low) | antigravity/adapter.ts:34 대비 models.toml:175-177. computeClasses 미주입 생성 시 frontier 레인 후보가 선택 불가. 현재 예시 설정은 persistent 모드(providers.example.toml:58)라 실경로 영향 없음 |

## 4. 결론 (findings, 5줄 이내)

1. mismatch — provider-support.md:12 Pi 행 escalation 서술이 2026-09-23 mixed routing 이전 상태로 스테일(pi가 balanced/frontier gpt-6 직접 수행, model-routing.md:35만 갱신됨).
2. mismatch — provider-support.md 어댑터 표에 AgyPersistentProvider(영속 드라이버, 실제 기본 mode) 누락, pi 레인 openai-codex 인증 경로도 미기술(:7,:12).
3. mismatch — HerdrAgentProvider가 runtime.read() 요약을 redact 없이 반환(herdr-agent.ts:208,222)하여 "summaries redacted" 계약(provider-support.md:18) 위반 소지; @loop/herdr 내부 확인 필요.
4. mismatch(low) — agy print 어댑터 기본 computeClasses에 frontier 없어 antigravity frontier 후보 미지원(antigravity/adapter.ts:34 ↔ models.toml:175).
5. match — 클래스 사다리, mixed routing 본체, Z.AI/Codex/Fake/pi 헤드리스 어댑터 동작, models.json sync, 7종 실패 분류는 문서·설정·코드가 일치; 범위 밖(orchestrator/herdr/loop-core/cli) 5개 주장은 미검증.

## 5. 미해결 리스크 / 한계

- P12는 @loop/herdr `read()` 구현 확인 전까지 확정 불가(읽기 범위 밖). 후속 태스크에서 `packages/herdr` 대상 확인 권장.
- R4(Rust 불투명성), R5(risk floor), P14(jev 거부), P15(loop doctor)는 읽기 범위 밖이라 not-in-scope로 남김.
- 본 감사는 정적 대조이며 유료 모델 호출·인증 스모크를 포함하지 않음(evidence boundary 준수).
