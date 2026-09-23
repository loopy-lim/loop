import { selectCandidate, type ComputeClass, type SelectCandidateInput } from "@loop/protocol";

import type { AgentProvider, ProviderCapabilities } from "./types";

export class ProviderRegistry {
  readonly #providers: AgentProvider[];
  readonly #capabilities = new Map<string, ProviderCapabilities>();

  constructor(providers: AgentProvider[]) {
    if (providers.length === 0) throw new Error("at least one provider is required");
    this.#providers = [...providers];
  }

  /**
   * Executes the deterministic routing decision from loop-core
   * (`policy::routing::select_candidate`) over the advertised candidates.
   * Availability filtering, capability satisfaction, the risk floor, and
   * cost/latency ordering live in Rust — this method only maps provider
   * capabilities into candidates and executes the decision.
   */
  async select(computeClass: ComputeClass): Promise<AgentProvider> {
    const providersByCandidate = new Map<string, AgentProvider>();
    const candidates: SelectCandidateInput["candidates"] = [];
    for (const provider of this.#providers) {
      const capabilities = await this.#capabilitiesFor(provider);
      for (const candidateClass of capabilities.computeClasses) {
        // Candidate ids pair a provider with one advertised class so the Rust
        // decision ranks (provider, class) pairs. `computeClasses` is typed
        // with the generated `ComputeClass` union, so no cast and no
        // TypeScript copy of the enum exist here.
        const id = `${provider.id}::${candidateClass}`;
        providersByCandidate.set(id, provider);
        candidates.push({
          id,
          computeClass: candidateClass,
          capabilities: {
            coding: 0,
            reasoning: 0,
            tools: capabilities.tools ? 1 : 0,
            vision: capabilities.vision ? 1 : 0,
            longContext: 0,
          },
          latency: 0,
          costWeight: 0,
          available: capabilities.available,
        });
      }
    }
    const selection = await selectCandidate({
      candidates,
      eligibleCandidateIds: candidates.map((candidate) => candidate.id),
      requirements: {
        capabilities: { coding: 0, reasoning: 0, tools: 0, vision: 0, longContext: 0 },
        minimumCompute: computeClass,
        maximumCompute: computeClass,
        risk: "low",
      },
    });
    const provider = providersByCandidate.get(selection.candidateId);
    if (!provider) throw new Error(`no provider supports compute class ${computeClass}`);
    return provider;
  }

  async #capabilitiesFor(provider: AgentProvider): Promise<ProviderCapabilities> {
    let capabilities = this.#capabilities.get(provider.id);
    if (!capabilities) {
      capabilities = await provider.capabilities();
      this.#capabilities.set(provider.id, capabilities);
    }
    return capabilities;
  }
}
