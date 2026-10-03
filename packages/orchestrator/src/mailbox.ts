import type { OrchestrationControl } from "./control";

/**
 * Async human-input mailbox + delivery bookkeeping (docs/research/async-human-input.md §6).
 *
 * The receive path stays exactly the existing steer surface: `loop steer` /
 * watch relay → `steerRun` → `GuidanceAdded` append. This adapter only READS
 * those events through the existing `subscribeEvents` seam and never touches
 * run state, so pending/attention scheduling is never blocked by operator
 * input.
 *
 * Per-active-worker mailboxes are filled by a polling tap and drained only at
 * safe boundaries:
 *  (a) a live worker on a steer-capable provider; the drain policy follows the
 *      steer channel's own coalescing semantics: a channel that self-coalesces
 *      at its boundaries (the turn-boundary inbox of a turn-loop worker) hands
 *      off on every tap tick, while a conversation-scoped channel (a live pi
 *      prompt) waits out the coalescing window (bursts within one window are
 *      delivered as one combined message). Neither hand-off ever waits for
 *      tool completion or a re-claim — a steer issued mid-turn enters the
 *      worker's transcript at the very next turn boundary;
 *  (b) otherwise the next-claim path: `getTaskContext` already folds run-wide
 *      and task-targeted guidance into every new attempt, and `claimContext`
 *      adds what it cannot know — guidance targeted at the claimed task's
 *      transitive ancestors (the descendant-sub-task injection rule) — and
 *      drops what the delivery watermark already covered.
 *
 * Delivery bookkeeping (M-TL2): every successful live drain and every
 * claim-context injection appends a `GuidanceDelivered { task_id, worker_id,
 * through_sequence }` event (Rust-first, ascending-only watermark enforced by
 * the loop-core reducer). The tap replays those events from the log, so the
 * watermark survives process restarts: guidance at or below the watermark is
 * never re-steered and never re-injected (at-most-once live; the recorded
 * guidance list remains the fallback exactly once per delivery gap). A crash
 * between `provider.steer` and the append leaves the guidance pending in the
 * projection — the next claim injects it exactly once.
 *
 * Everything here is orchestrator-adapter memory: no provider or pane concept
 * crosses into loop-core, and a mailbox failure must never fail a run.
 */

export interface GuidanceMailboxOptions {
  /** Master switch; default true. */
  enabled?: boolean;
  /**
   * Quiet period between live drains of a conversation-scoped steer channel
   * (spam coalescing); boundary-inbox channels use it only as the retry
   * backoff after a rejecting hand-off. Default 2000ms.
   */
  coalescingWindowMs?: number;
  /** Event-tap poll period; bounds receive-to-drain latency. Default 100ms. */
  pollIntervalMs?: number;
  /** Byte budget for one combined steer message; overflow waits for the next window. Default 16000 (steerRun's own cap). */
  maxMessageBytes?: number;
}

export const GUIDANCE_MAILBOX_DEFAULTS = {
  coalescingWindowMs: 2000,
  pollIntervalMs: 100,
  maxMessageBytes: 16000,
} as const;

/** GuidanceAdded/GuidanceDelivered payload shape (serde tag/content) inside EventOutput.payloadJson. */
interface GuidanceEventPayload {
  kind?: {
    type?: unknown;
    data?: {
      task_id?: unknown;
      message?: unknown;
      worker_id?: unknown;
      through_sequence?: unknown;
    };
  };
}

interface PendingGuidance {
  sequence: number;
  message: string;
}

/** One GuidanceAdded observation from the event log, in log order. */
interface GuidanceRecord {
  sequence: number;
  taskId: string | null;
  message: string;
}

interface MailboxTarget {
  /** Key of this target in the mailbox map (one active worker per task). */
  readonly taskId: string;
  workerId: string;
  /** Live steer channel; absent → the mailbox only observes and the next-claim path applies. */
  steer?: (message: string) => Promise<void>;
  /** Drain policy of the live channel (see SteerCoalescing). */
  steerCoalescing: SteerCoalescing;
  /** Guidance at or below this sequence already reached the worker's start context. */
  deliveredThroughSequence: number;
  pending: PendingGuidance[];
  /**
   * Earliest permitted next drain (ms epoch). Window targets advance it after
   * every drain (spam coalescing); inbox targets advance it only after a
   * failed hand-off, so a rejecting channel is never retried on every tick.
   */
  nextDrainAt: number;
}

