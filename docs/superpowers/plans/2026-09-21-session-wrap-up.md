# Session Wrap-Up — 2026-09-21

Final state: **Herdr stays.** It is the visible terminal layer — workspaces, panes, tabs, and the `loop` agent reporting. The earlier "remove herdr" step was a misreading of the user's request (which meant: clean up leftover workspaces from dead runs) and was fully reverted in the same session.

## What stands

1. **Jev disabled, typed_decision → zai** (`glm-5.3-flash-typed-decision` + `glm-5.2`). Decision: `docs/decisions/2026-09-21-routing-jev-disable-and-pi-coverage.md`.
2. **Herdr-hosted Loop agent intact** — CLI inversion (Tasks 1–2 of `docs/superpowers/plans/2026-09-21-loop-herdr-hosted-agent-plan.md`), lifecycle reporter, plugin with tab placement, install script. The plan doc was reconstructed after the accidental deletion (noted inside).
3. **Terminal cleaned up** — dead-run workspaces (w16, w1C, w1D, w1E) closed; only the user's focused workspace remains. All Loop runs are terminal.
4. **Verification** — `bun run check` green (67 bun tests, architecture 6/6, cargo, codegen, typecheck).

## Scoped commit plan (Korean Conventional Commits)

### commit 1 — feat(cli): Pi Lead 현재 터미널 실행 진입점 반전
- `packages/cli/**`

### commit 2 — feat(pi-loop): Herdr 라이프사이클 리포터 등록
- `packages/pi-loop/**`

### commit 3 — feat(providers): jev 제거와 typed_decision zai 전환
- `config/models.toml`, `packages/providers/**`, `packages/orchestrator/**`

### commit 4 — chore(install): 플러그인 링크와 설치 검증 갱신
- `scripts/install-local.sh`, `tests/install-local.test.ts`, `package.json`, `bun.lock`

### commit 5 — docs: 아키텍처 문서와 플랜·결정 기록 정리
- `README.md`, `docs/**`

## Follow-ups

- Tab placement for worker panes (user preference: same space, multiple tabs instead of one split screen) — herdr 0.8.2 supports it; needs a follow-up run when workers are stable.
- Pi-universal worker remains an open question, explicitly subordinated to herdr visibility; revisit only with user confirmation.
- Reinstall after merge: `bun run build:cli && ./scripts/install-local.sh`.
