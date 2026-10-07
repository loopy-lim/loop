/**
 * Run projection — reduces the SSE stream into display state (ADR §5.3).
 *
 * - `status` events replace the authoritative run state.
 * - `output` events append bounded activity text, deduped by `activityId`.
 * - `reset` events replace the authoritative run; previously observed output
 *   is kept but marked as a previous observation (loss recovery is not
 *   guaranteed).
 * - `terminal` events replace the run, mark it terminal, and end observation.
 */

import type {
  RemoteRun,
  RemoteRunOutputEvent,
  RemoteRunResetEvent,
  RemoteRunStatusEvent,
  RemoteRunTerminalEvent,
} from "../gateway-client/wire";

export type OutputEntry = {
  activityId: string;
  taskId: string;
  text: string;
  truncated: boolean;
};

export type RunProjectionState = {
  run: RemoteRun | null;
  outputs: OutputEntry[];
  /** True after a reset event until the next status/output confirms continuity. */
  stale: boolean;
  terminal: boolean;
};

export class RunProjection {
  private state: RunProjectionState;

  constructor(readonly runId: string) {
    this.state = { run: null, outputs: [], stale: false, terminal: false };
  }

  snapshot(): RunProjectionState {
    return this.state;
  }

  applyStatus(event: RemoteRunStatusEvent): void {
    this.assertRun(event.run.runId);
    this.state = { ...this.state, run: event.run, stale: false };
  }

  applyOutput(event: RemoteRunOutputEvent): void {
    this.assertRun(event.runId);
    if (this.state.outputs.some((entry) => entry.activityId === event.activityId)) {
      return; // dedupe by opaque activityId
    }
    const entry: OutputEntry = {
      activityId: event.activityId,
      taskId: event.taskId,
      text: event.text,
      truncated: event.truncated,
    };
    this.state = { ...this.state, outputs: [...this.state.outputs, entry] };
  }

  applyReset(event: RemoteRunResetEvent): void {
    this.assertRun(event.run.runId);
    // Authoritative status wins; kept output becomes a previous observation.
    this.state = { ...this.state, run: event.run, stale: true };
  }

  applyTerminal(event: RemoteRunTerminalEvent): void {
    this.assertRun(event.run.runId);
    this.state = { ...this.state, run: event.run, stale: false, terminal: true };
  }

  private assertRun(runId: string): void {
    if (runId !== this.runId) {
      throw new Error(`event for run ${runId} delivered to projection of run ${this.runId}`);
    }
  }
}
