import { HerdrWorkerRuntime } from "@loop/herdr";
import {
  AntigravityProvider,
  CodexProvider,
  AgyPersistentProvider,
  HerdrAgentProvider,
  PiProvider,
  ProviderRegistry,
  ZaiApiProvider,
  ZaiCliProvider,
  type AgentProvider,
} from "@loop/providers";

import type { LoopConfig, ModelProfile, ProviderConfig } from "./config";

export interface ProviderCompositionOptions {
  config: LoopConfig;
  projectRoot: string;
  environment?: Record<string, string | undefined>;
  herdr?: HerdrWorkerRuntime;
}

export function buildProviderRegistry(options: ProviderCompositionOptions): ProviderRegistry {
  const providers: AgentProvider[] = [];
  const environment = options.environment ?? process.env;
  const herdr = options.herdr ?? new HerdrWorkerRuntime();

  for (const [providerId, providerConfig] of Object.entries(options.config.providers)) {
    if (!providerConfig.enabled) continue;
    const models = options.config.models.filter((model) => model.provider === providerId);
    for (const model of models) {
      const id = `${providerId}:${model.id}`;
      if (providerId === "codex") {
        providers.push(providerConfig.mode === "interactive"
          ? visibleAgent(id, "codex", model, providerConfig, options.projectRoot, herdr)
          : new CodexProvider({
              id,
              cwd: options.projectRoot,
              command: providerConfig.command,
              model: model.id,
              computeClasses: [model.computeClass],
            }));
      } else if (providerId === "antigravity") {
        providers.push(providerConfig.mode === "interactive"
          ? visibleAgent(id, "agy", model, providerConfig, options.projectRoot, herdr)
          : providerConfig.mode === "persistent"
            ? new AgyPersistentProvider({
                id,
                cwd: options.projectRoot,
                command: providerConfig.command,
                model: model.id,
                computeClasses: [model.computeClass],
              })
            : new AntigravityProvider({
                id,
                cwd: options.projectRoot,
                command: providerConfig.command,
                model: model.id,
                computeClasses: [model.computeClass],
              }));
      } else if (providerId === "pi") {
        providers.push(providerConfig.mode === "interactive"
          ? visibleAgent(id, "pi", model, providerConfig, options.projectRoot, herdr)
          : new PiProvider({
              id,
              cwd: options.projectRoot,
              command: providerConfig.command,
              model: model.id,
              computeClasses: [model.computeClass],
            }));
      } else if (providerId === "zai" && providerConfig.mode === "api") {
        const apiKey = providerConfig.apiKeyEnv ? environment[providerConfig.apiKeyEnv] ?? "" : "";
        providers.push(new ZaiApiProvider({
          id,
          baseUrl: required(providerConfig.endpoint, `${providerId}.endpoint`),
          apiKey,
          model: model.id,
          mode: "general",
          computeClasses: [model.computeClass],
        }));
      } else if (providerId === "zai_cli") {
        providers.push(new ZaiCliProvider({
          id,
          cwd: options.projectRoot,
          command: providerConfig.command,
          model: model.id,
          computeClasses: [model.computeClass],
        }));
      }
    }
  }

  if (providers.length === 0) {
    throw new Error("no enabled provider has a configured model");
  }
  return new ProviderRegistry(providers);
}

function visibleAgent(
  id: string,
  kind: "pi" | "codex" | "agy",
  model: ModelProfile,
  config: ProviderConfig,
  projectRoot: string,
  herdr: HerdrWorkerRuntime,
): HerdrAgentProvider {
  const args = kind === "codex"
    ? ["--sandbox", "workspace-write", "--model", model.id]
    : kind === "agy"
      ? ["--sandbox", "--model", model.id]
      : ["--model", model.id];
  return new HerdrAgentProvider({
    id,
    runtime: herdr,
    kind,
    projectRoot,
    computeClasses: [model.computeClass],
    args,
    available: Boolean(config.command),
  });
}

function required(value: string | undefined, field: string): string {
  if (!value) throw new Error(`provider configuration requires ${field}`);
  return value;
}
