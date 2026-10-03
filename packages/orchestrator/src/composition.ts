import { HerdrWorkerRuntime } from "@loop/herdr";
import type { RecordActivityInput } from "@loop/protocol";
import {
  TurnLoopProvider,
  type ModelClient,
  type ToolDeclaration,
  type ToolRunner,
} from "@loop/turnloop";
import {
  AntigravityProvider,
  FakeProvider,
  CodexProvider,
  AgyPersistentProvider,
  HerdrAgentProvider,
  MirroringProvider,
  PaneMirrorSink,
  PiProvider,
  ProviderRegistry,
  ZaiApiProvider,
  ZaiCliProvider,
  compositeSink,
  type AgentProvider,
  type MirrorSink,
} from "@loop/providers";

import type { LoopConfig, ModelProfile, ProviderConfig } from "./config";

/** Store-side sink dependency (D6: the orchestrator owns store recording). */
export interface ActivityRecorder {
  recordActivity(input: RecordActivityInput): Promise<unknown>;
}

/**
 * Model + tuning boundary for one turnloop-lane worker profile (M-TL3). The
 * embedding application (gateway/app path) constructs this in adapter
 * construction: model ids, endpoints, and credentials never leave this
 * closure and are never logged or persisted here (decision TL1 금지 목록).
 */
export interface TurnLoopWorkerBinding {
  readonly modelClient: ModelClient;
  readonly toolRunner?: ToolRunner;
  readonly tools?: readonly ToolDeclaration[];
  /**
   * Two-item pattern capability (decision 공급자 다양성): false → final-only
   * recording for this profile. Adapter-construction setting only.
   */
  readonly inProgressToolResults?: boolean;
  readonly laneCap?: number;
  readonly maxTurns?: number;
}

export interface ProviderCompositionOptions {
  config: LoopConfig;
  projectRoot: string;
  environment?: Record<string, string | undefined>;
  herdr?: HerdrWorkerRuntime;
  /** Required for the watch feed store sink; without it no rendered lines reach the run store. */
  activityRecorder?: ActivityRecorder;
  /**
   * Builds the per-worker steer-relay command hosted in the worker pane
   * (docs/decisions/2026-09-23-watch-to-steer.md). Optional: without it the
   * panes stay plain and `loop steer` remains the steering affordance.
   */
  relayCommand?: (worker: {
    runId: string;
    taskId: string;
    paneId: string;
    tabId: string;
  }) => { command: string; args: string[] } | undefined;
  /**
   * M-TL3 turnloop-lane support: supplies the model boundary for worker
   * profiles that select `lane = "turnloop"` in models.toml. Omitting the
   * hook (or returning undefined for a profile) refuses that profile
   * deterministically — the pi lane is the default everywhere and the CLI
   * ships without a turnloop model client, so CLI configurations selecting
   * the turnloop lane fail fast with a stable error instead of silently
   * changing worker behavior.
   */
  turnloopWorker?: (model: ModelProfile) => TurnLoopWorkerBinding | undefined;
}

/**
 * D3 watch-feed transport: records mirror-rendered lines into the run store's
 * per-task activity history. Lifecycle/result lines bypass the rate limit;
 * rendered output lines keep the historical 1 Hz drop-on-throttle policy so
 * publish pressure on the store stays bounded exactly as before.
 */
export class StoreActivitySink implements MirrorSink {
  readonly #recorder: ActivityRecorder;
  readonly #databasePath: string;
  readonly #workers = new Map<string, { runId: string; taskId: string }>();
  readonly #lastRecordAt = new Map<string, number>();

  constructor(recorder: ActivityRecorder, databasePath: string) {
    this.#recorder = recorder;
    this.#databasePath = databasePath;
  }

  async onWorkerStart(info: { workerId: string; runId: string; taskId: string }): Promise<void> {
    this.#workers.set(info.workerId, { runId: info.runId, taskId: info.taskId });
  }

  async onWorkerFinish(workerId: string): Promise<void> {
    this.#workers.delete(workerId);
    this.#lastRecordAt.delete(workerId);
  }

