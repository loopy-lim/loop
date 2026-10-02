import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ComputeClass, TaskKind } from "@loop/protocol";
import { parse as parseToml } from "smol-toml";

import { DEFAULT_CONTEXT_LIFECYCLE_POLICY, type ContextLifecyclePolicy } from "./context-lifecycle";
import {
  KIND_DEFAULT_PERSONAS,
  LEAD_PERSONA_IDS,
  type PersonaKindDefaults,
  type PersonaRegistry,
} from "./persona";

export interface ModelProfile {
  id: string;
  provider: string;
  computeClass: ComputeClass;
  /**
   * Execution lane selection (M-TL3): "pi" (default) keeps the existing CLI
   * harness worker; "turnloop" runs the profile through the own-turn-loop
   * adapter. Absent means "pi" — the default lane never changes existing
   * behavior. Routing/quota identity stays with `provider`, not the lane.
   */
  lane?: WorkerLane;
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

/**
 * Execution lane of a worker profile (M-TL3, decision TL1). Closed set: the
 * default is always the pi lane; "turnloop" is explicit opt-in that is
 * refused deterministically when the embedding application supplies no
 * turnloop model client.
 */
export type WorkerLane = "pi" | "turnloop";

export interface ProviderConfig {
  enabled: boolean;
  command?: string;
  endpoint?: string;
  auth?: "api_key" | "native" | "none";
  apiKeyEnv?: string;
  mode?: "api" | "cli" | "interactive" | "persistent";
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
  output: {
    statusLineLimit: number;
    attentionLineLimit: number;
    findingsLineLimit: number;
    listLineLimit: number;
    lineTextLimit: number;
    workerVisibility: WorkerVisibility;
    workerActivityLines: number;
    workerPaneLimit: number;
    /**
     * G2 code map worker-context injection (docs/research/loop-gap-analysis.md).
     * "off" (default) never injects; "scopes" derives a bounded map summary
     * from the task's declared read/write scopes.
     */
    codeMapInjection?: "off" | "scopes";
  };
  /**
   * G1 context-lifecycle thresholds (policy.toml `[context]`); absent section
   * resolves to DEFAULT_CONTEXT_LIFECYCLE_POLICY via resolveContextPolicy.
   */
  context?: ContextLifecyclePolicy;
  lead: {
    command: string;
    provider: string;
    model: string;
  };
  models: ModelProfile[];
  providers: Record<string, ProviderConfig>;
  personas: PersonaRegistry;
  /**
   * kind → default persona id: `personas/defaults.toml` overrides merged over
   * the compile-time floor (KIND_DEFAULT_PERSONAS) — key-by-key, never a full
   * replacement, so a partial file cannot silently strip a kind's default.
   */
  personaKindDefaults: PersonaKindDefaults;
}

/** Live worker-activity surface (docs/decisions/2026-09-23-worker-visibility.md D5). */
export type WorkerVisibility = "off" | "watch" | "panes";

/**
 * Stored history cap for per-task worker activity — the Rust core keeps at
 * most this many lines per task (loop-core ACTIVITY_HISTORY_LIMIT). The
 * presentation budget is clamped to it because showing more is impossible.
 */
const ACTIVITY_HISTORY_LIMIT = 8;

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
  const output = record(policyDocument.output, "policy.output");
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
    output: {
      statusLineLimit: positiveInteger(output.status_line_limit, "output.status_line_limit"),
      attentionLineLimit: positiveInteger(
        output.attention_line_limit,
        "output.attention_line_limit",
      ),
      findingsLineLimit: positiveInteger(
        output.findings_line_limit,
        "output.findings_line_limit",
      ),
      listLineLimit: positiveInteger(output.list_line_limit, "output.list_line_limit"),
      lineTextLimit: positiveInteger(output.line_text_limit, "output.line_text_limit"),
      workerVisibility: workerVisibility(output.worker_visibility),
      workerActivityLines: clampWorkerActivityLines(output.worker_activity_lines),
      workerPaneLimit: positiveInteger(output.worker_pane_limit ?? 4, "output.worker_pane_limit"),
      codeMapInjection: codeMapInjection(output.code_map_injection),
    },
    context: resolveContextPolicy(policyDocument.context),
    lead: {
      command: text(lead.command, "lead.command"),
      provider: text(lead.provider, "lead.provider"),
      model: text(lead.model, "lead.model"),
    },
    models,
    providers: parseProviders(providersDocument),
    personas: loadPersonaRegistry(configDirectory),
    personaKindDefaults: {
      ...KIND_DEFAULT_PERSONAS,
      ...loadPersonaKindDefaults(configDirectory),
    },
  };
}

