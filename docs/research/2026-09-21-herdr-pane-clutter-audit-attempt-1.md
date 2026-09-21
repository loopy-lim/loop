# Herdr pane clutter audit — attempt 1

- Kind: `research`
- Attempt: `1`
- Captured: 2026-09-21 21:13:55 KST
- Workspace: `/Users/loopy/dev/ll3/loop` (source `HEAD` `3c17869a0ff9`, with unrelated pre-existing dirty/untracked work)
- Herdr: `0.8.2`
- Scope: **read-only** pane/workspace/process inspection and source inspection. This report is the only write. It did not focus, split, close, resize, move, send input to, or otherwise change any live pane. No model prompt or paid-provider command was issued by this audit.

## Conclusion

The clutter is real and is concentrated in two Loop-created worker workspaces, not in
the two active Loop Lead tabs. The final snapshot has **4 workspaces, 5 tabs, and 13
panes**: 2 working Loop Leads, 4 recognized Codex workers in the current Loop run
(2 working and 2 idle), 2 idle Codex workers from an older Loop-named workspace, and
5 unrecognized-but-live `zsh` panes. **No pane is confirmed dead.** [C1][C2]

The current-run worker tab `w16:t1` has five panes arranged as four nested `right`
splits across a 94-column area: `6 / 6 / 12 / 23 / 47` columns. The 6- and 12-column
slots cannot show a useful agent transcript. This is the direct visual source of the
busy/narrow screen. [C3]

The observed geometry follows the current Loop adapter exactly: it caches the
workspace's original/root pane, then every worker call splits that same parent to the
right with `--no-focus`. Repeated 50/50 division of the root's left portion yields
the observed `47 → 23 → 12 → 6`-column rail. [S1][C3]

## Live pane inventory and attribution

| Scope | Pane(s) | Captured state | Attribution and action risk |
| --- | --- | --- | --- |
| `w12:t1` | `w12:p1` | `loop`, `working`, full-width 94 columns | **Active Loop Lead / execution root.** Its foreground process is `loop __execute-plan --json --stream`; its process group is waiting on prompts for current-run workers in `w16`. Do not touch. [C1][C2][C4] |
| `w12:t2` | `w12:p2` | `loop`, `working`, full-width 94 columns | **Second active Loop Lead.** Do not touch. [C1][C3][C4] |
| `w16:t1` | `w16:p2`, `w16:p3` | `codex`, `idle` | **Current Loop-run workers, currently retained.** The workspace label and agent names share run prefix `af78fc30-b43d-43ed-a7c1-3d1966e3e386`; their task titles are the current Herdr audits. They may have completed their turns, but the run remains working and their Codex processes are live. Do not close until the owning Lead has terminal receipts and explicitly releases them. [C1][C2][C4] |
| `w16:t1` | `w16:p4`, `w16:p5` | `codex`, `working` | **Current Loop-run workers.** Their titles are the clutter and tab-placement investigations; live Codex processes remain. Do not touch. [C1][C2][C4] |
| `w16:t1` | `w16:p1` | `agent_status=unknown`; foreground `zsh` | Root/anchor shell of the **current** Loop worker workspace, not a dead pane. It is visually wasteful at 6 columns but is tied to the active run's nested split tree; do not close. [C1][C2][C3] |
| `w15:t1` | `w15:p2`, `w15:p3` | `codex`, `idle` | **Older Loop-run worker candidates.** The workspace label and agent names carry a different run prefix `337a4a53-947d-4889-bc99-72be5614812b`. Both Codex processes are live, so “idle” does not prove abandoned/dead. Candidate only after run-owner and completion-receipt reconciliation. [C1][C2][C4] |
| `w15:t1` | `w15:p1`, `w15:p4` | `agent_status=unknown`; foreground `zsh` | Plain live shells in the older Loop-named workspace. They are plausible residual panes but have no verified owner/completion record. Candidate only after ownership confirmation. [C1][C2][C3] |
| `w19:t1` | `w19:p1`, `w19:p2` | `agent_status=unknown`; foreground `zsh` | **Not attributable to Loop from this snapshot.** Its label/cwd identify a separate `herdr-placement-research-20260921` temporary workspace. Both shells are live; keep out of Loop cleanup scope. [C1][C2][C3] |

The attribution boundary is deliberate: a workspace label such as `loop-loop-<run-id>`
matches the adapter's creation convention, but it is not a completion receipt. The
stronger current-run link is `w12:p1`'s active `loop __execute-plan` process group,
which is waiting on two `loop-loop-af78…` Herdr agent prompts, plus `w16`'s matching
workspace/agent prefix. The current Pi integration also reports the `loop` agent under
the explicit `loop:lead` source, so the two `agent=loop` panes are Lead attribution,
not generic shell detection. [C2][S1][S4]

## Layout evidence

