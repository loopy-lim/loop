import { selectCandidate, type ComputeClass, type SelectCandidateInput, type TaskSpecInput } from "@loop/protocol";

import type { AgentProvider, ProviderCapabilities } from "./types";

type RoutingMetadata = Pick<SelectCandidateInput["candidates"][number], "costWeight" | "latency"> & { quotaGroup?: string; capabilities?: SelectCandidateInput["candidates"][number]["capabilities"] };
type RouteRequirements = Omit<SelectCandidateInput["requirements"], "highRiskFloor" | "criticalRiskFloor">;

export interface RouteSelection {
  provider: AgentProvider;
  computeClass: ComputeClass;
  reason: string;
}

export class ProviderRegistry {
  readonly #providers: AgentProvider[];
  readonly #capabilities = new Map<string, ProviderCapabilities>();

  constructor(providers: AgentProvider[], private readonly routing: Readonly<Record<string, RoutingMetadata>> = {}, private readonly riskFloors?: { high: ComputeClass; critical: ComputeClass }) {
    if (providers.length === 0) throw new Error("at least one provider is required");
    this.#providers = [...providers];
  }

  /** Fix one execution lane for a controlled comparison trial. */
  only(providerId: string): ProviderRegistry {
    const provider = this.#providers.find(candidate => candidate.id === providerId);
    if (!provider) throw new Error(`unknown provider for comparison: ${providerId}`);
    return new ProviderRegistry([provider], this.routing, this.riskFloors);
  }

  /**
   * Executes the deterministic routing decision from loop-core
   * (`policy::routing::select_candidate`) over the advertised candidates.
   * Availability filtering, capability satisfaction, the risk floor, and
   * cost/latency ordering live in Rust — this method only maps provider
   * capabilities into candidates and executes the decision.
   */
  async select(computeClass: ComputeClass, excludedProviderIds: ReadonlySet<string> = new Set()): Promise<AgentProvider> {
    return (await this.#select({ minimumCompute: computeClass, maximumCompute: computeClass, risk: "low", capabilities: { coding: 0, reasoning: 0, tools: 0, vision: 0, longContext: 0 } }, excludedProviderIds)).provider;
  }

  async selectForTask(task: Pick<TaskSpecInput, "preferredCompute" | "maximumCompute" | "routing">, excludedProviderIds: ReadonlySet<string> = new Set()): Promise<RouteSelection> {
    const routing = task.routing;
    const capabilities = routing?.required;
    const requirements: RouteRequirements = {
      minimumCompute: task.preferredCompute,
      maximumCompute: task.maximumCompute,
      risk: routing?.risk ?? "low",
      capabilities: {
        coding: capabilities?.coding ?? 0,
        reasoning: capabilities?.reasoning ?? 0,
        tools: capabilities?.tools ?? 0,
        vision: capabilities?.vision ?? 0,
        longContext: capabilities?.long_context ?? 0,
      },
    };
    const selected = await this.#select(requirements, excludedProviderIds);
    return { ...selected, reason: `risk ${requirements.risk}; required coding ${requirements.capabilities.coding}, reasoning ${requirements.capabilities.reasoning}, tools ${requirements.capabilities.tools}, vision ${requirements.capabilities.vision}, context ${requirements.capabilities.longContext}; selected ${selected.computeClass}` };
  }

  async #select(requirements: RouteRequirements, excludedProviderIds: ReadonlySet<string>): Promise<{ provider: AgentProvider; computeClass: ComputeClass }> {
    const providersByCandidate = new Map<string, AgentProvider>();
    const candidates: SelectCandidateInput["candidates"] = [];
    const excludedGroups = new Set([...excludedProviderIds].map(id => this.routing[id]?.quotaGroup ?? id));
    for (const provider of this.#providers) {
      if (excludedGroups.has(this.routing[provider.id]?.quotaGroup ?? provider.id)) continue;
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
            coding: this.routing[provider.id]?.capabilities?.coding ?? 0,
            reasoning: this.routing[provider.id]?.capabilities?.reasoning ?? 0,
            tools: capabilities.tools ? (this.routing[provider.id]?.capabilities?.tools ?? 1) : 0,
            vision: capabilities.vision ? (this.routing[provider.id]?.capabilities?.vision ?? 1) : 0,
            longContext: this.routing[provider.id]?.capabilities?.longContext ?? 0,
          },
          latency: this.routing[provider.id]?.latency ?? 0,
          costWeight: this.routing[provider.id]?.costWeight ?? 0,
          available: capabilities.available,
        });
      }
    }
    const selection = await selectCandidate({
      candidates,
      eligibleCandidateIds: candidates.map((candidate) => candidate.id),
      requirements: { ...requirements, highRiskFloor: this.riskFloors?.high ?? "strong", criticalRiskFloor: this.riskFloors?.critical ?? "frontier" },
    });
    const provider = providersByCandidate.get(selection.candidateId);
    if (!provider) throw new Error(`no provider supports compute class ${requirements.minimumCompute}`);
    return { provider, computeClass: selection.computeClass };
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
