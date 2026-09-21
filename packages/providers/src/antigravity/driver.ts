import { spawn, type ChildProcess } from "node:child_process";

/**
 * Persistent agy stream-json driver (in-house, learned from
 * docs/research/2026-09-21-pi-antigravity-package-study.md).
 *
 * One long-lived `agy` process owns the native conversation; each turn writes
 * a single user event to stdin and resolves on the terminal result event.
 * Auth stays inside the agy CLI's native store — no token ever passes
 * through this code.
 *
 * Protocol (observed from agy 1.2.x):
 *   stdin  : {"event":"user","message":{"role":"user","content":"..."}}\n
 *   stdout : {"type":"init","conversationId":"..."}\n
 *            {"type":"result","result":{"status":"SUCCESS","response":"...",
 *             "conversation_id":"...","error":...,"usage":...}}\n
 *   status : SUCCESS | OK complete the turn; anything else fails closed.
 */

export interface AgyStreamDriverOptions {
  cwd: string;
  binary?: string;
  model?: string;
  /** Resume an existing agy conversation instead of starting fresh. */
  conversationId?: string;
  /** Per-turn deadline. The driver owns termination (agy's print wait is set huge). */
  turnTimeoutMs?: number;
  spawnProcess?: typeof spawn;
  onLog?: (message: string) => void;
}

export interface AgyTurnResult {
  ok: boolean;
  response: string;
  error?: string;
  conversationId?: string;
  failure?: { kind: "authentication" | "quota" | "timeout" | "cancelled" | "incomplete_output"; retryable: boolean };
}

interface PendingTurn {
  resolve: (result: AgyTurnResult) => void;
  timer: ReturnType<typeof setTimeout>;
  response: string;
}

const DEFAULT_TURN_TIMEOUT_MS = 600_000;

export class AgyStreamDriver {
  readonly #child: ChildProcess;
  readonly #options: AgyStreamDriverOptions;
  readonly #onLog: (message: string) => void;
  #conversationId: string | undefined;
  #stdoutBuffer = "";
  #pending: PendingTurn | undefined;
  #closed = false;
  #queue: Promise<unknown> = Promise.resolve();

  private constructor(child: ChildProcess, options: AgyStreamDriverOptions) {
    this.#child = child;
    this.#options = options;
    this.#conversationId = options.conversationId;
    this.#onLog = options.onLog ?? (() => undefined);

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.#onStdout(chunk));
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => this.#onLog(`stderr: ${chunk.slice(0, 200)}`));
    child.on("error", (error: Error) => this.#failAll(`agy driver process error: ${error.message}`));
    child.on("close", (code, signal) => {
      this.#closed = true;
      this.#failAll(
        signal
          ? `agy driver terminated by signal ${signal}`
          : `agy driver exited with code ${code ?? "unknown"}`,
      );
    });
  }

