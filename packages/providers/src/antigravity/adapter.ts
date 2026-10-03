import type { ComputeClass } from "@loop/protocol";

import { sandboxDeclaration } from "../sandbox";
import { NodeProcessRunner, type ProcessRunner } from "../process";
import { ProcessProvider } from "../process-provider";
import { buildWorkerPrompt } from "../prompt";
import type { ProviderCapabilities, StartWorkerInput } from "../types";
import type { ResumeWorkerInput, WorkerHandle } from "../types";

interface AntigravityProviderOptions {
  id?: string;
  runner?: ProcessRunner;
  cwd: string;
  command?: string;
  model?: string;
  sandbox?: boolean;
  /** Compute-class stance comes from configuration at construction time. */
  computeClasses: ComputeClass[];
}

export class AntigravityProvider extends ProcessProvider {
  readonly id: string;
  protected runner: ProcessRunner;
  readonly #cwd: string;
  readonly #command: string;
  readonly #model?: string;
  readonly #sandbox: boolean;
  readonly #computeClasses: ComputeClass[];

  constructor(options: AntigravityProviderOptions) {
    super();
    this.id = options.id ?? "antigravity";
    this.runner = options.runner ?? new NodeProcessRunner();
    this.#cwd = options.cwd;
    this.#command = options.command ?? "agy";
    this.#model = options.model;
    this.#sandbox = options.sandbox ?? true;
    this.#computeClasses = [...options.computeClasses];
  }

  async capabilities(): Promise<ProviderCapabilities> {
    const available = (await this.runner.probe(this.#command, ["--help"])).exitCode === 0;
    let models: string[] | undefined;
    if (available) {
      const discovered = await this.runner.probe(this.#command, ["models"]);
      if (discovered.exitCode === 0) {
        models = parseModels(discovered.stdout);
      }
    }
    return {
      available,
      models,
      computeClasses: this.#computeClasses,
      tools: true,
      vision: true,
      structuredOutput: true,
      resumableSession: true,
    };
  }

  /** G4a: agy's --sandbox flag, reported as best-effort vendor policy. */
  sandboxDeclaration() {
    if (!this.#sandbox) {
      return sandboxDeclaration({
        adapterId: this.id,
        isolation: "none",
        filesystemScoped: false,
        networkIsolated: false,
        detail: "agy launched without --sandbox",
      });
    }
    return sandboxDeclaration({
      adapterId: this.id,
      isolation: "partial",
      filesystemScoped: true,
      networkIsolated: false,
      detail:
        "agy --sandbox (vendor CLI policy); escape properties unaudited, not a security boundary",
    });
  }

  protected launch(input: StartWorkerInput) {
    const cwd = input.workingDirectory ?? this.#cwd;
    const args = ["--output-format", "stream-json"];
    if (this.#sandbox) args.push("--sandbox");
    if (this.#model) args.push("--model", this.#model);
    args.push("--print", buildWorkerPrompt(input));
    return { command: this.#command, args, cwd };
  }

  async resume(sessionId: string, input: ResumeWorkerInput): Promise<WorkerHandle> {
    const launch = this.launch(input);
    const printIndex = launch.args.indexOf("--print");
    launch.args.splice(printIndex, 0, "--conversation", sessionId);
    return this.startProcess(launch);
  }
}

function parseModels(output: string): string[] | undefined {
  try {
    const value = JSON.parse(output) as { models?: unknown[] };
    return value.models?.filter((model): model is string => typeof model === "string");
  } catch {
    const models = output
      .split(/\r?\n/)
      .map((line) => line.match(/^([a-z0-9][a-z0-9._-]*)\s+/i)?.[1])
      .filter((model): model is string => Boolean(model));
    return models.length > 0 ? models : undefined;
  }
}
