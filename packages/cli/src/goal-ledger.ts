import type { EventOutput, GoalCriterionStatusOutput } from "@loop/protocol";
import {
  compactLines,
  moreItems,
  separator,
  statusGlyph,
  type OutputLimits,
} from "@loop/presentation";

/**
 * Local goal-ledger view (docs/local-verification.md): assembles one run's
 * goal criteria with their owning task, linked check evidence, and provenance
 * (originally declared vs. promoted from a mid-run steer adjustment).
 *
 * Layer boundary: the criterion `state` and the verified/pending decision are
 * taken verbatim from the Rust projection via the run snapshot — this module
 * never re-implements the closure policy. It only joins the projection output
 * with the event stream facts (receipts, verification evidence, steer
 * provenance) that the snapshot does not carry.
 */

export interface GoalLedgerMeta {
  runId: string;
  runState: string;
  tasks: Array<{ id: string; state: string }>;
  criteria: GoalCriterionStatusOutput[];
}

export interface GoalLedgerCheckView {
  checkId: string;
  /** Number of receipts recorded for this check on the owning task. */
  receipts: number;
  /** Latest receipt outcome; null when no receipt was ever recorded. */
  lastExitCode: number | null;
  lastTimedOut: boolean;
  /** Latest receipt's read/write fingerprint stability, null without a source receipt. */
  lastSourceStable: boolean | null;
  /** Paths the latest receipt observed changing outside the task's write scope. */
  lastOutOfScopePaths: string[];
  /** Latest verification evidence for this check; null without any evidence. */
  evidencePassed: boolean | null;
}

export interface GoalLedgerEntryView {
  id: string;
  description: string;
  taskId: string;
  taskState: string | null;
  /** True when the criterion entered the goal contract through a steer promotion batch. */
  fromSteer: boolean;
  state: "pending" | "verified";
  checks: GoalLedgerCheckView[];
}

export interface GoalLedgerView {
  runId: string;
  runState: string;
  total: number;
  verified: number;
  criteria: GoalLedgerEntryView[];
}

interface ParsedEvent {
  sequence: number;
  kind: string;
  data: Record<string, unknown>;
}

function parseEvents(events: EventOutput[]): ParsedEvent[] {
  const parsed: ParsedEvent[] = [];
  for (const event of events) {
    const sequence = Number(event.sequence);
    if (!Number.isSafeInteger(sequence) || sequence <= 0) continue;
    let kind: { type?: string; data?: Record<string, unknown> } | undefined;
    try {
      kind = (JSON.parse(event.payloadJson) as { kind?: typeof kind }).kind;
    } catch {
      continue;
    }
    if (!kind || typeof kind.type !== "string") continue;
    parsed.push({ sequence, kind: kind.type, data: kind.data ?? {} });
  }
  return parsed.toSorted((left, right) => left.sequence - right.sequence);
}

interface ReceiptFacts {
  receipts: number;
  lastExitCode: number | null;
  lastTimedOut: boolean;
  lastSourceStable: boolean | null;
  lastOutOfScopePaths: string[];
}

function emptyFacts(): ReceiptFacts {
  return {
    receipts: 0,
    lastExitCode: null,
    lastTimedOut: false,
    lastSourceStable: null,
    lastOutOfScopePaths: [],
  };
}

function receiptKey(taskId: string, checkId: string): string {
  return `${taskId}\u0000${checkId}`;
}

/** Events of one steer promotion batch are contiguous: task_created, then
 * guidance_added scoped to that task, then goal_criteria_declared. */
function isSteerDeclaration(
  declaration: ParsedEvent,
  bySequence: Map<number, ParsedEvent>,
  criterion: { taskId: string },
): boolean {
  const guidance = bySequence.get(declaration.sequence - 1);
  const task = bySequence.get(declaration.sequence - 2);
  return (
    guidance?.kind === "guidance_added" &&
    guidance.data.task_id === criterion.taskId &&
    task?.kind === "task_created" &&
    task.data.id === criterion.taskId
  );
}