  static start(options: AgyStreamDriverOptions): AgyStreamDriver {
    const args = [
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      // agy's print wait can report SUCCESS with an empty response on expiry;
      // keep the process-level wait huge and let the driver own the deadline.
      "--print-timeout",
      "2147484s",
      "--dangerously-skip-permissions",
      "--disable-slash-commands",
      "--add-dir",
      options.cwd,
    ];
    if (options.model) args.push("--model", options.model);
    if (options.conversationId) args.push("--conversation", options.conversationId);
    const doSpawn = options.spawnProcess ?? spawn;
    const child = doSpawn(options.binary ?? "agy", args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
      windowsHide: true,
    });
    return new AgyStreamDriver(child, options);
  }

  get conversationId(): string | undefined {
    return this.#conversationId;
  }

  get running(): boolean {
    return !this.#closed && this.#child.exitCode === null && !this.#child.killed;
  }

  /** Serialized: turns run one at a time against the single agy process. */
  turn(prompt: string): Promise<AgyTurnResult> {
    const run = this.#queue.then(() => this.#runTurn(prompt));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  #runTurn(prompt: string): Promise<AgyTurnResult> {
    if (this.#closed) {
      return Promise.resolve({
        ok: false,
        response: "",
        error: "agy driver is closed.",
        conversationId: this.#conversationId,
        failure: { kind: "incomplete_output", retryable: true },
      });
    }
    return new Promise<AgyTurnResult>((resolve) => {
      const timeoutMs = this.#options.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
      const pending: PendingTurn = {
        resolve,
        response: "",
        timer: setTimeout(() => {
          if (this.#pending !== pending) return;
          this.#pending = undefined;
          this.cancel();
          resolve({
            ok: false,
            response: "",
            error: `agy turn timed out after ${timeoutMs}ms.`,
            conversationId: this.#conversationId,
            failure: { kind: "timeout", retryable: true },
          });
        }, timeoutMs),
      };
      this.#pending = pending;
      const line = `${JSON.stringify({ event: "user", message: { role: "user", content: prompt } })}\n`;
      this.#child.stdin?.write(line, (error) => {
        if (error) {
          if (this.#pending === pending) {
            clearTimeout(pending.timer);
            this.#pending = undefined;
            resolve({
              ok: false,
              response: "",
              error: `failed to write agy turn: ${error.message}`,
              conversationId: this.#conversationId,
              failure: { kind: "incomplete_output", retryable: true },
            });
          }
        }
      });
    });
  }

  #onStdout(chunk: string): void {
    this.#stdoutBuffer += chunk;
    for (;;) {
      const newline = this.#stdoutBuffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.#stdoutBuffer.slice(0, newline).replace(/\r$/, "");
      this.#stdoutBuffer = this.#stdoutBuffer.slice(newline + 1);
      if (!line.trim()) continue;
      this.#onLine(line);
    }
  }

  #onLine(line: string): void {
    let event: {
      event?: string;
      type?: string;
      conversation_id?: string;
      conversationId?: string;
      result?: {
        status?: string;
        response?: string;
        error?: string;
        conversation_id?: string;
      };
      step_update?: { text_delta?: string; state?: string };
    };
    try {
      event = JSON.parse(line);
    } catch {
      this.#onLog(`unparsable line: ${line.slice(0, 120)}`);
      return;
    }
    // agy 1.2.x uses "event" as the discriminator; accept "type" too.
    const type = event.event ?? event.type;
    if (type === "init") {
      const id = event.conversation_id ?? event.conversationId;
      if (typeof id === "string") this.#conversationId = id;
      return;
    }
    if (type === "step_update" && this.#pending) {
      const delta = event.step_update?.text_delta;
      if (typeof delta === "string") this.#pending.response += delta;
      return;
    }
    if (type === "result" && this.#pending) {
      const pending = this.#pending;
      clearTimeout(pending.timer);
      this.#pending = undefined;
      if (typeof event.result?.conversation_id === "string") {
        this.#conversationId = event.result.conversation_id;
      }
      // Fail closed: only an explicitly successful status completes the turn.
      const ok = event.result?.status === "SUCCESS" || event.result?.status === "OK";
      const response = ok
        ? (event.result?.response ?? pending.response)
        : (event.result?.error ?? event.result?.response ?? pending.response);
      pending.resolve({
        ok,
        response,
        error: ok ? undefined : (event.result?.error ?? `agy reported ${event.result?.status ?? "unknown"}`),
        conversationId: this.#conversationId,
        failure: ok ? undefined : { kind: "incomplete_output", retryable: true },
      });
    }
  }

  #failAll(message: string): void {
    if (!this.#pending) return;
    const pending = this.#pending;
    clearTimeout(pending.timer);
    this.#pending = undefined;
    pending.resolve({
      ok: false,
      response: "",
      error: message,
      conversationId: this.#conversationId,
      failure: { kind: "incomplete_output", retryable: true },
    });
  }

  /** Kill the whole agy process group (spawned detached with its own group). */
  cancel(): void {
    if (this.#closed) return;
    if (this.#child.pid !== undefined) {
      try {
        process.kill(-this.#child.pid, "SIGKILL");
        return;
      } catch {
        // fall through to child.kill
      }
    }
    this.#child.kill("SIGKILL");
  }

  /** End stdin gracefully, then force-kill if agy does not exit in time. */
  dispose(graceMs = 2000): void {
    if (this.#closed) return;
    const child = this.#child;
    const force = setTimeout(() => {
      if (child.exitCode === null) this.cancel();
    }, graceMs);
    child.once("close", () => clearTimeout(force));
    child.stdin?.end();
  }
}
