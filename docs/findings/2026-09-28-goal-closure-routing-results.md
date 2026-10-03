# Goal closure, routing, and repair verification — 2026-09-28

## Delivered

- Tracked runs declare one or more durable goal criteria. Each criterion names a task requirement and completion check IDs. Rust rejects missing task/check references, duplicate IDs, blank or unmapped requirements, and partial correction batches. Snapshot output shows each criterion as `pending` or `verified`.
- A tracked run reaches `completed` only after all tasks are done and every criterion has successful latest check receipts with stable fingerprints for its declared Git read/write scopes. A missing source receipt leaves the goal unverified and raises an explicit attention item. Legacy runs are still accepted, with an empty goal ledger shown as untracked in the Pi final report.
- Task routing stores risk and required capability scores. The provider registry passes configured model scores, compute bounds, risk floors, availability, cost, and latency to the Rust selector. The selected class and generic reason are recorded as task activity. High-risk and missing-capability cases are tested without model calls.
- A provider with `repair` can receive failed focused checks once on the same handle. Herdr continues the same agent conversation; Loop reruns executable checks independently, records the corrected result summary, then releases the handle before final verification. Providers without `repair` keep the bounded scheduler retry path.
- A repair-capable mirrored worker keeps its pane open between its first result and the focused repair; releasing the handle closes it.
- The Pi Lead sends derived criteria with new runs, adds correction task and criterion in one CLI operation, and reports outstanding criterion IDs in its final status. The prompt now asks for explicit task risk/capability scores.

## Evidence

| Gate | Result |
| --- | --- |
| Baseline `bun run check` before edits | 700 Bun tests passed |
| Final `bun run check` | 708 Bun tests passed; Rust, TypeScript, architecture, and codegen checks passed |
| `bun run test:packaged` | Packaged CLI/Pi extension built; offline 7-task acceptance completed, maximum concurrent workers 3, one escalation |
| `dist/loop doctor --auth --json` | `rustra`, `herdr`, and `pi` ready |
| Authenticated, single-task smoke | Temporary Git root `/tmp/loop-live-goal-adMrly`; run `live-goal-20260928` completed at attempt 0; `content` criterion verified; `file-content` check exit 0 with stable source fingerprint; `result.txt` contained one line `LOOP_OK`; route selected `fast` |
| Same-session repair | Offline fake and Herdr-runner tests showed one handle, two turns, one worker start, and independent check rerun |

## Evidence limits

- The authenticated smoke covered one low-risk Pi/Herdr worker. High-risk routing, provider fallback, and same-session repair were exercised offline, not with paid providers.
- Criteria cover what the Lead declared as task requirements. Comparing the user's full original request and later corrections with those declarations still needs the Lead's final review; machine checks cannot infer omitted intent.
- Source-state receipts require a Git repository root. A tracked run outside that boundary remains unverified and requests attention.
- The checks prove code and runtime behavior at their recorded source state. A later downstream edit can affect earlier behavior, so integration requirements need a downstream acceptance check.
- There is no repeated wall-clock P50/P95 benchmark or single-agent baseline. The repair test proves one worker start and one same-session repair, not a measured latency improvement.
- The optional `cargo fmt --all -- --check` gate reports formatting differences in pre-existing code, including untouched `crates/loop-core/src/error.rs`. The required `bun run check` gate passed; this work did not reformat unrelated files.

The pre-existing dirty workspace was preserved. No commit, push, installation, or publication was performed.
