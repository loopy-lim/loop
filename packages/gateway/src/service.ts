/**
 * GatewayService — the adapter-local run registry and projection pump
 * (ADR §4.3–§4.5, §5 interface).
 *
 * Owns the transient submission registry (`accepted`/`planning` before a
 * durable Loop run exists), the per-run projection cache, and the mapping of
 * snapshot changes onto SSE log events. Depends only on injected ports
 * (runtime, planner, clock, id factory) and the generated protocol types;
 * it never sees HTTP, Tailscale, or provider concepts.
 */

import type { RunState, SnapshotOutput } from "@loop/protocol";

import { encodeListCursor } from "./cursor";
import { RunEventLog, type OutboundFrame } from "./events";
import { ProblemError } from "./problem";
import {
  envelope,
  failedSubmissionRun,
  isTerminalStatus,
  iso,
  projectNewActivities,
  projectSnapshot,
  submissionRun,
} from "./projection";
import type { ClientContext, RemoteRun, RemoteRunPage, RemoteRunSummary } from "./wire";

/** Narrow LoopRuntime seam the gateway is allowed to know. */
export interface RunRuntimePort {
  snapshot(runId: string): Promise<SnapshotOutput>;
  subscribe(runId: string, listener: (snapshot: SnapshotOutput) => void): () => void;
  /** Durable run registry of the Loop store (`protocol.listRuns`). */
  listRuns(): Promise<{ runId: string; state: RunState }[]>;
}

/** Planner progress callbacks; the only surface the planner may touch. */
export interface PlanningHandle {
  markPlanning(runId: string): void;
  planningFailed(runId: string): void;
}

/** Raw-prompt seam (ADR §5: prompt planner / Pi adapter lives elsewhere). */
export interface PromptPlannerPort {
  begin(
    input: { runId: string; prompt: string; clientContext: ClientContext | null },
    handle: PlanningHandle,
  ): void;
  /** Reclaim an active run whose durable execution lease has expired. */
  recover?(runId: string): Promise<void>;
}

export type GatewayServiceOptions = {
  runtime: RunRuntimePort;
  planner: PromptPlannerPort;
  log: RunEventLog;
  nowMs?: () => number;
  runIdFactory?: () => string;
  planningLimit: number;
};

type RunRecord = {
  runId: string;
  createdAtMs: number;
  updatedAtMs: number;
  phase: "submission" | "planning" | "durable" | "failed";
  cache: RemoteRun | null;
  previousActivities: Map<string, string[]>;
  lastEmittedRunJson: string | null;
  terminalEmitted: boolean;
  stopPump: (() => void) | null;
};

/** First-seen projection cache for a durable run created outside this
 * gateway (CLI/terminal Loop); the store, not this registry, owns its truth. */
type DurableEntry = {
  createdAtMs: number;
  cache: RemoteRun | null;
};

/** Status-content fingerprint; `updatedAt` is deliberately excluded so that
 * unchanged projections never repeat as status events (ADR §4.5). */
function statusFingerprint(run: RemoteRun): string {
  return JSON.stringify({
    status: run.status,
    lastSequence: run.lastSequence,
    taskCounts: run.taskCounts,
    tasks: run.tasks,
    attention: run.attention,
  });
}

export class GatewayService {
  readonly #runtime: RunRuntimePort;
  readonly #planner: PromptPlannerPort;
  readonly #log: RunEventLog;
  readonly #nowMs: () => number;
  readonly #runIdFactory: () => string;
  readonly #planningLimit: number;
  readonly #runs = new Map<string, RunRecord>();
  readonly #durable = new Map<string, DurableEntry>();
  readonly #recovering = new Set<string>();

  constructor(options: GatewayServiceOptions) {
    this.#runtime = options.runtime;
    this.#planner = options.planner;
    this.#log = options.log;
    this.#nowMs = options.nowMs ?? Date.now;
    this.#runIdFactory = options.runIdFactory ?? defaultRunId;
    this.#planningLimit = options.planningLimit;
    if (this.#planner.recover) {
      const timer = setInterval(() => void this.reapExpiredLeases(), 1000);
      timer.unref();
    }
  }

