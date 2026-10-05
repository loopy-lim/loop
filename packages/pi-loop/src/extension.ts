import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

import { Type } from "typebox";
import { workerRunMarker } from "@loop/herdr";
import type { RunSummary } from "@loop/orchestrator";
// Subpath import: the persona module is a leaf (no bridge dependency), so the
// Node-targeted pi extension bundle stays free of Bun-only imports (bun:ffi).
import { derivePersonaVocabulary, type PersonaVocabulary } from "@loop/orchestrator/persona";
import { loadLoopConfig } from "@loop/orchestrator/config";
import {
  compactLines,
  isActiveRunState,
  type OutputLimits,
  type SnapshotRenderOptions,
  singleLine,
} from "@loop/presentation";
import type {
  RunListOutput,
  SnapshotOutput,
  TaskContextOutput,
  TaskSpecInput,
  GoalCriterionInput,
  ComputeClass,
  PromoteSteerOutput,
} from "@loop/protocol";

import { validateGoalPlan, type GoalPlan } from "./lead/decompose";
import { codeMap } from "./lead/code-map";
import { decompositionPrompt, taskSpecInputDescription } from "./lead/prompts";
import { LeadTiming, formatFinalTiming, formatHandoffTiming } from "./lead/timing";
import {
  FilesViewerComponent,
  listViewerFiles,
  readViewerFile,
  type ViewerFile,
  type ViewerTheme,
} from "./ui/files-viewer";

/**
 * Lead-facing settings derived once per process from Loop configuration:
 * output limits plus the persona vocabulary (valid ids, merged kind defaults,
 * explicit-only ids). One loadLoopConfig call derives both together. The
 * vocabulary is fixed for the session — like models/routing, config edits
 * need a Lead restart to take effect.
 */
export interface LeadSettings {
  limits: OutputLimits;
  vocabulary: PersonaVocabulary;
  herdrVisible?: boolean;
  /**
   * Main-orchestration milestone surfacing through herdr (desktop toast;
   * done sound only on goal completion). On by default inside a Herdr pane;
   * set LOOP_HERDR_NOTIFY=0 (or off/false) to mute. Worker pane transitions
   * are unaffected — they stay under herdr's own [ui.sound.agents] policy.
   */
  herdrNotify?: boolean;
  defaultComputeClass?: ComputeClass;
}

function loadLeadSettings(): LeadSettings {
  const config = loadLoopConfig();
  const notifyFlag = process.env.LOOP_HERDR_NOTIFY?.toLowerCase();
  return {
    limits: config.output,
    vocabulary: derivePersonaVocabulary(config.personas, config.personaKindDefaults),
    herdrVisible: process.env.HERDR_ENV === "1",
    herdrNotify: !(notifyFlag === "0" || notifyFlag === "off" || notifyFlag === "false"),
    defaultComputeClass: config.routing.defaultComputeClass,
  };
}
import {
  HerdrLifecycleReporter,
  HerdrNotificationReporter,
  registerHerdrLifecycle,
  type HerdrLifecycleSink,
  type HerdrNotification,
  type PiLifecycleEvent,
} from "./herdr-lifecycle";
import { renderModels } from "./ui/models";
import { renderRuns, renderSnapshot, renderTaskContext } from "./ui/snapshot";
import { renderLoopRunSummary } from "./ui/summary";

interface PiContext {
  cwd: string;
  ui: {
    notify(message: string, level?: "info" | "success" | "warning" | "error"): void;
    setStatus?(key: string, text: string | undefined): void;
    setWidget?(key: string, lines: string[] | undefined): void;
    /** Interactive-only custom overlay (see docs/tui.md). Absent in JSON/print modes. */
    custom?<T>(
      factory: (
        tui: { requestRender(): void },
        theme: ViewerTheme,
        keybindings: unknown,
        done: (result: T) => void,
      ) => unknown,
      options?: {
        overlay?: boolean;
        overlayOptions?: { anchor?: string; width?: string; maxHeight?: string };
      },
    ): Promise<T>;
  };
  sessionManager?: { getBranch(): Array<{ type: string; customType?: string; data?: unknown }> };
}

type LeadToolParams = {
  intent?: string;
  tasksJson?: string;
  runId?: string;
  taskId?: string;
  taskJson?: string;
  attentionId?: string;
  resolution?: string;
  action?: string;
  title?: string;
  readScope?: string[];
  writeScope?: string[];
  requirements?: string[];
  risk?: NonNullable<TaskSpecInput["routing"]>["risk"];
  path?: string;
  checks?: Array<Pick<TaskSpecInput["completionChecks"][number], "id" | "command" | "args">>;
  acceptance?: Array<{ requirement: string; checkIds: string[] }>;
};

interface PiToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
}

export interface PiExtensionApi {
  registerCommand(
    name: string,
    options: {
      description: string;
      handler(args: string, context: PiContext): Promise<void> | void;
    },
  ): void;
  registerTool(tool: {
    name: string;
    label: string;
    description: string;
    parameters: unknown;
    execute(
      toolCallId: string,
      params: LeadToolParams,
      signal: AbortSignal,
      onUpdate: ((value: PiToolResult) => void) | undefined,
      context: PiContext,
    ): Promise<PiToolResult>;
  }): void;
  appendEntry?(customType: string, data: unknown): void;
  sendMessage?(
    message: { customType: string; content: string; display: boolean },
    options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
  ): void | Promise<void>;
  on(
    event: PiLifecycleEvent | "session_tree" | "message_start",
    handler: (event: unknown, context: PiContext) => Promise<void> | void,
  ): void;
  on(
    event: "before_agent_start",
    handler: (
      event: { prompt: string; systemPrompt: string },
      context: PiContext,
    ) => Promise<{ systemPrompt: string }> | { systemPrompt: string },
  ): void;
}

export interface LoopLeadBackend {
  run(input: {
    intent: string;
    tasks: TaskSpecInput[];
    criteria: GoalCriterionInput[];
    runId: string;
    cwd: string;
    signal: AbortSignal;
    onProgress?: (snapshot: SnapshotOutput) => void;
  }): Promise<RunSummary>;
  snapshot(runId: string, cwd: string): Promise<SnapshotOutput>;
  cancel(runId: string, cwd: string): Promise<SnapshotOutput>;
  pause(runId: string, cwd: string): Promise<SnapshotOutput>;
  resume(runId: string, cwd: string): Promise<SnapshotOutput>;
  steer(runId: string, taskId: string, message: string, cwd: string): Promise<SnapshotOutput>;
  resolve(
    runId: string,
    attentionId: string,
    resolution: string,
    cwd: string,
  ): Promise<SnapshotOutput>;
  task(runId: string, taskId: string, cwd: string): Promise<TaskContextOutput>;
  guidance(runId: string, taskId: string, cwd: string): Promise<string>;
  runs(cwd: string): Promise<RunListOutput[]>;
  models(cwd: string): Promise<string[]>;
  /**
   * Promote the user's mid-run condition into the goal contract: one atomic
   * append binds the user's own words, a new dependent task, and new goal
   * criteria, so the completion gate holds the run open until the promoted
   * criteria verify. The receipt carries the focused test names that prove
   * the promotion contract — surface them as evidence, never as the user's
   * verification.
   */
  promoteSteer(
    runId: string,
    message: string,
    task: TaskSpecInput,
    criteria: GoalCriterionInput[],
    cwd: string,
  ): Promise<PromoteSteerOutput>;
}

