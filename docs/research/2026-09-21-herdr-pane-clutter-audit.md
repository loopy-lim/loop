# Herdr pane clutter audit

- Captured: 2026-09-21 21:09 KST initial; 21:10:55 KST final read-only snapshot
- Herdr: 0.8.2
- Kind: `research`, attempt `0`
- Scope: read-only Herdr CLI/API inspection and read-only source inspection.
- Write scope: this report only. No pane focus, split, close, input, prompt, or lifecycle command was issued; no new paid model call was made.

## Executive finding

The globally focused Herdr surface is not itself split: `herdr api snapshot` reports focus on `w12:p2` / `w12:t2`, a single full-width pane with no splits. The clutter is in two unfocused worker workspaces that remain live in the Herdr session:

- `w15:t1`: four panes, three nested right splits, two idle Codex agents, and two plain `zsh` panes.
- `w16:t1`: five panes, four nested right splits, four working Codex agents, and one plain `zsh` pane.

At the final snapshot there are 3 workspaces, 4 tabs, and 11 panes. Eight panes have recognized agents (`loop` x2, `codex` x6); three have `agent_status=unknown`, but process inspection shows all three are live `zsh` shells. No pane can be confirmed dead from this snapshot.

During the audit, without any pane command from the auditor, `w16:t1` grew from 3 panes / 2 splits at 21:09 to 5 panes / 4 splits at 21:10:55. The new panes were `w16:p4` and `w16:p5`, both working Codex agents. This is direct evidence that the live run itself can increase the clutter while it is being observed.

## Live pane inventory

| Workspace / tab | Pane | Evidence | Classification |
| --- | --- | --- | --- |
| `w12` / `w12:t1` | `w12:p1` | `agent=loop`, `working`, title `π - loop`; terminal shows active `loop_run`, `Workers: 2`, and `loop __execute-plan --json --stream` | Loop Lead / active run root |
| `w12` / `w12:t2` | `w12:p2` | globally focused; `agent=loop`, `working`, title `π - loop`; foreground `loop` + Pi | Second active Loop Lead session |
| `w15` / `w15:t1` | `w15:p2` | `agent=codex`, `idle`, `interactive_ready=true`; Codex process remains present; recent tail ends at a completed-looking prompt | Retained idle worker; not proven dead |
| `w15` / `w15:t1` | `w15:p3` | `agent=codex`, `idle`, `interactive_ready=true`; Codex process remains present; recent tail ends at a completed-looking prompt | Retained idle worker; not proven dead |
| `w15` / `w15:t1` | `w15:p1` | `agent_status=unknown`; foreground process is live `zsh`; no recent output | Unattached shell / residual candidate; user ownership unverified |
| `w15` / `w15:t1` | `w15:p4` | `agent_status=unknown`; foreground process is live `zsh`; recent tail shows a shell prompt on `codex/rebuild-loop-cli` | Unattached shell / residual candidate; do not close without ownership check |
| `w16` / `w16:t1` | `w16:p2` | `agent=codex`, `working`; title `감사해 현재 Herdr 화면 \| loop`; foreground Codex process | Current-run worker; high risk to touch |
| `w16` / `w16:t1` | `w16:p3` | `agent=codex`, `working`; title `Herdr 0.8.2 탭 배치를 확인하라 \| loop`; foreground Codex process | Current-run worker; high risk to touch |
| `w16` / `w16:t1` | `w16:p4` | `agent=codex`, `working`; title `Herdr 화면 어수선함 감사 \| loop`; foreground Codex process | Current-run worker; high risk to touch |
| `w16` / `w16:t1` | `w16:p5` | `agent=codex`, `working`; title `확인해 Herdr 0.8.2 탭 배치 \| loop`; foreground Codex process | Current-run worker; high risk to touch |
| `w16` / `w16:t1` | `w16:p1` | `agent_status=unknown`; foreground process is live `zsh`; no recent output | Unattached shell / residual candidate; user ownership unverified |

