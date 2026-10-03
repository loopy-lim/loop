import type { ComputeClass } from "@loop/protocol";

import { sandboxDeclaration } from "../sandbox";
import { NodeProcessRunner, type ProcessRunner } from "../process";
import { ProcessProvider } from "../process-provider";
import { buildWorkerPrompt } from "../prompt";
import type {
  ProviderCapabilities,
  ResumeWorkerInput,
  StartWorkerInput,
  WorkerHandle,
} from "../types";

interface CodexProviderOptions {
  id?: string;
  runner?: ProcessRunner;
  cwd: string;
  model?: string;
  command?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  approveForMe?: boolean;
  /** Compute-class stance comes from configuration at construction time. */
  computeClasses: ComputeClass[];
}

export class CodexProvider extends ProcessProvider {
  readonly id: string;
  protected runner: ProcessRunner;
  readonly #cwd: string;
  readonly #model?: string;
  readonly #command: string;
  readonly #sandbox: "read-only" | "workspace-write" | "danger-full-access";
  readonly #approveForMe: boolean;
  readonly #computeClasses: ComputeClass[];

  constructor(options: CodexProviderOptions) {
    super();
    this.id = options.id ?? "codex";
    this.runner = options.runner ?? new NodeProcessRunner();
    this.#cwd = options.cwd;
    this.#model = options.model;
    this.#command = options.command ?? "codex";
    this.#sandbox = options.sandbox ?? "workspace-write";
    this.#approveForMe = options.approveForMe ?? false;
    this.#computeClasses = [...options.computeClasses];
  }

  async capabilities(): Promise<ProviderCapabilities> {
    const appServer = await this.runner.probe(this.#command, ["app-server", "--help"]);
    const executable =
      appServer.exitCode === 0
        ? appServer
        : await this.runner.probe(this.#command, ["exec", "--help"]);
    return {
      available: executable.exitCode === 0,
      models: this.#model ? [this.#model] : undefined,
      computeClasses: this.#computeClasses,
      tools: true,
      vision: true,
      structuredOutput: true,
      resumableSession: true,
    };
  }

  /** G4a: codex's own sandbox mode, reported honestly (never a Loop security boundary). */
  sandboxDeclaration() {
    if (this.#approveForMe) {
      return sandboxDeclaration({
        adapterId: this.id,
        isolation: "none",
        filesystemScoped: false,
        networkIsolated: false,
        detail:
          "approve-for-me mode launches codex without --sandbox; commands run with the caller's authority",
      });
    }
    if (this.#sandbox === "danger-full-access") {
      return sandboxDeclaration({
        adapterId: this.id,
        isolation: "none",
        filesystemScoped: false,
        networkIsolated: false,
        detail: "danger-full-access disables the codex sandbox",
      });
    }
    return sandboxDeclaration({
      adapterId: this.id,
      isolation: "partial",
      filesystemScoped: true,
      networkIsolated: true,
      detail: `codex --sandbox ${this.#sandbox} (Seatbelt/Landlock): best-effort containment, escapable in principle; not a security boundary`,
    });
  }

  protected launch(input: StartWorkerInput) {
    const cwd = input.workingDirectory ?? this.#cwd;
    const args = ["exec", "--json", "-C", cwd];
    if (this.#approveForMe) args.push("--approve-for-me");
    else args.push("--sandbox", this.#sandbox);
    if (this.#model) args.push("--model", this.#model);
    args.push(buildWorkerPrompt(input));
    return { command: this.#command, args, cwd };
  }

  async resume(sessionId: string, input: ResumeWorkerInput): Promise<WorkerHandle> {
    const args = ["exec", "resume", sessionId, "--json"];
    if (this.#model) args.push("--model", this.#model);
    args.push(buildWorkerPrompt(input));
    return this.startProcess({
      command: this.#command,
      args,
      cwd: input.workingDirectory ?? this.#cwd,
    });
  }
}