function renderRunWidget(
  snapshot: SnapshotOutput,
  limits: OutputLimits,
  herdrVisible: boolean,
): string[] {
  const done = snapshot.tasks.filter((task) => task.state === "done").length;
  const headline = `Loop · ${snapshot.state} · ${done}/${snapshot.tasks.length} verified`;
  let detail: string;
  if (snapshot.openAttentionIds.length > 0) {
    const open = snapshot.attention.find((item) => snapshot.openAttentionIds.includes(item.id));
    detail = `Decision: ${open?.summary ?? "Attention needed"} · answer here`;
  } else if (snapshot.state === "paused") {
    detail = "Paused · ask here to resume";
  } else if (snapshot.state === "pausing") {
    detail = "Finishing active work before pause";
  } else if (snapshot.state === "cancelling") {
    detail = "Stopping workers";
  } else {
    const workerTasks = [...new Set(snapshot.activeWorkers.map((worker) => worker.taskId))];
    const working = snapshot.tasks.filter(
      (task) => task.state === "running" || task.state === "verifying",
    );
    const ready = snapshot.tasks.filter((task) => task.state === "ready");
    const visible = working.length > 0 ? working : ready;
    const label = working.length > 0 ? "Working" : "Ready";
    detail =
      herdrVisible && workerTasks.length > 0
        ? `Herdr tabs: ${workerTasks.slice(0, 2).join(", ")}${workerTasks.length > 2 ? ` +${workerTasks.length - 2}` : ""} [${workerRunMarker(snapshot.runId)}] · steer here`
        : visible.length > 0
          ? `${label}: ${visible
              .slice(0, 2)
              .map((task) => task.title)
              .join(
                ", ",
              )}${visible.length > 2 ? ` +${visible.length - 2}` : ""} · ask here to adjust`
          : "Waiting for the next task · ask here to adjust";
  }
  return [headline, detail].map((line) => singleLine(line, limits.lineTextLimit));
}

function verifierReportedFailure(snapshot: SnapshotOutput): boolean {
  return snapshot.tasks.some(
    (task) =>
      task.kind === "verification" &&
      /(?:^|\n)\s*(?:[-*]\s*)?(?:LOOP_)?VERDICT:\s*FAIL\b/i.test(task.resultSummary ?? ""),
  );
}

