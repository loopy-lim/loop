import type { RunListOutput, SnapshotOutput, TaskContextOutput } from "@loop/protocol";

import { compactLines, compactItems, singleLine, type OutputLimits } from "./compact";
import { emptyState, moreItems, separator } from "./tokens";
import { workingLine, formatElapsed } from "./working";

/** Age in milliseconds of a persisted instant (task lastProgressMs, attention
 * openedAtMs); undefined when the snapshot predates the field. Future
 * instants clamp to 0 — clock corrections are not staleness. */
function ageMs(
  instantMs: number | bigint | null | undefined,
  nowMs: number,
): number | undefined {
  if (instantMs === undefined || instantMs === null) return undefined;
  return Math.max(0, nowMs - Number(instantMs));
}

/** Options for the live worker-activity feed (docs/decisions/2026-09-23-worker-visibility.md D3/D5). */
export interface SnapshotRenderOptions {
  /** Per-worker history lines shown in the watch feed; 0/undefined hides the feed section. */
  workerActivityLines?: number;
  /** Elapsed milliseconds in the active run, measured by long-lived callers
   * (Lead session, watch); SnapshotOutput carries no run-start timestamp, so
   * undefined simply hides the elapsed segment of the working line. */
  elapsedMs?: number;
  /** Clock used to age persisted progress (task lastProgressMs) and open
   * attention (openedAtMs); defaults to the render time. Tests pass a fixed
   * clock for deterministic output. */
  nowMs?: number;
}

export function renderSnapshot(
  command: string,
  snapshot: SnapshotOutput,
  limits: OutputLimits,
  options: SnapshotRenderOptions = {},
): string {
  if (command === "graph") return renderGraph(snapshot, limits);
  if (command === "workers") return renderWorkers(snapshot, limits);
  if (command === "attention") return renderAttention(snapshot, limits, options);
  return renderStatus(snapshot, limits, options);
}

export function renderRuns(runs: RunListOutput[], limits: OutputLimits): string {
  if (runs.length === 0) return emptyState.noRuns;
  return compactLines(
    runs.map((run) => `${run.runId} ${separator.list} ${run.state}`),
    {
      lineLimit: limits.listLineLimit,
      lineTextLimit: limits.lineTextLimit,
      overflow: (omitted) => moreItems(omitted, "runs"),
    },
  ).join("\n");
}

export function renderTaskContext(context: TaskContextOutput, limits: OutputLimits): string {
  const task = context.task;
  const lines = [
    `Task ${task.id} ${separator.list} ${task.kind} ${separator.list} attempt ${context.attempt} ${separator.list} ${task.title}`,
    `Dependencies: ${list([...task.dependencies].sort())}`,
    `Read: ${list(task.readScope)} ${separator.list} Write: ${list(task.writeScope)}`,
    ...(context.resultSummary ? [`Result: ${context.resultSummary}`] : []),
    ...(context.previousFailure ? [`Failure: ${context.previousFailure}`] : []),
    ...context.previousChecks.map((check) => {
      const evidence = check.exitCode === 0 ? check.stdout : check.stderr || check.stdout;
      const source = check.source
        ? ` ${separator.list} source ${check.source.beforeFingerprint === check.source.afterFingerprint ? "stable" : "changed"}`
        : "";
      const outside = check.source?.observedOutsideWriteScope?.length
        ? ` ${separator.list} ${check.source.observedOutsideWriteScope.length} path(s) outside write scope (writer unknown)`
        : "";
      const artifact = check.outputArtifact
        ? ` ${separator.list} artifact ${check.outputArtifact}`
        : "";
      return `Check ${check.id} ${separator.list} exit ${check.exitCode}${source}${outside}${artifact}${evidence ? ` ${separator.list} ${evidence}` : ""}`;
    }),
    ...context.dependencyResults.map((result) => `Result ${result.taskId}: ${result.summary}`),
    ...context.guidance.map((guidance) => `Guidance: ${guidance}`),
    ...(task.requirements.length > 0 ? [`Requires: ${task.requirements.join(", ")}`] : []),
  ];
  return compactLines(lines, {
    lineLimit: limits.statusLineLimit,
    lineTextLimit: limits.lineTextLimit,
    overflow: (omitted) => moreItems(omitted, "task details"),
  }).join("\n");
}

