# Loop Lead / Pi Agent Harness Review (2026-xx)

Scope: Lead tool surface (`loop_run`, `loop_quick_run`, `loop_status`, `loop_task`,
`loop_guidance`, `loop_steer`, `loop_resolve`), presentation compactness rules
(status 8 / attention 6 / findings 5 lines), task contract expressiveness
(scopes, completion checks, criteria mapping), and the Pi extension integration
in `packages/pi-loop`. Evidence base: `packages/pi-loop`, `packages/presentation`,
`packages/cli`, `packages/orchestrator`, `packages/protocol` generated types,
`crates/loop-core`, `config/policy.toml`, `docs/architecture.md`,
`docs/model-routing.md`, `docs/reviewer-pattern.md`.
Each section below is capped at five findings; improvements are prioritized.

## Strengths

1. **The submission gate makes the task contract real, not advisory.**
   `validateGoalPlan` (`packages/pi-loop/src/lead/decompose.ts`) rejects plans
   where a requirement has no criterion, a criterion names a missing check, or
   a multi-implementation plan lacks a transitive integration gate;
   `validateDecomposition` requires non-empty completion checks, explicit write
   ownership for decision/implementation/integration kinds, and acyclic
   dependencies. `loop_quick_run` (`packages/pi-loop/src/extension.ts`)
   additionally enforces acceptance mapping with ≥1 check per requirement.

2. **Criterion verification is deterministic and evidence-based in core.**
   `RunProjection::goal_criteria_status`
   (`crates/loop-core/src/event/reducer.rs`) marks a criterion verified only
   when its task is Done and every mapped receipt has exit 0, no timeout, a
   stable source fingerprint, and no writes observed outside scope. Provider
   claims cannot substitute for check evidence.

3. **Guidance is durable with an exactly-once delivery watermark.**
   `packages/orchestrator/src/mailbox.ts` records `GuidanceAdded` /
   `GuidanceDelivered` events with an ascending per-task watermark; a crash
   between `provider.steer` and the append replays on the next claim, and
   claim-context injection folds run-wide and ancestor-targeted guidance into
   worker start context. `packages/cli/src/guidance-status.ts` reconstructs
   recorded → delivered → checked stages purely from the event log.

4. **Compactness budgets are single-sourced and enforced structurally.**
   `config/policy.toml` (8/6/5/8/160) flows through `OutputLimits` into
   `compactLines` / `singleLine` / `compactItems`
   (`packages/presentation/src/compact.ts`), with grapheme-aware truncation and
   overflow lines that count against the budget. Lead surfaces never hand-roll
   line caps; the widget, status, attention, and final-report paths all go
   through the same primitives.

5. **The Lead operating discipline is encoded, not hoped for.**
   `leadInstructions` (`packages/pi-loop/src/lead/prompts.ts` + `extension.ts`)
   forbids polling after handoff, forbids self-implementing, requires carrying
   unresolved acceptance criteria into follow-up runs, separates "recorded /
   delivered / verified" reporting, and the automatic final-review turn
   compares durable criteria against check evidence before claiming success.
   `LeadTiming` (`packages/pi-loop/src/lead/timing.ts`) makes handoff latency a
   visible, tested receipt.

## Friction Points

1. **Per-task state is the most compressed view in the system.**
   `renderTaskContext` (`packages/presentation/src/snapshot.ts`) clamps the
   whole task context — dependencies, scopes, check evidence, dependency
   results, guidance, and the trailing `Requires:` contract line — to
   `statusLineLimit` (8). A task with 2 checks + 2 dependency results + 2
   guidance items overflows before `Requires:` renders, and each check's
   stdout/stderr evidence is inline-clamped to `lineTextLimit` (160 graphemes).
   The Lead's deepest-dive tool (`loop_task`) therefore shows the least
   evidence per line of any surface.

2. **The guidance view shows stages but not the correction text.**
   `loop guidance` renders only `sequence · state`
   (`packages/cli/src/main.ts`, plain-text branch;
   `GuidanceStatusView` in `packages/cli/src/guidance-status.ts` carries no
   message). The Lead's `loop_guidance` reuses that same plain output via
   `backend.guidance` (`packages/pi-loop/src/extension.ts`). To learn *what*
   was recorded, the Lead must cross-reference `loop_task`, whose guidance
   list (`TaskContextOutput.guidance`) is stage-less and subject to Friction 1.
   A correction can be durably logged yet effectively invisible to the Lead.

3. **Goal-criteria progress is invisible until the run is terminal.**
   `SnapshotOutput.goalCriteria` is populated by the bridge and computed by
   core, but no mid-run renderer uses it: `renderStatus` / `renderGraph` /
   `renderWorkers` (`packages/presentation/src/snapshot.ts`) never show
   criteria; only `reportFinal` (`packages/pi-loop/src/extension.ts`) reads
   them, after completion. Mid-run, neither the Lead nor the user can ask
   "which acceptance criteria are proven so far" without walking every task.
   Run-level guidance (`SnapshotOutput.guidance`) is likewise rendered nowhere.