export function registerLoopExtension(
  pi: PiExtensionApi,
  backend: LoopLeadBackend = new DefaultLoopLeadBackend(),
  lifecycle: HerdrLifecycleSink = new HerdrLifecycleReporter(),
  settings: LeadSettings = loadLeadSettings(),
  notifier: HerdrNotificationReporter = new HerdrNotificationReporter(),
): void {
  const { limits, vocabulary } = settings;

  /** Main-orchestration milestone surfacing (desktop toast + done/request
   * sound) through herdr. Disabled by LOOP_HERDR_NOTIFY or when not inside
   * a herdr pane; failures never reach the run observer. */
  const milestones: {
    notify(notification: HerdrNotification): Promise<void>;
  } = notifier.active && settings.herdrNotify !== false ? notifier : { notify: async () => {} };

  const notifyRunMilestone = (snapshot: SnapshotOutput): void => {
    // Sound only on actual goal completion — attention/failed/cancelled stay
    // silent (desktop toast only) so the chime always means "done".
    const sound = snapshot.state === "completed" ? "done" : "none";
    void milestones.notify({
      title: `Loop run ${snapshot.state}`,
      body: singleLine(`${snapshot.runId} · ${snapshot.intent}`, limits.lineTextLimit),
      sound,
    }).catch(() => {});
  };
  let currentRunId: string | undefined;
  let lastUserPrompt = "";
  let observer: ReturnType<typeof setInterval> | undefined;
  let observedSequence = -1;
  let observedAttention = new Set<string>();
  let observedDone = new Set<string>();
  let recoveryAttempted = false;
  let observerBusy = false;
  let observerVersion = 0;
  let restoreVersion = 0;
  let widgetContext: PiContext | undefined;
  const announcedAttention = new Set<string>();
  const announcedFinal = new Set<string>();
  const automaticFollowUpRuns = new Set<string>();
  let inFinalReviewTurn = false;
  let leadTiming = new LeadTiming();
  /** Working-line options for Lead-rendered snapshots: elapsed time only when
   * this session knows the run is in flight. */
  const leadSnapshotOptions = (snapshot: SnapshotOutput): SnapshotRenderOptions =>
    isActiveRunState(snapshot.state) ? { elapsedMs: leadTiming.activeMs(snapshot.runId) } : {};

  const stopObserver = () => {
    observerVersion++;
    if (observer) clearInterval(observer);
    observer = undefined;
    widgetContext?.ui.setWidget?.("loop-run", undefined);
    widgetContext = undefined;
    observedSequence = -1;
    observedAttention = new Set();
    observedDone = new Set();
    recoveryAttempted = false;
  };
  const reportFinal = async (snapshot: SnapshotOutput, context: PiContext) => {
    const prioritized = [...snapshot.tasks].sort((left, right) => {
      const priority = (state: string) =>
        state === "failed" ? 0 : state === "cancelled" ? 1 : state === "done" ? 3 : 2;
      return priority(left.state) - priority(right.state);
    });
    const findings = await Promise.all(
      prioritized.slice(0, limits.findingsLineLimit).map(async (task) => {
        try {
          const detail = await backend.task(snapshot.runId, task.id, context.cwd);
          const passed = detail.previousChecks.filter(
            (check) => check.exitCode === 0 && !check.timedOut,
          );
          const checks = passed.length
            ? ` · checks ${passed.map((check) => check.id).join(", ")}`
            : "";
          const finding =
            task.state === "done" ? task.resultSummary : (task.lastFailure ?? task.resultSummary);
          return `${task.id}: ${task.state}${checks}${finding ? ` · ${finding}` : ""}`;
        } catch {
          const finding = task.state === "done" ? task.resultSummary : task.lastFailure;
          return `${task.id}: ${task.state} · ${finding ?? "check details unavailable"}`;
        }
      }),
    );
    if (currentRunId !== snapshot.runId) return;
    const done = snapshot.tasks.filter((task) => task.state === "done").length;
    const verifiedCriteria = snapshot.goalCriteria.filter(
      (criterion) => criterion.state === "verified",
    ).length;
    const pendingCriteria = snapshot.goalCriteria.filter(
      (criterion) => criterion.state !== "verified",
    );
    const reviewNeeded = verifierReportedFailure(snapshot) || pendingCriteria.length > 0;
    const goalStatus =
      snapshot.goalCriteria.length > 0
        ? `${verifiedCriteria}/${snapshot.goalCriteria.length} criteria verified`
        : "goal criteria untracked";
    const timingLine = formatFinalTiming(leadTiming.finishDisplay(snapshot.runId));
    const body = compactLines(
      [
        `Run ${snapshot.runId}`,
        `State: ${snapshot.state}`,
        `${reviewNeeded ? "Task checks passed" : "Verified tasks"}: ${done}/${snapshot.tasks.length} · ${goalStatus}`,
        ...(verifierReportedFailure(snapshot)
          ? ["Review needed: verifier reported FAIL; goal incomplete."]
          : []),
        ...(pendingCriteria.length > 0
          ? [
              `Remaining criteria: ${pendingCriteria
                .slice(0, 2)
                .map((item) => item.id)
                .join(", ")}${pendingCriteria.length > 2 ? ` +${pendingCriteria.length - 2}` : ""}`,
            ]
          : []),
        ...(timingLine ? [timingLine] : []),
        ...findings,
        ...(snapshot.tasks.length > findings.length
          ? [`… ${snapshot.tasks.length - findings.length} more tasks`]
          : []),
      ],
      {
        lineLimit: limits.statusLineLimit,
        lineTextLimit: limits.lineTextLimit,
        overflow: (omitted) => `… ${omitted} more`,
      },
    ).join("\n");
    await pi.sendMessage?.(
      { customType: "loop-final", content: body, display: true },
      { triggerTurn: false },
    );
    if (
      snapshot.state !== "cancelled" &&
      !automaticFollowUpRuns.has(snapshot.runId) &&
      pi.sendMessage
    ) {
      try {
        await pi.sendMessage(
          {
            customType: "loop-final-review",
            content: `Loop final review for ${snapshot.runId}. Original intent: ${snapshot.intent}. Durable criteria: ${snapshot.goalCriteria.length ? snapshot.goalCriteria.map((item) => `${item.id} ${item.state}: ${item.description}`).join("; ") : "untracked"}. Compare the original goal and later user corrections with these criteria and executable check evidence. If a requirement is absent or unverified, start one focused follow-up run with an explicit completion check. Report the review outcome as a closing report that separates verified criteria, unverified criteria, and the follow-up path. If covered, summarize the verified result in at most 8 lines: result, checks, and any material limit. Show details only when asked. Do not repeat this automatic review for a follow-up run.`,
            display: false,
          },
          { triggerTurn: true, deliverAs: "followUp" },
        );
      } catch {
        context.ui.notify(
          "Loop final review could not start; ask here to continue the goal.",
          "warning",
        );
      }
    }
  };
  const acceptSnapshot = (snapshot: SnapshotOutput, context: PiContext) => {
    if (canonical(snapshot.workingDirectory) !== canonical(context.cwd))
      throw new Error("Loop run belongs to another working directory");
    if (snapshot.runId !== currentRunId) return;
    const sequence = Number(snapshot.lastSequence);
    const done = snapshot.tasks.filter((task) => task.state === "done").length;
    context.ui.setStatus?.(
      "loop",
      `Loop ${snapshot.state} · ${done}/${snapshot.tasks.length} · ${snapshot.activeWorkers.length} workers · ${snapshot.openAttentionIds.length} attention`,
    );
    if (sequence <= observedSequence) return;
    observedSequence = sequence;
    for (const task of snapshot.tasks) {
      if (task.state !== "done" || observedDone.has(task.id)) continue;
      observedDone.add(task.id);
      pi.appendEntry?.("loop-task-done", { runId: snapshot.runId, taskId: task.id });
      void milestones.notify({
        title: `Loop task done · ${task.id}`,
        body: singleLine(task.title, limits.lineTextLimit),
        sound: "none",
      }).catch(() => {});
      const announce = () => pi.sendMessage?.(
        { customType: "loop-task-done", content: `Loop task done · ${task.id}: ${task.title}`, display: true },
        { triggerTurn: false },
      );
      if (["completed", "failed", "cancelled"].includes(snapshot.state)) setTimeout(announce, 0);
      else void announce();
    }
    if (!["completed", "failed", "cancelled"].includes(snapshot.state)) {
      context.ui.setWidget?.(
        "loop-run",
        renderRunWidget(snapshot, limits, settings.herdrVisible === true),
      );
    }
    const newAttention = snapshot.openAttentionIds.filter(
      (id) => !observedAttention.has(id) && !announcedAttention.has(`${snapshot.runId}:${id}`),
    );
    for (const id of newAttention) {
      announcedAttention.add(`${snapshot.runId}:${id}`);
      pi.appendEntry?.("loop-run-attention", { runId: snapshot.runId, attentionId: id });
      const detail = snapshot.attention.find((item) => item.id === id);
      const attentionSummary = singleLine(detail?.summary ?? "Decision needed", limits.lineTextLimit);
      void milestones.notify({
        title: `Loop attention ${id}`,
        body: attentionSummary,
        sound: "none",
      }).catch(() => {});
      pi.sendMessage?.(
        {
          customType: "loop-attention",
          content: compactLines(
            [
              `Loop attention ${id}`,
              singleLine(detail?.summary ?? "Decision needed", limits.lineTextLimit),
              "Answer in this conversation to resolve it.",
            ],
            {
              lineLimit: limits.attentionLineLimit,
              lineTextLimit: limits.lineTextLimit,
              overflow: (omitted) => `… ${omitted} more`,
            },
          ).join("\n"),
          display: true,
        },
        { triggerTurn: false },
      );
    }
    observedAttention = new Set(snapshot.openAttentionIds);
    if (["completed", "failed", "cancelled"].includes(snapshot.state)) {
      if (!announcedFinal.has(snapshot.runId)) {
        announcedFinal.add(snapshot.runId);
        pi.appendEntry?.("loop-run-final", { runId: snapshot.runId, lastSequence: sequence });
        notifyRunMilestone(snapshot);
        void reportFinal(snapshot, context);
      }
      stopObserver();
    }
  };
  const observe = (runId: string, context: PiContext) => {
    stopObserver();
    widgetContext = context;
    const version = observerVersion;
    const poll = async () => {
      if (observerBusy || currentRunId !== runId) return;
      observerBusy = true;
      try {
        const snapshot = await backend.snapshot(runId, context.cwd);
        if (version === observerVersion && currentRunId === runId) {
          acceptSnapshot(snapshot, context);
          if (
            !recoveryAttempted && snapshot.state === "active" &&
            snapshot.executionExpiresAt != null &&
            Number(snapshot.executionExpiresAt) <= Date.now()
          ) {
            recoveryAttempted = true;
            try {
              acceptSnapshot(await backend.resume(runId, context.cwd), context);
            } catch {
              context.ui.notify("Loop owner restart failed; ask to resume this run.", "warning");
            }
          }
        }
      } catch {
        if (version === observerVersion) {
          context.ui.setStatus?.("loop", `Loop ${runId} · observation unavailable`);
          context.ui.setWidget?.("loop-run", undefined);
        }
      } finally {
        observerBusy = false;
      }
    };
    void poll();
    observer = setInterval(() => void poll(), 500);
    observer.unref?.();
  };
  const bind = (runId: string, context: PiContext) => {
    restoreVersion++;
    currentRunId = runId;
    pi.appendEntry?.("loop-run-binding", { runId, workingDirectory: canonical(context.cwd) });
    if (context.ui.setStatus || context.ui.setWidget || pi.sendMessage) observe(runId, context);
  };
  const restore = async (_event: unknown, context: PiContext) => {
    const version = ++restoreVersion;
    stopObserver();
    announcedAttention.clear();
    announcedFinal.clear();
    automaticFollowUpRuns.clear();
    inFinalReviewTurn = false;
    leadTiming = new LeadTiming();
    currentRunId = undefined;
    const cwd = canonical(context.cwd);
    let lastBinding: { runId?: string; workingDirectory?: string } | undefined;
    for (const entry of context.sessionManager?.getBranch() ?? []) {
      if (entry.type === "custom" && entry.customType === "loop-run-final") {
        const data = entry.data as { runId?: string } | undefined;
        if (data?.runId) announcedFinal.add(data.runId);
      }
      if (entry.type === "custom" && entry.customType === "loop-run-attention") {
        const data = entry.data as { runId?: string; attentionId?: string } | undefined;
        if (data?.runId && data.attentionId)
          announcedAttention.add(`${data.runId}:${data.attentionId}`);
      }
      if (entry.type === "custom" && entry.customType === "loop-run-auto-follow-up") {
        const data = entry.data as { runId?: string } | undefined;
        if (data?.runId) automaticFollowUpRuns.add(data.runId);
      }
      if (entry.type !== "custom" || entry.customType !== "loop-run-binding") continue;
      lastBinding = entry.data as { runId?: string; workingDirectory?: string } | undefined;
    }
    if (lastBinding?.runId) {
      if (lastBinding.workingDirectory !== cwd) {
        context.ui.setStatus?.("loop", "Loop binding belongs to another directory");
        return;
      }
      currentRunId = lastBinding.runId;
    }
    try {
      if (!currentRunId) {
        const candidates: string[] = [];
        for (const run of await backend.runs(context.cwd)) {
          if (version !== restoreVersion) return;
          if (!["active", "pausing", "paused", "attention", "cancelling"].includes(run.state))
            continue;
          const snapshot = await backend.snapshot(run.runId, context.cwd);
          if (version !== restoreVersion) return;
          if (canonical(snapshot.workingDirectory) === cwd) candidates.push(run.runId);
        }
        if (version !== restoreVersion) return;
        const soleCandidate = candidates[0];
        if (candidates.length === 1 && soleCandidate !== undefined) bind(soleCandidate, context);
        else if (candidates.length > 1)
          context.ui.setStatus?.(
            "loop",
            `${candidates.length} Loop runs · choose one in conversation`,
          );
      } else {
        const snapshot = await backend.snapshot(currentRunId, context.cwd);
        if (version !== restoreVersion) return;
        if (canonical(snapshot.workingDirectory) === cwd) observe(currentRunId, context);
        else currentRunId = undefined;
      }
    } catch {
      if (version === restoreVersion) context.ui.setStatus?.("loop", "Loop status unavailable");
    }
  };

  registerHerdrLifecycle(pi, lifecycle);

  const runTool: Parameters<PiExtensionApi["registerTool"]>[0] = {
    name: "loop_run",
    label: "Loop Run",
    description: [
      "Submit a dependency DAG to Loop after understanding an engineering request.",
      "Loop owns scheduling, worker dispatch, verification, retries, and durable state.",
      "Pass tasksJson as a JSON object with generated tasks and explicit criteria fields.",
      `Each task may carry an optional persona id (${vocabulary.ids.join(" | ")}). Kind defaults: ${personaKindDefaultsProse(vocabulary)}.`,
    ].join(" "),
    parameters: Type.Object({
      intent: Type.String({ description: "The user's complete engineering intent" }),
      tasksJson: Type.String({
        description: taskSpecInputDescription(vocabulary),
      }),
      runId: Type.Optional(Type.String({ description: "Stable run id; omit to generate one" })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, context) {
      if (!params.intent || !params.tasksJson)
        throw new Error("loop_run requires intent and tasksJson");
      const runId = params.runId?.trim() || `loop-${randomUUID()}`;
      const plan = parseGoalPlan(params.tasksJson);
      const tasks = normalizePersonas(plan.tasks, vocabulary);
      const criteria = plan.criteria;
      onUpdate?.(
        result(
          [
            singleLine(`Run ${runId}`, limits.lineTextLimit),
            singleLine(`Starting ${tasks.length} tasks`, limits.lineTextLimit),
          ].join("\n"),
          { runId },
        ),
      );
      leadTiming.beginSubmission(runId);
      let summary: RunSummary;
      try {
        summary = normalizeRunSummary(
          await backend.run({
            intent: params.intent,
            tasks,
            criteria,
            runId,
            cwd: context.cwd,
            signal,
            onProgress: (snapshot) => {
              onUpdate?.(
                result(renderSnapshot("status", snapshot, limits, leadSnapshotOptions(snapshot)), {
                  runId,
                  state: snapshot.state,
                }),
              );
            },
          }),
          tasks.length,
        );
      } catch (error) {
        leadTiming.forget(runId);
        throw error;
      }
      const handoffTiming = formatHandoffTiming(leadTiming.confirmHandoff(runId));
      if (inFinalReviewTurn) {
        automaticFollowUpRuns.add(runId);
        pi.appendEntry?.("loop-run-auto-follow-up", { runId });
      }
      bind(runId, context);
      const summaryLines = renderLeadRunSummary(runId, summary, limits).split("\n");
      const lineLimit =
        summary.status === "running" || summary.status === "completed"
          ? limits.statusLineLimit
          : limits.attentionLineLimit;
      if (handoffTiming) {
        if (summaryLines.length >= lineLimit) {
          const taskLine = summaryLines.findIndex((line) => line.startsWith("Tasks:"));
          if (taskLine >= 0) summaryLines.splice(taskLine, 1);
        }
        summaryLines.splice(2, 0, handoffTiming);
      }
      const text = compactLines(summaryLines, {
        lineLimit,
        lineTextLimit: limits.lineTextLimit,
        overflow: (omitted) => `… ${omitted} more`,
      }).join("\n");
      context.ui.notify(text, summary.status === "completed" ? "success" : "info");
      return result(text, { runId, status: summary.status });
    },
  };
  pi.registerTool(runTool);

  pi.registerTool({
    name: "loop_quick_run",
    label: "Loop Quick Run",
    description:
      "Start one bounded implementation task immediately. Supply exact read/write paths, concrete requirements, executable checks, and an explicit acceptance mapping from each requirement to its proving check IDs. Use loop_run for multiple tasks, decisions, or integration.",
    parameters: Type.Object({
      intent: Type.String(),
      title: Type.String(),
      readScope: Type.Array(Type.String()),
      writeScope: Type.Array(Type.String()),
      requirements: Type.Array(Type.String()),
      acceptance: Type.Array(
        Type.Object({
          requirement: Type.String(),
          checkIds: Type.Array(Type.String(), { minItems: 1 }),
        }),
        { minItems: 1 },
      ),
      risk: Type.Optional(
        Type.Union([
          Type.Literal("low"),
          Type.Literal("medium"),
          Type.Literal("high"),
          Type.Literal("critical"),
        ]),
      ),
      checks: Type.Array(
        Type.Object({
          id: Type.String(),
          command: Type.String(),
          args: Type.Array(Type.String()),
        }),
        { minItems: 1 },
      ),
      runId: Type.Optional(Type.String()),
    }),
    async execute(id, params, signal, onUpdate, context) {
      const readScope = params.readScope?.map((item) => item.trim()).filter(Boolean) ?? [];
      const writeScope = params.writeScope?.map((item) => item.trim()).filter(Boolean) ?? [];
      const requirements = params.requirements?.map((item) => item.trim()).filter(Boolean) ?? [];
      if (!params.intent?.trim() || !params.title?.trim())
        throw new Error("intent and title are required");
      if (writeScope.length === 0)
        throw new Error("writeScope must name the files owned by this task");
      if (requirements.length === 0) throw new Error("requirements must name the expected result");
      const checks = params.checks ?? [];
      if (
        checks.length === 0 ||
        checks.some(
          (check) => !check.id.trim() || !check.command.trim() || !Array.isArray(check.args),
        )
      ) {
        throw new Error(
          "checks must name each executable completion check with an id, command, and args",
        );
      }
      if (new Set(checks.map((check) => check.id.trim())).size !== checks.length)
        throw new Error("checks must have unique ids");
      const task: TaskSpecInput = {
        id: "implementation",
        title: params.title.trim(),
        kind: "implementation",
        dependencies: [],
        readScope,
        writeScope,
        requirements,
        completionChecks: checks.map((check) => ({
          id: check.id.trim(),
          command: check.command.trim(),
          args: check.args,
          workingDirectory: null,
          timeoutMs: 120_000,
        })),
        preferredCompute: settings.defaultComputeClass ?? "fast",
        minimumCompute: "tiny",
        maximumCompute: "frontier",
        routing: {
          risk: params.risk ?? "low",
          required: { coding: 2, reasoning: 1, tools: 1, vision: 0, long_context: 1 },
        },
        maxAttempts: 3,
      };
      const acceptance = params.acceptance ?? [];
      const criteria = acceptance.map((item, index) => ({
        id: `implementation:${index + 1}`,
        taskId: task.id,
        description: item.requirement.trim(),
        checkIds: item.checkIds.map((id) => id.trim()),
      }));
      return runTool.execute(
        id,
        {
          intent: params.intent,
          tasksJson: JSON.stringify({ tasks: [task], criteria }),
          runId: params.runId,
        },
        signal,
        onUpdate,
        context,
      );
    },
  });

  const current = async (context: PiContext, requested?: string) => {
    const runId = requested?.trim() || currentRunId;
    if (!runId) throw new Error("No unique current Loop run. Ask the user to identify the run.");
    const snapshot = await backend.snapshot(runId, context.cwd);
    if (canonical(snapshot.workingDirectory) !== canonical(context.cwd))
      throw new Error("Loop run belongs to another working directory");
    return snapshot;
  };

  const activeRunsInDirectory = async (context: PiContext) => {
    const active: SnapshotOutput[] = [];
    for (const run of await backend.runs(context.cwd)) {
      if (!["active", "pausing", "paused", "attention", "cancelling"].includes(run.state)) continue;
      const snapshot = await backend.snapshot(run.runId, context.cwd);
      if (canonical(snapshot.workingDirectory) === canonical(context.cwd)) active.push(snapshot);
    }
    return active;
  };

  pi.registerTool({
    name: "loop_code_map",
    label: "Loop Code Map",
    description:
      "List file and exported symbol names under one project-relative path, at most eight lines. Use only when task ownership paths are unclear; open source text separately when needed.",
    parameters: Type.Object({
      path: Type.String({ description: "Project-relative file or directory" }),
    }),
    async execute(_id, params, _signal, _update, context) {
      return result(
        compactLines(codeMap(context.cwd, params.path ?? "", limits.listLineLimit).split("\n"), {
          lineLimit: limits.listLineLimit,
          lineTextLimit: limits.lineTextLimit,
          overflow: (omitted) => `… ${omitted} more files`,
        }).join("\n"),
        {},
      );
    },
  });

  pi.registerTool({
    name: "loop_status",
    label: "Loop Status",
    description:
      "Read the current durable run status, graph, workers, or attention. With no bound run, list active runs and their intents so the user can choose in conversation.",
    parameters: Type.Object({
      runId: Type.Optional(Type.String()),
      action: Type.Optional(
        Type.Union([
          Type.Literal("status"),
          Type.Literal("graph"),
          Type.Literal("workers"),
          Type.Literal("attention"),
        ]),
      ),
    }),
    async execute(_id, params, _signal, _update, context) {
      if (!params.runId && !currentRunId) {
        const candidates = await activeRunsInDirectory(context);
        const lines = candidates.length
          ? candidates.map((run) => `${run.runId} · ${run.state} · ${run.intent}`)
          : ["No active Loop run in this directory."];
        return result(
          compactLines(lines, {
            lineLimit: limits.statusLineLimit,
            lineTextLimit: limits.lineTextLimit,
            overflow: (omitted) => `… ${omitted} more runs`,
          }).join("\n"),
          { candidates: candidates.map((run) => run.runId) },
        );
      }
      const snapshot = await current(context, params.runId);
      return result(renderLeadSnapshot(params.action ?? "status", snapshot, limits, leadSnapshotOptions(snapshot)), {
        runId: snapshot.runId,
        state: snapshot.state,
      });
    },
  });
  pi.registerTool({
    name: "loop_select_run",
    label: "Loop Select Run",
    description:
      "Bind one run to this Pi conversation after the user identifies its goal among the run list. This changes the target for subsequent natural-language control.",
    parameters: Type.Object({ runId: Type.String() }),
    async execute(_id, params, _signal, _update, context) {
      if (!params.runId?.trim()) throw new Error("runId is required");
      const snapshot = await current(context, params.runId);
      bind(snapshot.runId, context);
      return result(renderLeadSnapshot("status", snapshot, limits, leadSnapshotOptions(snapshot)), {
        runId: snapshot.runId,
        state: snapshot.state,
      });
    },
  });
  pi.registerTool({
    name: "loop_task",
    label: "Loop Task Detail",
    description:
      "Read one task's durable requirements, ownership, dependency results, guidance, and check evidence in this Pi conversation. Choose taskId from loop_status graph or workers.",
    parameters: Type.Object({ taskId: Type.String(), runId: Type.Optional(Type.String()) }),
    async execute(_id, params, _signal, _update, context) {
      const snapshot = await current(context, params.runId);
      if (!params.taskId?.trim() || !snapshot.tasks.some((task) => task.id === params.taskId)) {
        throw new Error(`Task ${params.taskId ?? ""} is not in run ${snapshot.runId}`);
      }
      const detail = await backend.task(snapshot.runId, params.taskId, context.cwd);
      const artifacts = detail.previousChecks.flatMap((check) =>
        check.outputArtifact ? [{ checkId: check.id, path: check.outputArtifact }] : [],
      );
      return result(renderTaskContext(detail, limits), {
        runId: snapshot.runId,
        taskId: params.taskId,
        artifacts,
      });
    },
  });
  pi.registerTool({
    name: "loop_guidance",
    label: "Loop Guidance Status",
    description:
      "Read recorded, delivered, and post-delivery checked correction stages for one task. Checked means stable-source task checks passed after delivery; inspect check coverage before claiming the new criterion is satisfied.",
    parameters: Type.Object({ taskId: Type.String(), runId: Type.Optional(Type.String()) }),
    async execute(_id, params, _signal, _update, context) {
      const snapshot = await current(context, params.runId);
      if (!params.taskId?.trim() || !snapshot.tasks.some((task) => task.id === params.taskId)) {
        throw new Error(`Task ${params.taskId ?? ""} is not in run ${snapshot.runId}`);
      }
      const stages = (await backend.guidance(snapshot.runId, params.taskId, context.cwd)).trim();
      return result(
        compactLines(
          [
            `Guidance for ${params.taskId}`,
            ...(stages ? stages.split("\n") : ["No guidance recorded for this task"]),
            "Checked means later task checks passed on stable source; inspect coverage for the changed criterion.",
          ],
          {
            lineLimit: limits.statusLineLimit,
            lineTextLimit: limits.lineTextLimit,
            overflow: (omitted) => `… ${omitted} more guidance items`,
          },
        ).join("\n"),
        { runId: snapshot.runId, taskId: params.taskId },
      );
    },
  });
  pi.registerTool({
    name: "loop_steer",
    label: "Loop Steer",
    description:
      "Record the latest user's exact guidance for one running task within its existing completion contract. Use loop_add_task for changed acceptance criteria. Select taskId from loop_status; use 'all' only when the user explicitly addresses every task. The original user text is forwarded unchanged.",
    parameters: Type.Object({ taskId: Type.String(), runId: Type.Optional(Type.String()) }),
    async execute(_id, params, _signal, _update, context) {
      if (inFinalReviewTurn)
        throw new Error(
          "Steering needs the latest user message; this turn is an automatic final review",
        );
      const snapshot = await current(context, params.runId);
      if (!params.taskId?.trim() || !lastUserPrompt.trim())
        throw new Error("Steering needs a task target and the latest user message");
      if (params.taskId !== "all") {
        const task = snapshot.tasks.find((candidate) => candidate.id === params.taskId);
        if (!task) throw new Error(`Task ${params.taskId} is not in run ${snapshot.runId}`);
        if (["done", "failed", "cancelled"].includes(task.state)) {
          throw new Error(
            `Task ${params.taskId} is completed (${task.state}); add a dependent task with explicit write scope and completion checks for this change.`,
          );
        }
      }
      const next = await backend.steer(snapshot.runId, params.taskId, lastUserPrompt, context.cwd);
      acceptSnapshot(next, context);
      return result(
        `Guidance recorded for ${params.taskId}. Worker delivery and completion remain pending.`,
        { runId: snapshot.runId, state: next.state },
      );
    },
  });
  pi.registerTool({
    name: "loop_add_task",
    label: "Loop Add Task",
    description: `Promote the user's mid-run condition into the goal contract: add one dependent task whose criteria carry the changed acceptance, and Loop appends it atomically with the user's own words so the completion gate holds the run open until the new criteria verify. Provide JSON {task, criteria} with explicit requirement-to-check coverage. ${taskSpecInputDescription(vocabulary)}`,
    parameters: Type.Object({ taskJson: Type.String(), runId: Type.Optional(Type.String()) }),
    async execute(_id, params, _signal, _update, context) {
      if (inFinalReviewTurn)
        throw new Error(
          "Promoting a condition needs the latest user message; this turn is an automatic final review",
        );
      const snapshot = await current(context, params.runId);
      if (!params.taskJson) throw new Error("taskJson is required");
      const payload = parseGoalTask(params.taskJson);
      const [task] = normalizePersonas([payload.task], vocabulary);
      if (task === undefined) throw new Error("task normalization produced no task");
      if (task.dependencies.length === 0)
        throw new Error(
          "A promoted condition needs a dependent task: declare dependencies on the tasks whose verified result it corrects or extends",
        );
      if (!lastUserPrompt.trim())
        throw new Error(
          "Promotion records the user's own condition text; no latest user message is available",
        );
      if (["completed", "failed", "cancelled"].includes(snapshot.state)) {
        throw new Error(
          `Run ${snapshot.runId} is ${snapshot.state}; start a follow-up run carrying this condition and its completion checks instead.`,
        );
      }
      let promoted: PromoteSteerOutput;
      try {
        promoted = await backend.promoteSteer(
          snapshot.runId,
          lastUserPrompt,
          task,
          payload.criteria,
          context.cwd,
        );
      } catch (error) {
        const latest = await backend.snapshot(snapshot.runId, context.cwd);
        if (["completed", "failed", "cancelled"].includes(latest.state)) {
          throw new Error(
            `Run ${snapshot.runId} is ${latest.state}; preserve the requested task for a new run: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
        throw error;
      }
      const next = await backend.snapshot(snapshot.runId, context.cwd);
      acceptSnapshot(next, context);
      return result(
        compactLines(
          [
            `Condition promoted into run ${snapshot.runId}: criteria ${promoted.criterionIds.join(", ")} on dependent task ${promoted.taskId}.`,
            "The run stays open until the new criteria verify through their declared checks; report them as unverified until then.",
            ...(promoted.evidenceTests.length
              ? [
                  "Promotion contract evidence (focused tests):",
                  ...promoted.evidenceTests.map((name) => `- ${name}`),
                ]
              : [
                  "No focused promotion evidence tests were reported; treat the criterion as unverified.",
                ]),
          ],
          {
            lineLimit: limits.statusLineLimit,
            lineTextLimit: limits.lineTextLimit,
            overflow: (omitted) => `… ${omitted} more`,
          },
        ).join("\n"),
        {
          runId: snapshot.runId,
          taskId: promoted.taskId,
          criterionIds: promoted.criterionIds,
          evidenceTests: promoted.evidenceTests,
          state: next.state,
        },
      );
    },
  });
  pi.registerTool({
    name: "loop_resolve",
    label: "Loop Resolve Attention",
    description:
      "Resolve a material attention item only from the user's explicit answer. Inspect loop_status attention first; never guess approval.",
    parameters: Type.Object({
      attentionId: Type.String(),
      resolution: Type.String(),
      runId: Type.Optional(Type.String()),
    }),
    async execute(_id, params, _signal, _update, context) {
      const snapshot = await current(context, params.runId);
      if (!params.attentionId || !params.resolution)
        throw new Error("attentionId and explicit resolution are required");
      const { snapshot: next, restarted } = await resolveAttentionAndRestart(
        snapshot.runId,
        params.attentionId,
        params.resolution,
        context,
      );
      acceptSnapshot(next, context);
      return result(withOwnerRestart(renderLeadSnapshot("status", next, limits, leadSnapshotOptions(next)), restarted), {
        runId: snapshot.runId,
        state: next.state,
      });
    },
  });
  pi.registerTool({
    name: "loop_control",
    label: "Loop Control",
    description: "Pause, resume, or cancel the current run when the user explicitly asks.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("pause"), Type.Literal("resume"), Type.Literal("cancel")]),
      runId: Type.Optional(Type.String()),
    }),
    async execute(_id, params, _signal, _update, context) {
      const snapshot = await current(context, params.runId);
      const next =
        params.action === "pause"
          ? await backend.pause(snapshot.runId, context.cwd)
          : params.action === "resume"
            ? await backend.resume(snapshot.runId, context.cwd)
            : params.action === "cancel"
              ? await backend.cancel(snapshot.runId, context.cwd)
              : undefined;
      if (!next) throw new Error("Choose pause, resume, or cancel");
      acceptSnapshot(next, context);
      return result(renderLeadSnapshot("status", next, limits, leadSnapshotOptions(next)), {
        runId: snapshot.runId,
        state: next.state,
      });
    },
  });

  pi.registerCommand("loop", {
    description: "Show or control the current durable Loop run",
    async handler(rawArgs, context) {
      const parts = rawArgs.trim().split(/\s+/).filter(Boolean);
      const command = parts.shift() ?? "status";
      if (command === "models") {
        context.ui.notify(renderModels(await backend.models(context.cwd), limits), "info");
        return;
      }
      if (command === "runs") {
        context.ui.notify(renderRuns(await backend.runs(context.cwd), limits), "info");
        return;
      }
      if (command === "task") {
        const [runId, taskId] = parts;
        if (!runId || !taskId) {
          context.ui.notify("Usage: /loop task <run> <task>", "warning");
          return;
        }
        context.ui.notify(
          renderTaskContext(await backend.task(runId, taskId, context.cwd), limits),
          "info",
        );
        return;
      }
      if (command === "steer" || command === "resolve") {
        const [runId, targetId, ...messageParts] = parts;
        const message = messageParts.join(" ");
        if (!runId || !targetId || !message) {
          const target = command === "steer" ? "<task|all> <message>" : "<id> <resolution>";
          context.ui.notify(`Usage: /loop ${command} <run> ${target}`, "warning");
          return;
        }
        const resolved =
          command === "resolve"
            ? await resolveAttentionAndRestart(runId, targetId, message, context)
            : undefined;
        const snapshot =
          command === "steer"
            ? await backend.steer(runId, targetId, message, context.cwd)
            : resolved?.snapshot;
        if (snapshot === undefined) return; // steer|resolve 분기가 snapshot 을 보장한다
        acceptSnapshot(snapshot, context);
        context.ui.notify(
          withOwnerRestart(
            renderSnapshot("status", snapshot, limits),
            resolved?.restarted === true,
          ),
          snapshot.state === "attention" ? "warning" : "info",
        );
        return;
      }
      if (
        !["status", "graph", "workers", "attention", "cancel", "pause", "resume"].includes(command)
      ) {
        context.ui.notify(
          "Unknown Loop command. Use status, graph, workers, attention, runs, task, pause, resume, steer, resolve, cancel, or models.",
          "warning",
        );
        return;
      }
      const requestedRunId = parts[0];
      const runId = requestedRunId ?? currentRunId;
      if (!runId) {
        context.ui.notify("No Loop run yet. Submit an engineering request first.", "warning");
        return;
      }
      const snapshot =
        command === "cancel"
          ? await backend.cancel(runId, context.cwd)
          : command === "pause"
            ? await backend.pause(runId, context.cwd)
            : command === "resume"
              ? await backend.resume(runId, context.cwd)
              : await backend.snapshot(runId, context.cwd);
      if (["cancel", "pause", "resume"].includes(command)) acceptSnapshot(snapshot, context);
      const rendered = renderSnapshot(command, snapshot, limits);
      context.ui.notify(rendered, snapshot.state === "attention" ? "warning" : "info");
    },
  });

  pi.registerCommand("files", {
    description: "Browse working-directory files in a split viewer overlay",
    async handler(_args, context) {
      const custom = context.ui.custom;
      if (!custom) {
        context.ui.notify("The file viewer needs the interactive Pi TUI.", "warning");
        return;
      }
      let files: ViewerFile[];
      try {
        files = await listViewerFiles(context.cwd);
      } catch (error) {
        context.ui.notify(
          `File list failed: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
        return;
      }
      if (files.length === 0) {
        context.ui.notify("No readable files under this directory.", "info");
        return;
      }
      const cwd = context.cwd;
      // Reads the local file system directly: extension and repo share a machine.
      await custom<undefined>(
        (tui, theme, _keybindings, done) =>
          new FilesViewerComponent({
            rootDir: cwd,
            theme,
            files,
            read: (relativePath) => readViewerFile(cwd, relativePath),
            requestRender: () => tui.requestRender(),
            done,
          }),
        { overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "90%" } },
      );
    },
  });

  const resolveAttentionAndRestart = async (
    runId: string,
    attentionId: string,
    resolution: string,
    context: PiContext,
  ) => {
    let resolved: SnapshotOutput;
    try {
      resolved = await backend.resolve(runId, attentionId, resolution, context.cwd);
    } catch (error) {
      // A post-commit status read may fail; only recover if a fresh snapshot
      // proves that this attention has already been consumed.
      let latest: SnapshotOutput | undefined;
      try {
        latest = await backend.snapshot(runId, context.cwd);
      } catch { /* Preserve the original error when observation is unavailable. */ }
      if (!latest || latest.openAttentionIds.includes(attentionId) || latest.state !== "active") throw error;
      resolved = latest;
    }
    const leaseAlive =
      resolved.executionOwner &&
      resolved.executionExpiresAt != null &&
      Number(resolved.executionExpiresAt) > Date.now();
    if (resolved.state !== "active" || leaseAlive)
      return { snapshot: resolved, restarted: false };
    try {
      return { snapshot: await backend.resume(runId, context.cwd), restarted: true };
    } catch {
      // Resolve has already committed. The observer gets one bounded retry.
      if (currentRunId === runId) recoveryAttempted = false;
      throw new Error(
        `Attention was resolved for ${runId}, but the owner could not restart. Ask to resume this run.`,
      );
    }
  };
  const withOwnerRestart = (rendered: string, restarted: boolean): string => {
    if (!restarted) return rendered;
    const lines = rendered.split("\n");
    lines[0] = singleLine(`Owner restart requested · ${lines[0]}`, limits.lineTextLimit);
    return lines.join("\n");
  };

  pi.on("session_start", restore);
  pi.on("session_tree", restore);
  pi.on("session_shutdown", () => {
    restoreVersion++;
    stopObserver();
    inFinalReviewTurn = false;
  });
  pi.on("message_start", (event) => {
    const message = (event as { message?: { role?: string; customType?: string } }).message;
    if (message?.role === "custom" && message.customType === "loop-final-review")
      inFinalReviewTurn = true;
    else if (message?.role === "user") inFinalReviewTurn = false;
  });
  pi.on("agent_end", () => {
    inFinalReviewTurn = false;
  });
  pi.on("before_agent_start", (event) => {
    leadTiming.beginTurn();
    if (!event.prompt.startsWith("Loop final review for ")) {
      inFinalReviewTurn = false;
      lastUserPrompt = event.prompt;
    }
    return {
      systemPrompt: `${event.systemPrompt}\n\n${leadInstructions(event.prompt, vocabulary, currentRunId)}`,
    };
  });
}

class DefaultLoopLeadBackend implements LoopLeadBackend {
  async run(input: {
    intent: string;
    tasks: TaskSpecInput[];
    criteria: GoalCriterionInput[];
    runId: string;
    cwd: string;
    signal: AbortSignal;
    onProgress?: (snapshot: SnapshotOutput) => void;
  }): Promise<RunSummary> {
    return runLoopPlan(input);
  }

  async snapshot(runId: string, cwd: string): Promise<SnapshotOutput> {
    return this.#json(["status", runId, "--json"], cwd);
  }

  async cancel(runId: string, cwd: string): Promise<SnapshotOutput> {
    await this.#json<unknown>(["cancel", runId, "--json"], cwd);
    return this.snapshot(runId, cwd);
  }

  async pause(runId: string, cwd: string): Promise<SnapshotOutput> {
    await this.#json<unknown>(["pause", runId, "--json"], cwd);
    return this.snapshot(runId, cwd);
  }

  async resume(runId: string, cwd: string): Promise<SnapshotOutput> {
    await this.#json<unknown>(["resume", runId, "--json"], cwd);
    return this.snapshot(runId, cwd);
  }

  async steer(
    runId: string,
    taskId: string,
    message: string,
    cwd: string,
  ): Promise<SnapshotOutput> {
    await this.#json<unknown>(["steer", runId, taskId, message, "--json"], cwd);
    return this.snapshot(runId, cwd);
  }

  async resolve(
    runId: string,
    attentionId: string,
    resolution: string,
    cwd: string,
  ): Promise<SnapshotOutput> {
    await this.#json<unknown>(["resolve", runId, attentionId, resolution, "--json"], cwd);
    return this.snapshot(runId, cwd);
  }

  async task(runId: string, taskId: string, cwd: string): Promise<TaskContextOutput> {
    return this.#json(["task", runId, taskId, "--json"], cwd);
  }

  async guidance(runId: string, taskId: string, cwd: string): Promise<string> {
    return runLoopCommand(["guidance", runId, taskId], cwd);
  }

  async runs(cwd: string): Promise<RunListOutput[]> {
    return this.#json(["runs", "--json"], cwd);
  }

  async models(cwd: string): Promise<string[]> {
    const models = await this.#json<Array<{ computeClass: string; id: string }>>(
      ["models", "--json"],
      cwd,
    );
    return models.map((model) => `${model.computeClass} · ${model.id}`);
  }

  async promoteSteer(
    runId: string,
    message: string,
    task: TaskSpecInput,
    criteria: GoalCriterionInput[],
    cwd: string,
  ): Promise<PromoteSteerOutput> {
    return this.#json(
      ["promote-steer", runId, "--json"],
      cwd,
      JSON.stringify({ message, task, criteria }),
    );
  }

  async #json<T>(args: string[], cwd: string, stdin?: string, signal?: AbortSignal): Promise<T> {
    const output = await runLoopCommand(args, cwd, stdin, signal);
    try {
      return JSON.parse(output) as T;
    } catch {
      throw new Error("Loop returned invalid JSON");
    }
  }
}

