import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunningProcess {
  id: string;
  result: Promise<ProcessResult>;
  cancel(): Promise<void>;
  subscribe?(listener: (event: ProcessEvent) => void): () => void;
}

export interface ProcessEvent {
  stream: "stdout" | "stderr";
  chunk: string;
}

export interface ProcessRunner {
  probe(command: string, args: string[]): Promise<ProcessResult>;
  start(
    command: string,
    args: string[],
    options?: { cwd?: string; env?: Record<string, string | undefined> },
  ): RunningProcess;
}

export const DEFAULT_RUN_TIMEOUT_MS = 30 * 60 * 1000;

export interface NodeProcessRunnerOptions {
  cancelGraceMs?: number;
  drainTimeoutMs?: number;
  killWaitMs?: number;
  probeTimeoutMs?: number;
  runTimeoutMs?: number;
}

export class NodeProcessRunner implements ProcessRunner {
  readonly #cancelGraceMs: number;
  readonly #drainTimeoutMs: number;
  readonly #killWaitMs: number;
  readonly #probeTimeoutMs: number;
  readonly #runTimeoutMs: number | undefined;

  constructor(options: NodeProcessRunnerOptions = {}) {
    this.#cancelGraceMs = options.cancelGraceMs ?? 3_000;
    this.#drainTimeoutMs = options.drainTimeoutMs ?? 100;
    this.#killWaitMs = options.killWaitMs ?? 1_000;
    this.#probeTimeoutMs = options.probeTimeoutMs ?? 10_000;
    this.#runTimeoutMs = options.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  }

  async probe(command: string, args: string[]): Promise<ProcessResult> {
    const running = this.start(command, args);
    let stopping: Promise<void> | undefined;
    let rejectStop!: (error: unknown) => void;
    const stopFailure = new Promise<never>((_, reject) => {
      rejectStop = reject;
    });
    const timeout = setTimeout(() => {
      stopping = running.cancel();
      void stopping.catch(rejectStop);
    }, this.#probeTimeoutMs);
    try {
      const output = await Promise.race([running.result, stopFailure]);
      await stopping;
      return output;
    } finally {
      clearTimeout(timeout);
    }
  }

  start(
    command: string,
    args: string[],
    options: { cwd?: string; env?: Record<string, string | undefined> } = {},
  ): RunningProcess {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    const listeners = new Set<(event: ProcessEvent) => void>();
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout = bounded(stdout + text);
      for (const listener of listeners) listener({ stream: "stdout", chunk: text });
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr = bounded(stderr + text);
      for (const listener of listeners) listener({ stream: "stderr", chunk: text });
    });
    let settled = false;
    let drainTimer: ReturnType<typeof setTimeout> | undefined;
    let runTimer: ReturnType<typeof setTimeout> | undefined;
    const result = new Promise<ProcessResult>((resolve) => {
      const finish = (exitCode: number) => {
        if (settled) return;
        settled = true;
        if (drainTimer) clearTimeout(drainTimer);
        if (runTimer) clearTimeout(runTimer);
        resolve({ exitCode, stdout, stderr: bounded(stderr) });
      };
      child.on("error", (error) => {
        stderr = bounded(`${stderr}\n${error.message}`);
        finish(1);
      });
      child.on("exit", (code, signal) => {
        const exitCode = code ?? (signal ? 128 : 1);
        drainTimer = setTimeout(() => finish(exitCode), this.#drainTimeoutMs);
      });
      child.on("close", (code, signal) => finish(code ?? (signal ? 128 : 1)));
      if (this.#runTimeoutMs !== undefined) {
        runTimer = setTimeout(() => {
          if (settled) return;
          stderr = bounded(`${stderr}\nworker timed out after ${this.#runTimeoutMs}ms`);
          // Resolve only after cancellation has been attempted. Cancellation is
          // itself bounded below, so a timeout never inherits an unbounded wait.
          void cancelProcess().finally(() => finish(124));
        }, this.#runTimeoutMs);
      }
    });
    const cancelProcess = async () => {
      const groupPid = process.platform === "win32" ? undefined : child.pid;
      signal(child, groupPid, "SIGTERM");
      if (groupPid !== undefined && !(await waitForGroupExit(groupPid, this.#cancelGraceMs))) {
        signal(child, groupPid, "SIGKILL");
      } else if (groupPid === undefined) {
        await Promise.race([result, delay(this.#cancelGraceMs)]);
        if (!settled) child.kill("SIGKILL");
      }
    };
    return {
      id: `process-${child.pid ?? randomUUID()}`,
      result,
      cancel: async () => {
        const groupPid = process.platform === "win32" ? undefined : child.pid;
        if (settled && (groupPid === undefined || !groupExists(groupPid))) return;
        signal(child, groupPid, "SIGTERM");
        if (groupPid !== undefined) {
          const stoppedGracefully = await waitForGroupExit(groupPid, this.#cancelGraceMs);
          if (!stoppedGracefully) {
            signal(child, groupPid, "SIGKILL");
            // SIGKILL cannot be ignored; don't let a broken OS/process state
            // keep the worker result pending indefinitely.
            await Promise.race([
              waitForGroupExit(groupPid, this.#killWaitMs),
              delay(this.#killWaitMs),
            ]);
          }
          await Promise.race([result, delay(this.#killWaitMs)]);
          return;
        }
        await Promise.race([result, delay(this.#cancelGraceMs)]);
        if (!settled) child.kill("SIGKILL");
        await result;
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  }
}

function signal(
  child: ReturnType<typeof spawn>,
  groupPid: number | undefined,
  signalName: NodeJS.Signals,
): void {
  if (groupPid !== undefined) {
    try {
      process.kill(-groupPid, signalName);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    }
  }
  child.kill(signalName);
}

async function waitForGroupExit(groupPid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (!groupExists(groupPid)) return true;
    await delay(10);
  } while (Date.now() < deadline);
  return !groupExists(groupPid);
}

function groupExists(groupPid: number): boolean {
  try {
    process.kill(-groupPid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function bounded(value: string): string {
  return value.slice(-256_000);
}