function renderGraph(snapshot: SnapshotOutput, limits: OutputLimits): string {
  if (snapshot.tasks.length === 0) return emptyState.noTasks;
  return compactLines(
    snapshot.tasks.map((task) => {
      const details = [
        `${task.id} ${separator.depends} ${list([...task.dependencies].sort(), "root")}`,
        task.state,
        ...(task.blockedBy.length > 0 ? [`blocked: ${[...task.blockedBy].sort().join(", ")}`] : []),
        `r: ${list([...task.readScope].sort())}`,
        `w: ${list([...task.writeScope].sort())}`,
        ...taskDetails(task),
      ];
      return details.join(` ${separator.list} `);
    }),
    {
      lineLimit: limits.listLineLimit,
      lineTextLimit: limits.lineTextLimit,
      overflow: (omitted) => moreItems(omitted, "tasks"),
    },
  ).join("\n");
}

function renderWorkers(snapshot: SnapshotOutput, limits: OutputLimits): string {
  if (snapshot.activeWorkers.length === 0) return emptyState.noActiveWorkers;
  // G18 요약 고도화: worker 식별자에 실행 상태와 최근 활동 한 줄을 붙여
  // 다중 worker 상태 파악이 `loop watch` 없이도 가능하다.
  const taskById = new Map(snapshot.tasks.map((task) => [task.id, task]));
  return compactLines(
    snapshot.activeWorkers.map((worker) => {
      const task = taskById.get(worker.taskId);
      const latestActivity = task?.activities.at(-1);
      return singleLine(
        [
          `${worker.id} ${separator.list} ${worker.taskId}`,
          ...(task ? [task.state] : []),
          ...(latestActivity ? [latestActivity] : []),
        ].join(` ${separator.list} `),
        limits.lineTextLimit,
      );
    }),
    {
      lineLimit: limits.listLineLimit,
      lineTextLimit: limits.lineTextLimit,
      overflow: (omitted) => moreItems(omitted, "workers"),
    },
  ).join("\n");
}

function renderAttention(
  snapshot: SnapshotOutput,
  limits: OutputLimits,
  options: SnapshotRenderOptions = {},
): string {
  const openIds = snapshot.openAttentionIds;
  if (openIds.length === 0) return emptyState.attentionOk;
  const attentionById = new Map(snapshot.attention.map((item) => [item.id, item]));
  const nowMs = options.nowMs ?? Date.now();
  const items = openIds.map((id) => {
    const item = attentionById.get(id);
    if (!item) return id;
    const waitedAge = ageMs(item.openedAtMs, nowMs);
    return [`${item.kind} ${item.id}`, waitedAge === undefined ? null : `waited ${formatElapsed(waitedAge)}`, item.taskId, item.summary]
      .filter(Boolean)
      .join(` ${separator.list} `);
  });
  const next = `Next: /loop resolve ${snapshot.runId} ${openIds[0]} <resolution>`;
  if (limits.attentionLineLimit <= 1) {
    return compactLines([next], {
      lineLimit: 1,
      lineTextLimit: limits.lineTextLimit,
      overflow: () => "",
    }).join("\n");
  }
  const availableItems = Math.max(0, limits.attentionLineLimit - 2);
  const compacted = compactLines(items, {
    lineLimit: availableItems,
    lineTextLimit: limits.lineTextLimit,
    overflow: (omitted) => moreItems(omitted, "attention items"),
  });
  return compactLines([`Attention: ${openIds.length} open`, ...compacted, next], {
    lineLimit: limits.attentionLineLimit,
    lineTextLimit: limits.lineTextLimit,
    overflow: (omitted) => moreItems(omitted, "attention lines"),
  }).join("\n");
}