export function runLoopPlan(input: {
  intent: string;
  tasks: TaskSpecInput[];
  criteria?: GoalCriterionInput[];
  runId: string;
  cwd: string;
  signal: AbortSignal;
  onProgress?: (snapshot: SnapshotOutput) => void;
}): Promise<RunSummary> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.LOOP_BIN || "loop", ["__execute-plan", "--json", "--detach"], {
      cwd: input.cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.stdin.on("error", () => {
      /* close handler reports the handoff result */
    });
    child.on("error", reject);
    child.on("close", (code) => {
      input.signal.removeEventListener("abort", abort);
      if (code !== 0) {
        reject(
          new Error(
            `Run ${input.runId} handoff failed: ${(stderr || `Loop handoff exited ${code}`).slice(-4_000)}`,
          ),
        );
        return;
      }
      try {
        const accepted = JSON.parse(stdout) as {
          runId?: string;
          state?: string;
          ownerPid?: number;
        };
        if (accepted.runId !== input.runId || !accepted.state || !accepted.ownerPid)
          throw new Error("invalid handoff receipt");
        resolve(
          normalizeRunSummary(
            {
              status: accepted.state === "active" ? "running" : accepted.state,
              tasks: input.tasks.length,
            },
            input.tasks.length,
          ),
        );
      } catch {
        reject(new Error("Loop returned invalid handoff JSON"));
      }
    });
    const abort = () => child.kill("SIGTERM");
    child.stdin.end(
      JSON.stringify({
        intent: input.intent,
        runId: input.runId,
        workingDirectory: input.cwd,
        tasks: input.tasks,
        criteria: input.criteria,
      }),
    );
    if (input.signal.aborted) abort();
    else input.signal.addEventListener("abort", abort, { once: true });
  });
}

