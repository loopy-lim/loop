import { randomUUID } from "node:crypto";
import type { ComputeClass } from "@loop/protocol";
import { buildWorkerPrompt } from "../prompt";
import { redactProviderText } from "../redact";

import type {
  AgentProvider,
  ProviderCapabilities,
  StartWorkerInput,
  WorkerHandle,
  WorkerResult,
  WorkerState,
} from "../types";

interface ZaiApiProviderOptions {
  id?: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  mode: "general" | "coding-plan";
  generalPath?: string;
  codingPlanPath?: string;
  fetch?: FetchLike;
  /** Compute-class stance comes from configuration at construction time. */
  computeClasses: ComputeClass[];
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface Session {
  status: WorkerState;
  abort: AbortController;
  result: Promise<WorkerResult>;
}

export class ZaiApiProvider implements AgentProvider {
  readonly id: string;
  readonly #options: ZaiApiProviderOptions;
  readonly #fetch: FetchLike;
  readonly #sessions = new Map<string, Session>();

  constructor(options: ZaiApiProviderOptions) {
    if (options.mode === "coding-plan" && !options.codingPlanPath) {
      throw new Error("codingPlanPath is required in coding-plan mode");
    }
    this.id = options.id ?? `zai-${options.mode}`;
    this.#options = options;
    this.#fetch = options.fetch ?? fetch;
  }

  async capabilities(): Promise<ProviderCapabilities> {
    return {
      available: this.#options.apiKey.length > 0,
      models: [this.#options.model],
      computeClasses: this.#options.computeClasses,
      tools: true,
      vision: false,
      structuredOutput: true,
      resumableSession: false,
    };
  }

  async start(input: StartWorkerInput): Promise<WorkerHandle> {
    const id = `${this.id}-${randomUUID()}`;
    const abort = new AbortController();
    const session: Session = {
      status: "running",
      abort,
      result: Promise.resolve({
        success: false,
        summary: "not started",
        failure: { kind: "process_error", retryable: true },
      }),
    };
    session.result = this.#request(input, abort.signal).then(
      (result) => {
        session.status = result.success ? "completed" : "lost";
        return result;
      },
      (error) => {
        session.status = abort.signal.aborted ? "cancelled" : "lost";
        return {
          success: false,
          summary: redact(error instanceof Error ? error.message : String(error)),
          failure: {
            kind: abort.signal.aborted ? "cancelled" : "process_error",
            retryable: !abort.signal.aborted,
          },
        };
      },
    );
    this.#sessions.set(id, session);
    return { id };
  }

  async cancel(workerId: string): Promise<void> {
    const session = this.require(workerId);
    session.abort.abort();
    session.status = "cancelled";
    await session.result;
  }

  async status(workerId: string): Promise<WorkerState> {
    return this.require(workerId).status;
  }

  async result(workerId: string): Promise<WorkerResult> {
    return this.require(workerId).result;
  }

  async release(workerId: string): Promise<void> {
    const session = this.require(workerId);
    await session.result;
    this.#sessions.delete(workerId);
  }

  async #request(input: StartWorkerInput, signal: AbortSignal): Promise<WorkerResult> {
    const path = this.#options.mode === "general"
      ? (this.#options.generalPath ?? "/chat/completions")
      : this.#options.codingPlanPath!;
    const response = await this.#fetch(
      `${this.#options.baseUrl.replace(/\/$/, "")}${path}`,
      {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${this.#options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.#options.model,
          messages: [
            {
              role: "user",
              content: buildWorkerPrompt(input),
            },
          ],
        }),
      },
    );
    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (!response.ok) {
      return {
        success: false,
        summary: redact(payload.error?.message ?? `Z.AI HTTP ${response.status}`),
        failure: {
          kind: response.status === 401 || response.status === 403
            ? "authentication"
            : response.status === 429
              ? "quota"
              : "process_error",
          retryable: response.status === 429 || response.status >= 500,
        },
      };
    }
    const summary = payload.choices?.[0]?.message?.content?.trim() || "Z.AI completed";
    return { success: true, summary };
  }

  require(workerId: string): Session {
    const session = this.#sessions.get(workerId);
    if (!session) throw new Error(`unknown worker ${workerId}`);
    return session;
  }
}

function redact(value: string): string {
  return redactProviderText(value);
}
