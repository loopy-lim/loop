#!/usr/bin/env bun
/**
 * Self-trace workflow-pattern report over a loop-store SQLite database.
 *
 * The aggregation mirrors `crates/loop-store/src/trace.rs`: the same window,
 * kind-count, and ordered task-scan SQL, the same per-task derivation, and the
 * same per-mille `TraceScore` semantics as loop-core. Numbers printed here are
 * therefore the numbers `SqliteStore::trace_report` produces for the same
 * database. This script is a thin reporting adapter — it defines no policy of
 * its own and makes no model or provider calls.
 *
 * Usage:
 *   bun scripts/trace-report.ts --fixture            generate a deterministic
 *                                                    fixture database and print
 *                                                    its report
 *   bun scripts/trace-report.ts --database <path>    report over an existing
 *                                                    loop-store database (all
 *                                                    runs)
 *   bun scripts/trace-report.ts --database <path> --run <run-id>
 *
 * The only domain types imported are the generated protocol shapes of
 * loop-core's `TraceSummary`/`TraceScore`; no Rust domain type is re-declared
 * here.
 */
import type { TraceScore, TraceSummary } from "../packages/protocol/src/generated/types.ts";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";

// ---------------------------------------------------------------------------
// Store access — SQL mirrors crates/loop-store/src/trace.rs
// ---------------------------------------------------------------------------

const WINDOW_SQL =
  "SELECT count(*), min(created_at), max(created_at) FROM events WHERE run_id = ?1";

const KIND_COUNT_SQL =
  "SELECT json_extract(payload_json, '$.kind.type') AS kind, count(*) " +
  "FROM events WHERE run_id = ?1 GROUP BY kind ORDER BY kind";

const TASK_SCAN_SQL =
  "SELECT seq, payload_json, created_at FROM events WHERE run_id = ?1 ORDER BY seq ASC";

const RUNS_SQL = "SELECT id FROM runs ORDER BY id ASC";

