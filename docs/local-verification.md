# 로컬 goal 종료 상태 조회·검증 가이드

Loop 런의 goal criterion 장부를 로컬에서 조회하고, 종료 게이트가 강제하는
검증 상태를 직접 재현하는 명령 모음이다. 유료 모델 호출 없이 실행된다.

## 1. 전체 게이트

```bash
bun run check
```

커밋 전 반드시 통과해야 하는 기본 게이트다. 실패하면 아래 focused 명령으로
범위를 좁혀 원인을 확인한다.

## 2. Focused 테스트

```bash
cargo test -p loop-core
cargo test -p loop-store
cargo test -p loop-bridge
bun test packages/cli          # CLI 뷰·포맷 (goal-ledger 포함)
bun test packages              # 전체 TypeScript 스위트
```

작업 범위가 명확한 경우 해당 패키지의 테스트만 먼저 돌리고, `bun run check`는
마지막에 전체로 확인한다.

## 3. Codegen 동기 확인

Rust bridge 타입을 바꿨다면:

```bash
bun run codegen            # 생성 파일 갱신 후 같은 커밋에 포함
bun run codegen:check      # 생성 파일이 원본과 일치하는지 확인
```

TypeScript 사본을 손으로 작성하지 않는다 — 생성된
`packages/protocol/src/generated/*` 만 사용한다.

## 4. Goal 장부 조회 (goal-ledger CLI)

```bash
loop goal-ledger <run-id>           # 사람 읽기 형식
loop goal-ledger <run-id> --json    # 기계 판독 형식
```

한 런의 모든 criterion을 다음 정보와 함께 보여준다.

- 상태: `verified` / `pending` — 판정은 Rust projection(run snapshot)이
  내린 것을 그대로 표시하며, CLI는 정책을 재구현하지 않는다
- 소유 task와 그 task의 현재 상태
- 연결된 completion check 결과: 마지막 receipt의 exit code / 타임아웃 여부,
  source fingerprint 안정성, verification evidence 통과 여부
- 출처 표시: 런 중간 steer 조정이 goal criterion + dependent task로 승격되어
  추가된 criterion은 `(steer)` 마크로 구분된다

출력 예시:

```text
Goal ledger · run-1 · active
Verified 1/2
✓ original-criterion · verified · task original · unit (exit 0, evidence pass)
! steer-criterion · pending · task correction (steer) · unit (no receipt)
```

종료 규칙: 모든 criterion이 verified면 exit 0, 하나라도 pending이면 exit 1.
`--json`은 `{ runId, runState, total, verified, criteria: [...] }` 구조를
반환한다. 조정 메시지 본문은 프라이버시 정책상 장부에 노출되지 않는다.

## 5. 로컬 검증 루틴 (요약)

1. `bun run check` — 전체 게이트
2. 변경 범위의 focused 테스트 (위 §2)
3. bridge 타입 변경 시 `bun run codegen:check`
4. 런 종료 상태 확인: `loop goal-ledger <run-id>` — pending criterion이
   남아 있으면 해당 task의 check 증거를 확인하고, 필요하면 후속 작업을
   추가한 뒤 다시 조회한다
