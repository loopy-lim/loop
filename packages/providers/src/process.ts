import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

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

export class NodeProcessRunner implements ProcessRunner {
  async probe(command: string, args: string[]): Promise<ProcessResult> {
    const output = spawnSync(command, args, { encoding: "utf8", timeout: 10_000 });
    return {
      exitCode: output.status ?? 1,
      stdout: bounded(output.stdout ?? ""),
      stderr: bounded(output.stderr ?? output.error?.message ?? ""),
    };
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
    const result = new Promise<ProcessResult>((resolve) => {
      child.on("error", (error) => {
        settled = true;
        resolve({ exitCode: 1, stdout, stderr: bounded(error.message) });
      });
      child.on("exit", (code, signal) => {
        settled = true;
        resolve({
          exitCode: code ?? (signal ? 128 : 1),
          stdout,
          stderr: bounded(stderr),
        });
      });
    });
    return {
      id: `process-${child.pid ?? randomUUID()}`,
      result,
      async cancel() {
        if (settled) return;
        child.kill("SIGTERM");
        const timeout = setTimeout(() => {
          if (!settled) child.kill("SIGKILL");
        }, 3_000);
        await result;
        clearTimeout(timeout);
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  }
}

function bounded(value: string): string {
  return value.slice(-256_000);
}