export interface RegisteredWorker {
  taskId: string;
  workerId: string;
  /**
   * Highest GuidanceAdded sequence already present in this worker's start
   * context: `claimContext().throughSequence` when the mailbox assembled the
   * claim context, otherwise the pre-context snapshot sequence (guidance at
   * or below it is folded in by getTaskContext).
   */
  deliveredThroughSequence: number;
  /** Present only when the provider exposes the optional live steer channel. */
  steer?: (message: string) => Promise<void>;
  /** Drain policy for the live channel; defaults to "window". */
  steerCoalescing?: SteerCoalescing;
}

/** Claim-context view produced by claimContext(): the guidance list a worker should start with. */
export interface ClaimGuidance {
  guidance: string[];
  /** Highest GuidanceAdded sequence delivered through this claim context. */
  throughSequence: number;
}

/**
 * Capability declaration for providers whose steer channel coalesces at its
 * own delivery boundaries (decision TL2/M-TL2: a turn-boundary worker's inbox
 * IS the coalescer, so the research §6 drain trigger "worker is at its next
 * turn boundary" needs no mailbox-side wait). Structural by design: adapters
 * declare the field, the orchestrator reads only the capability and still
 * cannot tell a turn-loop worker from a pi worker.
 */
export interface TurnBoundarySteer {
  readonly steerDelivery: "turn_boundary";
}

/**
 * Per-target live-drain policy: "inbox" — the channel self-coalesces, so the
 * mailbox hands off on every tap tick and applies its window only as retry
 * backoff after a rejection; "window" — the mailbox spaces drains by the
 * coalescing window (conversation-scoped channels).
 */
export type SteerCoalescing = "inbox" | "window";

export function steerCoalescingOf(provider: unknown): SteerCoalescing {
  const declared = (provider as Partial<TurnBoundarySteer> | null | undefined)?.steerDelivery;
  return declared === "turn_boundary" ? "inbox" : "window";
}

export function resolveMailboxOptions(
  options: GuidanceMailboxOptions = {},
): Required<GuidanceMailboxOptions> {
  return {
    enabled: options.enabled ?? true,
    coalescingWindowMs: positive(
      options.coalescingWindowMs,
      GUIDANCE_MAILBOX_DEFAULTS.coalescingWindowMs,
    ),
    pollIntervalMs: positive(options.pollIntervalMs, GUIDANCE_MAILBOX_DEFAULTS.pollIntervalMs),
    maxMessageBytes: positive(options.maxMessageBytes, GUIDANCE_MAILBOX_DEFAULTS.maxMessageBytes),
  };
}

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * How many leading messages fit into one combined delivery under the byte
 * budget (separators included). The first message always fits: steerRun
 * already rejects messages above 16000 bytes, so a single guidance can never
 * exceed the default budget on its own.
 */
export function guidanceBatchSize(messages: readonly string[], maxMessageBytes: number): number {
  let total = 0;
  let count = 0;
  for (const message of messages) {
    const size = Buffer.byteLength(message) + (count > 0 ? 1 : 0);
    if (count > 0 && total + size > maxMessageBytes) break;
    total += size;
    count += 1;
  }
  return count;
}

function parseGuidanceAdded(
  payloadJson: string,
): { taskId: string | null; message: string } | undefined {
  const payload = parsePayload(payloadJson);
  if (payload?.type !== "guidance_added") return undefined;
  const data = payload.data;
  if (typeof data?.message !== "string" || data.message.length === 0) return undefined;
  const taskId = data.task_id === null || data.task_id === undefined ? null : String(data.task_id);
  return { taskId, message: data.message };
}

function parseGuidanceDelivered(
  payloadJson: string,
): { taskId: string; throughSequence: number } | undefined {
  const payload = parsePayload(payloadJson);
  if (payload?.type !== "guidance_delivered") return undefined;
  const through = Number(payload.data?.through_sequence);
  const taskId = payload.data?.task_id;
  if (!Number.isFinite(through) || typeof taskId !== "string" || taskId.length === 0)
    return undefined;
  return { taskId, throughSequence: through };
}

function isTaskCreated(payloadJson: string): boolean {
  return parsePayload(payloadJson)?.type === "task_created";
}

function parsePayload(
  payloadJson: string,
): { type: string; data?: Record<string, unknown> } | undefined {
  let payload: GuidanceEventPayload;
  try {
    payload = JSON.parse(payloadJson) as GuidanceEventPayload;
  } catch {
    return undefined;
  }
  if (typeof payload.kind?.type !== "string") return undefined;
  return {
    type: payload.kind.type,
    data: payload.kind.data as Record<string, unknown> | undefined,
  };
}

