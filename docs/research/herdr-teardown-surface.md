# Herdr CLI Teardown Surface Research

- Captured: 2026-09-22 KST (prior run `cleanup-support-r1`)
- Refreshed: 2026-09-22 KST, verify-and-refresh pass against live Herdr `0.8.2` (socket protocol `20`, schema version `1`)
- Re-verified: 2026-09-22 01:11 KST, spot-check pass against live Herdr `0.8.2` (protocol `20`, schema `1`): CLI verbs, `api schema` `$defs`, and all `HerdrWorkerRuntime` gap line references confirmed unchanged — document is fresh and authoritative.
- Re-verified: 2026-09-22 01:32 KST, spot-check pass against live Herdr `0.8.2`: CLI verbs re-probed (`workspace close` present, exit `0` on help), all gap line references re-pinned (`client.ts` drifted only in `#ensureWorkspace` 207→229 and `#turns.set` 197→219; both corrected below), and repo-wide grep re-confirmed `cleanup()`/`workspace close` have no production callers — all gap findings remain valid.
- Re-verified: 2026-09-22 01:34 KST, spot-check verification pass: confirmed Herdr `0.8.2` CLI verbs, cascade semantics, and all `HerdrWorkerRuntime` gap references (workspace leak, discarded `tab_id`, production omission of `cleanup()`) intact and accurate. Document is fresh; no drift detected.
- Re-verified: 2026-09-22 01:55 KST, spot-check pass against live Herdr `0.8.2` (protocol `20`, schema `1`): teardown verbs and cascade semantics re-probed live (scratch workspace `w2B`: sole-pane `pane close` cascaded through tab to workspace destruction; `workspace get` → `workspace_not_found`; zero leaked workspaces), all `client.ts` gap line references re-pinned after drift (`cleanup` 162→172, `#turns.delete` 165→183, `#turns.set` 219→246, `#ensureWorkspace` 229→256–276; corrected below), production omission of `cleanup()` re-confirmed by repo-wide grep, and three `herdr agent` interaction contracts newly verified live via a local `pi` session (no prompt submitted, zero model calls) — recorded in §1.G: `agent read` prints raw pane text (no JSON envelope), `agent get` exposes `result.agent.agent_status`, `agent prompt --wait` requires `--until done` for deterministic completion.
- Kind: `research`, attempt `0`
- Tool: Offline probe runners ([`verify-herdr-teardown.ts`](file:///Users/loopy/.gemini/antigravity-cli/brain/754d5a0d-382c-4490-831b-9212b9a9e269/scratch/verify-herdr-teardown.ts), [`probe-herdr-teardown.ts`](file:///Users/loopy/.gemini/antigravity-cli/brain/97b55c1f-901f-4a80-96fa-afd1bfd9d0d4/scratch/probe-herdr-teardown.ts))
- Target: Herdr `0.8.2`, socket protocol `20`, schema version `1`
- Scope: `herdr --help`, subcommands (`workspace`, `tab`, `pane`, `agent`, `worktree`), candidate verbs (`close`, `kill`, `remove`), JSON schema definitions, cascade semantics, and [`HerdrWorkerRuntime`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L64) integration.
- Boundaries: Probed strictly offline against the local Herdr daemon; zero paid model calls; zero credential lookups; isolated scratch test workspaces created and torn down immediately (zero leaked workspaces verified via `herdr workspace list`).
- Write scope: this report and scratch probe scripts only.

---

## Verification Notes (Diff Against Prior Attempt)

All findings from `cleanup-support-r1` were re-verified against a live `herdr 0.8.2` daemon (protocol `20`, schema version `1`) running at `/Users/loopy/.config/herdr/herdr.sock`:

1. **Exact Supported Verbs Confirmed**:
   - `herdr workspace close <workspace_id>`: confirmed exit `0`, returns `{"id":"cli:workspace:close","result":{"type":"ok"}}`.
   - `herdr tab close <tab_id>`: confirmed exit `0`, returns `{"id":"cli:tab:close","result":{"type":"ok"}}`.
   - `herdr pane close <pane_id>`: confirmed exit `0`, returns `{"id":"cli:pane:close","result":{"type":"ok"}}`.
   - `herdr worktree remove --workspace <workspace_id> [--force]`: confirmed syntax, applicable strictly to Herdr-managed Git worktrees (fails with exit `1` and `not_linked_worktree` on standard workspaces).

2. **Absent Verbs Confirmed (Exit Code 2)**:
   - Top-level `herdr close`, `herdr kill`, `herdr remove` exit `2` (`unknown command: <cmd>`).
   - `herdr workspace remove|delete|kill` exit `2`.
   - `herdr tab remove|delete|kill` exit `2`.
   - `herdr pane kill|remove` exit `2`.
   - `herdr agent close|kill|stop|remove` exit `2`. Agent authority release is strictly via `herdr pane release-agent`, while process termination occurs via `herdr pane send-keys <pane_id> ctrl+c` or pane/tab closure.

3. **Wire Protocol Schema Pinning**:
   - Verified against `herdr api schema --json`:
     - `workspace.close` maps to `$defs.WorkspaceTarget` (`workspace_id: string`).
     - `tab.close` maps to `$defs.TabTarget` (`tab_id: string`).
     - `pane.close` maps to `$defs.PaneTarget` (`pane_id: string`).
     - `worktree.remove` maps to `$defs.WorktreeRemoveParams` (`workspace_id: string`, `force: boolean = false`).
     - Success response result variant for teardown is `ResponseResult` with `{"type":"ok"}` (or `{"type":"worktree_removed",...}`).
     - Error response schema matches `ErrorResponse` with `id: string` and `error: {code: string, message: string}`.

4. **Empirical Lifecycle & Cascade Semantics Confirmed**:
   - **Sole pane closure cascades to tab**: Closing the single pane in a worker tab automatically destroys the tab (`Remaining tabs after pane close: [ "w21:t1" ]`, `Is w1TabId destroyed? true`).
   - **Sole tab closure cascades to workspace**: Closing the last remaining tab in a workspace implicitly destroys the workspace.
   - **Workspace closure cascades downward**: Closing a workspace destroys all contained tabs, panes, and pseudo-terminals atomically (`workspace get` returns `workspace_not_found`).
   - **Type safety on IDs**: Cross-target calls strictly rejected with exit code `1` (`tab close <pane_id>` -> `tab_not_found`, `workspace close <tab_id>` -> `workspace_not_found`, `pane close <tab_id>` -> `pane_not_found`).

5. **`HerdrWorkerRuntime` Code Gaps Re-Pinned Against HEAD**:
   - All line references in [`packages/herdr/src/client.ts`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts), [`packages/herdr/src/worker.ts`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/worker.ts), [`packages/orchestrator/src/coordinator.ts`](file:///Users/loopy/dev/ll3/loop/packages/orchestrator/src/coordinator.ts), [`packages/providers/src/herdr-agent.ts`](file:///Users/loopy/dev/ll3/loop/packages/providers/src/herdr-agent.ts), and [`packages/herdr/test/lifecycle.test.ts`](file:///Users/loopy/dev/ll3/loop/packages/herdr/test/lifecycle.test.ts) were re-checked and match exact symbols.

6. **`herdr agent` Interaction Contracts Newly Verified (2026-09-22 01:55 KST)**:
   - `agent read` prints raw pane text (no JSON envelope); `agent get` state field is `agent_status` (`result.agent.agent_status`); `agent prompt --wait` requires `--until done` for deterministic completion detection. Details in §1.G.

---

## Executive Summary

1. **Exact Supported Teardown Verbs**:
   Herdr CLI provides three granular close verbs and one Git-worktree-specific remove verb:
   - `herdr workspace close <workspace_id>`
   - `herdr tab close <tab_id>`
   - `herdr pane close <pane_id>`
   - `herdr worktree remove --workspace <workspace_id> [--force]` (applicable strictly to Herdr-managed Git worktrees)

2. **Absent Verbs (Exit Code 2)**:
   - No top-level `close`, `kill`, or `remove` verbs exist (`herdr close`, `herdr kill`, `herdr remove` exit `2`).
   - No `remove`, `delete`, or `kill` subcommands exist under `workspace`, `tab`, or `pane` (`herdr workspace remove`, `herdr tab kill`, etc. exit `2`).
   - No teardown verbs exist under `agent` (`herdr agent close`, `kill`, `stop`, or `remove` exit `2`). Agent authority is released via `pane release-agent`, while process termination occurs via `send-keys ctrl+c` or pane/tab closure.

3. **Standard Response Shapes**:
   - Successful teardown commands (`workspace close`, `tab close`, `pane close`) exit `0` and return standard JSON:
     `{"id":"cli:<subcommand>:close","result":{"type":"ok"}}`
   - Non-existent targets exit `1` and return standard structured errors:
     `{"id":"cli:<subcommand>:close","error":{"code":"<type>_not_found","message":"<type> <id> not found"}}`

4. **Observed Lifecycle & Cascade Semantics**:
   - **Pane closure cascades to tab**: Closing the sole pane in a tab implicitly destroys the tab.
   - **Tab closure cascades to workspace**: Closing the last remaining tab in a workspace implicitly destroys the workspace.
   - **Workspace closure cascades down**: Closing a workspace terminates all contained panes, destroys all constituent tabs, and removes the workspace atomically.
   - **Type safety on IDs**: Herdr rejects cross-target calls (passing a `pane_id` to `tab close` returns `tab_not_found`).

5. **Current `HerdrWorkerRuntime` Teardown Gaps**:
   - **Workspace leak**: When Loop creates an ephemeral workspace ([`#ensureWorkspace`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L256)), Herdr creates root Tab 1 (`t1`) and Pane 1 (`p1`). Worker tabs (`t2`, `t3`...) are created alongside it. When workers finish, closing worker panes removes `t2`, but `t1` and `p1` remain alive. The workspace is never closed and leaks permanently.
   - **Discarded `tab_id`**: [`HerdrWorkerHandle`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/worker.ts#L22) stores `workspaceId` and `paneId`, but drops `tab_id` from the `herdr tab create` response.
   - **Production omission**: [`HerdrWorkerRuntime.cleanup`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L172) (`pane close` + `#turns.delete`) is called in unit tests ([`lifecycle.test.ts:69`](file:///Users/loopy/dev/ll3/loop/packages/herdr/test/lifecycle.test.ts#L69)), but never invoked by the production orchestrator coordinator ([`coordinator.ts`](file:///Users/loopy/dev/ll3/loop/packages/orchestrator/src/coordinator.ts)) or provider wait loop ([`herdr-agent.ts:#wait`](file:///Users/loopy/dev/ll3/loop/packages/providers/src/herdr-agent.ts#L133)).
   - **In-memory turn map retention**: `HerdrWorkerRuntime.#turns` ([`client.ts:69`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L69)) tracks in-flight agent prompt promises; because `cleanup()` is not called in production, completed worker promises remain unpruned in memory.

6. **Least-Invasive Fallback Strategy**:
   - **Tier 1 (Per-Worker Cleanup)**: Programmatic `herdr tab close <tab_id>`. Cleanly removes worker tabs without risking caller workspaces.
   - **Tier 2 (Per-Run Workspace Teardown)**: Programmatic `herdr workspace close <workspace_id>` invoked at run termination **only when `input.caller` was undefined**.
   - **Tier 3 (Hanging Process Fallback)**: `herdr pane send-keys <pane_id> ctrl+c`, falling back to reading `shell_pid` / `foreground_processes[].pid` from `herdr pane process-info --pane <pane_id>` for POSIX signal escalation (`SIGTERM` → `SIGKILL`) prior to tab closure.

---

## 1. CLI Surface & Help Probe Results

All help probes were conducted offline against `herdr 0.8.2`.

### A. Top-Level Verbs
Probing top-level teardown verbs proves that Herdr does not accept top-level verbs:

| Command | Exit Code | Output / Behavior |
| --- | --- | --- |
| `herdr close` | `2` | `unknown command: close\nrun 'herdr --help' for usage` |
| `herdr kill` | `2` | `unknown command: kill\nrun 'herdr --help' for usage` |
| `herdr remove` | `2` | `unknown command: remove\nrun 'herdr --help' for usage` |

### B. `herdr workspace` Surface
Command probe: `herdr workspace --help`
Supported commands: `list`, `create`, `get`, `focus`, `rename`, `report-metadata`, `close`.

| Command / Subcommand | Exit Code | Observation |
| --- | --- | --- |
| `herdr workspace close <workspace_id>` | `0` (on help) | **Supported teardown verb**. Usage: `herdr workspace close <workspace_id>` |
| `herdr workspace remove` | `2` | **Absent**. Rejected with list of valid workspace commands. |
| `herdr workspace delete` | `2` | **Absent**. Rejected with list of valid workspace commands. |
| `herdr workspace kill` | `2` | **Absent**. Rejected with list of valid workspace commands. |

### C. `herdr tab` Surface
Command probe: `herdr tab --help`
Supported commands: `list`, `create`, `get`, `focus`, `rename`, `close`.

| Command / Subcommand | Exit Code | Observation |
| --- | --- | --- |
| `herdr tab close <tab_id>` | `0` (on help) | **Supported teardown verb**. Usage: `herdr tab close <tab_id>` |
| `herdr tab remove` | `2` | **Absent**. Rejected with list of valid tab commands. |
| `herdr tab delete` | `2` | **Absent**. Rejected with list of valid tab commands. |
| `herdr tab kill` | `2` | **Absent**. Rejected with list of valid tab commands. |

### D. `herdr pane` Surface
Command probe: `herdr pane --help`
Supported commands include: `list`, `current`, `get`, `layout`, `process-info`, `read`, `split`, `swap`, `move`, `close`, `send-keys`, `run`, `release-agent`, etc.

| Command / Subcommand | Exit Code | Observation |
| --- | --- | --- |
| `herdr pane close <pane_id>` | `0` (on help) | **Supported teardown verb**. Usage: `herdr pane close <pane_id>` |
| `herdr pane process-info [--pane ID\|--current]` | `0` (on help) | **Supported diagnostic verb**. Inspects child shell and foreground PIDs. |
| `herdr pane send-keys <pane_id> <key>...` | `0` (on help) | **Supported control verb**. Used for graceful `ctrl+c`. |
| `herdr pane release-agent <pane_id> --source ID --agent LABEL` | `0` (on help) | **Supported authority release verb**. Releases agent status on pane. |
| `herdr pane kill` | `2` | **Absent**. Rejected with list of valid pane commands. |
| `herdr pane remove` | `2` | **Absent**. Rejected with list of valid pane commands. |

### E. `herdr agent` Surface
Command probe: `herdr agent --help`
Supported commands: `list`, `get`, `read`, `send-keys`, `prompt`, `rename`, `focus`, `wait`, `attach`, `start`, `explain`.

| Command / Subcommand | Exit Code | Observation |
| --- | --- | --- |
| `herdr agent close` | `2` | **Absent**. |
| `herdr agent kill` | `2` | **Absent**. |
| `herdr agent stop` | `2` | **Absent**. |
| `herdr agent remove` | `2` | **Absent**. |

*Note*: Agent processes run within panes. Herdr manages agent lifecycle state detection automatically from terminal output. Releasing external authority is done via `herdr pane release-agent`, while terminating the process is done by closing the pane/tab or signaling via `send-keys ctrl+c`.

### F. `herdr worktree` Surface
Command probe: `herdr worktree --help`
Supported commands: `list`, `create`, `open`, `remove`.

| Command / Subcommand | Exit Code | Observation |
| --- | --- | --- |
| `herdr worktree remove --workspace <ID> [--force]` | `0` (on help) | **Supported for linked Git worktrees only**. |

*Validation*: Executing `herdr worktree remove --workspace <id>` against a standard workspace created via `herdr workspace create` fails with exit code `1`:
```json
{
  "id": "cli:worktree:remove",
  "error": {
    "code": "not_linked_worktree",
    "message": "workspace is not a Herdr-managed worktree checkout"
  }
}
```
Thus, `worktree remove` cannot be used as a generic workspace teardown command.

### G. `herdr agent` Interaction Contracts (Newly Verified Live, 2026-09-22)

Verified against a live `herdr 0.8.2` daemon using a local interactive `pi` session (`herdr agent start loop-verify --kind pi --pane <id>`, no prompt submitted — zero model calls), plus flag-validation probes against a nonexistent target:

| Contract | Verified Behavior |
| --- | --- |
| `herdr agent read <target>` | **Prints raw pane text** (terminal snapshot) directly to stdout — **no JSON envelope** (`{"id":...,"result":...}` is absent). Output formats are `text` (default) and `ansi` via `--format`; there is no JSON output mode (`--format bogus` → `invalid read format: bogus`). Options: `--source <visible\|recent\|recent-unwrapped\|detection>`, `--lines <N>`, `--format`, `--ansi`. |
| `herdr agent get <target>` | Returns the standard JSON envelope with agent state under **`result.agent.agent_status`** (e.g. `"agent_status":"idle"`; possible values `idle`, `working`, `blocked`, `done`, `unknown`). The target accepts the agent name or a `pane_id` interchangeably (both resolved to the same `agent_info` result). |
| `herdr agent prompt <target> <text> --wait` | `--wait` alone matches `idle`, `done`, or `blocked` by default, so an early `idle` can match before work starts; for deterministic completion detection pass **`--until done`** (`--until` validates against `idle, working, blocked, done, unknown`; any other value is rejected: `invalid agent status: bogus`). `--wait` requires an observed state change within 5000ms or fails `agent_prompt_stalled`; `--timeout <MS>` bounds the wait; submission to an already-blocked agent fails `agent_blocked`. |

Loop's code already encodes these contracts: `agent get` → `requiredString(..., ["result", "agent", "agent_status"])` at [`client.ts:125-129`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L125), and `agent prompt --wait --until done` at [`client.ts:237-238`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L237).

---

## 2. Wire Protocol & API Schema Shapes

Herdr exposes its full API schema via `herdr api schema --json`. The socket schema (`protocol 20`, `schema_version 1`) defines the exact JSON payload shapes for request methods and responses.

### Request Definitions (`schema.schemas.request`)

In `herdr api schema --json`, the `request.oneOf` array maps teardown methods to reusable parameter schemas in `request.$defs`:

```json
{
  "workspace.close": {
    "method": "workspace.close",
    "params": {
      "$ref": "#/schemas/request/$defs/WorkspaceTarget"
    }
  },
  "tab.close": {
    "method": "tab.close",
    "params": {
      "$ref": "#/schemas/request/$defs/TabTarget"
    }
  },
  "pane.close": {
    "method": "pane.close",
    "params": {
      "$ref": "#/schemas/request/$defs/PaneTarget"
    }
  },
  "worktree.remove": {
    "method": "worktree.remove",
    "params": {
      "$ref": "#/schemas/request/$defs/WorktreeRemoveParams"
    }
  }
}
```

Where the parameter `$defs` are:
```json
{
  "WorkspaceTarget": {
    "type": "object",
    "properties": { "workspace_id": { "type": "string" } },
    "required": ["workspace_id"]
  },
  "TabTarget": {
    "type": "object",
    "properties": { "tab_id": { "type": "string" } },
    "required": ["tab_id"]
  },
  "PaneTarget": {
    "type": "object",
    "properties": { "pane_id": { "type": "string" } },
    "required": ["pane_id"]
  },
  "WorktreeRemoveParams": {
    "type": "object",
    "properties": {
      "workspace_id": { "type": "string" },
      "force": { "type": "boolean", "default": false }
    },
    "required": ["workspace_id"]
  }
}
```

### Success Response Definitions (`schema.schemas.success_response`)

For `workspace.close`, `tab.close`, and `pane.close`, the result variant is `{"type": "ok"}`:
```json
{
  "id": "cli:<subcommand>:close",
  "result": {
    "type": "ok"
  }
}
```

For `worktree.remove`, the result variant is `worktree_removed`:
```json
{
  "id": "cli:worktree:remove",
  "result": {
    "type": "worktree_removed",
    "workspace_id": "string",
    "path": "string",
    "forced": "boolean"
  }
}
```

### Error Response Definitions (`schema.schemas.error_response`)

All error responses adhere to `ErrorResponse` with structured `ErrorBody`:
```json
{
  "id": "cli:<subcommand>:<verb>",
  "error": {
    "code": "string",
    "message": "string"
  }
}
```

---

## 3. Empirical Lifecycle & Edge Case Probes

The probe runner verified the exact behavior of resource creation, deletion, cascading effects, and error handling on live Herdr socket connections.

### A. Workspace Creation Shape
Command:
```bash
herdr workspace create --cwd /tmp --label loop-verify-teardown --no-focus
```
Live Response:
```json
{
  "id": "cli:workspace:create",
  "result": {
    "type": "workspace_created",
    "workspace": {
      "workspace_id": "w21",
      "label": "loop-verify-teardown",
      "number": 4,
      "tab_count": 1,
      "pane_count": 1,
      "active_tab_id": "w21:t1",
      "agent_status": "unknown",
      "focused": false
    },
    "tab": {
      "tab_id": "w21:t1",
      "workspace_id": "w21",
      "number": 1,
      "label": "1",
      "pane_count": 1,
      "agent_status": "unknown",
      "focused": false
    },
    "root_pane": {
      "pane_id": "w21:p1",
      "workspace_id": "w21",
      "tab_id": "w21:t1",
      "cwd": "/tmp",
      "foreground_cwd": "/tmp",
      "focused": false,
      "terminal_id": "term_65c024d9c79e6ca",
      "terminal_title": "loopy@Main:/tmp",
      "terminal_title_stripped": "loopy@Main:/tmp",
      "agent_status": "unknown",
      "scroll": {
        "viewport_rows": 58,
        "offset_from_bottom": 0,
        "max_offset_from_bottom": 0
      },
      "revision": 1
    }
  }
}
```
*Key Finding*: A workspace creation **always** initializes a root tab (`tab.tab_id`) and a root terminal pane (`root_pane.pane_id`).

### B. Tab Creation Shape
Command:
```bash
herdr tab create --workspace w21 --cwd /tmp --label worker-1 --no-focus
```
Live Response:
```json
{
  "id": "cli:tab:create",
  "result": {
    "type": "tab_created",
    "tab": {
      "tab_id": "w21:t2",
      "workspace_id": "w21",
      "number": 2,
      "label": "worker-1",
      "pane_count": 1,
      "agent_status": "unknown",
      "focused": false
    },
    "root_pane": {
      "pane_id": "w21:p2",
      "workspace_id": "w21",
      "tab_id": "w21:t2",
      "cwd": "/tmp",
      "foreground_cwd": "/tmp",
      "focused": false,
      "terminal_id": "term_65c024d9c8cf1d0",
      "terminal_title": "loopy@Main:/tmp",
      "terminal_title_stripped": "loopy@Main:/tmp",
      "agent_status": "unknown",
      "scroll": {
        "viewport_rows": 58,
        "offset_from_bottom": 0,
        "max_offset_from_bottom": 0
      },
      "revision": 1
    }
  }
}
```
*Key Finding*: Both `tab.tab_id` (`w21:t2`) and `root_pane.pane_id` (`w21:p2`) are returned in the response payload.

### C. Pane Close vs Tab Close Behavior
1. **Closing worker pane (`herdr pane close w21:p2`)**:
   - Exit Code: `0`
   - Stdout: `{"id":"cli:pane:close","result":{"type":"ok"}}`
   - Verification via `herdr tab list --workspace w21`:
     `{"tabs":[{"tab_id":"w21:t1","pane_count":1,"number":1}]}`
   - *Result*: Because worker tab `w21:t2` contained only one pane, closing that pane automatically removed `w21:t2` from the tab list (`Is w1TabId destroyed? true`).
2. **Closing worker tab directly (`herdr tab close w21:t3`)**:
   - Exit Code: `0`
   - Stdout: `{"id":"cli:tab:close","result":{"type":"ok"}}`
   - Verification via `herdr tab list --workspace w21`: Tab `w21:t3` was removed immediately (`Is w2TabId destroyed? true`).
3. **Closing the only pane in the root tab of a workspace**:
   - When `herdr pane close <root_pane_id>` is called on a workspace with no other tabs/panes, Herdr automatically destroys the root tab, and in turn destroys the workspace. Subsequent `herdr workspace get <ws_id>` returns `workspace_not_found`.

### D. Workspace Close Cascading Behavior
Command:
```bash
herdr workspace close w21
```
Live Response:
```json
{
  "id": "cli:workspace:close",
  "result": {
    "type": "ok"
  }
}
```
*Verification*: When `workspace close` was invoked on workspace `w21`:
- `herdr workspace get w21` exited `1` with `workspace_not_found`.
- Contained tabs and panes were removed immediately.
- *Result*: Workspace closure is **atomic and cascading**; it reliably cleans up all underlying tabs, panes, and pseudo-terminals without leaving orphan resources.

### E. ID Type Safety & Cross-Target Resistance
Herdr strictly verifies identifier types:

| Invocation | Exit Code | Stderr Payload |
| --- | --- | --- |
| `herdr tab close <pane_id>` | `1` | `{"error":{"code":"tab_not_found","message":"tab w21:p1 not found"},"id":"cli:tab:close"}` |
| `herdr tab close <workspace_id>` | `1` | `{"error":{"code":"tab_not_found","message":"tab w21 not found"},"id":"cli:tab:close"}` |
| `herdr workspace close <tab_id>` | `1` | `{"error":{"code":"workspace_not_found","message":"workspace w21:t1 not found"},"id":"cli:workspace:close"}` |
| `herdr pane close <tab_id>` | `1` | `{"error":{"code":"pane_not_found","message":"pane w21:t1 not found"},"id":"cli:pane:close"}` |

### F. Process Information & Non-Invasive Termination Surface
Command:
```bash
herdr pane process-info --pane <pane_id>
```
Live Response:
```json
{
  "id": "cli:pane:process_info",
  "result": {
    "type": "pane_process_info",
    "process_info": {
      "pane_id": "w21:p2",
      "shell_pid": 11663,
      "foreground_process_group_id": 11663,
      "foreground_processes": [
        {
          "pid": 11663,
          "name": "zsh",
          "argv": ["-zsh"],
          "argv0": "zsh",
          "cmdline": "-zsh",
          "cwd": "/tmp"
        }
      ]
    }
  }
}
```
Live test of `herdr pane send-keys <pane_id> ctrl+c`:
- Exit Code: `0`
- Stdout: empty
- Successfully delivers the interrupt signal to foreground processes without killing the pane or shell.

---

## 4. Current Gaps in `HerdrWorkerRuntime`

Inspection of [`packages/herdr/src/client.ts`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts) in conjunction with empirical probe observations reveals four distinct lifecycle leaks:

```text
┌──────────────────────────────────────────────────────────┐
│                   Herdr Daemon                           │
│                                                          │
│  Workspace: loop-<runId> (w21)                           │
│  ├─ Tab 1 (w21:t1) [Root / Unused]                       │
│  │   └─ Pane 1 (w21:p1) ──> NEVER CLOSED (LEAKED)        │
│  │                                                       │
│  ├─ Tab 2 (w21:t2) [Worker: loop-task-1]                 │
│  │   └─ Pane 2 (w21:p2) ──> closed via cleanup()         │
│  │                          (only in unit tests)         │
│  └─ Tab 3 (w21:t3) [Worker: loop-task-2]                 │
│      └─ Pane 3 (w21:p3) ──> closed via cleanup()         │
└──────────────────────────────────────────────────────────┘
```

1. **Root Tab 1 and Workspace Leaked Indefinitely**:
   - In [`HerdrWorkerRuntime.#ensureWorkspace`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L256-L276), `herdr workspace create` is executed when `input.caller` is missing.
   - Herdr creates `w21:t1` and `w21:p1`.
   - All actual work happens in subsequent worker tabs created by `herdr tab create` ([`client.ts:83-93`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L83)).
   - Neither `w21:p1`, nor `w21:t1`, nor `w21` is ever closed.
   - Even if all worker panes are closed, Workspace `w21` remains permanently open with idle `w21:t1`.

2. **`tab_id` is Dropped from `HerdrWorkerHandle`**:
   - [`HerdrWorkerRuntime.start`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L94-L101) extracts `paneId`:
     `const paneId = requiredString(tab, ["result", "root_pane", "pane_id"]);`
   - It ignores `tab.result.tab.tab_id`.
   - If a worker agent splits the pane during execution (e.g. debugging split), calling `pane close` on `paneId` only closes that specific pane, leaving the worker tab open. Tracking `tabId` enables `herdr tab close <tabId>` to close the entire worker container deterministically.

3. **`cleanup()` is Never Called in Production Orchestrator**:
   - [`HerdrWorkerRuntime.cleanup(handle)`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L172) exists and executes `herdr pane close <handle.paneId>`.
   - However, grep confirms `cleanup` is called exclusively in [`packages/herdr/test/lifecycle.test.ts:69`](file:///Users/loopy/dev/ll3/loop/packages/herdr/test/lifecycle.test.ts#L69). Neither [`Orchestrator`](file:///Users/loopy/dev/ll3/loop/packages/orchestrator/src/coordinator.ts) nor [`HerdrAgentProvider`](file:///Users/loopy/dev/ll3/loop/packages/providers/src/herdr-agent.ts) invokes `cleanup` upon task completion or run termination.

4. **In-Memory `#turns` Map Accumulation**:
   - [`HerdrWorkerRuntime`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L69) maintains `readonly #turns = new Map<string, Promise<void>>()`.
   - When interactive agents are launched with `waitForPrompt: true`, `#launch` registers the in-flight prompt turn promise at line 246 (`#turns.set(handle.workerId, turn)`).
   - `wait(handle)` awaits the turn promise ([`client.ts:119`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L119)).
   - Pruning only occurs in `cleanup(handle)` at line 183 (`this.#turns.delete(handle.workerId)`).
   - Because `cleanup` is never called in production, every interactive worker turn retains an entry in `#turns` indefinitely.

---

## 5. Least-Invasive Programmatic Removal Proposal

To prevent surface accumulation while strictly preserving user interactive sessions, teardown must distinguish between **worker scope** and **run scope**.

### Escalation & Isolation Hierarchy

```text
Run Scope Decision
 ├── input.caller exists (User / Lead pane inside Herdr)
 │    └── NEVER close workspace
 │    └── Teardown per worker: herdr tab close <tabId>
 └── input.caller undefined (Loop created ephemeral workspace)
      └── Teardown per worker: herdr tab close <tabId> (or batch)
      └── Teardown at run completion: herdr workspace close <workspaceId>
```

### Tier 1: Worker Teardown via `herdr tab close <tab_id>` (Least Invasive)
- **Applicability**: Run completion of individual workers, whether running in a caller's existing workspace or in an ephemeral Loop workspace.
- **Implementation**:
   1. Add `tabId: string` to [`HerdrWorkerHandle`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/worker.ts#L22):
      ```ts
      export interface HerdrWorkerHandle {
        workerId: string;
        workspaceId: string;
        tabId: string;
        paneId: string;
        taskId: string;
        agentName?: string;
      }
      ```
   2. Populate `tabId` in [`HerdrWorkerRuntime.start`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L94):
      ```ts
      const tabId = requiredString(tab, ["result", "tab", "tab_id"]);
      const paneId = requiredString(tab, ["result", "root_pane", "pane_id"]);
      ```
   3. Update [`HerdrWorkerRuntime.cleanup`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L172):
      ```ts
      async cleanup(handle: HerdrWorkerHandle): Promise<void> {
        validateHandle(handle);
        await this.#run(["tab", "close", handle.tabId]);
        this.#turns.delete(handle.workerId);
      }
      ```
- **Why it is least-invasive**:
   - Closing by `tab_id` ensures all split panes within the worker's tab are torn down in one command.
   - Leaves the caller's other tabs, lead agent, and user terminals untouched.

### Tier 2: Run Teardown via `herdr workspace close <workspace_id>`
- **Applicability**: End-of-run cleanup when Loop created its own dedicated workspace (`input.caller === undefined`).
- **Implementation**:
   1. Expose a run-level teardown method on `HerdrWorkerRuntime`:
      ```ts
      async teardownWorkspace(runId: string): Promise<void> {
        const cached = this.#workspaces.get(runId);
        if (!cached) return;
        await this.#run(["workspace", "close", cached.workspaceId]).catch(() => undefined);
        this.#workspaces.delete(runId);
      }
      ```
   2. Wire into [`Orchestrator.run`](file:///Users/loopy/dev/ll3/loop/packages/orchestrator/src/coordinator.ts#L55) `finally` block or completion handler.
- **Safety Invariant**: If `input.caller` was present, `cached` is never populated for that run, guaranteeing the caller's workspace cannot be closed.

### Tier 3: Unresponsive Process Fallback Ladder
If a worker process hangs or traps termination signals during worker cancel:
1. **Level 1 (Soft Interrupt)**:
   `herdr pane send-keys <handle.paneId> ctrl+c` (Current `cancel()` behavior).
2. **Level 2 (Process Inspection & SIGTERM)**:
   If status does not transition within timeout (e.g. 3000ms), query `herdr pane process-info --pane <handle.paneId>`. If `foreground_processes` contains active PIDs other than the login shell, issue `process.kill(pid, "SIGTERM")`.
3. **Level 3 (Force Closure)**:
   Issue `herdr tab close <handle.tabId>`. This closes the pseudo-terminal device file (PTY), causing SIGHUP to be delivered to the process group, terminating child processes cleanly at the OS kernel level.

---

## 6. Verification Checklist for Implementation

When implementing the teardown methods in Loop:
- [ ] Run `bun test packages/herdr` with mock runner asserting `["tab", "close", "w1:t2"]` call.
- [ ] Run `bun test packages/orchestrator` verifying `cleanup` is called on worker completion.
- [ ] Verify `teardownWorkspace` executes `["workspace", "close", "w1"]` when `caller` is undefined.
- [ ] Verify `teardownWorkspace` is a no-op when `caller` was specified.
- [ ] Run `bun run test:architecture` to ensure no boundary leaks.
