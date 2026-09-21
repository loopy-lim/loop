import type { TaskSpecInput } from "@loop/protocol";
import type { Orchestrator, RunSummary } from "@loop/orchestrator";

import { validateDecomposition } from "./decompose";

export type Decomposer = (intent: string) => Promise<TaskSpecInput[]>;

export class LeadCoordinator {
  constructor(
    readonly orchestrator: Orchestrator,
    readonly decompose: Decomposer,
  ) {}

  async run(input: {
    intent: string;
    databasePath: string;
    runId: string;
    signal?: AbortSignal;
  }): Promise<RunSummary> {
    const tasks = validateDecomposition(await this.decompose(input.intent));
    return this.orchestrator.run({
      databasePath: input.databasePath,
      runId: input.runId,
      tasks,
      signal: input.signal,
    });
  }
}
