import type { AgentProvider, ProviderCapabilities } from "./types";

export class ProviderRegistry {
  readonly #providers: AgentProvider[];
  readonly #capabilities = new Map<string, ProviderCapabilities>();

  constructor(providers: AgentProvider[]) {
    if (providers.length === 0) throw new Error("at least one provider is required");
    this.#providers = [...providers];
  }

  async select(computeClass: string): Promise<AgentProvider> {
    for (const provider of this.#providers) {
      let capabilities = this.#capabilities.get(provider.id);
      if (!capabilities) {
        capabilities = await provider.capabilities();
        this.#capabilities.set(provider.id, capabilities);
      }
      if (capabilities.available && capabilities.computeClasses.includes(computeClass)) {
        return provider;
      }
    }
    throw new Error(`no provider supports compute class ${computeClass}`);
  }
}