/**
 * Tap + mailbox + safe-boundary drain + delivery watermark, owned by one
 * Orchestrator.execute(). Lifecycle: start() once, register/release per
 * active worker, stop() in the owner's finally. Every control-surface error
 * is swallowed by design — the mailbox is a delivery enhancement and the run
 * history remains the fallback.
 */
export class GuidanceMailbox {
  readonly #control: OrchestrationControl;
  readonly #databasePath: string;
  readonly #runId: string;
  readonly #coalescingWindowMs: number;
  readonly #pollIntervalMs: number;
  readonly #maxMessageBytes: number;
  /** Execution-lease owner for GuidanceDelivered appends; absent outside an owned execution. */
  readonly #executionOwner?: string;
  readonly #targets = new Map<string, MailboxTarget>();
  /** Every GuidanceAdded seen from the log, in ascending sequence order. */
  readonly #guidance: GuidanceRecord[] = [];
  /** message → highest GuidanceAdded sequence (claim-context filtering). */
  readonly #sequenceByMessage = new Map<string, number>();
  /** Per-task delivery watermark replayed from GuidanceDelivered events. */
  readonly #watermarks = new Map<string, number>();
  /** taskId → direct dependency ids, from the run plan (descendant routing). */
  #directDependencies = new Map<string, readonly string[]>();
  #tapSequence = 0;
  #tapPromise: Promise<void> | undefined;
  #pollChain: Promise<void> = Promise.resolve();
  #graphStale = true;
  #stopped = false;
  #delivered = 0;

  constructor(
    control: OrchestrationControl,
    databasePath: string,
    runId: string,
    options: GuidanceMailboxOptions = {},
    executionOwner?: string,
  ) {
    const resolved = resolveMailboxOptions(options);
    this.#control = control;
    this.#databasePath = databasePath;
    this.#runId = runId;
    this.#coalescingWindowMs = resolved.coalescingWindowMs;
    this.#pollIntervalMs = resolved.pollIntervalMs;
    this.#maxMessageBytes = resolved.maxMessageBytes;
    this.#executionOwner = executionOwner;
  }

  /** Number of guidance messages delivered live so far (diagnostics/tests). */
  get delivered(): number {
    return this.#delivered;
  }

  start(): void {
    if (this.#stopped || this.#tapPromise) return;
    this.#tapPromise = this.#tap();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    await this.#tapPromise;
  }

  register(worker: RegisteredWorker): void {
    if (this.#stopped) return;
    this.#targets.set(worker.taskId, {
      taskId: worker.taskId,
      workerId: worker.workerId,
      ...(worker.steer ? { steer: worker.steer } : {}),
      steerCoalescing: worker.steerCoalescing ?? "window",
      deliveredThroughSequence: worker.deliveredThroughSequence,
      pending: [],
      nextDrainAt: 0,
    });
    // The claim context this worker starts with is a delivery: advance the
    // in-memory watermark and persist it (fire-and-forget — the mailbox must
    // never fail the run; a lost append only widens the fallback window).
    this.#advanceWatermark(worker.taskId, worker.deliveredThroughSequence);
  }

  /**
   * Drops the worker and any guidance still pending for it. Intentional: the
   * recorded-steer contract keeps every guidance in the run history, so the
   * next attempt (or dependent claim) receives it through the claim-context
   * path.
   */
  release(taskId: string): void {
    this.#targets.delete(taskId);
  }

  /**
   * Claim-context view for one claimed task (M-TL2 injection rule):
   *  - keeps the run-wide and task-targeted guidance getTaskContext folded
   *    in, minus everything the delivery watermark already covered;
   *  - appends guidance targeted at the task's transitive ancestors (the
   *    descendant sub-task rule), which getTaskContext never includes;
   *  - reports the highest covered sequence so register() can watermark the
   *    claim-context delivery.
   * Unknown messages fail open (kept) so the recorded-steer contract can
   * never lose guidance to a parsing gap.
   */
  async claimContext(taskId: string, contextGuidance: readonly string[]): Promise<ClaimGuidance> {
    try {
      await this.#synchronize();
    } catch {
      // A control-surface failure degrades to the in-memory view: the
      // mailbox must never fail the run, and the recorded guidance stays
      // available through the bridge context either way.
    }
    const watermark = this.#watermarkOf(taskId);
    const resolved = contextGuidance.filter((message) => {
      const sequence = this.#sequenceByMessage.get(message);
      return sequence === undefined || sequence > watermark;
    });
    const ancestors = this.#ancestorsOf(taskId);
    const extras = this.#guidance.filter(
      (item) =>
        item.sequence > watermark &&
        item.taskId !== null &&
        item.taskId !== taskId &&
        ancestors.has(item.taskId),
    );
    let throughSequence = watermark;
    for (const message of resolved) {
      throughSequence = Math.max(throughSequence, this.#sequenceByMessage.get(message) ?? 0);
    }
    for (const item of extras) throughSequence = Math.max(throughSequence, item.sequence);
    return { guidance: [...resolved, ...extras.map((item) => item.message)], throughSequence };
  }

