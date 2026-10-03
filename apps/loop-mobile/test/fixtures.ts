/**
 * Recorded contract fixtures for the mock gateway.
 *
 * Payloads follow docs/decisions/2026-xx-remote-app-architecture.md §4 verbatim
 * (u64 as decimal string, RFC 3339 UTC timestamps, opaque IDs). The type
 * annotations pin the fixtures to the wire seam surface, so a contract change
 * fails compilation here before it can fail at runtime.
 */

import type {
  RemotePaneListOutput,
  RemotePaneResetEvent,
  RemotePaneTextEvent,
  RemoteRun,
  RemoteRunOutputEvent,
  RemoteRunPage,
  RemoteRunResetEvent,
  RemoteRunStatusEvent,
  RemoteRunTerminalEvent,
  SubmitPromptAccepted,
} from "../src/gateway-client/wire";

export const TOKEN = "mock-bearer-token"; // test-only; never written to disk

export const RUN_ID = "run_01JMOBILEFIXTURE0001";
export const OLD_RUN_ID = "run_01JMOBILEFIXTURE0000";

const zeroCounts = { pending: 0, running: 0, attention: 0, done: 0, failed: 0, cancelled: 0 };

export const ACCEPTED: SubmitPromptAccepted = {
  run: {
    runId: RUN_ID,
    status: "accepted",
    terminal: false,
    createdAt: "2026-09-25T03:14:15.926Z",
    updatedAt: "2026-09-25T03:14:15.926Z",
    lastSequence: null,
    taskCounts: zeroCounts,
  },
};

const runningRun: RemoteRun = {
  runId: RUN_ID,
  status: "running",
  terminal: false,
  createdAt: "2026-09-25T03:14:15.926Z",
  updatedAt: "2026-09-25T03:14:19.004Z",
  lastSequence: "42",
  taskCounts: { pending: 1, running: 2, attention: 0, done: 3, failed: 0, cancelled: 0 },
  tasks: [{ taskId: "gateway-app", status: "running", attempt: 1, summary: null }],
  attention: null,
};

/** GET /v1/runs page: newest first, nextCursor null. */
export const RUN_PAGE: RemoteRunPage = {
  runs: [
    runningRun,
    {
      runId: OLD_RUN_ID,
      status: "completed",
      terminal: true,
      createdAt: "2026-09-25T02:00:00.000Z",
      updatedAt: "2026-09-25T02:05:00.000Z",
      lastSequence: "128",
      taskCounts: { pending: 0, running: 0, attention: 0, done: 2, failed: 0, cancelled: 0 },
    },
  ],
  nextCursor: null,
};

/** GET /v1/runs/{runId}: attention projection with oldest-open attention. */
export const RUN: RemoteRun = {
  ...runningRun,
  status: "attention",
  updatedAt: "2026-09-25T03:14:30.112Z",
  lastSequence: "57",
  taskCounts: { pending: 0, running: 1, attention: 1, done: 4, failed: 0, cancelled: 0 },
  attention: {
    attentionId: "attn_01JMOBILEFIXTURE0001",
    taskId: "gateway-auth",
    kind: "decision",
    message: "Select the tailnet ACL policy",
  },
};

/** SSE frames: id is an opaque gateway cursor; client never parses it. */
export const STATUS_FRAME: RemoteRunStatusEvent = {
  version: 1,
  runId: RUN_ID,
  occurredAt: "2026-09-25T03:14:19.004Z",
  run: runningRun,
};

export const OUTPUT_FRAME_1: RemoteRunOutputEvent = {
  version: 1,
  runId: RUN_ID,
  occurredAt: "2026-09-25T03:14:19.104Z",
  taskId: "gateway-app",
  activityId: "57:gateway-app:3",
  text: "gateway listening on tailnet",
  truncated: false,
};

export const OUTPUT_FRAME_2: RemoteRunOutputEvent = {
  version: 1,
  runId: RUN_ID,
  occurredAt: "2026-09-25T03:14:20.000Z",
  taskId: "gateway-app",
  activityId: "57:gateway-app:4",
  text: "submitted plan with 3 tasks",
  truncated: false,
};

export const RESET_FRAME: RemoteRunResetEvent = {
  version: 1,
  runId: RUN_ID,
  occurredAt: "2026-09-25T03:15:00.000Z",
  reason: "cursor_unavailable",
  run: runningRun,
};

export const TERMINAL_FRAME: RemoteRunTerminalEvent = {
  version: 1,
  runId: RUN_ID,
  occurredAt: "2026-09-25T03:16:00.000Z",
  run: {
    ...runningRun,
    status: "completed",
    terminal: true,
    updatedAt: "2026-09-25T03:16:00.000Z",
    lastSequence: "50",
    taskCounts: { pending: 0, running: 0, attention: 0, done: 6, failed: 0, cancelled: 0 },
  },
};

export const FRAME_IDS = {
  status: "gen1-n1",
  output1: "gen1-n2",
  output2: "gen1-n3",
  terminal: "gen1-n4",
  reset: "gen2-n1",
} as const;

// ——— Terminal mirror v1 pane fixtures (decision 2026-xx-terminal-mirror) ———

export const PANE_ID = "w1:pT1";

export const PANE_LIST: RemotePaneListOutput = {
  panes: [
    {
      paneId: PANE_ID,
      label: "pi worker — loop",
      taskId: null,
      workspaceId: "w1",
      state: "active",
    },
    {
      paneId: "w1:pNoSrc",
      label: "pi -p worker",
      taskId: null,
      workspaceId: "w1",
      state: "unknown", // lifecycle-only lane
    },
  ],
};

export const PANE_TEXT_1: RemotePaneTextEvent = {
  paneId: PANE_ID,
  revision: "7",
  text: "› Reading crates/loop-core/src/lib.rs\n Thinking…",
  truncated: false,
  occurredAt: "2026-09-25T12:00:00.000Z",
};

export const PANE_TEXT_2: RemotePaneTextEvent = {
  paneId: PANE_ID,
  revision: "8",
  text: "› Reading crates/loop-core/src/lib.rs\n Thinking…\n● tool: read(path=…)",
  truncated: false,
  occurredAt: "2026-09-25T12:00:01.000Z",
};

export const PANE_RESET_CURSOR: RemotePaneResetEvent = {
  ...PANE_TEXT_2,
  reason: "cursorUnavailable",
};

export const PANE_GONE: RemotePaneResetEvent = {
  paneId: PANE_ID,
  reason: "paneGone",
  revision: "8",
  text: "",
  truncated: false,
  occurredAt: "2026-09-25T12:00:30.000Z",
};

export const PANE_FRAMES = {
  list: PANE_LIST,
  texts: [PANE_TEXT_1, PANE_TEXT_2],
  resetCursor: PANE_RESET_CURSOR,
  gone: PANE_GONE,
} as const;

/** Pane SSE frame ids: revision strings double as mock replay cursors. */
export const PANE_FRAME_IDS = {
  text: (index: number): string => String(PANE_FRAMES.texts[index]?.revision ?? ""),
  gone: "pane-gone-n3",
  reset: "pane-reset-n0",
} as const;