  /** Scan durable state, not the projection cache: a crashed owner has no pump. */
  async reapExpiredLeases(): Promise<void> {
    if (!this.#planner.recover) return;
    try {
      for (const row of await this.#runtime.listRuns()) {
        if (row.state !== "active" || this.#recovering.has(row.runId)) continue;
        const snapshot = await this.#runtime.snapshot(row.runId);
        if (snapshot.state !== "active" || Number(snapshot.executionExpiresAt ?? 0) > this.#nowMs()) continue;
        this.#recovering.add(row.runId);
        void this.#planner.recover(row.runId).catch(() => {}).finally(() => this.#recovering.delete(row.runId));
      }
    } catch {
      // Transient store failure: the next scan retries.
    }
  }

  get log(): RunEventLog {
    return this.#log;
  }

  /** POST /v1/runs core: register → accepted status → hand off to planner. */
  submit(prompt: string, clientContext: ClientContext | null): RemoteRunSummary {
    if (this.#inFlightPlanning() >= this.#planningLimit) {
      throw new ProblemError(429, "capacity_exhausted");
    }
    const now = this.#nowMs();
    const runId = this.#runIdFactory();
    const record: RunRecord = {
      runId,
      createdAtMs: now,
      updatedAtMs: now,
      phase: "submission",
      cache: null,
      previousActivities: new Map(),
      lastEmittedRunJson: null,
      terminalEmitted: false,
      stopPump: null,
    };
    this.#runs.set(runId, record);
    this.#emitStatus(
      record,
      submissionRun({ runId, phase: "accepted", createdAtMs: now, updatedAtMs: now }),
    );

    try {
      this.#planner.begin(
        { runId, prompt, clientContext },
        {
          markPlanning: (id) => this.#markPlanning(id),
          planningFailed: (id) => this.#planningFailed(id),
        },
      );
    } catch {
      // Fail closed without leaking planner internals (ADR §4.6).
      this.#runs.delete(runId);
      this.#log.forget(runId);
      throw new ProblemError(503, "planner_unavailable");
    }

    this.#startPump(record);
    return this.#summaryOf(record);
  }

  /**
   * GET /v1/runs core: transient submissions merged with the store's durable
   * run registry (decision D3). Durable rows are projected per-run through
   * `snapshot`; a row whose snapshot fails without a cached projection is
   * skipped — list availability beats per-row completeness. Ordering and the
   * opaque cursor follow ADR §4.4 (createdAt desc, runId desc tie-break).
   */
  async listRuns(page: {
    limit: number;
    cursor: { createdAtMs: number; runId: string } | null;
  }): Promise<RemoteRunPage> {
    const now = this.#nowMs();
    let durable: { runId: string; state: RunState }[] = [];
    try {
      durable = await this.#runtime.listRuns();
    } catch {
      // Store bridge unavailable: degrade to the transient registry (ADR §4.5
      // reset semantics keep clients convergent on the next successful call).
    }
    for (const entry of durable) {
      if (!this.#runs.has(entry.runId) && !this.#durable.has(entry.runId)) {
        this.#durable.set(entry.runId, { createdAtMs: now, cache: null });
      }
    }

    type Row = {
      runId: string;
      createdAtMs: number;
      record: RunRecord | null;
      entry: DurableEntry | null;
    };
    const rows: Row[] = [];
    for (const record of this.#runs.values()) {
      rows.push({ runId: record.runId, createdAtMs: record.createdAtMs, record, entry: null });
    }
    for (const [runId, entry] of this.#durable) {
      if (!this.#runs.has(runId))
        rows.push({ runId, createdAtMs: entry.createdAtMs, record: null, entry });
    }
    rows.sort((a, b) => {
      if (b.createdAtMs !== a.createdAtMs) return b.createdAtMs - a.createdAtMs;
      if (a.runId < b.runId) return 1;
      if (a.runId > b.runId) return -1;
      return 0;
    });

    const cursor = page.cursor;
    const filtered =
      cursor === null
        ? rows
        : rows.filter(
            (row) =>
              row.createdAtMs < cursor.createdAtMs ||
              (row.createdAtMs === cursor.createdAtMs && row.runId < cursor.runId),
          );
    const slice = filtered.slice(0, page.limit);

    const runs: RemoteRunSummary[] = [];
    let lastRow: Row | null = null;
    for (const row of slice) {
      const entry = row.entry;
      const summary =
        row.record !== null
          ? this.#summaryOf(row.record)
          : entry === null
            ? null // store row without durable cache: skip (matches Row invariant breach safely)
            : await this.#refreshDurable(row.runId, entry);
      if (summary === null) continue; // store row unavailable with no cache: skip (decision D3)
      runs.push(summary);
      lastRow = row;
    }
    const nextCursor =
      lastRow !== null && filtered.length > page.limit
        ? encodeListCursor({ createdAtMs: lastRow.createdAtMs, runId: lastRow.runId })
        : null;
    return { runs, nextCursor };
  }

  /** Refresh one durable row's projection; null when unavailable with no cache. */
  async #refreshDurable(runId: string, entry: DurableEntry): Promise<RemoteRunSummary | null> {
    try {
      const snapshot = await this.#runtime.snapshot(runId);
      entry.cache = projectSnapshot(snapshot, this.#nowMs());
    } catch {
      // Keep the last good projection; without one, skip the row (decision D3).
      if (entry.cache === null) return null;
    }
    const run = entry.cache;
    if (run === null) return null;
    return {
      runId: run.runId,
      status: run.status,
      terminal: run.terminal,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      lastSequence: run.lastSequence,
      taskCounts: run.taskCounts,
    };
  }

  /** GET /v1/runs/{runId} core: authoritative refresh, cache fallback.
   * Durable runs created outside this gateway are adopted on first read. */
  async getRun(runId: string): Promise<RemoteRun> {
    const existing = this.#runs.get(runId);
    const record = existing ?? (await this.#adopt(runId));
    if (record === null) throw new ProblemError(404, "run_not_found");
    if (record.phase === "durable" && !record.terminalEmitted) {
      try {
        const snapshot = await this.#runtime.snapshot(runId);
        this.#absorb(record, snapshot);
      } catch {
        if (record.cache === null) throw new ProblemError(503, "runtime_unavailable");
      }
    }
    return this.#runOf(record);
  }

  /**
   * SSE /events core. The intro computation and the live subscription happen
   * back-to-back after any adoption so no frame can slip between them.
   */
  async observeRun(
    runId: string,
    lastEventId: string | null,
  ): Promise<{
    intro: OutboundFrame[];
    terminalAfterIntro: boolean;
    listen(listener: (frame: OutboundFrame) => void): () => void;
  }> {
    const record = this.#runs.get(runId) ?? (await this.#adopt(runId));
    if (record === null) throw new ProblemError(404, "run_not_found");
    const replay = this.#log.replay(runId, lastEventId);
    const current = this.#runOf(record);

    const intro: OutboundFrame[] = [];
    if (replay.reset) {
      intro.push({
        id: this.#log.cursorAtHead(runId),
        event: "reset",
        data: { ...envelope(runId, this.#nowMs()), reason: "cursor_unavailable", run: current },
      });
    } else if (lastEventId === null) {
      intro.push({
        id: this.#log.cursorAtHead(runId),
        event: "status",
        data: statusData(runId, this.#nowMs(), current),
      });
      // The leading status is followed by the run's buffered output history:
      // a real run's worker output can land between the submission and this
      // connect, and a fresh client must still observe it (decision D4;
      // clients dedupe by activityId). Read synchronously with the live
      // subscription below so no appended frame can slip between the two.
      intro.push(...this.#log.bufferedOutputs(runId));
    } else {
      intro.push(...replay.frames);
    }

    // A reconnecting client that already saw the historical terminal frame
    // never reconnects; one that missed it needs the closure signal.
    if (record.terminalEmitted && !intro.some((frame) => frame.event === "terminal")) {
      intro.push({
        id: this.#log.cursorAtHead(runId),
        event: "terminal",
        data: statusData(runId, this.#nowMs(), current),
      });
    }

    return {
      intro,
      terminalAfterIntro: record.terminalEmitted,
      listen: (listener) => this.#log.subscribe(runId, listener),
    };
  }

  /**
   * Authoritative reset frame for a slow consumer: latest run plus a fresh
   * cursor. The HTTP layer writes it after SseClientStream drops outputs.
   */
  slowConsumerReset(runId: string): OutboundFrame | null {
    const record = this.#runs.get(runId);
    if (record === undefined) return null;
    return {
      id: this.#log.cursorAtHead(runId),
      event: "reset",
      data: {
        ...envelope(runId, this.#nowMs()),
        reason: "slow_consumer" as const,
        run: this.#runOf(record),
      },
    };
  }

  // ——— internals ———

  /**
   * Track a durable run created outside this gateway (decision D3): one
   * authoritative snapshot, an event-log absorb, and a live pump so SSE
   * observers receive subsequent status/output/terminal frames.
   */
  async #adopt(runId: string): Promise<RunRecord | null> {
    let known = false;
    try {
      known = (await this.#runtime.listRuns()).some((entry) => entry.runId === runId);
    } catch {
      known = false;
    }
    if (!known) return null;
    let snapshot: SnapshotOutput;
    try {
      snapshot = await this.#runtime.snapshot(runId);
    } catch {
      throw new ProblemError(503, "runtime_unavailable");
    }
    const now = this.#nowMs();
    const record: RunRecord = {
      runId,
      createdAtMs: now,
      updatedAtMs: now,
      phase: "durable",
      cache: null,
      previousActivities: new Map(),
      lastEmittedRunJson: null,
      terminalEmitted: false,
      stopPump: null,
    };
    this.#runs.set(runId, record);
    this.#durable.delete(runId);
    this.#absorb(record, snapshot);
    if (!record.terminalEmitted) this.#startPump(record);
    return record;
  }

  #inFlightPlanning(): number {
    let count = 0;
    for (const record of this.#runs.values()) {
      if (record.phase === "submission" || record.phase === "planning") count += 1;
    }
    return count;
  }

  #markPlanning(runId: string): void {
    const record = this.#runs.get(runId);
    if (record === undefined || record.phase !== "submission") return;
    record.phase = "planning";
    record.updatedAtMs = this.#nowMs();
    this.#emitStatus(
      record,
      submissionRun({
        runId,
        phase: "planning",
        createdAtMs: record.createdAtMs,
        updatedAtMs: record.updatedAtMs,
      }),
    );
  }

  #planningFailed(runId: string): void {
    const record = this.#runs.get(runId);
    if (record === undefined || record.terminalEmitted) return;
    record.phase = "failed";
    record.updatedAtMs = this.#nowMs();
    record.terminalEmitted = true;
    this.#emitStatus(
      record,
      failedSubmissionRun({
        runId,
        createdAtMs: record.createdAtMs,
        updatedAtMs: record.updatedAtMs,
      }),
    );
    this.#log.append(runId, "terminal", statusData(runId, this.#nowMs(), this.#runOf(record)));
  }

  #startPump(record: RunRecord): void {
    const stop = this.#runtime.subscribe(record.runId, (snapshot) => {
      if (record.terminalEmitted) return;
      record.phase = "durable";
      this.#absorb(record, snapshot);
    });
    record.stopPump = stop;
  }

  /** Fold one snapshot into the record: cache, status diff, outputs, terminal. */
  #absorb(record: RunRecord, snapshot: SnapshotOutput): void {
    if (record.terminalEmitted) return;
    const now = this.#nowMs();
    const run = projectSnapshot(snapshot, now);
    run.createdAt = iso(record.createdAtMs);
    record.cache = run;
    record.updatedAtMs = now;

    if (statusFingerprint(run) !== record.lastEmittedRunJson) {
      this.#emitStatus(record, run);
    }
    for (const activity of projectNewActivities(snapshot, record.previousActivities)) {
      this.#log.append(record.runId, "output", {
        ...envelope(record.runId, now),
        taskId: activity.taskId,
        activityId: activity.activityId,
        text: activity.text,
        truncated: activity.truncated,
      });
    }
    if (isTerminalStatus(run.status)) {
      record.terminalEmitted = true;
      record.stopPump?.();
      record.stopPump = null;
      this.#log.append(record.runId, "terminal", statusData(record.runId, now, run));
    }
  }

  #emitStatus(record: RunRecord, run: RemoteRun): void {
    record.lastEmittedRunJson = statusFingerprint(run);
    this.#log.append(record.runId, "status", statusData(record.runId, this.#nowMs(), run));
  }

  #runOf(record: RunRecord): RemoteRun {
    if (record.cache !== null) return record.cache;
    if (record.phase === "failed") {
      return failedSubmissionRun({
        runId: record.runId,
        createdAtMs: record.createdAtMs,
        updatedAtMs: record.updatedAtMs,
      });
    }
    return submissionRun({
      runId: record.runId,
      phase: record.phase === "planning" ? "planning" : "accepted",
      createdAtMs: record.createdAtMs,
      updatedAtMs: record.updatedAtMs,
    });
  }

  #summaryOf(record: RunRecord): RemoteRunSummary {
    const run = this.#runOf(record);
    return {
      runId: run.runId,
      status: run.status,
      terminal: run.terminal,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      lastSequence: run.lastSequence,
      taskCounts: run.taskCounts,
    };
  }
}

function statusData(runId: string, occurredAtMs: number, run: RemoteRun) {
  return { ...envelope(runId, occurredAtMs), run };
}

function defaultRunId(): string {
  return `run_${crypto.randomUUID()}`;
}
