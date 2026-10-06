import type { ComputeClass } from "@loop/protocol";

import type { ModelProfile } from "./config";

export class ModelRegistry {
  readonly #models: Map<string, ModelProfile>;

  constructor(models: Iterable<ModelProfile>) {
    this.#models = new Map([...models].map((model) => [model.id, model]));
  }

  get(id: string): ModelProfile {
    const model = this.#models.get(id);
    if (!model) throw new Error(`model is not configured: ${id}`);
    return model;
  }

  forComputeClass(computeClass: ComputeClass): ModelProfile[] {
    return [...this.#models.values()]
      .filter((model) => model.computeClass === computeClass)
      .toSorted(
        (left, right) =>
          left.costWeight + left.latency - (right.costWeight + right.latency) ||
          left.id.localeCompare(right.id),
      );
  }
}
