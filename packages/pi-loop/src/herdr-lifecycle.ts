import { spawn } from "node:child_process";

export type PiLifecycleEvent = "session_start" | "agent_start" | "agent_end" | "session_shutdown";

export type HerdrLifecycleState = "idle" | "working";

export interface HerdrLifecycleSink {
  report(state: HerdrLifecycleState): Promise<void>;
  release(): Promise<void>;
}

export interface HerdrLifecycleEnvironment {
  HERDR_ENV?: string;
  HERDR_PANE_ID?: string;
  HERDR_BIN_PATH?: string;
}

export interface HerdrLifecycleOptions {
  environment?: HerdrLifecycleEnvironment;
  runner?: (args: string[]) => Promise<void>;
  source?: string;
  agent?: string;
  timeoutMs?: number;
}

interface LifecycleCore {
  args(state: HerdrLifecycleState): string[];
  releaseArgs(): string[];
  seq(): number;
}

export class HerdrLifecycleReporter implements HerdrLifecycleSink {
  readonly #core: LifecycleCore | undefined;
  readonly #runner: ((args: string[]) => Promise<void>) | undefined;
  readonly #timeoutMs: number;

  constructor(options: HerdrLifecycleOptions = {}) {
    const env = options.environment ?? process.env;
    const pane = env.HERDR_PANE_ID;
    const bin = env.HERDR_BIN_PATH ?? "herdr";
    const source = options.source ?? "loop:lead";
    const agent = options.agent ?? "loop";
    let sequence = 0;
    this.#runner = options.runner;
    this.#timeoutMs = options.timeoutMs ?? 2_000;

    const activePane = env.HERDR_ENV && pane ? pane : undefined;
    this.#core = activePane
      ? {
          args: (state) => [
            bin,
            "pane",
            "report-agent",
            "--pane",
            activePane,
            "--source",
            source,
            "--agent",
            agent,
            "--state",
            state,
            "--seq",
            String(sequence++),
          ],
          releaseArgs: () => [
            bin,
            "pane",
            "release-agent",
            "--pane",
            activePane,
            "--source",
            source,
            "--agent",
            agent,
          ],
          seq: () => sequence,
        }
      : undefined;
  }

  get active(): boolean {
    return this.#core !== undefined;
  }

  args(state: HerdrLifecycleState): string[] {
    return this.#core?.args(state) ?? [];
  }

  releaseArgs(): string[] {
    return this.#core?.releaseArgs() ?? [];
  }

  seq(): number {
    return this.#core?.seq() ?? 0;
  }

  async report(state: HerdrLifecycleState): Promise<void> {
    if (!this.#core) return;
    await this.#run(this.#core.args(state));
  }

  async release(): Promise<void> {
    if (!this.#core) return;
    await this.#run(this.#core.releaseArgs());
  }

  async #run(args: string[]): Promise<void> {
    if (this.#runner) {
      await this.#runner(args);
      return;
    }
    await HerdrLifecycleReporter.spawn(args, this.#timeoutMs);
  }

  private static spawn(args: string[], timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const command = args[0];
      // argv-only spawn: never a shell, failures are non-fatal to the Lead UI.
      if (command === undefined) {
        resolve();
        return;
      }
      const child = spawn(command, args.slice(1), {
        stdio: "ignore",
        shell: false,
      });
      // Status reporting is optional telemetry, not a gate on Pi's next turn.
      const deadline = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      const finish = () => {
        clearTimeout(deadline);
        resolve();
      };
      child.on("error", finish);
      child.on("close", finish);
    });
  }
}

export function registerHerdrLifecycle(
  pi: {
    on(event: PiLifecycleEvent, handler: () => Promise<void> | void): void;
  },
  sink: HerdrLifecycleSink,
): void {
  void pi.on("session_start", () => sink.report("idle"));
  void pi.on("agent_start", () => sink.report("working"));
  void pi.on("agent_end", () => sink.report("idle"));
  void pi.on("session_shutdown", () => sink.release());
}
