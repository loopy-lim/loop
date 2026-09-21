# Routing Decision: Jev Disable, typed_decision → Zai, Pi-Universal Direction

- **Date:** 2026-09-21
- **Status:** Decided (config applied); pi-universal worker is the adopted direction, implementation pending
- **Requested by:** User ("jev는 지금 disable해주라. zai/glm-5.3-flash로만 하게 하고, codex/antigravity 대신 pi로 모두 커버")

## DECISION

1. **JEV-DISABLE** — Remove the `jev-typed-decision` model entry from `config/models.toml`.
   - Evidence: `packages/orchestrator/src/composition.ts` never wires a Jev adapter; `config/providers.example.toml` keeps `[providers.jev]` disabled. The model entry could never route. The `packages/providers/src/jev/client.ts` adapter stays as an inactive experimental client (no composition wiring), removable later without behavior change.
2. **CLASS-MAP** — `typed_decision` now routes to zai `glm-5.3-flash` via a dedicated model profile `glm-5.3-flash-typed-decision`.
   - Evidence: two in-flight decision tasks failed with "No available provider supports typed_decision" (attention rows `provider-decide-tab-layout-policy-typed_decision`, `provider-decision-output-line-limits-typed_decision`). Zai is the only worker path proven to complete in this environment today (`loop-ui-output-limits-4` workers completed on `zai:glm-5.3-flash`).
   - `config/policy.toml` escalation ladder is unchanged.
3. **PI-WORKER (direction)** — Worker execution should converge on pi instead of per-provider native CLIs (codex/antigravity visible workers), with per-class model selection in config.
   - Options evaluated (see `docs/research/2026-09-21-provider-availability-jev-impact-audit-attempt-0.md` and the jev impact audit): (a) zai-only for everything, (b) pi CLI process adapter over ProcessProvider, (c) keep codex/agy visible workers.
   - Chosen: (b) as the target, with zai as interim fallback. Implementation is a follow-up run once the worker status pipeline is fixed.
4. **attention** — Items requiring human action are listed below; they are not resolved by this decision.

## Stall Root-Cause Note

Three runs stalled with `agent_prompt_stalled` / `timeout waiting for agent status`. Research narrowed the cause to the Herdr prompt/status lifecycle of visible Codex/AGY workers — not provider auth or quota, and not jev. Workers frequently finished their work (artifacts landed in `docs/research/`) but Loop's status observation timed out. The pi-universal worker path plus status-reporting hardening addresses this; until then, prefer zai process workers for dispatch.

## Pending Human Actions (attention)

- Retry approval for `loop-af78fc30` (herdr tab layout) and `loop-337a4a53` (plan gap closure) — both paused, work intact.
- Real-provider smoke test of the new typed_decision mapping (separate evidence; unit checks stay offline).

## Verification

- `bun run check` must pass after the config edit (see routing run receipt in this session log).
- No paid model calls were made; doctor probes remain read-only.
