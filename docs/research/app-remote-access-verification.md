# App Remote Access — Integration Verification (attempt 0)

Date: 2026-09-25
Task: `integration-verification` — verify gateway + both apps integration and full repo check.
Scope read: `AGENTS.md`, `apps/**`, `packages/**`, `docs/decisions/2026-xx-remote-app-architecture.md`.
Scope written: this file only.
Context: ran after `gateway-sse-fix` restored `packages/gateway/test/submit-stream.test.ts` to 46/46.

## 1. Full repo check — `bun run check`

**PASS** (exit code 0). Evidence from `/tmp/full-check.log`:

| Stage | Result |
| --- | --- |
| `bun run codegen:check` | clean — generated bindings in a temp dir match the committed ones (Rust schema regenerated via `loop-bridge-generate`) |
| `bun run typecheck` (`tsc -p tsconfig.json`) | clean, no errors |
| `bun run test:architecture` | 6 pass / 0 fail (`tests/architecture-boundaries.test.ts`) |
| `bun run test` | **388 pass / 0 fail** across 46 files, 1628 `expect()` calls, 13.70s |

Gateway SSE tests previously failing (4) all pass in this run:

```
(pass) POST /v1/runs → SSE happy path > submit returns 202 with an accepted summary, then status/output/terminal stream
(pass) POST /v1/runs → SSE happy path > planning failure flips the run to failed and emits status then terminal
(pass) replay with Last-Event-ID > replaying across a terminal transition ends with terminal and closes
(pass) client disconnect semantics > disconnect does not cancel the run; the run continues and completes
```

## 2. Gateway ↔ app smoke (no paid model call)

**PASS.** Real gateway booted as a process (not in-process test server) with:

```
LOOP_GATEWAY_HOST=100.80.133.120   # Tailscale CGNAT IP on an active interface (fail-closed bind check satisfied)
LOOP_GATEWAY_PORT=18477
LOOP_GATEWAY_DATABASE_PATH=/tmp/loop-smoke/smoke.db
LOOP_GATEWAY_JWT_SECRET / _ISSUER / _AUDIENCE   # smoke values, process memory only
bun packages/gateway/src/main.ts
# → gateway listening on http://100.80.133.120:18477/v1
```

Client: the real mobile app client `apps/loop-mobile/src/gateway/client.ts` (`GatewayClient`),
driven from `/tmp/loop-smoke/smoke.ts` (kept outside the repo to respect the write scope).
Token minted with `signHs256Token` from `packages/gateway/src/auth.ts` (operators mint tokens
out of band; issuance is out of v1 scope).

Observed transcript:

```
auth-fail-check: rejected as GatewayError ok        # bad bearer → 401 problem, fail closed
submit: 202 runId=run_4f56ef57-26db-4d09-be66-784a4e1a6103 status=planning
status events received: 2
  status: {..., "run":{"status":"running","lastSequence":"1",...}}          # planning→running
  status: {..., "taskCounts":{"pending":1,...},"tasks":[{"taskId":"gateway-app","status":"pending",...}]}
output events received: 0
terminal event: (none within window)
getRun: status=running tasks={"pending":1,"running":0,"attention":0,"done":0,"failed":0,"cancelled":0}
listRuns: count=1 first=run_4f56ef57-26db-4d09-be66-784a4e1a6103
SMOKE: PASS
```

Checks exercised: bearer auth (reject + accept), `POST /v1/runs` → 202 with `{ run: RemoteRunSummary }`
(wire contract ADR §4.3), SSE `GET /v1/runs/{runId}/events` with `event: status` frames
(ADR §4.4), foreground polling fallback `GET /v1/runs/{runId}`, list `GET /v1/runs`.
**No provider or model call** — `main.ts` uses the deterministic stub prompt planner
(one implementation task, `echo ok` completion check).

### Expected non-observation: no terminal event

The stub planner only makes the submission durable (`createRun` + `submitPlan`); it does not
spawn a worker, so the run stays `running` with one pending task and the stream never reaches
`event: terminal`. This matches ADR §5: the Pi adapter that owns prompt→plan→execute is a
future composition-root replacement and must not change the wire contract. The smoke
requirement ("receives status events") is met; terminal behavior is covered by the unit
suite (stream-backpressure + submit-stream + cursor-replay tests exercise `terminal` frames
end to end against the same `GatewayService`).

