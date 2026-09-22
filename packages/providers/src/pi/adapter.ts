import { NodeProcessRunner, type ProcessRunner } from "../process";
import { ProcessProvider } from "../process-provider";
import { buildWorkerPrompt } from "../prompt";
import type { ProviderCapabilities, StartWorkerInput } from "../types";

interface PiProviderOptions {
  id?: string;
  runner?: ProcessRunner;
  cwd: string;
  command?: string;
  provider?: string;
  model?: string;
  computeClasses?: string[];
}

/**
 * Headless pi worker: runs `pi -p` as a one-shot process.
 * Model selection follows pi's pattern syntax ("zai/glm-5.3-flash",
 * "glm-5.3-flash", optionally ":<thinking>"), so every Loop model entry
 * maps to a distinct pi pattern while compute classes stay in Loop config.
 */
export class PiProvider extends ProcessProvider {
  readonly id: string;
  protected runner: ProcessRunner;
  readonly #cwd: string;
  readonly #command: string;
  readonly #provider?: string;
  readonly #model?: string;
  readonly #computeClasses: string[];

  constructor(options: PiProviderOptions) {
    super();
    this.id = options.id ?? "pi";
    this.runner = options.runner ?? new NodeProcessRunner();
    this.#cwd = options.cwd;
    this.#command = options.command ?? "pi";
    this.#provider = options.provider;
    this.#model = options.model;
    this.#computeClasses = options.computeClasses ?? ["tiny", "fast", "balanced", "strong", "frontier"];
  }

  async capabilities(): Promise<ProviderCapabilities> {
    const probe = await this.runner.probe(this.#command, ["--version"]);
    return {
      available: probe.exitCode === 0,
      models: this.#model ? [this.#model] : undefined,
      computeClasses: this.#computeClasses,
      tools: true,
      vision: false,
      structuredOutput: false,
      resumableSession: true,
    };
  }

  protected launch(input: StartWorkerInput) {
    const cwd = input.workingDirectory ?? this.#cwd;
    const args: string[] = [];
    if (this.#provider) args.push("--provider", this.#provider);
    if (this.#model) args.push("--model", this.#model);
    args.push("--no-session", "-p", buildWorkerPrompt(input));
    return { command: this.#command, args, cwd };
  }
}
