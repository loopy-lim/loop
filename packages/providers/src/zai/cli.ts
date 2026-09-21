import { NodeProcessRunner, type ProcessRunner } from "../process";
import { ProcessProvider } from "../process-provider";
import type { ProviderCapabilities, StartWorkerInput } from "../types";

interface ZaiCliProviderOptions {
  id?: string;
  runner?: ProcessRunner;
  cwd: string;
  command?: string;
  model?: string;
  computeClasses?: string[];
}

export class ZaiCliProvider extends ProcessProvider {
  readonly id: string;
  protected runner: ProcessRunner;
  readonly #cwd: string;
  readonly #command: string;
  readonly #model?: string;
  readonly #computeClasses: string[];

  constructor(options: ZaiCliProviderOptions) {
    super();
    this.id = options.id ?? "zai-cli";
    this.runner = options.runner ?? new NodeProcessRunner();
    this.#cwd = options.cwd;
    this.#command = options.command ?? "zai";
    this.#model = options.model;
    this.#computeClasses = options.computeClasses ?? ["tiny", "fast", "balanced", "strong"];
  }

  async capabilities(): Promise<ProviderCapabilities> {
    const probe = await this.runner.probe(this.#command, ["--help"]);
    return {
      available: probe.exitCode === 0,
      models: this.#model ? [this.#model] : undefined,
      computeClasses: this.#computeClasses,
      tools: true,
      vision: false,
      structuredOutput: true,
      resumableSession: true,
    };
  }

  protected launch(input: StartWorkerInput) {
    const cwd = input.workingDirectory ?? this.#cwd;
    const args = ["--output-format", "json", "--cwd", cwd];
    if (this.#model) args.push("--model", this.#model);
    args.push("--prompt", [input.title, ...input.requirements].join("\n"));
    return { command: this.#command, args, cwd };
  }
}
