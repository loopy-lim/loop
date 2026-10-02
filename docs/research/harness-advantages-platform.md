# 하네스 장점 조사: 플랫폼·인프라 관점

- 조사 기준일: 2026-09-30
- 범위: sandbox/권한, 재개·내구성, 백그라운드·클라우드, telemetry/비용, 검증 자동화, 팀 배포
- 방법: 로컬 Loop 문서 및 기존 하네스 비교 자료를 대조하고, 각 항목에 1차 출처 URL을 연결했다. 제품 문서에 공개된 기능만 다루며 실측·유료 호출은 하지 않았다. 외부 서비스 기능은 플랜·버전에 따라 달라질 수 있다.

## 요약과 evidence

| 관점 | 확인한 구체적 장점 수 | 대표 하네스 | Loop 대비 핵심 판단 |
|---|---:|---|---|
| 샌드박싱·권한 모델 | 4 | Codex, OpenHands, OpenCode, Claude Code | OS 샌드박스와 도구 권한은 task write scope와 다른 보안 경계다. 어댑터/worker 런타임에서 보강 가능 |
| checkpoint·재개·내구성 | 4 | Gemini CLI, Cline, Codex, Warp | Loop는 실행 DAG 내구성에 강하고, 파일 변경 되돌리기·대화 세션 재개는 별도 기능 |
| 백그라운드·클라우드 에이전트 | 4 | Cursor, Devin, Amp, Warp | Loop는 프로세스 분리·화면 종료 후 지속 실행을 지원하지만 원격 실행 인프라는 범위 밖 |
| telemetry·비용 가시성 | 4 | Claude Code, Cline, Codex, Warp | Loop의 이벤트/검증 기록은 내부 감사에 유용하나 토큰·비용 대시보드는 없음 |
| 검증 하네스 | 4 | Claude Code, Codex, Aider, OpenHands | Loop completion contract는 강제 완료 게이트. 추가 자동 리뷰는 계약의 보완이지 대체가 아님 |
| 팀 설정·스킬 배포 | 4 | Claude Code, Codex, Cursor, OpenCode | 공용 설정·마켓플레이스는 배포 편의가 높지만 코어 프로토콜로 흡수할 이유는 약함 |

수는 표에 든 독립적인 채택 사례 수이며 제품 전체 기능 수가 아니다. 주요 차이는 Loop가 SQLite 기반 오케스트레이션의 내구성과 완료 계약을 가진 반면, 전용 하네스들은 작업 디렉터리 보호, 대화/파일 체크포인트, 관리형 원격 런타임, 운영자 대시보드를 제품 표면으로 제공한다는 점이다.

## 1. 샌드박싱과 권한