export function goalLedger(meta: GoalLedgerMeta, events: EventOutput[]): GoalLedgerView {
  const parsed = parseEvents(events);
  const bySequence = new Map(parsed.map((event) => [event.sequence, event]));

  const facts = new Map<string, ReceiptFacts>();
  const evidence = new Map<string, boolean>();
  const steerCriteria = new Set<string>();
  for (const event of parsed) {
    if (event.kind === "check_receipts_recorded") {
      const taskId = event.data.task_id;
      if (typeof taskId !== "string") continue;
      const checks = Array.isArray(event.data.checks) ? event.data.checks : [];
      for (const check of checks) {
        if (!check || typeof check !== "object") continue;
        const receipt = check as {
          id?: unknown;
          exitCode?: unknown;
          timedOut?: unknown;
          source?: {
            beforeFingerprint?: unknown;
            afterFingerprint?: unknown;
            observedOutsideWriteScope?: unknown;
          } | null;
        };
        if (typeof receipt.id !== "string") continue;
        const source = receipt.source;
        const outOfScopePaths = Array.isArray(source?.observedOutsideWriteScope)
          ? source.observedOutsideWriteScope.filter(
              (path): path is string => typeof path === "string",
            )
          : [];
        const stable =
          typeof source?.beforeFingerprint === "string" &&
          typeof source?.afterFingerprint === "string" &&
          source.beforeFingerprint.length > 0 &&
          source.beforeFingerprint === source.afterFingerprint;
        facts.set(receiptKey(taskId, receipt.id), {
          receipts: (facts.get(receiptKey(taskId, receipt.id))?.receipts ?? 0) + 1,
          lastExitCode: typeof receipt.exitCode === "number" ? receipt.exitCode : null,
          lastTimedOut: receipt.timedOut === true,
          lastSourceStable: source === null || source === undefined ? null : stable,
          lastOutOfScopePaths: outOfScopePaths,
        });
      }
    }
    if (event.kind === "verification_passed" && typeof event.data.task_id === "string") {
      const checks = (event.data.evidence as { checks?: Record<string, unknown> } | undefined)
        ?.checks;
      if (checks && typeof checks === "object") {
        for (const [checkId, passed] of Object.entries(checks)) {
          if (typeof passed === "boolean")
            evidence.set(receiptKey(event.data.task_id as string, checkId), passed);
        }
      }
    }
    if (event.kind === "goal_criteria_declared" && Array.isArray(event.data)) {
      for (const criterion of event.data) {
        if (!criterion || typeof criterion !== "object") continue;
        const entry = criterion as { id?: unknown; task_id?: unknown };
        if (typeof entry.id !== "string" || typeof entry.task_id !== "string") continue;
        if (isSteerDeclaration(event, bySequence, { taskId: entry.task_id }))
          steerCriteria.add(entry.id);
      }
    }
  }

  const taskStates = new Map(meta.tasks.map((task) => [task.id, task.state]));
  const criteria: GoalLedgerEntryView[] = meta.criteria.map((criterion) => ({
    id: criterion.id,
    description: criterion.description,
    taskId: criterion.taskId,
    taskState: taskStates.get(criterion.taskId) ?? null,
    fromSteer: steerCriteria.has(criterion.id),
    state: criterion.state === "verified" ? ("verified" as const) : ("pending" as const),
    checks: criterion.checkIds.map((checkId) => {
      const receipt = facts.get(receiptKey(criterion.taskId, checkId)) ?? emptyFacts();
      return {
        checkId,
        receipts: receipt.receipts,
        lastExitCode: receipt.lastExitCode,
        lastTimedOut: receipt.lastTimedOut,
        lastSourceStable: receipt.lastSourceStable,
        lastOutOfScopePaths: receipt.lastOutOfScopePaths,
        evidencePassed: evidence.get(receiptKey(criterion.taskId, checkId)) ?? null,
      };
    }),
  }));

  return {
    runId: meta.runId,
    runState: meta.runState,
    total: criteria.length,
    verified: criteria.filter((criterion) => criterion.state === "verified").length,
    criteria,
  };
}

function formatCheck(check: GoalLedgerCheckView): string {
  const outcome =
    check.lastExitCode === null
      ? "no receipt"
      : check.lastTimedOut
        ? `timed out after exit ${check.lastExitCode}`
        : `exit ${check.lastExitCode}`;
  const evidence =
    check.evidencePassed === null ? "" : `, evidence ${check.evidencePassed ? "pass" : "fail"}`;
  return `${check.checkId} (${outcome}${evidence})`;
}

export function formatGoalLedger(view: GoalLedgerView, limits: OutputLimits): string {
  const lines = [
    `Goal ledger ${separator.list} ${view.runId} ${separator.list} ${view.runState}`,
    `Verified ${view.verified}/${view.total}`,
    ...(view.criteria.length
      ? view.criteria.map((criterion) => {
          const glyph = criterion.state === "verified" ? statusGlyph.success : statusGlyph.warning;
          const provenance = criterion.fromSteer ? " (steer)" : "";
          const checks =
            criterion.checks.length === 0
              ? separator.list
              : criterion.checks.map(formatCheck).join(", ");
          return `${glyph} ${criterion.id} ${separator.list} ${criterion.state} ${separator.list} task ${criterion.taskId}${provenance} ${separator.list} ${checks}`;
        })
      : ["No goal criteria declared for this run"]),
  ];
  return `${compactLines(lines, {
    lineLimit: limits.listLineLimit,
    lineTextLimit: limits.lineTextLimit,
    overflow: (count) => moreItems(count, "criteria", "use --json for the full report"),
  }).join("\n")}\n`;
}
