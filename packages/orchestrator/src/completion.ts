import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

import type { CompletionCheckInput } from "@loop/protocol";

export interface CompletionProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface CompletionEvidence extends CompletionProcessResult {
  id: string;
  passed: boolean;
}

export interface CompletionRunner {
  run(
    command: string,
    args: string[],
    options: { cwd: string; timeoutMs: number },
  ): Promise<CompletionProcessResult>;
}

export class CompletionVerifier {
  constructor(private readonly runner: CompletionRunner) {}

  async verify(
    checks: CompletionCheckInput[],
    rootDirectory: string,
  ): Promise<CompletionEvidence[]> {
    const root = realpathSync(resolve(rootDirectory));
    const results: CompletionEvidence[] = [];
    for (const check of checks) {
      const cwd = safeWorkingDirectory(root, check.workingDirectory);
      const timeoutMs = safeTimeout(check.timeoutMs, check.id);
      const result = await this.runner.run(check.command, [...check.args], { cwd, timeoutMs });
      results.push({
        id: check.id,
        passed: !result.timedOut && result.exitCode === 0,
        ...result,
      });
    }
    return results;
  }
}

export class NodeCompletionRunner implements CompletionRunner {
  run(
    command: string,
    args: string[],
    options: { cwd: string; timeoutMs: number },
  ): Promise<CompletionProcessResult> {
    return new Promise((resolveResult) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: process.env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      child.stdout.on("data", (chunk) => {
        stdout = bounded(stdout + String(chunk));
      });
      child.stderr.on("data", (chunk) => {
        stderr = bounded(stderr + String(chunk));
      });
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!settled) child.kill("SIGKILL");
        }, 500).unref();
      }, options.timeoutMs);
      timeout.unref();

      const finish = (exitCode: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolveResult({ exitCode, stdout, stderr: redact(stderr), timedOut });
      };
      child.on("error", (error) => {
        stderr = bounded(`${stderr}\n${error.message}`);
        finish(1);
      });
      child.on("close", (code, signal) => finish(code ?? (signal ? 128 : 1)));
    });
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

function bounded(value: string): string {
  return value.slice(-16_000);
}

function redact(value: string): string {
  return bounded(
    value.replace(
      /(?:api[_-]?key|token|authorization|password)\s*[:=]\s*\S+/gi,
      "[credential]=[redacted]",
    ),
  );
}
