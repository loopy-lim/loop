# Approved App Surfaces vs Legacy Ban List

- Status: Accepted
- Date: 2026-xx (decision node `boundary-rule-decision`)
- Context: run loop-900d602e / loop-f3143c02 verification failures

## Context

`tests/architecture-boundaries.test.ts`의 "the repository contains no recovered legacy product surfaces" 검사가 금지 경로 목록에 `"apps"`를 포함한다. 원격 앱 아키텍처 결정(`docs/decisions/2026-xx-remote-app-architecture.md`)에 따라 `apps/loop-mobile`과 `apps/loop-desktop`이 생성되면서 이 검사가 항상 실패한다. 이는 레거시 회수 방지라는 원래 의도와 무관한 오탐(false positive)이다.

## Decision

`apps/loop-mobile`과 `apps/loop-desktop`은 **승인된 신규 제품 표면(approved product surfaces)**이다. 레거시 금지 검사는 계속 유지되되, 금지 목록에서 블롭 `"apps"`를 제거하고 다음의 구체적 경로로 좁힌다:

- `crates/loop-legacy`
- `crates/loop-lock-holder`
- `crates/loop-rustra`
- `crates/loop-tui`
- `packages/pi-extension`
- `packages/provider-agy`
- `.codex-plugin`
- `.mcp.json`
- `plugins/loop-herdr` (부재 요구 유지)
- `plugins/loop-agent/herdr-plugin.toml` (존재 요구 유지)

## Intent preservation

이 결정은 테스트의 **레거시 회수 방지(anti-recovery) 의도를 약화시키지 않는다.** 위에 열거된 레거시 경로는 전부 이전과 동일하게 금지되며, 유일한 변경은 이미 별도 결정으로 승인된 두 앱 표면을 오탐 대상에서 제외하는 것이다. 레거시 표면이 이 경로들로 회수되면 테스트는 여전히 실패해야 한다.

## Consequences

- `bun run test:architecture`는 `apps/loop-mobile`, `apps/loop-desktop` 존재 하에 통과해야 한다.
- 향후 새 표면을 추가할 때는 이 결정 또는 후속 결정 문서에 승인 근거를 기록해야 한다. 무인가 표면은 금지 목록으로 회귀한다.
