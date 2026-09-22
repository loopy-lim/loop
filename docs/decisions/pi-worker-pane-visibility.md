# Pi Worker Pane Visibility

- **Date:** 2026-09-22
- **Status:** decided
- **Kind:** decision

## Root Cause Summary
When Loop is driven from the Pi Lead, dispatched pi worker tasks remain invisible in Herdr's left pane list. The `research-pi-pane-path` dependency shows that `codex` and `agy` are visible because they properly route through the `visibleAgent -> HerdrAgentProvider` path in interactive mode. While `pi` providers use this same interactive mode, they suffer from placement, race, and teardown issues in `packages/providers/src/herdr-agent.ts` and `packages/herdr/src/client.ts`. By default, they run headlessly or in disjoint ephemeral workspaces.

## Chosen Fix
Route pi workers through Herdr agent `kind=pi` so they appear identically to `codex` and `agy` workers by maintaining `mode="interactive"` and performing the following specific fixes:
1. Pass caller information (`workspaceId` from `HERDR_WORKSPACE_ID` and `paneId` from the lead pane) during worker startup so worker tabs properly open in the lead's workspace, leveraging existing `HerdrCaller` plumbing.
2. Coalesce `#ensureWorkspace` with an in-flight promise map in `HerdrWorkerRuntime` to resolve race conditions on simultaneous worker dispatch.
3. Guarantee proper teardown (`closeWorkspace`) at run end or on owner exit, avoiding leaked background headless providers.

## Exact Files to Change
- `packages/providers/src/herdr-agent.ts`
- `packages/herdr/src/client.ts`

## Deterministic In-Repo Test Plan
Create a deterministic offline fake Herdr test in the repository that instantiates a Herdr caller to test the pipeline end-to-end. This test must assert that the worker is dispatched correctly to the lead's workspace and teardown happens safely on exit. The test must mock Herdr responses, make no paid model calls, and execute without requiring a real live Herdr daemon during unit test runs.

## Smoke Check

```bash
bun run build:cli && \
  WORKSPACE_ID=$(herdr workspace create --cwd $(pwd) --label throwaway-pi-pane-test --no-focus | jq -r .result.workspace.workspace_id) && \
  ROOT_PANE=$(herdr pane list --workspace $WORKSPACE_ID | jq -r '.result.panes[0].pane_id') && \
  (HERDR_WORKSPACE_ID=$WORKSPACE_ID HERDR_PANE_ID=$ROOT_PANE bun -e '
    import { HerdrAgentProvider } from "./packages/providers/src/herdr-agent.ts";
    import { HerdrWorkerRuntime } from "./packages/herdr/src/client.ts";
    import { execSync } from "node:child_process";
    
    const provider = new HerdrAgentProvider({
      id: "pi-test",
      runtime: new HerdrWorkerRuntime(),
      kind: "pi",
      projectRoot: process.cwd(),
      computeClasses: []
    });
    
    const handle = await provider.start({
      runId: "smoke", taskId: "smoke", attempt: 0,
      context: { intent: "smoke", task: { id: "smoke", title: "smoke", kind: "task", readScope: [], writeScope: [], requirements: [], completionChecks: [] }, attempt: 0, workingDirectory: process.cwd(), guidance: [], dependencyResults: [], previousChecks: [] }
    } as any);
    
    const panes = execSync(`herdr pane list --workspace ${process.env.HERDR_WORKSPACE_ID}`).toString();
    if (!panes.includes(handle.id)) {
      console.error("Pane not visible!");
      process.exit(1);
    }
    
    await provider.cancel(handle.id);
    await provider.release(handle.id);
  ' ; STATUS=$?; herdr workspace close $WORKSPACE_ID > /dev/null; exit $STATUS)
```