| 하네스 장점 | 출처 | Loop 대비·채택 판단 |
|---|---|---|
| Codex는 읽기 전용, workspace-write, 전체 접근 정책과 승인 단계를 제공한다. | [Codex sandbox](https://developers.openai.com/codex/security/) | Loop의 경로별 read/write scope는 스케줄 충돌 방지용이며 OS 접근 제어가 아니다( reliable-runs 문서). **중간 난이도**, provider adapter에서 프로세스 실행 정책을 지정하고 core에는 결과만 전달하면 경계 충돌 없음. |
| OpenHands는 Docker/VM 실행과 보안 분석·확인 모드를 결합한다. | [OpenHands security](https://docs.openhands.dev/openhands/usage/security) | 강한 격리는 배포 운영 비용이 든다. 로컬 기본값 대신 선택 가능한 worker backend가 적합하며 Rust core에 컨테이너 세부를 넣으면 안 된다. **높은 난이도**. |
| OpenCode는 도구별 ask/allow/deny와 glob 권한을 둔다. | [OpenCode permissions](https://opencode.ai/docs/permissions/) | 좁은 권한 정책은 Loop attention/approval과 개념상 양립하나 도구 이벤트 중재 계층이 필요하다. **중간 난이도**, adapter seam에 한정. |
| Claude Code는 도구 호출 전후 hooks 및 권한 모드를 제공한다. | [Claude Code hooks](https://code.claude.com/docs/en/hooks) · [permissions](https://code.claude.com/docs/en/permissions) | 정책을 외부화할 수 있으나 provider 종속 hook API를 core에 복제하면 경계 침범. 선택적 어댑터 기능으로 **낮음~중간 난이도**. |

**권고:** 우선 Loop의 scope 계약과 OS sandbox를 문서에서 명확히 구별한다. 다음 단계는 로컬 worker adapter에 sandbox profile을 선택적으로 연결하고, 기본 기능으로 오인되지 않도록 실제 격리 상태를 보고하는 것이다. 전용 sandbox를 core에서 직접 구현하는 방안은 플랫폼 이식성·운영 부담 때문에 기각한다.

## 2. Checkpoint, 재개, 내구성

| 하네스 장점 | 출처 | Loop 대비·채택 판단 |
|---|---|---|
| Gemini CLI는 파일 변경 전 섀도 git checkpoint와 restore를 제공한다. | [Gemini checkpointing](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/checkpointing.md) | Loop SQLite는 run/task 상태 복구이지 임의 파일 변경 복원이 아니다. **낮음~중간 난이도**, 별도 workspace git snapshot 기능으로 두면 core와 충돌 없음. |
| Cline은 tool action마다 체크포인트를 만들어 작업을 되돌린다. | [Cline checkpoints](https://docs.cline.bot/core-workflows/checkpoints) | 세밀한 undo는 사용자 신뢰에 이점, 저장공간·대용량 저장소 비용이 있다. worker workspace 계층에서 구현하는 게 적절(**중간**). |
| Codex는 세션 목록에서 이전 세션 재개를 제공하며 앱/CLI 실행을 이어간다. | [Codex CLI](https://developers.openai.com/codex/cli/) | Loop의 resume은 완료·미완료 DAG 재조정이며 모델 대화 transcript 재개와 다르다. 세션 소유권까지 통합하면 provider 종속성이 커져 **높은 난이도/비권고**. |
| Warp는 handoff 시 대화 fork와 미커밋 변경 snapshot을 전달한다. | [Warp handoff](https://docs.warp.dev/agents/warp-agent/handoffs/) | 유용하지만 Loop는 persisted task inputs, steer, task outputs로 재개한다. 명시적 handoff artifact가 필요성이 확인될 때 adapter 레벨에서 도입(**중간**). |

Loop의 SQLite 이벤트 로그, 상태 캐시 재생, 실행 소유권 임대 및 불확실한 Running에 대한 reconcile은 오케스트레이션 내구성에 강점이다([reliable-runs](../reliable-runs.md)). 이와 별개로 workspace undo는 데이터 계층의 새 책임이므로 이벤트 로그에 파일 내용을 무제한 저장하는 설계는 피한다.

## 3. 백그라운드·클라우드 에이전트

| 하네스 장점 | 출처 | Loop 대비·채택 판단 |
|---|---|---|
| Cursor Cloud Agent는 저장소 작업을 원격 환경에서 실행하고 PR 흐름과 통합한다. | [Cursor background agents](https://cursor.com/docs/cloud-agent) | Loop 화면 종료 후 지속 실행은 있으나 원격 VM·네트워크·secret provisioning은 없다. **높은 난이도**, 외부 worker backend로만 고려. |
| Devin은 클라우드 개발 환경과 비동기 작업 위임/리뷰 흐름을 제공한다. | [Devin documentation](https://docs.devin.ai/) | 별도 컴퓨트·권한·비용 플랫폼을 요구한다. 현재 로컬/Herdr worker 경계와 충돌하지 않지만 운영 제품으로 확장하는 범위가 큼(**높음**). |
| Amp Orbs는 격리된 클라우드 VM에서 독립 태스크를 실행한다. | [Amp Orbs](https://ampcode.com/docs/orbs) | 병렬 원격 실행 패턴은 Loop DAG와 맞지만 provider-specific workspace 수명 관리가 필요(**높음**). |
| Warp는 로컬·클라우드·셀프호스트 자식 실행과 API/트리거를 통합한다. | [Warp orchestration](https://docs.warp.dev/platform/orchestration/multi-agent-runs/) | 관찰·제어 인터페이스가 강점. Loop의 provider-neutral core는 유지하고 backend capability로 표현하는 방향만 고려(**높음**). |

**권고:** 지금은 클라우드 실행 자체보다 worker lifecycle 계약의 취소·heartbeat·재연결을 견고히 하고, 원격 backend를 실제 수요가 생긴 뒤 별도 adapter로 검증한다. remote credentials를 SQLite나 로그에 저장하지 않는다.

## 4. Telemetry와 비용 가시성

| 하네스 장점 | 출처 | Loop 대비·채택 판단 |
|---|---|---|
| Claude Code는 사용량 통계와 세션 비용 추정 명령을 노출한다. | [Claude costs](https://code.claude.com/docs/en/costs) | Loop에 provider usage를 반환하는 공통 선택 필드가 필요할 수 있다. **중간 난이도**, secret 금지·수집 최소화 필수. |
| Cline은 OpenTelemetry 통합을 통해 추적/메트릭을 연결한다. | [Cline telemetry](https://docs.cline.bot/features/telemetry) | vendor-neutral export는 팀 관찰에 유리하지만 개인정보/코드 내용 유출 위험. 기본 비활성·민감값 제거 및 adapter 경계가 필요(**중간~높음**). |
| Codex는 실행 이벤트/구조화 출력을 제공해 외부 자동화가 처리할 수 있다. | [Codex CLI reference](https://developers.openai.com/codex/cli/reference/) | Loop도 SQLite 이벤트와 CLI JSON 관찰을 제공한다. 표준 event mapping은 낮은 비용이나 입력/출력 전문을 수집하는 것은 권고하지 않음. |
| Warp는 run transcript와 플랫폼 대시보드로 자식 실행까지 관찰한다. | [Warp multi-agent runs](https://docs.warp.dev/platform/orchestration/multi-agent-runs/) | Loop task/event 기록은 감사를 지원하나 토큰·달러·에이전트별 비교는 부족. usage가 provider에서 제공될 때만 **중간 난이도**로 명시적 usage event를 추가. |

Loop의 기본 원칙은 자격 증명을 저장·로그하지 않는 것이다(README). 비용 가시성은 모델 이름을 core에 넣지 말고, adapter가 반환 가능한 usage 수치와 통화/추정 여부를 typed optional metadata로 전달하는 방식이 경계와 양립한다. 단, 이 자료 조사에서는 이를 구현하지 않는다.

## 5. 검증 하네스: 테스트와 리뷰 자동화

| 하네스 장점 | 출처 | Loop 대비·채택 판단 |
|---|---|---|
| Claude Code hooks는 tool lifecycle에서 정책 검사·후처리를 호출한다. | [Claude hooks](https://code.claude.com/docs/en/hooks) | completion contract보다 실행 중 개입이 빠르다. worker adapter hook으로 제한하면 **중간 난이도**, core의 완료 판정은 계속 Rust에 둔다. |
| Codex는 `--output-schema`, exit status 및 코드 리뷰 지침을 지원한다. | [Codex CLI](https://developers.openai.com/codex/cli/) | 구조화 출력과 deterministic completion checks는 Loop와 잘 맞는다. contract 자체는 이미 더 강한 완료 gate이므로 schema 검증 보완은 **낮음~중간**. |
| Aider는 테스트·lint 명령 실패를 감지해 자동 수정 루프를 돌린다. | [Aider testing](https://aider.chat/docs/usage/lint-test.html) | Loop completion contract는 검사 통과 없이는 Done이 불가. 자동 반복은 현재 실패 정책(검증 assertion은 terminal failure)과 충돌 가능성이 있어 그대로 채택하지 말고, 명시적 retry 정책만 검토(**중간**). |
| OpenHands는 critic/security analyzer 및 CI에서 쓸 수 있는 구조화 출력 흐름을 문서화한다. | [OpenHands CLI](https://docs.openhands.dev/openhands/usage/cli) | critic은 추가 의견이지 테스트 증거가 아니다. 별도의 reviewer task를 DAG에 넣는 것은 기존 typed task로 가능하며 **낮은 구조 난이도**, 비용/직렬화는 명시해야 한다. |

**권고:** 실행 가능한 completion checks를 핵심 강점으로 보존한다. 자동 리뷰를 완료의 대체로 취급하지 말고, 독립 reviewer 결과와 테스트 증거를 구별한다. 계약이 단순 파일 존재 검사로 퇴화하지 않도록 연구/리뷰 task에 출처·판정 기준을 포함하는 패턴을 확장한다.

## 6. 팀 협업: 공유 설정과 스킬 배포

| 하네스 장점 | 출처 | Loop 대비·채택 판단 |
|---|---|---|
| Claude Code는 프로젝트 설정, skills, plugins/marketplace로 팀 워크플로를 공유한다. | [Claude skills](https://code.claude.com/docs/en/skills) · [plugins](https://code.claude.com/docs/en/plugins) | Loop는 README/config와 Pi extension에 규칙이 분산될 수 있다. 모델/권한 설정 공유는 이미 파일 설정으로 가능; 별도 plugin system은 **높은 난이도**. |
| Codex는 저장소별 `AGENTS.md`, 설정과 skill 경로를 사용한다. | [Codex configuration](https://developers.openai.com/codex/config-reference/) | 기존 AGENTS.md 규칙과 잘 맞는다. Loop용 task templates를 version control에 넣는 정도는 **낮음**, 하네스 고유 skill loader를 core에 추가할 필요 없음. |
| Cursor는 rules와 Agent Skills를 프로젝트 단위로 배포한다. | [Cursor rules](https://cursor.com/docs/context/rules) · [skills](https://cursor.com/docs/skills) | 재사용 가능한 작업 지침은 가치가 있으나 모델/하네스 중립 텍스트로 유지하면 충돌 없음(**낮음~중간**). |
| OpenCode는 프로젝트 설정·agents·skills를 저장소와 사용자 범위에서 관리한다. | [OpenCode agents](https://opencode.ai/docs/agents/) · [skills](https://opencode.ai/docs/skills/) | 팀별 역할 정의를 공유하는 패턴은 Loop task kind/template에 적용 가능. 런타임 플러그인 배포는 core 대신 Lead adapter 소관(**중간**). |

Loop의 경계 원칙상 provider, Pi 및 모델 세부를 Rust core로 들이지 않는다. 따라서 팀 배포는 먼저 repository-owned intent/task 템플릿과 정책 예시로 해결하고, 설치형 마켓플레이스는 채택하지 않는 편이 단순하다.

## 우선순위 갭과 실행 방향

1. **P1 — sandbox 사실성:** read/write scope가 OS 격리가 아님을 사용자에게 명확히 알리고, worker adapter가 sandbox 기능·제한을 선언적으로 보고하게 한다. 채택 난이도 중간, 경계 충돌 없음.
2. **P1 — 결과 검증/운영 증거:** completion contract를 유지하면서 구조화된 검사 결과와 필요시 독립 리뷰 task를 기록한다. 낮음~중간, Rust core의 결정권 유지.
3. **P2 — 사용량 가시성:** 지원 provider에서만 추정치와 실제 usage를 구별해 기록한다. optional metadata로 도입, 개인정보·credential 비저장.
4. **P2 — workspace checkpoint:** 이벤트 로그와 분리된 git snapshot/restore를 adapter 또는 workspace layer에서 실험한다. 보존·용량 정책 필요.
5. **P3 — 원격 backend:** Cursor/Devin/Warp 유형의 cloud execution은 worker lifecycle과 secret boundary 요구를 별도 설계할 정도의 수요가 확인될 때만 추진한다.
6. **P3 — 팀 템플릿:** repo 단위 task/template/skills 호환 파일을 우선 활용하고, marketplace/plugin 플랫폼은 피한다.

두 대안 중 하나를 선택해야 한다면 (A) 코어에 각 하네스의 sandbox/session/telemetry 개념을 직접 통합하는 방식은 portability와 계층 경계를 해치므로 배제한다. (B) Rust core가 provider-neutral task/event contract를 소유하고 adapter/workspace 계층이 선택 기능을 제공하는 방식이 권고안이다. 현 단계에서 가장 단순한 선택은 기능 구현보다 sandbox 한계와 telemetry 공백을 정확히 문서화하고 P1/P2 요구를 사용자 사례로 확인하는 것이다.

## Loop 근거 및 한계

- [README](../../README.md): Rust core, SQLite store, provider adapters, completion contract, secret 원칙.
- [Reliable runs](../reliable-runs.md): SQLite event log/cache replay, lease/reconciliation, scope semantics, verification behavior.
- 기존 비교 조사: [harness-comparison](harness-comparison.md), [closed-source](sections/closed-source.md).
- 근거는 공식 공개 문서이며 제품 기능·URL은 변경될 수 있다. Devin의 세부 격리/비용, 일부 서비스의 플랜별 telemetry 범위는 이번 로컬 조사에서 확정하지 않았다. 실제 provider 호출, 보안 침투 시험, 성능·비용 측정은 수행하지 않았다.