function runLoopCommand(
  args: string[],
  cwd: string,
  stdin?: string,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.LOOP_BIN || "loop", args, {
      cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error((stderr || `Loop exited ${code}`).slice(-4_000)));
    });
    if (stdin) child.stdin.end(stdin);
    else child.stdin.end();
    if (signal) {
      const cancel = () => child.kill("SIGTERM");
      if (signal.aborted) cancel();
      else signal.addEventListener("abort", cancel, { once: true });
    }
  });
}

function parseGoalPlan(value: string): GoalPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Loop plan must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Loop plan must be {tasks, criteria}");
  return validateGoalPlan(parsed as GoalPlan);
}

function parseGoalTask(value: string): { task: TaskSpecInput; criteria: GoalCriterionInput[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Loop task must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Loop task must be {task, criteria}");
  const payload = parsed as { task?: TaskSpecInput; criteria?: GoalCriterionInput[] };
  if (!payload.task || !Array.isArray(payload.criteria))
    throw new Error("Loop task must be {task, criteria}");
  validateGoalPlan({ tasks: [{ ...payload.task, dependencies: [] }], criteria: payload.criteria });
  return { task: payload.task, criteria: payload.criteria };
}

/**
 * Worker persona contract: unknown ids are rejected deterministically at
 * submission time (never silently diverge from the orchestrator's runtime
 * fallback), and blank/absent values forward as null so the orchestrator
 * applies its kind-based default. The valid id set comes from the derived
 * vocabulary — registry additions and kind-default overrides are honored
 * without code changes.
 */
function normalizePersonas(tasks: TaskSpecInput[], vocabulary: PersonaVocabulary): TaskSpecInput[] {
  const ids = [...vocabulary.ids];
  return tasks.map((task) => {
    const persona = task.persona?.trim();
    if (persona && !ids.includes(persona)) {
      throw new Error(
        `unknown persona '${persona}' in task ${task.id}. Valid persona ids: ${ids.join(", ")}`,
      );
    }
    return { ...task, persona: persona || null };
  });
}

/** kind→persona pairs plus the explicit-only tail, rendered from the derived vocabulary. */
function personaKindDefaultsProse(vocabulary: PersonaVocabulary): string {
  const pairs = Object.entries(vocabulary.kindDefaults)
    .map(([kind, id]) => `${kind}→${id}`)
    .join(", ");
  const explicit = vocabulary.explicitOnly.length
    ? `; ${vocabulary.explicitOnly.join(", ")} is explicit-request only`
    : "";
  return `${pairs}${explicit}`;
}

function leadInstructions(
  intent: string,
  vocabulary: PersonaVocabulary,
  currentRunId?: string,
): string {
  return [
    "You are the interactive Lead for Loop.",
    currentRunId
      ? `Current bound run: ${currentRunId}. For progress questions use loop_status; for a correction to a live task use loop_steer, for an added requirement use loop_add_task to promote it into the goal contract, for attention use loop_resolve, and for explicit pause/resume/cancel use loop_control. Read the durable snapshot before acting. If the bound run is terminal and the user has an unfinished requirement, start a follow-up run carrying that requirement and its completion checks. Parallel runs are allowed in this directory: when the user asks for a separate goal while this run is active, submit a new run for it; route corrections to an existing run through loop_steer and loop_add_task rather than starting a duplicate run for the same goal.`
      : "No run is bound. Use loop_status without arguments to list active runs and their intents, then loop_select_run after the user identifies the goal. Do not ask the user to supply an internal run ID.",
    "For a new engineering execution request, inspect only the minimum path and contract context needed. If ownership paths are unclear, use loop_code_map for file and symbol names, then open source text only as needed. For one bounded implementation task with exact scope, call loop_quick_run once and map each requirement to the check IDs that prove it in acceptance. For a dependency DAG, call loop_run exactly once with tasks and criteria.",
    "When the user asks about a worker or its evidence, use loop_status to select the task and loop_task to inspect its durable detail in this conversation. Use loop_guidance to distinguish correction recorded, worker delivered, and post-delivery checks; inspect coverage before claiming the changed criterion passed.",
    "Do not deeply debug, investigate root causes, or implement the change yourself; delegate that work promptly to Loop tasks.",
    "Every task must declare dependencies, exact read and write ownership, requirements, preferredCompute, minimumCompute, maximumCompute, routing risk/capabilities, maxAttempts, and at least one machine-verifiable completionChecks entry.",
    "Requirements must name the result and evidence the worker returns; downstream tasks receive dependency result summaries rather than implicit context.",
    "Do not claim completion yourself; Loop owns verification through the declared completion checks and worker evidence.",
    "Do not poll or sleep after loop_run returns; the observer updates status and completion asynchronously. End the turn promptly so the user can steer in this Pi conversation. Check status again only when the user asks or an attention needs a decision.",
    "Do not report a run terminal before the goal review passes: every durable criterion must be verified by its declared check evidence. A verifier FAIL verdict or any pending criterion keeps the goal incomplete even when the run state says completed.",
    "If a verifier reports FAIL or an unmet acceptance criterion, state that the goal is incomplete even when the run state says completed; add a corrective task while active or start a follow-up run after terminal.",
    "If a previous run ended in attention, paused, cancelled, or otherwise incomplete, explicitly carry the original goal's unresolved acceptance criteria into the next delegated DAG and state the available resume or follow-up path.",
    "Use only prior conversation and visible Loop output to identify unfinished work. Do not invent unavailable run or task details.",
    "Keep the user's mid-run correction text unchanged when calling loop_steer. Report recorded guidance, worker delivery, and verified completion as separate facts. A successful worker response alone is not verification.",
    "Promotion rule for mid-run adjustments: a user condition that changes acceptance must be promoted into the goal contract with loop_add_task — one dependent task whose criteria carry the condition, appended atomically with the user's own words, and the completion gate then holds the run open until the new criteria verify. loop_steer guidance is delivery-only and never satisfies the completion gate. If the run is terminal, start a follow-up run carrying the condition and its checks.",
    "Never claim that guidance was implemented from delivery alone. Inspect the final source and focused test evidence for the changed criterion before reporting it as done.",
    "End every goal with a closing report that separates verified criteria, unverified criteria, and the follow-up path (corrective task while active, focused follow-up run after terminal); never report an unverified criterion as done.",
    ...(currentRunId ? [] : [decompositionPrompt(intent, vocabulary)]),
  ].join("\n");
}

function normalizeRunSummary(value: unknown, fallbackTasks: number): RunSummary {
  const summary = value && typeof value === "object" ? (value as Partial<RunSummary>) : {};
  return {
    status: summary.status ?? "running",
    tasks: summary.tasks ?? fallbackTasks,
    escalations: summary.escalations ?? [],
    providersByTask: summary.providersByTask ?? {},
    startedAt: summary.startedAt ?? {},
    finishedAt: summary.finishedAt ?? {},
  };
}

function renderLeadRunSummary(runId: string, summary: RunSummary, limits: OutputLimits): string {
  if (summary.status === "completed") return renderLoopRunSummary(runId, summary, limits);
  if (summary.status !== "running")
    return compactLines(
      [
        `Run ${runId}`,
        `State: ${summary.status}`,
        "Goal: incomplete",
        `Tasks: ${summary.tasks}`,
        "Remaining: original acceptance criteria are not fully verified.",
        summary.status === "attention"
          ? "Answer the attention here, then ask me to continue."
          : "Ask me to resume or adjust this run here.",
      ],
      {
        lineLimit: limits.attentionLineLimit,
        lineTextLimit: limits.lineTextLimit,
        overflow: (omitted) => `… ${omitted} more`,
      },
    ).join("\n");
  return compactLines(
    [
      `Run ${runId}`,
      "State: running",
      "Goal: incomplete",
      `Tasks: ${summary.tasks}`,
      "Execution continues in the detached owner.",
      "Ask for progress or give corrections here at any time.",
    ],
    {
      lineLimit: limits.statusLineLimit,
      lineTextLimit: limits.lineTextLimit,
      overflow: (omitted) => `… ${omitted} more status lines`,
    },
  ).join("\n");
}

function renderLeadSnapshot(
  action: string,
  snapshot: SnapshotOutput,
  limits: OutputLimits,
  options: SnapshotRenderOptions = {},
): string {
  if (action !== "attention") {
    const rendered = renderSnapshot(action, snapshot, limits, options);
    if (action !== "status" || !verifierReportedFailure(snapshot)) return rendered;
    return compactLines(
      [
        "Review needed: verifier reported FAIL; goal incomplete.",
        ...rendered.trimEnd().split("\n"),
      ],
      {
        lineLimit: limits.statusLineLimit,
        lineTextLimit: limits.lineTextLimit,
        overflow: (omitted) => `… ${omitted} more status lines`,
      },
    ).join("\n");
  }
  if (snapshot.openAttentionIds.length === 0) return "No open attention items.";
  const lines = [
    `Attention: ${snapshot.openAttentionIds.length} open`,
    ...snapshot.openAttentionIds.map((id) => {
      const item = snapshot.attention.find((value) => value.id === id);
      return item ? `${id} · ${item.kind} · ${item.summary}` : id;
    }),
    "Answer the relevant item here to continue.",
  ];
  return compactLines(lines, {
    lineLimit: limits.attentionLineLimit,
    lineTextLimit: limits.lineTextLimit,
    overflow: (omitted) => `… ${omitted} more attention items`,
  }).join("\n");
}

function canonical(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

function result(text: string, details: Record<string, unknown>): PiToolResult {
  return { content: [{ type: "text", text }], details };
}

export default registerLoopExtension;
