import { BoundedPaneSender } from "@loop/herdr";

import { redactProviderText } from "./redact";
import type {
  AgentProvider,
  ProviderCapabilities,
  ProviderEvent,
  ResumeWorkerInput,
  StartWorkerInput,
  WorkerHandle,
  WorkerResult,
  WorkerStatus,
} from "./types";

export interface MirrorSinkWorkerStartInfo {
  providerId: string;
  workerId: string;
  runId: string;
  taskId: string;
  worktree?: string;
}

export interface MirrorSink {
  publish(workerId: string, line: string): void | Promise<void>;
  onWorkerStart?(info: MirrorSinkWorkerStartInfo): void | Promise<void>;
  onWorkerFinish?(workerId: string): void | Promise<void>;
}

export type MirrorSinkInput = MirrorSink | ((workerId: string, line: string) => void);

export function toMirrorSink(sink: MirrorSinkInput): MirrorSink {
  if (typeof sink === "function") {
    return { publish: sink };
  }
  return sink;
}

export interface RenderOptions {
  family?: string;
  lineTextLimit?: number;
}

/**
 * Pure renderer: transforms raw ProviderEvents into human-readable lines
 * according to the provider family (codex JSONL, agy text deltas, pi, generic).
 */
export function renderProviderEvent(
  event: ProviderEvent,
  options: RenderOptions = {},
): string[] {
  const lineTextLimit = options.lineTextLimit ?? 160;
  const family = options.family ?? "generic";

  const rawLines: string[] = [];

  switch (event.type) {
    case "lifecycle":
      rawLines.push(`[lifecycle] ${event.status}`);
      break;
    case "session":
      rawLines.push(`[session] ${event.sessionId}`);
      break;
    case "final":
      rawLines.push(`[result] ${event.summary}`);
      break;
    case "output":
      // D2 of the visibility decision: pi print mode exposes no incremental
      // events by specification, so its lane renders lifecycle + final result
      // only. The final stdout text still reaches the machine result path.
      if (family === "pi") {
        break;
      }
      if (family === "codex") {
        rawLines.push(...renderCodexOutput(event.text));
      } else if (family === "antigravity" || family === "agy") {
        rawLines.push(...renderAgyOutput(event.text));
      } else {
        rawLines.push(...renderGenericOutput(event.text));
      }
      break;
  }

  return rawLines
    .map((line) => cleanLine(line, lineTextLimit))
    .filter((line): line is string => line !== null);
}

function renderCodexOutput(text: string): string[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const rendered: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const item = JSON.parse(trimmed) as Record<string, unknown>;
        rendered.push(...renderCodexJson(item));
        continue;
      } catch {
        // Fall back to plain line if JSON parsing fails
      }
    }
    rendered.push(trimmed);
  }
  return rendered;
}

function renderCodexJson(record: Record<string, unknown>): string[] {
  const type = typeof record.type === "string" ? record.type : "";

  if (type === "thread.started") {
    const threadId = typeof record.thread_id === "string" ? record.thread_id : "";
    return [threadId ? `[thread] started: ${threadId}` : `[thread] started`];
  }

  if (type === "item.started") {
    const item = record.item as Record<string, unknown> | undefined;
    const itemType = typeof item?.type === "string" ? item.type : "";
    return [itemType ? `[item] started: ${itemType}` : `[item] started`];
  }

  if (type === "item.completed") {
    const item = record.item as Record<string, unknown> | undefined;
    if (item && typeof item === "object") {
      const itemType = typeof item.type === "string" ? item.type : "";
      if (itemType === "agent_message" && typeof item.text === "string") {
        return [`[message] ${item.text}`];
      }
      if (itemType === "command_execution") {
        const cmd = typeof item.command === "string" ? item.command : "";
        const exit = item.exit_code !== undefined ? ` (exit ${item.exit_code})` : "";
        return [cmd ? `[command] ${cmd}${exit}` : `[command] completed${exit}`];
      }
      return [itemType ? `[item] completed: ${itemType}` : `[item] completed`];
    }
    return [`[item] completed`];
  }

  if (type === "turn.started") return [`[turn] started`];
  if (type === "turn.completed") return [`[turn] completed`];

  if (record.item && typeof record.item === "object") {
    const item = record.item as Record<string, unknown>;
    if (typeof item.text === "string") return [`[message] ${item.text}`];
  }

  if (typeof record.text === "string") return [`[message] ${record.text}`];
  if (typeof record.message === "string") return [`[message] ${record.message}`];

  if (type) return [`[${type}]`];
  return [];
}