  #watermarkOf(taskId: string): number {
    return this.#watermarks.get(taskId) ?? 0;
  }

  #advanceWatermark(taskId: string, throughSequence: number): void {
    if (throughSequence <= this.#watermarkOf(taskId)) return;
    this.#watermarks.set(taskId, throughSequence);
    if (throughSequence > 0) {
      void this.#control
        .recordGuidanceDelivered({
          databasePath: this.#databasePath,
          runId: this.#runId,
          guidance: {
            taskId,
            workerId: this.#targets.get(taskId)?.workerId ?? "claim-context",
            throughSequence,
          },
          executionOwner: this.#executionOwner,
        })
        .catch(() => {
          // The append is bookkeeping; the projection still holds the
          // guidance, so the recorded-steer fallback covers the gap.
        });
    }
  }

  async #tap(): Promise<void> {
    while (!this.#stopped) {
      try {
        await this.#synchronize();
        await this.#drainDue();
      } catch {
        // The tap never disturbs the run; the next tick retries.
      }
      await this.#sleep(this.#pollIntervalMs);
    }
  }

  /**
   * Serializes every log read (tap tick and claimContext) through one chain,
   * so pending routing never double-counts a sequence.
   */
  #synchronize(): Promise<void> {
    const run = this.#pollChain.then(() => this.#poll());
    this.#pollChain = run.catch(() => {});
    return run;
  }

  async #poll(): Promise<void> {
    const events = await this.#control.subscribeEvents({
      databasePath: this.#databasePath,
      runId: this.#runId,
      afterSequence: this.#tapSequence,
      limit: 500,
    });
    if (events.length === 0) return;
    // Pass one: advance the tap, observe the graph, collect new guidance and
    // replayed deliveries. Routing waits for the graph so a guidance event
    // and its sub-task's TaskCreated in the same batch still route correctly.
    const added: GuidanceRecord[] = [];
    let sawTaskCreated = false;
    for (const event of events) {
      const sequence = Number(event.sequence);
      this.#tapSequence = Math.max(this.#tapSequence, sequence);
      if (isTaskCreated(event.payloadJson)) sawTaskCreated = true;
      const delivered = parseGuidanceDelivered(event.payloadJson);
      if (delivered) {
        // Log replay: the watermark survives restarts (crash recovery).
        this.#watermarks.set(
          delivered.taskId,
          Math.max(this.#watermarkOf(delivered.taskId), delivered.throughSequence),
        );
        continue;
      }
      const guidance = parseGuidanceAdded(event.payloadJson);
      if (guidance) {
        added.push({ sequence, taskId: guidance.taskId, message: guidance.message });
        this.#sequenceByMessage.set(
          guidance.message,
          Math.max(this.#sequenceByMessage.get(guidance.message) ?? 0, sequence),
        );
      }
    }
    if (sawTaskCreated || this.#graphStale) await this.#refreshGraph();
    // Pass two: route in log order (the #guidance list stays ascending).
    for (const item of added) {
      this.#guidance.push(item);
      for (const target of this.#targetsFor(item.taskId)) {
        if (item.sequence <= target.deliveredThroughSequence) continue;
        if (item.sequence <= this.#watermarkOf(target.taskId)) continue;
        target.pending.push({ sequence: item.sequence, message: item.message });
      }
    }
    // Page until the log is caught up (store caps one read at 500 here).
    if (events.length >= 500) await this.#poll();
  }

  async #refreshGraph(): Promise<void> {
    try {
      const plan = await this.#control.getRunPlan({
        databasePath: this.#databasePath,
        runId: this.#runId,
      });
      this.#directDependencies = new Map(
        plan.tasks.map((task) => [task.id, [...task.dependencies]]),
      );
      this.#graphStale = false;
    } catch {
      // Routing keeps the previous graph; the next poll retries.
    }
  }

  /**
   * Live-delivery routing (TL2): guidance for task T reaches T's worker and
   * the workers of T's transitively dependent sub-tasks. Unknown graphs
   * degrade to exact-task routing (run-wide guidance always broadcasts).
   */
  #targetsFor(taskId: string | null): MailboxTarget[] {
    if (taskId === null) return [...this.#targets.values()];
    const audience = this.#descendantsOf(taskId);
    return [...this.#targets.values()].filter((target) => audience.has(target.taskId));
  }

  #descendantsOf(taskId: string): Set<string> {
    const audience = new Set<string>([taskId]);
    if (this.#directDependencies.size === 0) return audience;
    // Reverse edges: dep → tasks that depend on it; BFS collects the
    // transitive dependent closure (the descendant sub-tasks).
    const dependents = new Map<string, string[]>();
    for (const [task, dependencies] of this.#directDependencies) {
      for (const dependency of dependencies) {
        const bucket = dependents.get(dependency) ?? [];
        bucket.push(task);
        dependents.set(dependency, bucket);
      }
    }
    const queue = [taskId];
    while (queue.length > 0) {
      const current = queue.pop();
      if (current === undefined) break; // length > 0 이 pop 을 보장한다
      for (const next of dependents.get(current) ?? []) {
        if (audience.has(next)) continue;
        audience.add(next);
        queue.push(next);
      }
    }
    return audience;
  }

  /** Transitive ancestors of a task (dependency closure), for claim-context injection. */
  #ancestorsOf(taskId: string): Set<string> {
    const ancestors = new Set<string>();
    if (this.#directDependencies.size === 0) return ancestors;
    const queue = [...(this.#directDependencies.get(taskId) ?? [])];
    while (queue.length > 0) {
      const current = queue.pop();
      if (current === undefined) break; // length > 0 이 pop 을 보장한다
      if (ancestors.has(current)) continue;
      ancestors.add(current);
      queue.push(...(this.#directDependencies.get(current) ?? []));
    }
    return ancestors;
  }

  async #drainDue(): Promise<void> {
    const now = Date.now();
    for (const target of this.#targets.values()) {
      if (target.pending.length === 0 || !target.steer) continue;
      // Inbox targets skip the spam window on purpose: the provider's queue
      // is the coalescer (decision TL2), so the hand-off lands on every tap
      // tick and a steer never waits out a window it does not need. The
      // window then only bounds retry backoff after a rejection below.
      if (now < target.nextDrainAt) continue;
      // The watermark may have advanced since the item was queued (e.g. the
      // same guidance reached the task through a claim context).
      const watermark = this.#watermarkOf(target.taskId);
      target.pending = target.pending.filter((item) => item.sequence > watermark);
      if (target.pending.length === 0) continue;
      const batch = guidanceBatchSize(
        target.pending.map((item) => item.message),
        this.#maxMessageBytes,
      );
      if (batch === 0) continue;
      const message = target.pending
        .slice(0, batch)
        .map((item) => item.message)
        .join("\n");
      const lastPending = target.pending[batch - 1];
      if (lastPending === undefined) continue; // batch <= pending.length 불변식
      const throughSequence = lastPending.sequence;
      try {
        await target.steer(message);
      } catch {
        // Rejection (e.g. agent_blocked) keeps the messages pending — the
        // recorded-steer contract already preserves them in run history. Even
        // inbox targets back off one window so a rejecting channel is not
        // retried on every tick.
        target.nextDrainAt = now + this.#coalescingWindowMs;
        continue;
      }
      // Delivery happened; drop the batch immediately (at-most-once live).
      // Byte-budget overflow waits for the next drain: a window after the
      // window, the next tick for an inbox.
      target.pending.splice(0, batch);
      this.#delivered += batch;
      if (target.steerCoalescing === "window") target.nextDrainAt = now + this.#coalescingWindowMs;
      // The append is the persistence point: a crash before it leaves the
      // guidance pending in the projection, and the next claim injects it
      // exactly once. An append failure re-opens the fallback the same way.
      this.#advanceWatermark(target.taskId, throughSequence);
    }
  }

  #sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, milliseconds);
      // Never keep a process alive for the mailbox alone.
      timer.unref?.();
    });
  }
}
