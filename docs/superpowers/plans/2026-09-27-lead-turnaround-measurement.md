# Pi Lead Development Turnaround Measurement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure and show Pi Lead request-to-handoff and request-to-final-result time without recording user text or inventing unavailable phases.

**Architecture:** A pure timing state machine consumes only clock values and run IDs. The Pi extension feeds it turn, submission, confirmed handoff, and final-display boundaries. A reproducible fixture contract separates fake scheduling checks from real provider measurements.

**Tech Stack:** Bun, TypeScript, Pi extension API, existing Loop backend and tests.

**Spec:** `docs/superpowers/specs/2026-09-27-lead-turnaround-measurement-design.md`

## Global Constraints

- Maintain the existing Pi Lead conversation, natural-language steering, and Herdr worker-tab lifetime.
- Do not persist or log prompts, credentials, or worker transcripts as timing data.
- Do not change Rust graph types or hand-write copies of generated types.
- The final human-readable status stays within eight lines.
- A missing or invalid phase is reported as unmeasured, never as zero or estimated time.
- No unit or milestone test makes a paid model call.

---

## File map

- Create `packages/pi-loop/src/lead/timing.ts`: isolated timing state and formatter; no Pi, backend, or provider imports.
- Create `packages/pi-loop/test/timing.test.ts`: injected-clock behavior tests for real transitions and omissions.
- Modify `packages/pi-loop/src/extension.ts`: forward the existing Pi and observer boundaries to timing; show one bounded timing line.
- Modify `packages/pi-loop/test/lead.test.ts`: fake Pi integration for one final line and session restoration omission.
- Create `docs/benchmarks/lead-turnaround-fixtures.md`: four fixed task contracts and an honest result sheet.

### Task 1: Timing state with honest omissions

**Files:**
- Create: `packages/pi-loop/src/lead/timing.ts`
- Test: `packages/pi-loop/test/timing.test.ts`

**Interfaces:**
- Produces: `LeadTiming` with `beginTurn()`, `beginSubmission(runId)`, `confirmHandoff(runId)`, `finishDisplay(runId)`, and `forget(runId)`.
- Produces: `formatHandoffTiming(receipt)` and `formatFinalTiming(receipt)` returning a single line or `undefined`.
- Consumes: an injected `() => number` monotonic millisecond clock; no external state.

- [ ] **Step 1: Write a failing behavior test.** Use a sequence clock and assert that a turn at 0, submission at 7000, handoff at 7200, and display at 20000 yield `requestToHandoffMs=7200` and `requestToResultMs=20000`. A second terminal call returns `undefined`. A submission without `beginTurn()` yields only tool and post-handoff intervals. The test must assert values, not calls to mocks.
- [ ] **Step 2: Verify the test fails for the missing module.** Run `bun test packages/pi-loop/test/timing.test.ts`; expect module-not-found.
- [ ] **Step 3: Add minimal code.** Store at most one pending turn and a run-ID keyed map of `{ requestAt?, submissionAt, handoffAt? }`. Discard a pending turn after the first submission. Reject negative/nonfinite differences by omitting them. `confirmHandoff` and `finishDisplay` are idempotent. Return immutable receipts containing only durations and run ID.
- [ ] **Step 4: Verify green.** Run `bun test packages/pi-loop/test/timing.test.ts`; expect every timing and omission case to pass.
- [ ] **Step 5: Review the module boundary.** Confirm `rg -n 'prompt|credential|transcript|@loop/' packages/pi-loop/src/lead/timing.ts` finds no captured content or platform imports. Commit only these two files.

### Task 2: Connect Pi boundaries and bounded display

**Files:**
- Modify: `packages/pi-loop/src/extension.ts`
- Modify: `packages/pi-loop/test/lead.test.ts`

**Interfaces:**
- Consumes: `LeadTiming` and its two formatters from Task 1.
- Produces: one timing line in the `loop_run` result after a confirmed handoff, and one in the observer's final message when the same Pi session has both timestamps.

- [ ] **Step 1: Add a failing fake Pi test.** Invoke `before_agent_start`, then `loop_run`, then let the observer read a terminal snapshot. Assert that the handoff result and final message contain a timing line and that each final message is emitted once. Restore a session containing only `loop-run-binding` and assert no invented request-to-result duration appears.
- [ ] **Step 2: Verify red.** Run `bun test packages/pi-loop/test/lead.test.ts`; expect only the new timing assertions to fail.
- [ ] **Step 3: Wire transitions.** Instantiate `LeadTiming` in `registerLoopExtension`. Call `beginTurn` in the existing `before_agent_start` hook; call `beginSubmission` immediately before backend submission; call `confirmHandoff` only after `backend.run` resolves; call `forget` on handoff failure. In `reportFinal`, call `finishDisplay` after reading check details and before sending the final message. Include the formatter output in `compactLines`, leaving the existing eight-line cap authoritative.
- [ ] **Step 4: Verify green.** Run `bun test packages/pi-loop/test/lead.test.ts packages/pi-loop/test/timing.test.ts` and `bun run typecheck`; expect both to pass. No Pi session restoration may fabricate a timestamp.
- [ ] **Step 5: Build the actual extension.** Run `bun run build:pi`; inspect the built bundle for successful compilation. Commit only the Pi extension and test files.

### Task 3: Fixed comparisons and verification receipt

**Files:**
- Create: `docs/benchmarks/lead-turnaround-fixtures.md`
- Create: `docs/findings/lead-turnaround-measurement-verification.md`

**Interfaces:**
- Consumes: the timing line from Task 2 and the existing fake benchmark/test runner.
- Produces: a table with seed revision, exact task/check, model/config, repetitions, request→handoff, request→verified result, 429, steer result, and missing fields.

- [ ] **Step 1: Write four reproducible fixture contracts.** Specify the initial source state, user request, exact focused check and success criterion for a local edit, bridge/codegen edit, two independent edits, and a mid-run changed criterion. Identify which fixtures need an isolated checkout so concurrent user changes cannot contaminate measurement.
- [ ] **Step 2: Record offline evidence.** Run `bun test packages/pi-loop/test/timing.test.ts packages/pi-loop/test/lead.test.ts`, then `bun run check`. Copy the command outcomes and test counts into the verification file. Do not call the fake benchmark a measured coding task.
- [ ] **Step 3: Record real-provider evidence separately if available.** Use the installed Pi-native Z.AI route and Herdr panes; record only durations, configured route, pass/fail, 429 count and completion evidence. If no repeatable earlier version or usable quota exists, mark baseline comparison or real-provider fields `미측정`.
- [ ] **Step 4: Commit the two evidence documents.** Check the final Git diff for unowned concurrent changes and include only these files.

## Self-review

- A timing receipt is diagnostics, never a completion decision.
- Each task has its own observable output and test cycle.
- Task 1 and Task 2 avoid the concurrently edited Rust bridge, generated protocol, gateway, and turnloop files.
- Task 3 cannot substitute synthetic `process.exit(0)` checks for real acceptance tests.