## 3. AGENTS.md boundary verification

**PASS.**

- **Architecture boundary tests green**: `bun run test:architecture` → 6/6, including
  "loop-core exports only provider-neutral orchestration modules",
  "generated Rustra bindings are the only TypeScript to Rust seam",
  "provider, Pi, SQLite, and generated protocol dependencies do not invert",
  "configuration keeps model names and provider endpoints out of business logic".
- **`codegen:check` clean**: committed generated files are byte-identical to what
  `loop-bridge` regenerates (stage passed inside `bun run check`).
- **No provider/Pi/Herdr/endpoint concepts in `loop-core`**:
  - `crates/loop-core/Cargo.toml` depends only on `schemars`, `serde`, `thiserror`
    (+ `serde_json` for tests) — no bridge, provider, or IO dependencies.
  - `grep -rn -iE 'provider|pi-loop|herdr|endpoint' crates/loop-core/src` matches a single
    line, `crates/loop-core/src/run/worker.rs:13`, a **doc comment** referencing the
    TypeScript `WorkerState` union path for reader orientation — not an import or
    dependency. No `use` of anything outside `loop_core` + std-adjacent crates.

## 4. Gateway ↔ app contract mismatches

**None found on the wire.** Both apps hand-declare the wire types (allowed: they are app
adapters, and the architecture test forbids importing generated protocol into apps):

- `apps/loop-mobile/src/gateway/wire.ts` vs `apps/loop-desktop/src/wire/protocol-types.ts`:
  `RemoteRunSummary`, `SubmitPromptInput`, `SubmitPromptAccepted`, `RemoteRunEventEnvelope`,
  and the event kinds `status | output | reset | terminal` are field-for-field identical.
  Diffs are doc-comment wording ("Decimal string per contract" vs "u64 as decimal string")
  and `clientContext?: ClientContext | null` vs `clientContext?: ClientContext` — JSON
  shape is the same (`null` allowed, gateway validates and stores it opaquely).
- Both clients implement the same four-surface interface (submit / list / get / observe SSE
  with `Last-Event-ID` replay) per ADR §4. The smoke exercised the mobile client directly;
  the desktop client's types match the same responses, and its request paths are the same
  `/v1` routes.

## 5. Changed files

- `docs/research/app-remote-access-verification.md` (this file) — only file written.
- No source changes; the gateway SSE fix landed in a sibling task (`gateway-sse-fix`,
  all changes confined to `packages/gateway/**`).

## 6. Checks run

1. `bun run check` — exit 0 (codegen:check, typecheck, architecture, 388 tests).
2. Gateway smoke — booted `packages/gateway/src/main.ts`, connected
   `apps/loop-mobile` `GatewayClient`, submitted a prompt stub, received 2 `status` SSE
   frames, verified `getRun`/`listRuns`. No paid model call.
3. Boundary greps over `crates/loop-core` (imports + Cargo deps).
4. Wire-type diff of both app clients against the ADR §4 frames.

## 7. Unresolved risks

1. **No live terminal/worker path in smoke.** The stub planner never executes the task, so
   real `output`/`terminal` frames, replay-after-terminal against a live server, and worker
   cancellation were verified only via unit tests, not a live process. When the Pi adapter
   replaces the stub planner, rerun this smoke end to end (with a cheap/non-model executor
   or an explicitly stubbed worker) to observe a live `terminal` frame.
2. **Hand-declared wire types in apps can drift.** Nothing mechanically pins
   `apps/*/wire` types to the gateway's. Consider a small drift test (apps asserting their
   types against a shared fixture JSON) when either app's surface changes.
3. **Smoke secrets passed via env to a local process** — smoke values only, never persisted;
   consistent with AGENTS.md ("do not persist or log credentials").
4. **`GatewayClient` used from the desktop app was not exercised live** in this attempt
   (types verified only). The desktop shell goes through Tauri HTTP (`src-tauri`), which the
   gateway's no-`Origin` framing rule is designed for, but a desktop-shell smoke remains open.