The `w16` workspace label contains run ID `af78fc30-b43d-43ed-a7c1-3d1966e3e386`, matching the active `loop_run` shown in `w12:p1`; this is the evidence linking `w16:p2` and `w16:p3` to the current Lead run. `w15` has a different run ID (`337a4a53-947d-4889-bc99-72be5614812b`) and its workspace is globally idle.

## Layout and split evidence

`herdr pane layout` by workspace returned:

- `w12:t1`: 1 pane, 0 splits; `w12:p1` occupies the full `94 x 44` area.
- `w12:t2`: 1 pane, 0 splits; `w12:p2` occupies the full `94 x 44` area.
- `w15:t1`: 4 panes, 3 right splits. Widths are `12 / 12 / 23 / 47`; the two 12-column panes are the plain shells.
- `w16:t1`: final snapshot has 5 panes, 4 right splits. Widths are `6 / 6 / 12 / 23 / 47`: `w16:p1` is the plain shell at the left edge, while `w16:p5` and `w16:p4` are newly accumulated worker slots.

The visual clutter is therefore caused by repeated horizontal worker splits plus retained shell/idle panes, not by the currently focused Lead pane. Hidden workspaces and tabs amplify the sidebar/workspace inventory even when the active screen is a single pane.

There is one context distinction: `herdr pane current` and `herdr pane layout --current` resolve the CLI caller's Herdr context (`w16:p2` / `w16:t1`), while `herdr api snapshot` reports the globally focused UI (`w12:p2` / `w12:t2`). Both were read-only; the global snapshot is used for the “current screen” conclusion above.

## Root cause in Loop integration

The source matches the observed geometry:

1. `packages/herdr/src/client.ts:77-90` creates every worker by calling `pane split --direction right --no-focus`.
2. `packages/herdr/src/client.ts:205-224` creates one `loop-${runId}` workspace when no caller is supplied, also with `--no-focus`.
3. `packages/herdr/src/client.ts:160-164` provides `cleanup()` as `pane close`, but `packages/providers/src/herdr-agent.ts:133-173` waits, reads, and reports completion without calling it. A repository search found no production call site for `cleanup()`.

Thus, repeated workers naturally build nested right splits, and completed workers can leave their Herdr panes and processes behind. The tests intentionally prove the split/no-focus contract (`packages/herdr/test/lifecycle.test.ts:5-52`) and separately prove cleanup exists (`:55-76`), but they do not prove production completion invokes cleanup.

## Cleanup and risk classification

### Safe to observe only

- `w12:p1`, `w12:p2`: active Loop Leads; do not interrupt, focus, or close.
- `w16:p2`, `w16:p3`, `w16:p4`, `w16:p5`: active current-run Codex workers; do not interrupt, focus, or close.
- `w15:p2`, `w15:p3`: idle but still live Codex sessions; treat as retained work until completion/ownership is explicitly reconciled.

### Cleanup candidates, pending explicit approval and ownership check

- `w15:p1`, `w15:p4`, `w16:p1`: no recognized agent and live `zsh`; likely residual split shells, but not dead. `w15:p4` visibly has a user branch prompt, so it is especially unsafe to close blindly.
- `w15:p2`, `w15:p3`: likely stale completed workers, but their live Codex processes and transcripts are recoverable state; verify the owning run and completion receipt before any close.

### Confirmed dead panes

None. `agent_status=unknown` is only an agent-detection result; process-info disproves “dead” for the three shell candidates.

The process inspections also observed existing model-backed work: the Lead tail displayed `(zai) glm-5.3-flash`, earlier worker inspection showed `gpt-5.6-luna` in `w15:p2`, `w15:p3`, `w16:p2`, and `w16:p3`, and the final inspection showed `gpt-5.6-terra` in `w16:p4` and `w16:p5`. This audit did not start those prompts or any other model call, and did not stop them because the requested scope forbids live pane state changes. They are recorded as external live-state risk, not as audit work performed.

## Evidence commands

Read-only commands used: `herdr pane list`, `herdr pane layout --current`, `herdr pane layout --pane <id>`, `herdr workspace list`, `herdr tab list`, `herdr agent list`, `herdr pane get <id>`, `herdr pane process-info --pane <id>`, `herdr pane read --source recent --lines 18 <id>`, and `herdr api snapshot`.