/**
 * Persona registry per D1/D4 of the worker persona contract
 * (docs/decisions/2026-09-22-worker-persona-contract.md): every
 * `personas/*.md` file stem is a persona id and its trimmed body is the
 * instruction text injected into worker prompts. Lead-owned ids
 * (LEAD_PERSONA_IDS) are skipped: the directory is shared with Lead
 * standing rules, which workers must not be able to request. A missing
 * directory, a non-markdown file, or an empty body simply omits that id —
 * resolution then degrades silently (or with a warning) instead of failing
 * a run.
 */
export function loadPersonaRegistry(configDirectory: string): PersonaRegistry {
  const directory = join(configDirectory, "personas");
  if (!existsSync(directory)) return {};
  const registry: PersonaRegistry = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const id = entry.name.slice(0, -".md".length);
    if ((LEAD_PERSONA_IDS as readonly string[]).includes(id)) continue;
    const instructions = readFileSync(join(directory, entry.name), "utf8").trim();
    if (!instructions) continue;
    registry[id] = instructions;
  }
  return registry;
}

/**
 * kind → default persona id overrides from `personas/defaults.toml`
 * (docs/decisions/2026-09-24-persona-defaults-config.md C1–C3). A missing
 * file means no overrides — the feature is optional, same silence as a
 * missing registry. Structure is strict at load time (keys must be the
 * closed TaskKind set; values non-empty strings) so operator typos fail
 * fast; whether a value names a registered persona stays advisory at
 * runtime (D3 — resolvePersona warns, never hard-fails).
 */
