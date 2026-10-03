# Lead 인계 문서 — 백로그 해소 마무리 (2026-10-03)

세션 reload 후 이 문서 하나만 읽고 이어서 진행한다.

## 남은 목표 (아직 끝나지 않은 수용 기준)

1. **bun test 59건 실패 회귀 수정** — `bun test packages tests plugins scripts/rustra-codegen.test.ts`에서
   profile·compute-selection·restart-recovery·persona·benchmark 랭킹 계열 실패.
   `cargo test --workspace`, `bun run codegen:check`, `bun run typecheck`은 전부 통과.
   테스트 삭제·skip·완화 금지. 근본 원인 가설: 작업 트리의 dispatch-scaling config 변경
   (`config/policy.toml` max_frontier_workers=6, compute_selection, `config/models.toml` 라우팅 재편,
   `tests/architecture-boundaries.test.ts` 확장)과 오늘의 WorkerState 코드젱 편입 상호작용.
2. **bun run check 전체 통과** + 벤치마크 오프라인 재증명:
   `./dist/loop benchmark agents scripts/benchmark/manifest.json --json`이 trials JSON 반환.
3. **해소 기록 문서 완결** — `docs/research/2026-09-30-remaining-backlog-resolution.md`에
   WorkerState 편입과 테스트 회귀 수정 내역 보강.

## 시작 방법 (2026-10-03 14:15 업데이트 — 반드시 이 순서)

1. 설치본 갱신 완료: `~/.local/bin/libloop_bridge.dylib`와 `~/.local/bin/loop-pi-extension.js`를
   오늘 빌드(dist)로 교체함 (postcard Option discriminant 크래시의 근본 원인 = 구버전 설치본).
2. 이 문서를 읽는 세션이 **완전히 새로 시작된 Pi 세션**인지 확인 — 구 세션은 메모리에 구버전 확장을
   가지므로 절대 run을 시작하면 안 된다. 의심되면 `ps aux | grep pi`로 시작 시각 확인(14:15 이후여야 함).
3. `loop run "이 문서의 남은 목표 3가지를 수행해줘"` — 기존 run을 resume하지 말고 반드시 새 run으로.
   task 2개(회귀 수정 → 최종 통합) 체인, task 1에 debugger 페르소나 권장.

## 이미 착지·검증 완료 (재구현 금지)

- provider-support.md 갱신(P7/P8/P9), bridge 명령 직접 테스트 6종+, WorkerState 코드젱 편입
  (bridge state 필드 + generated protocol), types.ts TS 사본 제거(생성 타입 재노출),
  벤치마크 fixture·manifest·fake 레인(config 선언형), scripts/benchmark/README.md,
  해소 기록 문서 초판(문서 존재, 벤치마크 재증명 exit 0까지 확인됨).

## 오늘 발견된 Loop 엔진 결함 — 다음 정책 개선 run의 회귀 시나리오

1. attention 시 무관 frontier·교정 task까지 클레임 전면 차단 → 교정 task 굶주림 순환 (run 1·2)
2. 검사가 착지된 설계 결정과 모숭되면 3회 재시도 후 attention 반복 (run 2·3)
3. task 쓰기 소유권에 검사가 가리키는 파일이 없으면 같은 실패 반복 (run 3)
4. 재디스패치 프롬프트 6000자 초과 시 재시작 불가 (run 4)
5. 고아 worker 재조정 실패: health가 "interrupted 없음" 보고, reconcile은 수동 (run 4)
6. 세션 메모리의 구버전 네이티브 lib이 프레임을 기록해 신버전 dispatcher가 postcard 디코드 크래시
   — "Option discriminant not 0 or 1". writer/reader 버전 불일치 조기 감지 필요 (run 5)
8. (10-03 확정) 근본 원인은 `~/.local/bin` 설치본(9/28 dylib·9/29 확장)과 dist(10/03)의 버전 불일치.
   `loop` CLI는 dist 심링크인데 Lead 확장은 설치본을 로드해 프레임 스키마가 갈렸다. 개선:
   `loop doctor`가 설치본-저장소 버전 일치(md5 또는 build id)를 검사하고, 불일치면 run 시작을 차단
7. 네트워크 등 일시 실패에 대한 백오프 자동 재시도 없음, watch/polling 관찰자 부재로 정체가 눈에 안 보임
