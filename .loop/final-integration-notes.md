# Final integration verification — attempt 3 (final-integrate)

Date: 2026-02-15 · Worker: architect persona · Write scope: this file only

## 결과: PASS — `bun run check` 통과 (exitCode=0)

이전 attempt(아래 기록)의 유일한 실패였던 keychain 경계 위반은
선행 작업 `fix-keychain-boundary`가 권고 1대로 해결했다:
`apps/loop-mobile/src/state/settingsStorage.ts` →
`apps/loop-mobile/src/auth/settingsKeychainStorage.ts` 이동 + `App.tsx` import 경로 수정.
본 attempt에서 기능 상호작용 실패는 **0건**이므로 원문 기록할 신규 실패는 없다.

## 체크별 요약

| 명령 | 결과 |
| --- | --- |
| `bun run check` (전체 체인) | ✅ PASS — exitCode=0 |
| └ `bun run codegen:check` | ✅ PASS (Rust schema 생성 무 diff, loop-bridge 재생성 일치) |
| └ `bun run typecheck` (`tsc -p tsconfig.json`) | ✅ PASS (에러 없음) |
| └ `bun run test:architecture` | ✅ PASS — 8 pass / 0 fail (경계 테스트 포함) |
| └ `bun run test` = `cargo test --workspace && cargo build -p loop-bridge && bun test packages tests plugins scripts/rustra-codegen.test.ts` | ✅ PASS — cargo 전 크레이트 `test result: ok` (failed 0), bridge 빌드 성공, bun 811 pass / 0 fail (96 files, 4,812 expect) |
| `bun test apps/loop-mobile/test` (초점 보강 — `bun run check`가 apps/ 를 실행하지 않음) | ✅ PASS — 356 pass / 0 fail (36 files) |
| └ `bun test apps/loop-mobile/test/split-viewer-contract.test.ts` | ✅ PASS — 17 pass / 0 fail |

## 네 기능 통과 증거 (실행된 체크 출력에서 직접 확인)

- **Gateway file API**: `packages/gateway/test/files.test.ts` 전부 pass —
  `GET /v1/files` 목록/`?dir=`/`..` traversal 400, `GET /v1/files/content` ETag·304·
  512KB 413·binary 415 포함.
- **TUI /files viewer**: `packages/pi-loop/test/files-viewer.test.ts` 전부 pass —
  디렉터리 walk, byte cap, width threshold 이상에서만 split layout, lazy load,
  에러가 viewer pane에 표시됨.
- **Orchestrator self-heal**: `packages/orchestrator/test/criteria-self-heal.test.ts`
  pass — "criteria that stay unverified after the self-heal pass still raise the
  blocked-goal attention" 포함. `Herdr repairs a failed check through a second turn`,
  "failed focused check is repaired once in the same worker session"도 pass.
- **Mobile split viewer + settings**: `apps/loop-mobile/test/split-viewer-contract.test.ts`
  17/17 pass — shared `FileViewerPane`, wide 2-pane / narrow `ViewerBottomSheet`
  (half·full snap), no WebView, lazy load, settings 3섹션, "settings feed the split
  viewer (font size + refresh interval)", entry-point wiring. `settings.test.ts`도 pass.
- **Keychain 경계 (이번 수정분)**: architecture 테스트
  "keychain/keyring/credential-store references stay confined to the auth layer" pass
  — keychain import가 `auth/settingsKeychainStorage.ts`로 국한됨을 확인.

## 이전 attempt의 기능 상호작용 실패 (원문 보존 — 해결됨)

아래 실패는 attempt 2에서 기록된 것이며 `fix-keychain-boundary`로 해소되어
본 attempt에서는 재현되지 않았다.

- 테스트: `tests/architecture-boundaries.test.ts` —
  "keychain/keyring/credential-store references stay confined to the auth layer"
- 위반 파일: `apps/loop-mobile/src/state/settingsStorage.ts` (settings screen 작업에서 신규 추가)

```text
error: apps/loop-mobile: credential-store import outside auth/: state/settingsStorage.ts

- []
+ [
+   "react-native-keychain",
+ ]

      at <anonymous> (/Users/loopy/dev/ll3/loop/tests/architecture-boundaries.test.ts:211:80)
```

```text
(fail) keychain/keyring/credential-store references stay confined to the auth layer [1.00ms]

 7 pass
 1 fail
 528 expect() calls
Ran 8 tests across 1 file. [216.00ms]
error: script "test:architecture" exited with code 1
error: script "check" exited with code 1
```

해결 방식은 권고 1(어댑터를 `auth/`로 이동, `state/settings.ts`의 순수 port 유지)을
그대로 따랐다. auth 레이어의 gateway-client-only 제약(D-B) 때문에 port 타입을
`state/`에서 import하는 대신 구조적 twin port(`SettingsKeychainPort`)를 선언하고
`App.tsx`(entry)에서 structural typing으로 주입한 점은 기존 `credentialStore.ts`
패턴과 일치하며 도메인 타입 중복이 아니다(2메서드 storage port).

## 선행 작업 확인 (raise-limit)

- dist loop dispatcher 재빌드 및 `packages/providers`의 6,000자 contract limit 반영은
  본 체인의 providers/orchestrator 스위트(전부 pass)로 간접 확인.

## Unresolved risks

- `fix-keychain-boundary`가 `App.tsx` 1줄을 선언된 write scope 밖에서 수정했다고
  보고했다(의도된 최소 편차). 본 attempt의 typecheck·모바일·경계 테스트 전부 통과로
  실질 위험 없음. Loop의 declared check 재실행이 최종 확인.
- `bun run check`는 `apps/loop-mobile` 테스트를 실행하지 않는다(스크립트가
  `packages tests plugins`만 대상). 모바일 회귀는 별도 `bun test apps/loop-mobile/test`
  필요 — 본 attempt에서 초점 보강으로 실행해 356/0 확인.
