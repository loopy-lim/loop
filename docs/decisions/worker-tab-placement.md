# Worker Tab Placement and Leak Cleanup Policy

- **Date:** 2026-09-22
- **Status:** decided
- **Kind:** decision
- **Read scope:** `packages/herdr/src/client.ts`, `packages/providers/src/herdr-agent.ts`
- **Write scope:** This decision record (for now). Implementation will modify the specified files.

## Decision

### 1. Tab Placement Policy

- **Derivation Rule:** When Loop is invoked from a Herdr pane, it MUST derive the caller `workspaceId` from the `HERDR_PANE_ID` environment variable prefix (e.g., `w16:p3` -> `w16`).
- **Placement:** Using the derived caller workspace, open each worker as a new tab within that same workspace via `herdr tab create`.
- **Fallback:** When no Herdr context exists (no `HERDR_PANE_ID`), fall back to creating a single labeled Loop workspace per run using `ensureWorkspace`.
- **Label Format:** The worker tab label format must incorporate both the run ID and task ID (e.g., `${runId}-${taskId}`) to maintain clear provenance for each worker tab within a shared workspace.

### 2. Leak Cleanup Mechanism

- **Purge Target:** Leaked Loop-created Herdr workspaces must be identified strictly by their generated label prefix (`loop-loop-<uuid>`).
- **Safety:** The purge mechanism must never touch user-owned workspaces (i.e., those missing the specific internal label prefix).
- **Execution:** The cleanup will be integrated into the `loop cleanup` command. Mirroring existing Loop cleanup conventions, the workspace purge must be a **dry-run by default**. Actual deletion of leaked workspaces will only occur when the `--execute` flag is passed.

## Files to Change

- `packages/providers/src/herdr-agent.ts`: Add logic to parse `process.env.HERDR_PANE_ID` and extract the prefix as `callerWorkspaceId` so the caller context is correctly passed down.
- `packages/cli/src/main.ts` (or relevant cleanup module): Extend `loop cleanup` to fetch the workspace list via the Herdr CLI and close matching leaked `loop-loop-*` workspaces.

## Smoke Check

```bash
#!/bin/bash
set -ex

# 1. Build loop
bun run build

# 2. Create throwaway workspace
WORKSPACE_JSON=$(herdr workspace create --cwd . --label temp-smoke-test-$$ --no-focus)
W=$(echo "$WORKSPACE_JSON" | jq -r .result.workspace.workspace_id)
P=$(echo "$WORKSPACE_JSON" | jq -r .result.root_pane.pane_id)

# 3. Create script to dispatch worker with caller
cat << TS_EOF > test-dispatch.ts
import { HerdrWorkerRuntime } from "./packages/herdr/src/client.ts";
async function main() {
  const runtime = new HerdrWorkerRuntime();
  await runtime.start({
    projectRoot: process.cwd(),
    runId: "smoke-$$",
    taskId: "tab-$$",
    attempt: 0,
    worktree: process.cwd(),
    execution: { type: "agent", kind: "codex", args: [] },
    prompt: "",
    waitForPrompt: false,
    caller: { workspaceId: process.env.W!, paneId: process.env.P! }
  });
}
main();
TS_EOF

# Run it
W=$W P=$P bun test-dispatch.ts

# 4. Prove worker tab landed via read-only tab list
herdr tab list --workspace $W | grep -q "loop-tab-$$"

# 5. Verify leak purge path (create dummy leak, list it, remove it)
herdr workspace create --cwd . --label loop-loop-leak-$$ --no-focus > /dev/null
LEAKS=$(herdr workspace list | jq -r '.result.workspaces[] | select(.label | startswith("loop-loop-")) | .workspace_id')
test -n "$LEAKS"
echo "$LEAKS" | xargs -I {} herdr workspace close {} > /dev/null

# 6. Remove throwaway workspace
herdr workspace close $W > /dev/null
rm test-dispatch.ts
```
