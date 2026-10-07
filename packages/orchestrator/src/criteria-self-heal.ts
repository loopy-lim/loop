import type { CheckReceipt, GoalCriterionInput } from "@loop/protocol";
import type { CompletionVerifier } from "./completion";
import type { OrchestrationControl } from "./control";
import { redact } from "./redact";
import { storeCheckOutput } from "./evidence-artifact";
import {
  captureSourceState,
  changedSourcePaths,
  scopeContainsPath,
  scopedFingerprint,
} from "./source-state";

/**
 * Run resilience (design 2026-10-02 §D): before a blocked-goal failure
 * attention can become inevitable, re-run the pending criteria's declared
 * checks once on stable source. The pass is anchored in the task
 * verification flow — the store completes a run only while appending the
 * verification event, so a post-hoc receipt replacement at the blocked-goal
 * branch could verify criteria but never complete the run. Recording the
 * healed receipts before the final verification keeps that completion
 * semantics intact and guarantees the pass precedes any blocked attention.
 *
 * Whether a criterion is verified stays a deterministic loop-core projection;
 * this module only decides when fresh evidence is worth one more pass.
 */

/** Union of goal-criterion check ids declared against one task. */
export function criteriaCheckIdsForTask(
  criteria: readonly GoalCriterionInput[] | undefined,
  taskId: string,
): string[] {
  const ids: string[] = [];
  for (const criterion of criteria ?? []) {
    if (criterion.taskId !== taskId) continue;
    for (const id of criterion.checkIds) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Whether the recorded evidence would keep a criterion pending even though
 * the checks passed: criterion verification requires a stable source receipt
 * with no out-of-scope observation. A missing source (non-repository runs)
 * always blocks. The authoritative decision stays in loop-core; this is only
 * the adapter-side trigger for the self-heal pass.
 */
export function receiptsBlockCriteria(
  receipts: ReadonlyArray<CheckReceipt>,
  writeScope: readonly string[],
): boolean {
  return receipts.some((receipt) => {
    const source = receipt.source;
    if (!source) return true;
    if (source.beforeFingerprint === "" || source.beforeFingerprint !== source.afterFingerprint)
      return true;
    return source.observedOutsideWriteScope.some(
      (path) => !writeScope.some((scope) => scopeContainsPath([scope], path)),
    );
  });
}

export interface CriteriaSelfHealOptions {
  input: { databasePath: string; runId: string; executionOwner: string };
  control: OrchestrationControl;
  verifier: CompletionVerifier;
  taskId: string;
  checkIds: readonly string[];
  completionChecks: Parameters<CompletionVerifier["verify"]>[0];
  readScope: readonly string[];
  writeScope: readonly string[];
  workingDirectory: string;
  signal?: AbortSignal;
}

/**
 * Re-run the declared checks once on quiet source and record replacement
 * receipts. Returns the replacement receipts when the pass is clean (every
 * check passed and the source stayed stable with no out-of-scope
 * observation); returns undefined — leaving the original evidence intact —
 * when the pass cannot rescue the criterion.
 */
export async function rerunCriteriaChecksOnStableSource(
  options: CriteriaSelfHealOptions,
): Promise<CheckReceipt[] | undefined> {
  const {
    input,
    control,
    verifier,
    taskId,
    checkIds,
    completionChecks,
    readScope,
    writeScope,
    workingDirectory,
    signal,
  } = options;
  const checks = completionChecks.filter((check) => checkIds.includes(check.id));
  if (checks.length === 0) return undefined;
  const scopes = [...readScope, ...writeScope];
  const sourceBefore = await captureSourceState(workingDirectory, [input.databasePath]);
  const evidence = await verifier.verify(checks, workingDirectory, signal);
  const sourceAfter = await captureSourceState(workingDirectory, [input.databasePath]);
  const before = sourceBefore;
  const after = sourceAfter;
  const healed =
    evidence.every((check) => check.passed) &&
    before !== undefined &&
    after !== undefined &&
    (() => {
      if (scopedFingerprint(before, scopes) !== scopedFingerprint(after, scopes)) return false;
      return !changedSourcePaths(before, after).some(
        (path) => !writeScope.some((scope) => scopeContainsPath([scope], path)),
      );
    })();
  await control.recordActivity({
    ...input,
    taskId,
    activity: healed
      ? `Self-heal: re-ran declared checks (${checks.map((check) => check.id).join(", ")}) once on stable source before any blocked-goal attention.`
      : `Self-heal: re-ran declared checks (${checks.map((check) => check.id).join(", ")}) once; the criterion is still unverified, raising attention with the original evidence.`,
  });
  if (!healed || before === undefined || after === undefined) return undefined;
  const source = {
    beforeFingerprint: scopedFingerprint(before, scopes),
    afterFingerprint: scopedFingerprint(after, scopes),
    observedChangedPaths: changedSourcePaths(before, after),
    observedOutsideWriteScope: [] as string[],
  };
  const receipts = await Promise.all(
    evidence.map(async (check) => {
      const artifact = await storeCheckOutput(
        input.databasePath,
        input.runId,
        taskId,
        check.id,
        check.stdout,
        check.stderr,
      );
      return {
        id: check.id,
        command: check.command,
        args: check.args,
        workingDirectory: check.workingDirectory,
        exitCode: check.exitCode,
        stdout: redact(check.stdout),
        stderr: redact(check.stderr),
        timedOut: check.timedOut,
        durationMs: check.durationMs,
        ...(artifact ? { outputArtifact: artifact.path } : {}),
        source,
      };
    }),
  );
  await control.recordCheckReceipts({ ...input, taskId, checks: receipts });
  return receipts;
}