/** Fixture schema: the `runs` + `events` subset of crates/loop-store/src/schema.rs. */
const FIXTURE_SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS events_run_seq ON events(run_id, seq);
`;

interface EventRow {
  seq: number;
  payload_json: string;
  created_at: number;
}

interface KindCountRow {
  kind: string | null;
  "count(*)": number;
}

interface WindowRow {
  "count(*)": number;
  "min(created_at)": number | null;
  "max(created_at)": number | null;
}

/**
 * Per-task aggregation produced by the ordered event scan. Field semantics
 * follow loop-store's private `TaskTrace` derivation; the shape itself is
 * local to this script (the Rust type is not part of the generated protocol,
 * so there is nothing to import).
 */
interface TaskScan {
  taskId: string;
  kind: string | null;
  attempts: number;
  workerFailures: number;
  verificationFailures: number;
  verificationPasses: number;
  attentionCreated: number;
  firstReadySeq: number | null;
  firstStartedSeq: number | null;
  completedSeq: number | null;
}

interface RunReport {
  runId: string;
  summary: TraceSummary;
  score: TraceScore;
  tasks: TaskScan[];
  /** Tasks whose `task_created` precedes the run's first `worker_started`. */
  createdBeforeFirstWorkerStart: number;
  /** Distance in event-sequence steps between first and last `task_created`. */
  creationSpreadEvents: number;
}

// ---------------------------------------------------------------------------
// Aggregation — derivation mirrors loop-store trace.rs scan_tasks/add_kind
// ---------------------------------------------------------------------------

const SUMMARY_KINDS: Readonly<Record<string, keyof TraceSummary>> = {
  task_created: "tasks_created",
  task_completed: "tasks_completed",
  worker_started: "worker_starts",
  worker_finished: "worker_finishes",
  worker_failed: "worker_failures",
  verification_passed: "verification_passes",
  verification_failed: "verification_failures",
  attention_created: "attention_created",
  attention_resolved: "attention_resolved",
};

function taskKey(kind: string, data: unknown): string | null {
  const record = data as { id?: unknown; task_id?: unknown } | null | undefined;
  switch (kind) {
    case "task_created":
    case "task_completed":
    case "task_ready":
      return typeof data === "string" ? data : typeof record?.id === "string" ? record.id : null;
    case "task_output_recorded":
    case "worker_started":
    case "worker_finished":
    case "worker_failed":
    case "verification_passed":
    case "verification_failed":
    case "attention_created":
      return typeof record?.task_id === "string" ? record.task_id : null;
    default:
      return null;
  }
}

function scanTasks(db: Database, runId: string): { tasks: TaskScan[]; createdSeqs: number[]; firstStartSeq: number | null } {
  const order: string[] = [];
  const byId = new Map<string, TaskScan>();
  const createdSeqs: number[] = [];
  let firstStartSeq: number | null = null;
  const rows = db.query<EventRow, [string]>(TASK_SCAN_SQL).all(runId);
  for (const row of rows) {
    const event = JSON.parse(row.payload_json) as { kind?: { type?: unknown; data?: unknown } };
    const kind = typeof event.kind?.type === "string" ? event.kind.type : null;
    if (kind === null) continue;
    if (kind === "task_created") createdSeqs.push(row.seq);
    if (kind === "worker_started" && firstStartSeq === null) firstStartSeq = row.seq;
    const key = taskKey(kind, event.kind?.data);
    if (key === null) continue;
    let task = byId.get(key);
    if (task === undefined) {
      task = {
        taskId: key,
        kind: null,
        attempts: 0,
        workerFailures: 0,
        verificationFailures: 0,
        verificationPasses: 0,
        attentionCreated: 0,
        firstReadySeq: null,
        firstStartedSeq: null,
        completedSeq: null,
      };
      byId.set(key, task);
      order.push(key);
    }
    const data = event.kind?.data as { kind?: unknown } | undefined;
    switch (kind) {
      case "task_created":
        task.kind = typeof data?.kind === "string" ? data.kind : task.kind;
        break;
      case "task_ready":
        task.firstReadySeq ??= row.seq;
        break;
      case "worker_started":
        task.attempts += 1;
        task.firstStartedSeq ??= row.seq;
        break;
      case "worker_failed":
        task.workerFailures += 1;
        break;
      case "verification_failed":
        task.verificationFailures += 1;
        break;
      case "verification_passed":
        task.verificationPasses += 1;
        task.completedSeq ??= row.seq;
        break;
      case "task_completed":
        task.completedSeq ??= row.seq;
        break;
      case "attention_created":
        task.attentionCreated += 1;
        break;
    }
  }
  return { tasks: order.map((id) => byId.get(id) as TaskScan), createdSeqs, firstStartSeq };
}

/** Per-mille exactly as loop-core's `per_mille` (integer division, 0 when denominator is 0). */
function perMille(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.trunc((numerator * 1000) / denominator);
}

function scoreSummary(summary: TraceSummary): TraceScore {
  if ((summary.total_events ?? 0) === 0) return { reliability: 0, autonomy: 0, first_pass: 0 };
  const attempts = (summary.verification_passes ?? 0) + (summary.verification_failures ?? 0);
  return {
    reliability: perMille(summary.tasks_completed ?? 0, summary.tasks_created ?? 0),
    autonomy:
      (summary.attention_created ?? 0) === 0
        ? 1000
        : perMille(summary.attention_resolved ?? 0, summary.attention_created ?? 0),
    first_pass: perMille(summary.verification_passes ?? 0, attempts),
  };
}

function reportRun(db: Database, runId: string): RunReport {
  const window = db.query<WindowRow, [string]>(WINDOW_SQL).get(runId);
  if (window === null || window["count(*)"] === 0) {
    throw new Error(`run not found in store: ${runId}`);
  }
  const summary: TraceSummary = {
    total_events: window["count(*)"],
    elapsed_ms:
      window["min(created_at)"] === null || window["max(created_at)"] === null
        ? null
        : Math.max(0, window["max(created_at)"] - window["min(created_at)"]) * 1000,
  };
  for (const row of db.query<KindCountRow, [string]>(KIND_COUNT_SQL).all(runId)) {
    if (row.kind === null) continue;
    const counter = SUMMARY_KINDS[row.kind];
    if (counter !== undefined) {
      summary[counter] = ((summary[counter] as number | undefined) ?? 0) + row["count(*)"];
    }
  }
  const { tasks, createdSeqs, firstStartSeq } = scanTasks(db, runId);
  const createdBeforeFirstWorkerStart =
    firstStartSeq === null ? createdSeqs.length : createdSeqs.filter((seq) => seq < firstStartSeq).length;
  const firstSeq = createdSeqs[0];
  const lastSeq = createdSeqs[createdSeqs.length - 1];
  const creationSpreadEvents = firstSeq === undefined || lastSeq === undefined ? 0 : lastSeq - firstSeq;
  return {
    runId,
    summary,
    score: scoreSummary(summary),
    tasks,
    createdBeforeFirstWorkerStart,
    creationSpreadEvents,
  };
}

// ---------------------------------------------------------------------------
// Deterministic fixture — one plan-first-shaped DAG with one rework loop
// ---------------------------------------------------------------------------

const FIXTURE_RUN_ID = "fixture-self-trace";
const FIXTURE_BASE_EPOCH_S = 1_772_000_000;

interface FixtureEvent {
  run_id: string;
  kind: { type: string; data?: unknown };
}

function event(type: string, data?: unknown): FixtureEvent["kind"] {
  return data === undefined ? { type } : { type, data };
}

function fixtureEvents(): FixtureEvent[] {
  const task = (id: string, title: string, kind: string, writeScope: string) => ({
    id,
    title,
    kind,
    dependencies: [],
    ownership: { read_scope: ["docs/**"], write_scope: [writeScope] },
    requirements: ["fixture: deterministic trace shape"],
    completion_contract: { checks: [] },
    preferred_compute: "fast",
    minimum_compute: "deterministic",
    maximum_compute: "frontier",
    attempt: 0,
    max_attempts: 2,
    state: "pending",
  });
  const evidence = { checks: { "fixture-check": true } };
  return [
    // Plan-first signature: every task is created before any worker starts.
    { run_id: FIXTURE_RUN_ID, kind: event("run_created") },
    { run_id: FIXTURE_RUN_ID, kind: event("run_configured", { intent: "Fixture: plan-first DAG with one rework loop", working_directory: "/tmp/fixture" }) },
    { run_id: FIXTURE_RUN_ID, kind: event("task_created", task("design", "Design decomposition", "research", "docs/design/**")) },
    { run_id: FIXTURE_RUN_ID, kind: event("task_created", task("implement", "Implement to the design", "implementation", "src/**")) },
    { run_id: FIXTURE_RUN_ID, kind: event("task_created", task("integrate", "Integrate results", "integration", "src/**")) },
    { run_id: FIXTURE_RUN_ID, kind: event("guidance_added", { task_id: null, message: "Fixture guidance: no paid calls" }) },
    // design: clean research pass, completed without a verification gate.
    { run_id: FIXTURE_RUN_ID, kind: event("task_ready", "design") },
    { run_id: FIXTURE_RUN_ID, kind: event("worker_started", { task_id: "design", worker_id: "w-design-1" }) },
    { run_id: FIXTURE_RUN_ID, kind: event("task_output_recorded", { task_id: "design", summary: "Design written" }) },
    { run_id: FIXTURE_RUN_ID, kind: event("worker_finished", { task_id: "design", worker_id: "w-design-1" }) },
    { run_id: FIXTURE_RUN_ID, kind: event("task_completed", "design") },
    // implement: worker failure -> attention -> retry -> verification failure -> pass.
    { run_id: FIXTURE_RUN_ID, kind: event("task_ready", "implement") },
    { run_id: FIXTURE_RUN_ID, kind: event("worker_started", { task_id: "implement", worker_id: "w-impl-1" }) },
    { run_id: FIXTURE_RUN_ID, kind: event("task_activity_recorded", { task_id: "implement", activity: "editing" }) },
    { run_id: FIXTURE_RUN_ID, kind: event("worker_failed", { task_id: "implement", worker_id: "w-impl-1", reason: "fixture: rate limit" }) },
    { run_id: FIXTURE_RUN_ID, kind: event("attention_created", { id: "att-1", kind: "failure", summary: "Worker stopped; retry?", state: "open", resolution: null, task_id: "implement" }) },
    { run_id: FIXTURE_RUN_ID, kind: event("attention_resolved", { attention_id: "att-1", resolution: "retry" }) },
    { run_id: FIXTURE_RUN_ID, kind: event("worker_started", { task_id: "implement", worker_id: "w-impl-2" }) },
    { run_id: FIXTURE_RUN_ID, kind: event("task_output_recorded", { task_id: "implement", summary: "Implementation written" }) },
    { run_id: FIXTURE_RUN_ID, kind: event("verification_failed", { task_id: "implement", reason: "fixture: check failed" }) },
    { run_id: FIXTURE_RUN_ID, kind: event("worker_finished", { task_id: "implement", worker_id: "w-impl-2" }) },
    { run_id: FIXTURE_RUN_ID, kind: event("verification_passed", { task_id: "implement", evidence }) },
    { run_id: FIXTURE_RUN_ID, kind: event("task_completed", "implement") },
    // integrate: clean gated pass.
    { run_id: FIXTURE_RUN_ID, kind: event("task_ready", "integrate") },
    { run_id: FIXTURE_RUN_ID, kind: event("worker_started", { task_id: "integrate", worker_id: "w-int-1" }) },
    { run_id: FIXTURE_RUN_ID, kind: event("task_output_recorded", { task_id: "integrate", summary: "Integration done" }) },
    { run_id: FIXTURE_RUN_ID, kind: event("worker_finished", { task_id: "integrate", worker_id: "w-int-1" }) },
    { run_id: FIXTURE_RUN_ID, kind: event("verification_passed", { task_id: "integrate", evidence }) },
    { run_id: FIXTURE_RUN_ID, kind: event("task_completed", "integrate") },
    { run_id: FIXTURE_RUN_ID, kind: event("run_completed") },
  ];
}

function fixtureDatabasePath(): string {
  return join(tmpdir(), "loop-trace-fixture", "fixture.sqlite");
}

function generateFixture(path: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const db = new Database(path);
  try {
    db.exec("DROP INDEX IF EXISTS events_run_seq; DROP TABLE IF EXISTS events; DROP TABLE IF EXISTS runs;");
    db.exec(FIXTURE_SCHEMA);
    db.query("INSERT INTO runs (id, state, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)").run(
      FIXTURE_RUN_ID,
      "completed",
      FIXTURE_BASE_EPOCH_S,
      FIXTURE_BASE_EPOCH_S + 30,
    );
    const insert = db.query("INSERT INTO events (run_id, payload_json, created_at) VALUES (?1, ?2, ?3)");
    db.transaction(() => {
      fixtureEvents().forEach((fixtureEvent, index) => {
        insert.run(fixtureEvent.run_id, JSON.stringify(fixtureEvent), FIXTURE_BASE_EPOCH_S + index);
      });
    })();
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

function ratio(numerator: number, denominator: number, digits = 2): string {
  return denominator === 0 ? "n/a" : (numerator / denominator).toFixed(digits);
}

function percent(numerator: number, denominator: number): string {
  return denominator === 0 ? "n/a" : `${Math.round((numerator / denominator) * 100)}%`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  const lower = sorted[middle - 1];
  if (upper === undefined) return null;
  if (sorted.length % 2 === 1) return upper;
  return lower === undefined ? null : Math.round((lower + upper) / 2);
}

function renderReport(report: RunReport): string {
  const s = report.summary;
  const tasks = report.tasks;
  const lines: string[] = [];
  const out = (line = "") => lines.push(line);

  out(`run ${report.runId}`);
  const span =
    s.elapsed_ms === null || s.elapsed_ms === undefined ? "n/a" : `${Math.round(Number(s.elapsed_ms) / 1000)}s`;
  out(
    `  events ${s.total_events} (span ${span})` +
      `  tasks created ${s.tasks_created ?? 0} / completed ${s.tasks_completed ?? 0}` +
      `  worker starts ${s.worker_starts ?? 0} / finishes ${s.worker_finishes ?? 0} / failures ${s.worker_failures ?? 0}`,
  );
  out(
    `  verification passes ${s.verification_passes ?? 0} / failures ${s.verification_failures ?? 0}` +
      `  attention created ${s.attention_created ?? 0} / resolved ${s.attention_resolved ?? 0}`,
  );
  out();
  out("score (per-mille, loop-core TraceScore semantics)");
  out(
    `  reliability ${report.score.reliability}  autonomy ${report.score.autonomy}` +
      `  first-pass ${report.score.first_pass}  total ${
        report.score.reliability + report.score.autonomy + report.score.first_pass
      }/3000`,
  );

  const verificationEvents = (s.verification_passes ?? 0) + (s.verification_failures ?? 0);
  out();
  out("workflow patterns");
  out(
    `  task ordering: created before first worker start ${report.createdBeforeFirstWorkerStart}/${tasks.length}` +
      ` (all created up-front is the plan-first signature; fewer means tasks appeared mid-run)`,
  );
  out(`  task ordering: creation spread ${report.creationSpreadEvents} events between first and last task_created`);
  const readyGaps = tasks
    .filter((t) => t.firstReadySeq !== null && t.firstStartedSeq !== null)
    .map((t) => (t.firstStartedSeq as number) - (t.firstReadySeq as number));
  const medianGap = median(readyGaps);
  out(`  task ordering: ready -> first worker start median ${medianGap === null ? "n/a" : `${medianGap} events`}`);
  out(`  verification frequency: verification events per worker start ${ratio(verificationEvents, s.worker_starts ?? 0)}`);
  out(`  verification frequency: verification events per completed task ${ratio(verificationEvents, s.tasks_completed ?? 0)}`);
  out(`  verification frequency: tasks gated by a verification pass ${tasks.filter((t) => t.verificationPasses > 0).length}/${tasks.length}`);
  out(
    `  rework: verification failures per attempt ${
      verificationEvents === 0 ? "n/a" : `${s.verification_failures ?? 0}/${verificationEvents} (${percent(s.verification_failures ?? 0, verificationEvents)})`
    }`,
  );
  const tasksWithVerificationFailure = tasks.filter((t) => t.verificationFailures > 0).length;
  out(
    `  rework: tasks that failed verification at least once ${tasksWithVerificationFailure}/${tasks.length}` +
      ` (${percent(tasksWithVerificationFailure, tasks.length)})`,
  );
  out(
    `  rework: worker failures per start ${s.worker_failures ?? 0}/${s.worker_starts ?? 0}` +
      ` (${percent(s.worker_failures ?? 0, s.worker_starts ?? 0)})`,
  );
  out(`  rework: max worker attempts on one task ${tasks.reduce((max, t) => Math.max(max, t.attempts), 0)}`);
  out(`  attention: attention events per task ${ratio(s.attention_created ?? 0, tasks.length)}`);
  out(
    `  attention: resolved ${s.attention_resolved ?? 0}/${s.attention_created ?? 0}` +
      ` (${percent(s.attention_resolved ?? 0, s.attention_created ?? 0)})`,
  );

  out();
  out("per-task detail (event-sequence order)");
  for (const task of tasks) {
    const readyToDone =
      task.firstReadySeq !== null && task.completedSeq !== null
        ? `${task.completedSeq - task.firstReadySeq} ev`
        : "open";
    out(
      `  ${task.taskId.padEnd(12)} kind=${(task.kind ?? "?").padEnd(14)} attempts ${task.attempts}` +
        `  verify +${task.verificationPasses}/-${task.verificationFailures}` +
        `  attention ${task.attentionCreated}  ready->done ${readyToDone}`,
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

interface CliArgs {
  fixture: boolean;
  database?: string;
  run?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { fixture: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--fixture") {
      args.fixture = true;
    } else if (value === "--database") {
      index += 1;
      if (argv[index] === undefined) throw new Error("--database requires a path");
      args.database = argv[index];
    } else if (value === "--run") {
      index += 1;
      if (argv[index] === undefined) throw new Error("--run requires a run id");
      args.run = argv[index];
    } else {
      throw new Error(`unknown argument: ${value}`);
    }
  }
  if (!args.fixture && args.database === undefined) {
    throw new Error("usage: bun scripts/trace-report.ts --fixture | --database <path> [--run <id>]");
  }
  return args;
}

async function main(): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(String(error));
    return 2;
  }
  const databasePath = args.fixture ? fixtureDatabasePath() : (args.database as string);
  if (args.fixture) generateFixture(databasePath);

  // bun:sqlite rejects explicit read-write flag objects; omit options when writing.
  const db = args.fixture ? new Database(databasePath) : new Database(databasePath, { readonly: true });
  try {
    const runIds =
      args.run !== undefined ? [args.run] : db.query<{ id: string }, []>(RUNS_SQL).all().map((row) => row.id);
    if (runIds.length === 0) {
      console.error(`no runs found in ${databasePath}`);
      return 1;
    }
    console.log("loop self-trace workflow-pattern report");
    console.log(`database: ${databasePath}${args.fixture ? " (deterministic fixture)" : ""}`);
    for (const runId of runIds) {
      console.log();
      console.log(renderReport(reportRun(db, runId)));
    }
  } finally {
    db.close();
  }
  return 0;
}

process.exitCode = await main();