  async publish(workerId: string, line: string): Promise<void> {
    // Capture the context synchronously: the mirror fire-and-forgets publishes
    // right before onWorkerFinish drops the mapping.
    const worker = this.#workers.get(workerId);
    if (!worker) return;
    const immediate = line.startsWith("[lifecycle]") || line.startsWith("[result]");
    const now = Date.now();
    if (!immediate && now - (this.#lastRecordAt.get(workerId) ?? 0) < 1000) return;
    this.#lastRecordAt.set(workerId, now);
    await this.#recorder
      .recordActivity({
        databasePath: this.#databasePath,
        runId: worker.runId,
        taskId: worker.taskId,
        activity: line,
      })
      .catch(() => {});
  }
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
      // M-TL3 lane selection: the profile's lane swaps only the execution
      // adapter — provider identity, routing metadata, and quota grouping
      // stay exactly as configured for the pi lane.
      if (providerId === "fake") {
        providers.push(new FakeProvider(id, [model.computeClass]));
        continue;
      }
      if (model.lane === "turnloop") {
        providers.push(turnloopProfileWorker(id, model, options));
        continue;
      }
      if (providerId === "codex") {
        providers.push(
          providerConfig.mode === "interactive"
            ? visibleAgent(id, "codex", model, providerConfig, options.projectRoot, herdr)
            : new CodexProvider({
                id,
                cwd: options.projectRoot,
                command: providerConfig.command,
                model: model.id,
                computeClasses: [model.computeClass],
              }),
        );
      } else if (providerId === "antigravity") {
        providers.push(
          providerConfig.mode === "interactive"
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
                }),
        );
      } else if (providerId === "pi") {
        providers.push(
          providerConfig.mode === "interactive"
            ? visibleAgent(id, "pi", model, providerConfig, options.projectRoot, herdr)
            : new PiProvider({
                id,
                cwd: options.projectRoot,
                command: providerConfig.command,
                model: model.id,
                computeClasses: [model.computeClass],
              }),
        );
      } else if (providerId === "zai" && providerConfig.mode === "api") {
        const apiKey = providerConfig.apiKeyEnv
          ? (environment[providerConfig.apiKeyEnv] ?? "")
          : "";
        providers.push(
          new ZaiApiProvider({
            id,
            baseUrl: required(providerConfig.endpoint, `${providerId}.endpoint`),
            apiKey,
            model: model.id,
            mode: "general",
            computeClasses: [model.computeClass],
          }),
        );
      } else if (providerId === "zai_cli") {
        providers.push(
          new ZaiCliProvider({
            id,
            cwd: options.projectRoot,
            command: providerConfig.command,
            model: model.id,
            computeClasses: [model.computeClass],
          }),
        );
      }
    }
  }

  if (providers.length === 0) {
    throw new Error("no enabled provider has a configured model");
  }
  // Pi model patterns identify the upstream quota pool, not the launcher.
  // Keep this adapter knowledge out of the deterministic Rust policy.
  const routing = Object.fromEntries(
    options.config.models.map((model) => [
      `${model.provider}:${model.id}`,
      {
        costWeight: model.costWeight,
        latency: model.latency,
        capabilities: model.capabilities,
        quotaGroup:
          model.provider === "pi" && model.id.includes("/")
            ? model.id.split("/")[0]
            : model.provider === "zai_cli"
              ? "zai"
              : model.provider,
      },
    ]),
  );
  return new ProviderRegistry(wrapForVisibility(providers, options, herdr), routing, {
    high: options.config.routing.highRiskFloor,
    critical: options.config.routing.criticalRiskFloor,
  });
}

/**
 * D1/D4/D5 assembly: when worker visibility is enabled, adapters are wrapped in
 * the MirroringProvider decorator with the sinks appropriate to the configured
 * surface. "off" (the default) returns the providers untouched — the baseline
 * is byte-identical behavior. Exported for composition tests.
 */
export function wrapForVisibility(
  providers: AgentProvider[],
  options: ProviderCompositionOptions,
  herdr: HerdrWorkerRuntime,
): AgentProvider[] {
  const visibility = options.config.output.workerVisibility;
  if (visibility === "off") return providers;

  const sinks: MirrorSink[] = [];
  if (options.activityRecorder) {
    sinks.push(new StoreActivitySink(options.activityRecorder, options.config.databasePath));
  }
  if (visibility === "panes") {
    sinks.push(
      new PaneMirrorSink({
        host: herdr,
        projectRoot: options.projectRoot,
        environment: options.environment,
        paneLimit: options.config.output.workerPaneLimit,
        // Interactive workers own their native TUI pane (D4) — send-text
        // mirroring is excluded for them.
        excluded: new Set(
          providers.filter((p) => p instanceof HerdrAgentProvider).map((p) => p.id),
        ),
        // Watch-to-steer: the worker pane hosts the steer relay for its lifetime.
        relay: options.relayCommand,
      }),
    );
  }
  const primary = sinks[0];
  if (primary === undefined) return providers; // 위 length === 0 가드와 동일한 불변식
  const sink = sinks.length === 1 ? primary : compositeSink(...sinks);
  return providers.map(
    (provider) =>
      new MirroringProvider(provider, sink, {
        lineTextLimit: options.config.output.lineTextLimit,
      }),
  );
}

function visibleAgent(
  id: string,
  kind: "pi" | "codex" | "agy",
  model: ModelProfile,
  config: ProviderConfig,
  projectRoot: string,
  herdr: HerdrWorkerRuntime,
): HerdrAgentProvider {
  const args =
    kind === "codex"
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

/**
 * M-TL3 deterministic capability gate: a profile that selects the turnloop
 * lane without a configured turnloop model client is refused here, at
 * composition time, with a stable error — never with a runtime surprise
 * mid-run. Same input, same refusal, every time.
 */
function turnloopProfileWorker(
  id: string,
  model: ModelProfile,
  options: ProviderCompositionOptions,
): AgentProvider {
  const binding = options.turnloopWorker?.(model);
  if (!binding) {
    throw new Error(
      `config.turnloop_lane_unavailable: worker profile ${id} selects the turnloop lane but no turnloop model client is available; remove lane = "turnloop" from models.toml or supply a turnloopWorker binding (pi lane is the default)`,
    );
  }
  return new TurnLoopProvider({
    id,
    modelClient: binding.modelClient,
    toolRunner: binding.toolRunner,
    tools: binding.tools,
    computeClasses: [model.computeClass],
    modelId: model.id,
    inProgressToolResults: binding.inProgressToolResults,
    laneCap: binding.laneCap,
    maxTurns: binding.maxTurns,
  });
}