| Tab | Panes / splits | Widths (columns) | Finding |
| --- | ---: | --- | --- |
| `w12:t1` | 1 / 0 | `94` | Lead is not split. [C3] |
| `w12:t2` | 1 / 0 | `94` | Lead is not split. [C3] |
| `w15:t1` | 4 / 3, all `right` | `12 / 12 / 23 / 47` | Older workers and shells remain in a nested split tree. [C3] |
| `w16:t1` | 5 / 4, all `right` | `6 / 6 / 12 / 23 / 47` | Active worker workspace is the material clutter source. [C3] |
| `w19:t1` | 2 / 1, `right` | `47 / 47` | Separate external research workspace; not included in Loop-cause count. [C3] |

## Why completed panes accumulate

The worker runtime has a `cleanup()` method that performs `pane close`, but the
completion path in `HerdrAgentProvider.#wait()` reads/returns worker output without
calling it. An exact current-source search found `runtime.cleanup()` only in the
lifecycle test, not in a production caller. Thus the source supports the conclusion
that normal worker completion does not automatically remove a worker pane; the
current `w15` idle workers and `w16` idle workers are consistent with that behavior.
This is a source-to-observation connection, not proof of the individual panes'
history. [S2][S3]

## Cleanup classification

### Do not change now — high risk

- `w12:p1`, `w12:p2`: active Loop Leads.
- `w16:p4`, `w16:p5`: working current-run workers.
- `w16:p2`, `w16:p3`: idle current-run workers; their result/transcript remains
  attached to an active run.
- `w16:p1`: a live root shell in that current split tree.
- `w19:p1`, `w19:p2`: external, live, unowned-to-Loop research workspace.

### Cleanup candidates only after explicit approval and ownership checks

- `w15:p2`, `w15:p3`: first identify the owning old run and preserve/verify its
  receipt and final output. A live idle Codex process is not a dead process.
- `w15:p1`, `w15:p4`: first identify who owns the live shells and whether any
  terminal state is needed. `agent_status=unknown` means detection failed; it does
  **not** mean the process is dead.

### Confirmed dead panes

None. All five `unknown` panes had live foreground `zsh` processes at inspection;
all recognized worker panes were `working` or `idle`. [C1][C2]

## Evidence register

- **[C1] Live inventory (21:13:55 KST):** `herdr --version`; `herdr pane list`;
  `herdr workspace list`. Result: Herdr `0.8.2`, 13 panes across `w12`, `w15`,
  `w16`, and `w19`.
- **[C2] Process/ownership checks (read-only):** `herdr pane process-info --pane
  <id>` for `w12:p1`, `w12:p2`, every `w15`/`w16` pane, and both `w19` panes;
  `herdr pane get <id>` for recognized agents; one 12-line `herdr pane read --source
  recent w12:p1`. These commands established live `loop`, `codex`, and `zsh`
  foreground processes without sending input.
- **[C3] Layout capture (read-only):** `herdr pane layout --pane w12:p1`,
  `w12:p2`, `w15:p1`, `w16:p1`, and `w19:p1`. The same snapshot also used
  `herdr pane layout --current`, `herdr tab list`, and `herdr api snapshot`.
- **[C4] Agent metadata (read-only):** `herdr agent list`; its agent names and
  workspace labels supplied the run-prefix correlation. Live status is inherently
  time-sensitive; the 21:13:55 snapshot is authoritative for this report.
- **[S1] Worker split / workspace source:**
  [`packages/herdr/src/client.ts:77-90`](../../packages/herdr/src/client.ts#L77-L90)
  always invokes `pane split --direction right --no-focus`; the cached root workspace
  is created and reused at
  [`packages/herdr/src/client.ts:205-224`](../../packages/herdr/src/client.ts#L205-L224).
- **[S2] Cleanup and completion source:**
  [`packages/herdr/src/client.ts:160-164`](../../packages/herdr/src/client.ts#L160-L164)
  defines close-based cleanup, while
  [`packages/providers/src/herdr-agent.ts:133-172`](../../packages/providers/src/herdr-agent.ts#L133-L172)
  completes/returns without invoking it.
- **[S3] Search/test corroboration:** the current-source command
  `rg -n '\\.cleanup\\(' packages --glob '*.ts'` returned only
  [`packages/herdr/test/lifecycle.test.ts:69`](../../packages/herdr/test/lifecycle.test.ts#L69);
  that test expects `pane close` at
  [`packages/herdr/test/lifecycle.test.ts:71-76`](../../packages/herdr/test/lifecycle.test.ts#L71-L76).
- **[S4] Lead lifecycle source:**
  [`packages/pi-loop/src/herdr-lifecycle.ts:22-23`](../../packages/pi-loop/src/herdr-lifecycle.ts#L22-L23)
  sets source `loop:lead` and agent `loop`; its registered Pi events report `working`
  and `idle` at
  [`packages/pi-loop/src/herdr-lifecycle.ts:77-85`](../../packages/pi-loop/src/herdr-lifecycle.ts#L77-L85).

## Evidence limits

- This is a point-in-time inventory. Agent states changed during the read-only
  observation, so no `idle` or `working` label is treated as a durable result.
- No pane was closed or prompted, and no terminal history was broadly captured. The
  audit therefore cannot prove the human owner, completion receipt, or safe-to-delete
  status of an individual old pane.
- No test was run: the request was a live-state audit, and running repository checks
  would not improve pane ownership evidence.
