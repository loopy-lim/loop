import { NodeProcessRunner } from "@loop/providers";
import { realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

import type { CompletionCheckInput } from "@loop/protocol";
import { redact } from "./redact";

export interface CompletionProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface CompletionEvidence extends CompletionProcessResult {
  id: string;
  passed: boolean;
  command: string;
  args: string[];
  workingDirectory: string;
  durationMs: number;
}

export interface CompletionRunner {
  run(
    command: string,
    args: string[],
    options: { cwd: string; timeoutMs: number; signal?: AbortSignal },
  ): Promise<CompletionProcessResult>;
}

export class CompletionVerifier {
  constructor(private readonly runner: CompletionRunner) {}

  async verify(
    checks: CompletionCheckInput[],
    rootDirectory: string,
    signal?: AbortSignal,
  ): Promise<CompletionEvidence[]> {
    const root = realpathSync(resolve(rootDirectory));
    const results: CompletionEvidence[] = [];
    for (const check of checks) {
      signal?.throwIfAborted();
      const started = Date.now();
      const cwd = safeWorkingDirectory(root, check.workingDirectory);
      const timeoutMs = safeTimeout(check.timeoutMs, check.id);
      const result = await this.runner.run(check.command, [...check.args], {
        cwd,
        timeoutMs,
        signal,
      });
      results.push({
        id: check.id,
        command: check.command,
        args: [...check.args],
        workingDirectory: cwd,
        durationMs: Date.now() - started,
        passed: !result.timedOut && result.exitCode === 0,
        ...result,
      });
    }
    return results;
  }
}

export class NodeCompletionRunner implements CompletionRunner {
  async run(
    command: string,
    args: string[],
    options: { cwd: string; timeoutMs: number; signal?: AbortSignal },
  ): Promise<CompletionProcessResult> {
    // The compiled Loop CLI points Rustra at its adjacent native bridge.
    // Passing that private path to checks in another checkout can load a
    // library with an older generated contract. Keep an explicit project
    // override; remove only the path inserted by Loop itself.
    const library =
      globalThis.process.platform === "darwin"
        ? "libloop_bridge.dylib"
        : globalThis.process.platform === "win32"
          ? "loop_bridge.dll"
          : "libloop_bridge.so";
    const privateBridge = join(dirname(globalThis.process.execPath), library);
    const env =
      globalThis.process.env.RUSTRA_BUN_LIBRARY === privateBridge
        ? { RUSTRA_BUN_LIBRARY: undefined }
        : undefined;
    const process = new NodeProcessRunner().start(command, args, { cwd: options.cwd, env });
    let timedOut = false;
    let stopping: Promise<void> | undefined;
    let rejectStop!: (error: unknown) => void;
    const stopFailure = new Promise<never>((_, reject) => {
      rejectStop = reject;
    });
    const stop = () => {
      stopping ??= process.cancel();
      void stopping.catch(rejectStop);
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, options.timeoutMs);
    options.signal?.addEventListener("abort", stop, { once: true });
    if (options.signal?.aborted) stop();
    try {
      const result = await Promise.race([process.result, stopFailure]);
      await stopping;
      if (!stopping) await process.cancel();
      return { ...result, stdout: redact(result.stdout), stderr: redact(result.stderr), timedOut };
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", stop);
    }
  }
}

function safeWorkingDirectory(root: string, requested?: string | null): string {
  const candidate = resolve(root, requested ?? ".");
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    throw new Error(`completion working directory is outside the project root: ${requested}`);
  }
  const resolved = realpathSync(candidate);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) {
    throw new Error(`completion working directory resolves outside the project root: ${requested}`);
  }
  return resolved;
}

function safeTimeout(value: number | bigint, id: string): number {
  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout) || timeout <= 0) {
    throw new Error(`completion check ${id} has an invalid timeout`);
  }
  return timeout;
}