function renderStatus(
  snapshot: SnapshotOutput,
  limits: OutputLimits,
  options: SnapshotRenderOptions = {},
): string {
  const done = snapshot.tasks.filter((task) => task.state === "done").length;
  const statusNowMs = options.nowMs ?? Date.now();
  const taskLines = [...snapshot.tasks]
    .sort((left, right) => {
      return taskPriority(left.state) - taskPriority(right.state);
    })
    .map((task) => {
      const details = [
        ...(task.title !== task.id ? [task.title] : []),
        ...taskDetails(task, statusNowMs),
      ];
      return `${task.id} ${separator.list} ${task.state}${details.length > 0 ? ` ${separator.list} ${details.join(` ${separator.list} `)}` : ""}`;
    });
  const taskLineLimit = Math.min(limits.findingsLineLimit, Math.max(0, limits.statusLineLimit - 3));
  const visibleTasks =
    taskLineLimit === 0
      ? []
      : compactLines(taskLines, {
          lineLimit: taskLineLimit,
          lineTextLimit: limits.lineTextLimit,
          overflow: (omitted) => moreItems(omitted, "task findings"),
        });
  const working = workingLine(snapshot, options.elapsedMs, options.nowMs);
  const status = compactLines(
    [
      `Run ${snapshot.runId}`,
      `State: ${snapshot.state}`,
      ...(working ? [working] : []),
      `Tasks: ${done}/${snapshot.tasks.length} ${separator.list} Workers: ${snapshot.activeWorkers.length} ${separator.list} Attention: ${snapshot.openAttentionIds.length}`,
      ...visibleTasks,
    ],
    {
      lineLimit: limits.statusLineLimit,
      lineTextLimit: limits.lineTextLimit,
      overflow: (omitted) => moreItems(omitted, "status lines"),
    },
  ).join("\n");
  const feed = renderActivityFeed(snapshot, limits, options);
  return feed ? `${status}\n${feed}` : status;
}

/**
 * Live worker-activity section for `loop watch` (D3): the most recent history
 * lines under each running worker's identity, bounded by the presentation
 * budget (workerActivityLines per worker, findingsLineLimit workers) and the
 * shared line-text clamp. One-shot `loop status` omits the section.
 */
function renderActivityFeed(
  snapshot: SnapshotOutput,
  limits: OutputLimits,
  options: SnapshotRenderOptions,
): string {
  const budget = options.workerActivityLines ?? 0;
  if (budget <= 0) return "";
  const running = snapshot.tasks.filter(
    (task) => task.state === "running" && task.activities.length > 0,
  );
  if (running.length === 0) return "";
  const blocks = running.map((task) => {
    const recent = task.activities.slice(-budget);
    return [
      `${task.id} activity:`,
      ...recent.map((line) => `  ${separator.activity} ${singleLine(line, limits.lineTextLimit)}`),
    ];
  });
  const visible = compactItems(blocks, limits.findingsLineLimit);
  const lines = visible.items.flat();
  if (visible.omitted > 0) {
    lines.push(moreItems(visible.omitted, "workers with activity"));
  }
  return lines.join("\n");
}

function taskDetails(task: SnapshotOutput["tasks"][number], nowMs: number = Date.now()): string[] {
  const latestActivity = task.activities.at(-1);
  // Trust signal: a running/verifying task is only as healthy as its persisted
  // last progress; a dead worker's age grows here instead of faking activity.
  const progressAge =
    task.state === "running" || task.state === "verifying"
      ? ageMs(task.lastProgressMs, nowMs)
      : undefined;
  return [
    ...(task.blockedBy.length > 0 ? [`blocked: ${task.blockedBy.join(", ")}`] : []),
    ...(task.state !== "done" && task.lastFailure ? [`failure: ${task.lastFailure}`] : []),
    ...(progressAge !== undefined ? [`progress: ${formatElapsed(progressAge)} ago`] : []),
    ...(latestActivity ? [`activity: ${latestActivity}`] : []),
    ...(task.resultSummary ? [`result: ${task.resultSummary}`] : []),
  ];
}

function taskPriority(state: SnapshotOutput["tasks"][number]["state"]): number {
  return {
    attention: 0,
    running: 1,
    verifying: 2,
    failed: 3,
    blocked: 4,
    ready: 5,
    pending: 6,
    done: 7,
    cancelled: 8,
  }[state];
}

function list(values: string[], empty: string = emptyState.list): string {
  return values.length > 0 ? values.join(", ") : empty;
}