4. **Steer has delivery gaps at state boundaries and turn boundaries.**
   `loop_steer` forwards only `lastUserPrompt`
   (`packages/pi-loop/src/extension.ts`, `before_agent_start`); guidance given
   while the Lead is mid-tool, or mis-targeted by the Lead, is recorded nowhere
   (no unbound-corrections queue). Steering a `verifying` task is accepted, but
   if checks pass there is no next attempt, so the guidance stays `recorded`
   forever with no surface that flags it. During the automatic final-review
   turn, `loop_steer` hard-throws ("this turn is an automatic final review")
   instead of queueing the correction for the next turn.

5. **Verification evidence is tail-truncated, and the verifier verdict travels as prose.**
   `redact` (`packages/orchestrator/src/redact.ts`) keeps only the last 16000
   chars of check stdout/stderr — a failing test name printed mid-run is lost;
   artifacts are stored only when combined output exceeds 500 bytes
   (`INLINE_LIMIT`, `packages/orchestrator/src/evidence-artifact.ts`) and no
   Lead tool reads them back. The verifier-FAIL signal that drives the
   "Review needed" path is a regex over the worker's free-text summary
   (`verifierReportedFailure`, `packages/pi-loop/src/extension.ts`), not a
   typed protocol field.

## Top 5 Prioritized Improvements

1. **P0 — Give task detail its own budget and a dedicated evidence action.**
   Evidence: `renderTaskContext` in `packages/presentation/src/snapshot.ts`
   (single `lineLimit: limits.statusLineLimit` clamp over the entire context);
   `loop_task` in `packages/pi-loop/src/extension.ts`.
   Change: render the task contract (requires, scopes, check ids + exit codes,
   guidance stages) under a dedicated `taskLineLimit` (e.g. 3× status, from
   `config/policy.toml`), and add a `loop_task` `checkId` parameter returning
   one receipt's untruncated evidence head/tail plus artifact path. This
   directly serves the AGENTS.md rule "worker success is not verification" —
   today the Lead cannot actually read the verification it is told to trust.

2. **P0 — Surface goal-criteria state as one mid-run status line.**
   Evidence: `goal_criteria_status` (`crates/loop-core/src/event/reducer.rs`)
   already computes per-criterion verified/pending; `renderStatus` in
   `packages/presentation/src/snapshot.ts` omits it; widget headline in
   `renderRunWidget` (`packages/pi-loop/src/extension.ts`) counts only
   `done/N tasks`.
   Change: extend the status `Tasks:` line (or the widget headline) with
   `Criteria: 2/5 verified · pending: b:1, c:2` drawn from
   `snapshot.goalCriteria`. No core change; the data already crosses the
   protocol boundary. This makes "goal incomplete" detectable mid-run instead
   of only at `reportFinal`.

3. **P1 — Attach the correction text to the guidance stages.**
   Evidence: `GuidanceStatusView` in `packages/cli/src/guidance-status.ts`
   (no message field); plain render `sequence · state` in
   `packages/cli/src/main.ts` guidance branch; `loop_guidance` in
   `packages/pi-loop/src/extension.ts`.
   Change: include the recorded message (first ~120 graphemes via
   `singleLine`) in `GuidanceStatusView`, render
   `sequence · state · message`, and have the extension consume the JSON path.
   The Lead can then quote the exact user correction and check its delivery
   state in one tool call, instead of reconciling two truncated views.

4. **P1 — Close the steer delivery gaps.**
   Evidence: `loop_steer` + `inFinalReviewTurn` guard in
   `packages/pi-loop/src/extension.ts`; mailbox live-drain and next-claim
   delivery conditions in `packages/orchestrator/src/mailbox.ts`.
   Change: (a) when steering a task whose checks may pass with no retry,
   respond "recorded; delivers only on a retry/follow-up task" and offer
   `loop_add_task` in the same reply; (b) during the automatic final-review
   turn, queue the user text as pending guidance and bind it after
   `agent_end` instead of throwing; (c) if a user message contains guidance
   and the turn ends with no `loop_steer`/`loop_add_task` call, append a
   `loop-unbound-guidance` session entry so the correction is at least
   discoverable in the transcript.

5. **P2 — Type the verifier verdict and preserve both ends of check output.**
   Evidence: `verifierReportedFailure` regex over `resultSummary`
   (`packages/pi-loop/src/extension.ts`); tail-only `redact(value, 16000)`
   (`packages/orchestrator/src/redact.ts`); `INLINE_LIMIT = 500` in
   `packages/orchestrator/src/evidence-artifact.ts`.
   Change: require verification-kind workers to emit a structured verdict
   (typed field on the worker result or a `VerificationVerdict` recorded at
   receipt time in the orchestrator) and match it in core/presentation instead
   of regexing prose; store head+tail of check output (e.g. 8k/8k) so failure
   names in the middle survive; expose artifact contents through the `loop_task`
   evidence action from Improvement 1.

## Checks run

- Focused read of all in-scope packages and docs; no code changed.
- `test -s docs/findings/2026-xx-lead-harness-review.md` plus section greps
  (the declared completion check) — run by the worker and re-run by Loop.
