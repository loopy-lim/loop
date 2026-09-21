import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ComputeClass } from "@loop/protocol";

export interface ModelProfile {
  id: string;
  provider: string;
  computeClass: ComputeClass;
  capabilities: {
    coding: number;
    reasoning: number;
    tools: number;
    vision: number;
    longContext: number;
  };
  latency: number;
  costWeight: number;
}

export interface ProviderConfig {
  enabled: boolean;
  command?: string;
  endpoint?: string;
  auth?: "api_key" | "native" | "none";
  apiKeyEnv?: string;
  mode?: "api" | "cli" | "interactive";
  fallback?: string;
}

export interface LoopConfig {
  configDirectory: string;
  databasePath: string;
  scheduler: {
    maxWorkers: number;
    maxFrontierWorkers: number;
  };
  routing: {
    defaultComputeClass: ComputeClass;
    highRiskFloor: ComputeClass;
    criticalRiskFloor: ComputeClass;
    escalation: ComputeClass[];
  };
  attention: {
    maximumFindings: number;
    statusLineLimit: number;
    attentionLineLimit: number;
  };
  lead: {
    command: string;
    provider: string;
    model: string;
  };
  models: ModelProfile[];
  providers: Record<string, ProviderConfig>;
}

export class ConfigError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface ResolveConfigDirectoryOptions {
  explicit?: string;
  environment?: Record<string, string | undefined>;
  homeDirectory?: string;
}

export function resolveConfigDirectory(options: ResolveConfigDirectoryOptions = {}): string {
  const environment = options.environment ?? process.env;
  if (options.explicit) return options.explicit;
  if (environment.LOOP_CONFIG_DIR) return environment.LOOP_CONFIG_DIR;
  if (environment.XDG_CONFIG_HOME) return join(environment.XDG_CONFIG_HOME, "loop");
  return join(options.homeDirectory ?? homedir(), ".config", "loop");
}

export interface LoadLoopConfigOptions {
  configDirectory?: string;
  databasePath?: string;
  environment?: Record<string, string | undefined>;
  homeDirectory?: string;
}

export function loadLoopConfig(options: LoadLoopConfigOptions = {}): LoopConfig {
  const configDirectory = resolveConfigDirectory({
    explicit: options.configDirectory,
    environment: options.environment,
    homeDirectory: options.homeDirectory,
  });
  const modelsDocument = readToml(join(configDirectory, "models.toml"));
  const policyDocument = readToml(join(configDirectory, "policy.toml"));
  const providersPath = [
    join(configDirectory, "providers.toml"),
    join(configDirectory, "providers.example.toml"),
  ].find(existsSync);
  if (!providersPath) {
    throw new ConfigError(
      "config.file_missing",
      `missing configuration file: ${join(configDirectory, "providers.toml")}`,
    );
  }
  const providersDocument = readToml(providersPath);
  rejectCredentialValues(providersDocument);
  const lead = record(providersDocument.lead, "lead");

  const models = parseModels(modelsDocument);
  const scheduler = record(policyDocument.scheduler, "policy.scheduler");
  const routing = record(policyDocument.routing, "policy.routing");
  const attention = record(policyDocument.attention, "policy.attention");
  const maxWorkers = positiveInteger(scheduler.max_parallel, "scheduler.max_parallel");
  const maxFrontierWorkers = positiveInteger(
    scheduler.max_frontier_workers,
    "scheduler.max_frontier_workers",
  );
  if (maxFrontierWorkers > maxWorkers) {
    throw new ConfigError(
      "config.invalid",
      "scheduler.max_frontier_workers must not exceed scheduler.max_parallel",
    );
  }

  return {
    configDirectory,
    databasePath: options.databasePath ?? join(configDirectory, "loop.sqlite"),
    scheduler: { maxWorkers, maxFrontierWorkers },
    routing: {
      defaultComputeClass: computeClass(
        routing.default_compute_class,
        "routing.default_compute_class",
      ),
      highRiskFloor: computeClass(routing.high_risk_floor, "routing.high_risk_floor"),
      criticalRiskFloor: computeClass(
        routing.critical_risk_floor,
        "routing.critical_risk_floor",
      ),
      escalation: array(routing.escalation, "routing.escalation").map((value, index) =>
        computeClass(value, `routing.escalation[${index}]`),
      ),
    },
    attention: {
      maximumFindings: positiveInteger(attention.maximum_findings, "attention.maximum_findings"),
      statusLineLimit: positiveInteger(attention.status_line_limit, "attention.status_line_limit"),
      attentionLineLimit: positiveInteger(
        attention.attention_line_limit,
        "attention.attention_line_limit",
      ),
    },
    lead: {
      command: text(lead.command, "lead.command"),
      provider: text(lead.provider, "lead.provider"),
      model: text(lead.model, "lead.model"),
    },
    models,
    providers: parseProviders(providersDocument),
  };
}

