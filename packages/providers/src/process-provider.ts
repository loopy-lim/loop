import type {
  AgentProvider,
  ProviderCapabilities,
  ResumeWorkerInput,
  StartWorkerInput,
  WorkerHandle,
  ProviderEvent,
  ProviderFailureKind,
  WorkerResult,
  WorkerState,
} from "./types";
import type { ProcessResult, ProcessRunner, RunningProcess } from "./process";
import type { WorkerOutputContract } from "./json-output";
import { enforceOutputContract } from "./json-output";
import { parseUsageMetadata } from "./usage";
import { redactProviderText } from "./redact";

interface Session {
  process: RunningProcess;
  status: WorkerState;
  result: Promise<WorkerResult>;
  sessionId?: string;
}

export abstract class ProcessProvider implements AgentProvider {
  readonly #sessions = new Map<string, Session>();
  /** G16: adapter-level output contract applied to every process result. */
  protected outputContract?: WorkerOutputContract;

  abstract readonly id: string;
  protected abstract runner: ProcessRunner;
  abstract capabilities(): Promise<ProviderCapabilities>;
  protected abstract launch(input: StartWorkerInput): {
    command: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string | undefined>;
  };

  async start(input: StartWorkerInput): Promise<WorkerHandle> {
    return this.startProcess(this.launch(input));
  }

  async resume(_sessionId: string, input: ResumeWorkerInput): Promise<WorkerHandle> {
    return this.start(input);
  }

  async cancel(workerId: string): Promise<void> {
    const session = this.require(workerId);
    await session.process.cancel();
    session.status = "cancelled";
  }

  async status(workerId: string): Promise<WorkerState> {
    return this.require(workerId).status;
  }

  async result(workerId: string): Promise<WorkerResult> {
    return this.require(workerId).result;
  }

  async release(workerId: string): Promise<void> {
    const session = this.require(workerId);
    await session.result;
    await session.process.cancel();
    this.#sessions.delete(workerId);
  }

  subscribe(workerId: string, listener: (event: ProviderEvent) => void): () => void {
    const subscribe = this.require(workerId).process.subscribe;
    if (!subscribe) return () => {};
    return subscribe((event) => {
      const text = redact(event.chunk);
      listener({ type: "output", stream: event.stream, text });
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        const normalized = normalizeEventLine(line);
        if (normalized) listener(normalized);
        // Upstream usage reports ride JSON lines (G17): forward observed
        // figures; unrelated lines never fabricate records.
        const usage = parseUsageMetadata(line);
        if (usage) listener({ type: "usage", usage });
      }
    });
  }

  protected startProcess(spec: {
    command: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string | undefined>;
  }): WorkerHandle {
    const process = this.runner.start(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
    });
    const session: Session = {
      process,
      status: "running",
      result: Promise.resolve({
        success: false,
        summary: "not started",
        failure: { kind: "process_error", retryable: true },
      }),
    };
    session.result = process.result.then((result) => {
      session.status = result.exitCode === 0 ? "completed" : "lost";
      return normalizeProcessResult(result, this.outputContract);
    });
    this.#sessions.set(process.id, session);
    return { id: process.id };
  }

  protected require(workerId: string): Session {
    const session = this.#sessions.get(workerId);
    if (!session) throw new Error(`unknown worker ${workerId}`);
    return session;
  }
}

export function normalizeProcessResult(result: ProcessResult, contract?: WorkerOutputContract): WorkerResult {
  const parsed = extractMachineResult(result.stdout);
  const summary = parsed.summary || redact(result.stderr) || "worker exited without a final response";
  if (result.exitCode === 0 && !parsed.summary) {
    return {
      success: false,
      summary,
      sessionId: parsed.sessionId,
      failure: { kind: "incomplete_output", retryable: true },
    };
  }
  const success = result.exitCode === 0;
  const normalized: WorkerResult = {
    success,
    summary,
    sessionId: parsed.sessionId,
    ...(!success
      ? {
          failure: {
            kind: classifyFailure(result.stderr || result.stdout),
            retryable: isRetryableFailure(classifyFailure(result.stderr || result.stdout)),
          },
        }
      : {}),
  };
  // G16: a requested JSON output contract refines the report (or, when
  // requireValid, fails an unparseable result). Contract-less calls keep the
  // exact prior behavior.
  return enforceOutputContract(normalized, contract, result.stdout);
}

function extractMachineResult(stdout: string): { summary?: string; sessionId?: string } {
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  let sessionId: string | undefined;
  for (const line of lines) {
    try {
      sessionId ??= findString(
        JSON.parse(line) as unknown,
        new Set(["thread_id", "session_id", "conversation_id"]),
      );
    } catch {
      // Plain-text output cannot carry a structured session identifier.
    }
  }
  for (const line of lines.reverse()) {
    try {
      const value = JSON.parse(line) as unknown;
      const summary = findFinalSummary(value);
      if (summary) return { summary: redact(summary), sessionId };
    } catch {
      if (line.trim()) return { summary: redact(line.trim()), sessionId };
    }
  }
  return { sessionId };
}

function normalizeEventLine(line: string): ProviderEvent | undefined {
  try {
    const value = JSON.parse(line) as unknown;
    const sessionId = findString(value, new Set(["thread_id", "session_id", "conversation_id"]));
    if (sessionId) return { type: "session", sessionId };
    const summary = findFinalSummary(value);
    if (summary) return { type: "final", summary: redact(summary) };
  } catch {
    return undefined;
  }
  return undefined;
}

function findFinalSummary(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  if (record.event === "result" && record.result && typeof record.result === "object") {
    const result = record.result as Record<string, unknown>;
    if (typeof result.response === "string" && result.response) return result.response;
  }
  if (type === "item.completed" && record.item && typeof record.item === "object") {
    const item = record.item as Record<string, unknown>;
    if (item.type === "agent_message" && typeof item.text === "string") return item.text;
  }
  for (const key of ["final", "final_message", "result", "output_text"]) {
    if (typeof record[key] === "string" && record[key]) return record[key] as string;
  }
  if (["result", "final", "message.completed", "turn.completed"].includes(type)) {
    const nested = findString(record, new Set(["text", "content", "message"]));
    if (nested) return nested;
  }
  for (const child of Object.values(record)) {
    if (typeof child === "object" && child !== null) {
      const nested = findFinalSummary(child);
      if (nested) return nested;
    }
  }
  return undefined;
}

function findString(value: unknown, keys: Set<string>): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findString(child, keys);
      if (found) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key]) return record[key] as string;
  }
  for (const child of Object.values(record)) {
    const found = findString(child, keys);
    if (found) return found;
  }
  return undefined;
}

export function classifyFailure(value: string): ProviderFailureKind {
  const normalized = value.toLowerCase();
  if (/cancel(?:led|ed)|aborted|interrupt/.test(normalized)) return "cancelled";
  if (/timed?\s*out|deadline/.test(normalized)) return "timeout";
  if (/quota|rate.?limit|too many requests|resource_exhausted|\b429\b/.test(normalized)) return "quota";
  if (/unauthorized|authorization\s*[:=]|forbidden|authentication|not logged in|login required|invalid.?key/.test(normalized)) {
    return "authentication";
  }
  if (/command not found|enoent|not installed/.test(normalized)) return "unavailable";
  return "process_error";
}

function isRetryableFailure(kind: ProviderFailureKind): boolean {
  return kind === "quota" || kind === "timeout" || kind === "process_error";
}

function redact(value: string): string {
  return redactProviderText(value);
}
