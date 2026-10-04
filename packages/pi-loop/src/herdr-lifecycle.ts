import { spawn } from "node:child_process";

export type PiLifecycleEvent = "session_start" | "agent_start" | "agent_end" | "session_shutdown";

export type HerdrLifecycleState = "idle" | "working";

/** Sound choices accepted by `herdr notification show --sound`. */
export type HerdrNotificationSound = "none" | "done" | "request";

export interface HerdrNotification {
  title: string;
  body?: string;
  sound?: HerdrNotificationSound;
}

/**
 * Best-effort argv-only herdr CLI spawn shared by lifecycle reporting and
 * notification surfacing. Never a shell; failures and stalls never block the
 * caller (they are optional telemetry, not a gate on Pi's next turn).
 */
export function spawnHerdrCommand(args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const command = args[0];
    if (command === undefined) {
      resolve();
      return;
    }
    const child = spawn(command, args.slice(1), {
      stdio: "ignore",
      shell: false,
    });
    const deadline = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const finish = () => {
      clearTimeout(deadline);
      resolve();
    };
    child.on("error", finish);
    child.on("close", finish);
  });
}

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
    await spawnHerdrCommand(args, this.#timeoutMs);
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

/**
 * Surface Loop run milestones through `herdr notification show` so the
 * herdr client plays the configured toast/sound channel for main
 * orchestration outcomes only — never for worker pane transitions, which
 * stay under `[ui.sound.agents]` on the herdr side.
 */
export class HerdrNotificationReporter {
  readonly #core: { args(notification: HerdrNotification): string[] } | undefined;
  readonly #runner: ((args: string[]) => Promise<void>) | undefined;
  readonly #timeoutMs: number;

  constructor(options: HerdrLifecycleOptions = {}) {
    const env = options.environment ?? process.env;
    const pane = env.HERDR_PANE_ID;
    const bin = env.HERDR_BIN_PATH ?? "herdr";
    this.#runner = options.runner;
    this.#timeoutMs = options.timeoutMs ?? 2_000;

    const activePane = env.HERDR_ENV && pane ? pane : undefined;
    this.#core = activePane
      ? {
          args: (notification) => {
            const args = [bin, "notification", "show", notification.title];
            if (notification.body !== undefined && notification.body !== "") {
              args.push("--body", notification.body);
            }
            if (notification.sound !== undefined && notification.sound !== "none") {
              args.push("--sound", notification.sound);
            }
            return args;
          },
        }
      : undefined;
  }

  get active(): boolean {
    return this.#core !== undefined;
  }

  args(notification: HerdrNotification): string[] {
    return this.#core?.args(notification) ?? [];
  }

  async notify(notification: HerdrNotification): Promise<void> {
    if (!this.#core) return;
    if (this.#runner) {
      await this.#runner(this.#core.args(notification));
      return;
    }
    await spawnHerdrCommand(this.#core.args(notification), this.#timeoutMs);
  }
}