function renderAgyOutput(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function renderGenericOutput(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function cleanLine(line: string, limit: number): string | null {
  const stripped = line.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").trim();
  if (!stripped) return null;
  const redacted = redactProviderText(stripped);
  if (redacted.length <= limit) return redacted;
  return `${redacted.slice(0, limit - 1)}…`;
}

/**
 * MirroringProvider wraps an underlying AgentProvider.
 * It intercepts subscribe to render human-readable lines alongside the untouched
 * ProviderEvent stream (the machine result and 1Hz activity path stay untouched).
 */
/** Combines several sinks behind one MirrorSink; each sink is isolated from the others' failures. */
export function compositeSink(...sinks: MirrorSink[]): MirrorSink {
  return {
    async publish(workerId, line) {
      for (const sink of sinks) {
        try {
          await sink.publish(workerId, line);
        } catch {
          // A viewer surface must never break the machine path.
        }
      }
    },
    async onWorkerStart(info) {
      for (const sink of sinks) {
        try {
          await sink.onWorkerStart?.(info);
        } catch {
          // ignore
        }
      }
    },
    async onWorkerFinish(workerId) {
      for (const sink of sinks) {
        try {
          await sink.onWorkerFinish?.(workerId);
        } catch {
          // ignore
        }
      }
    },
  };
}

/** Structural surface of the Herdr pane API the pane sink needs (satisfied by HerdrWorkerRuntime). */
export interface PaneMirrorHost {
  createPane(
    runId: string,
    taskId: string,
    projectRoot: string,
    worktree: string,
    label: string,
  ): Promise<{ tabId: string; paneId: string }>;
  closePane(tabId: string): Promise<void>;
  sendText(paneId: string, text: string): Promise<void>;
}

export interface PaneMirrorSinkOptions {
  host: PaneMirrorHost;
  projectRoot: string;
  environment?: Record<string, string | undefined>;
  /** Maximum concurrently open mirror panes; extra workers fall back to the watch feed only. */
  paneLimit?: number;
  /** Providers whose workers own a native TUI pane and must not receive send-text mirrors. */
  excluded?: ReadonlySet<string>;
  /** Rate-limit between pane writes (D4: 250ms coalescing default). */
  intervalMs?: number;
}

interface PaneSender {
  send(line: string): void;
  close(): Promise<void>;
}

function createPaneSender(host: PaneMirrorHost, paneId: string, intervalMs: number): PaneSender {
  return new BoundedPaneSender(host, paneId, intervalMs);
}

/**
 * D4 pane surface: one passive Herdr pane per worker, created on worker start
 * and closed on worker finish (pane lifetime == worker lifetime). Headless
 * environments (no HERDR_* context) disable the sink entirely — the fail-open
 * precedent from herdr lifecycle reporting. Workers beyond the pane limit fall
 * back to the watch feed only (first-come-first-served, no reassignment queue).
 */
export class PaneMirrorSink implements MirrorSink {
  readonly #host: PaneMirrorHost;
  readonly #projectRoot: string;
  readonly #environment: Record<string, string | undefined>;
  readonly #paneLimit: number;
  readonly #excluded: ReadonlySet<string>;
  readonly #intervalMs: number;
  readonly #panes = new Map<string, { tabId: string; sender: PaneSender }>();
  readonly #pending = new Set<string>();
  readonly #finished = new Set<string>();

  constructor(options: PaneMirrorSinkOptions) {
    this.#host = options.host;
    this.#projectRoot = options.projectRoot;
    this.#environment = options.environment ?? process.env;
    this.#paneLimit = Math.max(1, options.paneLimit ?? 4);
    this.#excluded = options.excluded ?? new Set();
    this.#intervalMs = options.intervalMs ?? 250;
  }

  async onWorkerStart(info: MirrorSinkWorkerStartInfo): Promise<void> {
    if (!hasHerdrContext(this.#environment)) return;
    if (this.#excluded.has(info.providerId)) return;
    if (this.#panes.size + this.#pending.size >= this.#paneLimit) return;
    if (this.#panes.has(info.workerId) || this.#pending.has(info.workerId)) return;
    this.#pending.add(info.workerId);
    try {
      const pane = await this.#host.createPane(
        info.runId,
        info.taskId,
        this.#projectRoot,
        info.worktree ?? this.#projectRoot,
        info.taskId,
      );
      // The worker may have finished while the pane was being created.
      if (this.#finished.has(info.workerId)) {
        await this.#host.closePane(pane.tabId).catch(() => undefined);
        return;
      }
      this.#panes.set(info.workerId, {
        tabId: pane.tabId,
        sender: createPaneSender(this.#host, pane.paneId, this.#intervalMs),
      });
    } catch {
      // Pane creation failures fall back to the watch feed — never break the worker.
    } finally {
      this.#pending.delete(info.workerId);
    }
  }

  async publish(workerId: string, line: string): Promise<void> {
    this.#panes.get(workerId)?.sender.send(line);
  }

  async onWorkerFinish(workerId: string): Promise<void> {
    this.#finished.add(workerId);
    const pane = this.#panes.get(workerId);
    if (!pane) return;
    this.#panes.delete(workerId);
    try {
      await pane.sender.close();
    } finally {
      await this.#host.closePane(pane.tabId).catch(() => undefined);
    }
  }
}

function hasHerdrContext(environment: Record<string, string | undefined>): boolean {
  return Boolean(environment.HERDR_WORKSPACE_ID || environment.HERDR_PANE_ID);
}

export class MirroringProvider implements AgentProvider {
  readonly #inner: AgentProvider;
  readonly #sink: MirrorSink;
  readonly #family: string;
  readonly #lineTextLimit: number;

  constructor(
    inner: AgentProvider,
    sink: MirrorSinkInput,
    options: RenderOptions = {},
  ) {
    this.#inner = inner;
    this.#sink = toMirrorSink(sink);
    this.#family = options.family ?? deriveFamily(inner.id);
    this.#lineTextLimit = options.lineTextLimit ?? 160;
  }

  get id(): string {
    return this.#inner.id;
  }

  capabilities(): Promise<ProviderCapabilities> {
    return this.#inner.capabilities();
  }

  async start(input: StartWorkerInput): Promise<WorkerHandle> {
    const handle = await this.#inner.start(input);
    await this.#sink.onWorkerStart?.({
      providerId: this.#inner.id,
      workerId: handle.id,
      runId: input.runId,
      taskId: input.taskId,
      worktree: input.workingDirectory,
    });
    this.#publishLines(handle.id, [`[lifecycle] starting ${input.taskId}`]);
    return handle;
  }

  async resume(sessionId: string, input: ResumeWorkerInput): Promise<WorkerHandle> {
    if (!this.#inner.resume) throw new Error(`Provider ${this.id} does not support resume`);
    const handle = await this.#inner.resume(sessionId, input);
    await this.#sink.onWorkerStart?.({
      providerId: this.#inner.id,
      workerId: handle.id,
      runId: input.runId,
      taskId: input.taskId,
      worktree: input.workingDirectory,
    });
    this.#publishLines(handle.id, [`[lifecycle] resuming ${input.taskId}`]);
    return handle;
  }

  async cancel(workerId: string): Promise<void> {
    try {
      await this.#inner.cancel(workerId);
      this.#publishLines(workerId, [`[lifecycle] cancelled`]);
    } finally {
      await this.#sink.onWorkerFinish?.(workerId);
    }
  }

  async release(workerId: string): Promise<void> {
    try {
      if (this.#inner.release) {
        await this.#inner.release(workerId);
      }
    } finally {
      await this.#sink.onWorkerFinish?.(workerId);
    }
  }

  async status(workerId: string): Promise<WorkerStatus> {
    return this.#inner.status(workerId);
  }

  async result(workerId: string): Promise<WorkerResult> {
    try {
      const res = await this.#inner.result(workerId);
      this.#publishLines(workerId, [
        `[lifecycle] ${res.success ? "completed" : "failed"}`,
        `[result] ${res.summary}`,
      ]);
      return res;
    } finally {
      await this.#sink.onWorkerFinish?.(workerId);
    }
  }

  subscribe(workerId: string, listener: (event: ProviderEvent) => void): () => void {
    if (!this.#inner.subscribe) {
      return () => {};
    }
    return this.#inner.subscribe(workerId, (event) => {
      // 1. Pass untouched event to original subscriber (machine/1Hz activity path)
      listener(event);

      // 2. Render and publish human-readable lines to sink
      const lines = renderProviderEvent(event, {
        family: this.#family,
        lineTextLimit: this.#lineTextLimit,
      });
      this.#publishLines(workerId, lines);
    });
  }

  #publishLines(workerId: string, lines: string[]): void {
    for (const line of lines) {
      void this.#sink.publish(workerId, line);
    }
  }
}

function deriveFamily(providerId: string): string {
  const lower = providerId.toLowerCase();
  if (lower.startsWith("codex")) return "codex";
  if (lower.startsWith("antigravity") || lower.startsWith("agy")) return "antigravity";
  if (lower.startsWith("pi")) return "pi";
  return "generic";
}