export function loadPersonaKindDefaults(configDirectory: string): PersonaKindDefaults {
  const path = join(configDirectory, "personas", "defaults.toml");
  if (!existsSync(path)) return {};
  let document: Record<string, unknown>;
  try {
    document = record(parseToml(readFileSync(path, "utf8")), path);
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError("config.parse_failed", `failed to parse ${path}: ${String(error)}`);
  }
  const table = document.kind_defaults === undefined
    ? {}
    : record(document.kind_defaults, "personas.defaults.kind_defaults");
  const defaults: PersonaKindDefaults = {};
  for (const [kind, value] of Object.entries(table)) {
    if (!taskKinds.has(kind as TaskKind)) {
      throw new ConfigError(
        "config.unknown_task_kind",
        `unknown task kind at personas.defaults.kind_defaults.${kind}`,
      );
    }
    defaults[kind] = text(value, `personas.defaults.kind_defaults.${kind}`);
  }
  return defaults;
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

/** Closed worker-lane set (M-TL3); the default lane stays off this set's error path. */
const workerLanes = new Set<WorkerLane>(["pi", "turnloop"]);

function workerLane(value: unknown, path: string): WorkerLane {
  const parsed = text(value, path) as WorkerLane;
  if (!workerLanes.has(parsed)) {
    throw new ConfigError(
      "config.unknown_worker_lane",
      `unknown worker lane at ${path}: ${parsed} (expected "pi" or "turnloop")`,
    );
  }
  return parsed;
}

/**
 * Closed TaskKind set — the generated protocol exports the union type, not a
 * runtime set, so config.ts keeps this validation table exactly like
 * computeClasses (a TS-side check of a Rust bridge enum, not a hand-written
 * copy of a domain type).
 */
const taskKinds = new Set<TaskKind>([
  "research",
  "decision",
  "implementation",
  "verification",
  "integration",
]);

function readToml(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    throw new ConfigError("config.file_missing", `missing configuration file: ${path}`);
  }
  try {
    return record(parseToml(readFileSync(path, "utf8")), path);
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
    const lane = entry.lane === undefined ? undefined : workerLane(entry.lane, `models[${index}].lane`);
    return {
      id,
      provider: text(entry.provider, `models[${index}].provider`),
      computeClass: computeClass(entry.compute_class, `models[${index}].compute_class`),
      ...(lane ? { lane } : {}),
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
    Object.entries(entries).flatMap(([id, value]) => {
      const entry = record(value, `providers.${id}`);
      const enabled = boolean(entry.enabled, `providers.${id}.enabled`);
      if (id === "jev") {
        if (enabled) {
          throw new ConfigError(
            "config.unsupported_provider",
            "provider jev is no longer supported; remove or disable providers.jev",
          );
        }
        return [];
      }
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
      return [[
        id,
        {
          enabled,
          command: optionalText(entry.command),
          endpoint: optionalText(entry.endpoint),
          auth,
          apiKeyEnv,
          mode: optionalText(entry.mode) as ProviderConfig["mode"],
        },
      ]];
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

function workerVisibility(value: unknown): WorkerVisibility {
  // G18 기본값 개선: watch가 기본이다. activityRecorder가 없는 조립 경로는
  // sink 없이 동작을 바꾸지 않으므로 기본값 변경은 안전하다 (구성 파일이
  // 명시적으로 "off"를 지정하면 그대로 존중된다).
  if (value === undefined) return "watch";
  if (value === "off" || value === "watch" || value === "panes") return value;
  throw new ConfigError("config.invalid", `output.worker_visibility must be "off", "watch", or "panes"`);
}

function codeMapInjection(value: unknown): "off" | "scopes" {
  if (value === undefined) return "off";
  if (value === "off" || value === "scopes") return value;
  throw new ConfigError("config.invalid", `output.code_map_injection must be "off" or "scopes"`);
}

/**
 * G1 context-lifecycle thresholds. The whole `[context]` section is optional;
 * individual knobs fall back to the compile-time defaults. `advisory_byte_budget = 0`
 * is the explicit opt-out that keeps the context byte-identical to pre-G1.
 */
export function resolveContextPolicy(section: unknown): ContextLifecyclePolicy {
  if (section === undefined || section === null) return DEFAULT_CONTEXT_LIFECYCLE_POLICY;
  if (typeof section !== "object" || Array.isArray(section)) {
    throw new ConfigError("config.invalid", "context must be a table");
  }
  const value = section as Record<string, unknown>;
  return {
    advisoryByteBudget: value.advisory_byte_budget === undefined
      ? DEFAULT_CONTEXT_LIFECYCLE_POLICY.advisoryByteBudget
      : nonNegativeInteger(value.advisory_byte_budget, "context.advisory_byte_budget"),
    summaryEntryBytes: value.summary_entry_bytes === undefined
      ? DEFAULT_CONTEXT_LIFECYCLE_POLICY.summaryEntryBytes
      : positiveInteger(value.summary_entry_bytes, "context.summary_entry_bytes"),
    summaryByteCap: value.summary_byte_cap === undefined
      ? DEFAULT_CONTEXT_LIFECYCLE_POLICY.summaryByteCap
      : positiveInteger(value.summary_byte_cap, "context.summary_byte_cap"),
  };
}

function clampWorkerActivityLines(value: unknown): number {
  const lines = value === undefined ? 5 : positiveInteger(value, "output.worker_activity_lines");
  return Math.min(lines, ACTIVITY_HISTORY_LIMIT);
}

function nonNegativeNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ConfigError("config.invalid", `${path} must be a non-negative number`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  const parsed = nonNegativeNumber(value, path);
  if (!Number.isInteger(parsed)) throw new ConfigError("config.invalid", `${path} must be an integer`);
  return parsed;
}

function score(value: unknown, path: string): number {
  const parsed = nonNegativeNumber(value, path);
  if (parsed > 5) throw new ConfigError("config.invalid", `${path} must be between 0 and 5`);
  return parsed;
}