const computeClasses = new Set<ComputeClass>([
  "deterministic",
  "typed_decision",
  "tiny",
  "fast",
  "balanced",
  "strong",
  "frontier",
]);

function readToml(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    throw new ConfigError("config.file_missing", `missing configuration file: ${path}`);
  }
  try {
    return record(Bun.TOML.parse(readFileSync(path, "utf8")), path);
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError("config.parse_failed", `failed to parse ${path}: ${String(error)}`);
  }
}

function parseModels(document: Record<string, unknown>): ModelProfile[] {
  const entries = array(document.models, "models");
  const seen = new Set<string>();
  return entries.map((value, index) => {
    const entry = record(value, `models[${index}]`);
    const id = text(entry.id, `models[${index}].id`);
    if (seen.has(id)) {
      throw new ConfigError("config.duplicate_model", `duplicate model id: ${id}`);
    }
    seen.add(id);
    const capabilities = record(entry.capabilities, `models[${index}].capabilities`);
    return {
      id,
      provider: text(entry.provider, `models[${index}].provider`),
      computeClass: computeClass(entry.compute_class, `models[${index}].compute_class`),
      capabilities: {
        coding: score(capabilities.coding, `${id}.capabilities.coding`),
        reasoning: score(capabilities.reasoning, `${id}.capabilities.reasoning`),
        tools: score(capabilities.tools, `${id}.capabilities.tools`),
        vision: score(capabilities.vision, `${id}.capabilities.vision`),
        longContext: score(capabilities.long_context, `${id}.capabilities.long_context`),
      },
      latency: nonNegativeNumber(entry.latency, `${id}.latency`),
      costWeight: nonNegativeNumber(entry.cost_weight, `${id}.cost_weight`),
    };
  });
}

function parseProviders(document: Record<string, unknown>): Record<string, ProviderConfig> {
  const entries = record(document.providers, "providers");
  return Object.fromEntries(
    Object.entries(entries).map(([id, value]) => {
      const entry = record(value, `providers.${id}`);
      const enabled = boolean(entry.enabled, `providers.${id}.enabled`);
      const auth = optionalText(entry.auth) as ProviderConfig["auth"];
      const apiKeyEnv = optionalText(entry.api_key_env);
      if (apiKeyEnv && !/^[A-Z_][A-Z0-9_]*$/.test(apiKeyEnv)) {
        throw new ConfigError(
          "config.invalid_credential_environment",
          `invalid credential environment variable: ${apiKeyEnv}`,
        );
      }
      if (enabled && auth === "api_key" && !apiKeyEnv) {
        throw new ConfigError(
          "config.missing_credential_environment",
          `provider ${id} requires api_key_env`,
        );
      }
      return [
        id,
        {
          enabled,
          command: optionalText(entry.command),
          endpoint: optionalText(entry.endpoint),
          auth,
          apiKeyEnv,
          mode: optionalText(entry.mode) as ProviderConfig["mode"],
          fallback: optionalText(entry.fallback),
        },
      ];
    }),
  );
}

function rejectCredentialValues(value: unknown, path = "providers"): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (/^(api_key|authorization|token|secret|password)$/i.test(key)) {
      throw new ConfigError(
        "config.credential_value_forbidden",
        `credential values are forbidden in configuration: ${childPath}`,
      );
    }
    rejectCredentialValues(child, childPath);
  }
}

function computeClass(value: unknown, path: string): ComputeClass {
  const parsed = text(value, path) as ComputeClass;
  if (!computeClasses.has(parsed)) {
    throw new ConfigError("config.unknown_compute_class", `unknown compute class at ${path}`);
  }
  return parsed;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError("config.invalid", `${path} must be a table`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new ConfigError("config.invalid", `${path} must be an array`);
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError("config.invalid", `${path} must be a non-empty string`);
  }
  return value;
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return text(value, "optional string");
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new ConfigError("config.invalid", `${path} must be boolean`);
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new ConfigError("config.invalid", `${path} must be a positive integer`);
  }
  return Number(value);
}

function nonNegativeNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ConfigError("config.invalid", `${path} must be a non-negative number`);
  }
  return value;
}

function score(value: unknown, path: string): number {
  const parsed = nonNegativeNumber(value, path);
  if (parsed > 5) throw new ConfigError("config.invalid", `${path} must be between 0 and 5`);
  return parsed;
}
