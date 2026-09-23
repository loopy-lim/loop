import { HerdrWorkerRuntime } from "@loop/herdr";
import type { RecordActivityInput } from "@loop/protocol";
import {
  AntigravityProvider,
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
  relayCommand?: (worker: { runId: string; taskId: string; paneId: string; tabId: string }) =>
    | { command: string; args: string[] }
    | undefined;
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
    await this.#recorder.recordActivity({
      databasePath: this.#databasePath,
      runId: worker.runId,
      taskId: worker.taskId,
      activity: line,
    }).catch(() => {});
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
  return new ProviderRegistry(wrapForVisibility(providers, options, herdr));
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
    sinks.push(new PaneMirrorSink({
      host: herdr,
      projectRoot: options.projectRoot,
      environment: options.environment,
      paneLimit: options.config.output.workerPaneLimit,
      // Interactive workers own their native TUI pane (D4) — send-text
      // mirroring is excluded for them.
      excluded: new Set(providers.filter(p => p instanceof HerdrAgentProvider).map(p => p.id)),
      // Watch-to-steer: the worker pane hosts the steer relay for its lifetime.
      relay: options.relayCommand,
    }));
  }
  if (sinks.length === 0) return providers;

  const sink = sinks.length === 1 ? sinks[0] : compositeSink(...sinks);
  return providers.map(provider => new MirroringProvider(provider, sink, {
    lineTextLimit: options.config.output.lineTextLimit,
  }));
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
