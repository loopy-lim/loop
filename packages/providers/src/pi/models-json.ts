import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * pi models.json provisioning (2026-09-22 model-environment-generalization
 * decision, Option 1).
 *
 * pi resolves `--model` patterns against its merged provider catalog
 * (built-ins plus `<agentDir>/models.json`). Loop ids that are absent from the
 * built-in catalog (e.g. "zai/glm-5.3-flashx") trigger pi's
 * `Model "<id>" not found for provider "<provider>". Using custom model id.`
 * warning and a fallback model that silently inherits wrong metadata
 * (context window/cost from the provider default).
 *
 * This module derives a models.json fragment deterministically from Loop's
 * config/models.toml — the single source of model ids — and upserts it into
 * pi's models.json (pi merges by model id inside a provider and keeps
 * built-ins). Model ids and catalog metadata live only in configuration; this
 * file contains none. Existing models.json content (including auth
 * placeholders such as apiKey values) is preserved verbatim and never logged;
 * this module never introduces credentials.
 *
 * Documented stance for ids without declared `[pi.models."<id>"]` metadata:
 * they rely on the built-in catalog (pi's warning fallback stays acceptable
 * there). Emitting metadata-less entries is unsafe because an `{ id }` upsert
 * of a built-in id would reset that model's catalog metadata to pi defaults.
 */

/** pi's valid thinking-level suffixes (pi-args VALID_THINKING_LEVELS). */
const PI_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export interface PiModelCost {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** pi models.json compat flags; snake_case config keys are camelCased. */
export type PiModelCompat = Record<string, string | number | boolean>;

/** pi catalog metadata for one concrete model id, from `[pi.models."<id>"]`. */
export interface PiCatalogModel {
  name?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  input?: string[];
  cost?: PiModelCost;
  compat?: PiModelCompat;
}

export interface PiCatalogConfig {
  /** pi provider that bare (unprefixed) Loop ids resolve against. */
  defaultProvider?: string;
  /** Declared catalog metadata keyed by concrete pi model id. */
  models: Record<string, PiCatalogModel>;
}

/** One pi catalog entry a Loop model id pattern must resolve to. */
export interface PiCatalogSource {
  provider: string;
  id: string;
}

/** A models.json definition for one provider catalog entry. */
export interface PiModelDefinition {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: string[];
  cost?: PiModelCost;
  compat?: PiModelCompat;
  contextWindow?: number;
  maxTokens?: number;
}

/** models.json fragment shape: providers with upsert model lists. */
export interface PiModelsJsonFragment {
  providers: Record<string, { models: PiModelDefinition[] }>;
}

/** Result of resolving a Loop id pattern against a pi catalog. */
export interface PiCatalogMatch {
  provider: string;
  id: string;
  thinking?: string;
}

/** A Loop id pattern parsed offline: provider attribution may be absent. */
export interface PiParsedPattern {
  provider?: string;
  id: string;
  thinking?: string;
}

interface TomlParser {
  parse(text: string): Record<string, unknown>;
}

/** Bun.TOML is guaranteed on the supported runtime but absent from bun-types@1.4.2. */
function tomlParser(): TomlParser {
  const parser = (globalThis as unknown as { Bun?: { TOML?: TomlParser } }).Bun?.TOML;
  if (!parser) {
    throw new Error("Bun.TOML is required to parse Loop TOML configuration");
  }
  return parser;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function toCamelCase(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

function camelCaseRecord(value: unknown): PiModelCompat {
  const result: PiModelCompat = {};
  for (const [key, entry] of Object.entries(record(value))) {
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
      result[toCamelCase(key)] = entry;
    }
  }
  return result;
}

function costFromToml(value: unknown): PiModelCost | undefined {
  const source = record(value);
  const cost: PiModelCost = {};
  const input = source.input;
  const output = source.output;
  const cacheRead = source.cache_read;
  const cacheWrite = source.cache_write;
  if (typeof input === "number") cost.input = input;
  if (typeof output === "number") cost.output = output;
  if (typeof cacheRead === "number") cost.cacheRead = cacheRead;
  if (typeof cacheWrite === "number") cost.cacheWrite = cacheWrite;
  return Object.keys(cost).length > 0 ? cost : undefined;
}

/**
 * Split a pi model pattern ("zai/glm-5.3-flashx:high") into its provider
 * prefix, concrete catalog id, and thinking suffix, mirroring pi's CLI
 * pattern syntax: the first "/" introduces the provider, and a trailing
 * ":<level>" is a thinking level only when it is one of pi's valid levels.
 */
export function parsePiModelPattern(pattern: string): PiParsedPattern | undefined {
  const trimmed = pattern.trim();
  if (!trimmed) return undefined;
  let provider: string | undefined;
  let rest = trimmed;
  const slash = trimmed.indexOf("/");
  if (slash > 0 && slash < trimmed.length - 1) {
    provider = trimmed.slice(0, slash);
    rest = trimmed.slice(slash + 1);
  }
  const colon = rest.lastIndexOf(":");
  if (colon > 0) {
    const suffix = rest.slice(colon + 1);
    if ((PI_THINKING_LEVELS as readonly string[]).includes(suffix)) {
      const id = rest.slice(0, colon);
      if (id) return { provider, id, thinking: suffix };
    }
  }
  return { provider, id: rest };
}

/** Parse Loop TOML configuration text (models.toml). */
export function parseModelsToml(text: string): Record<string, unknown> {
  return tomlParser().parse(text);
}

/** Read the `[pi]` catalog-provisioning table from a parsed models.toml. */
export function piCatalogFromModelsToml(document: unknown): PiCatalogConfig {
  const pi = record(record(document).pi);
  const defaultProviderRaw = pi.default_provider;
  const defaultProvider =
    typeof defaultProviderRaw === "string" && defaultProviderRaw.trim().length > 0
      ? defaultProviderRaw.trim()
      : undefined;
  const models: Record<string, PiCatalogModel> = {};
  for (const [id, value] of Object.entries(record(pi.models))) {
    const entry = record(value);
    const model: PiCatalogModel = {};
    if (typeof entry.name === "string") model.name = entry.name;
    if (typeof entry.reasoning === "boolean") model.reasoning = entry.reasoning;
    if (typeof entry.context_window === "number") model.contextWindow = entry.context_window;
    if (typeof entry.max_tokens === "number") model.maxTokens = entry.max_tokens;
    if (Array.isArray(entry.input)) {
      const input = entry.input.filter((item): item is string => typeof item === "string");
      if (input.length > 0) model.input = input;
    }
    const cost = costFromToml(entry.cost);
    if (cost) model.cost = cost;
    if (isRecord(entry.compat) && Object.keys(entry.compat).length > 0) {
      model.compat = camelCaseRecord(entry.compat);
    }
    models[id] = model;
  }
  return { defaultProvider, models };
}

/**
 * Collect the pi catalog entries every `[[models]]` entry with
 * `provider = "pi"` must resolve to. Prefixed ids use their "provider/"
 * prefix; bare ids use `[pi] default_provider`. Entries that cannot be
 * attributed to a pi provider are skipped. Output is deduplicated and sorted
 * for determinism.
 */
export function piCatalogSources(document: unknown): PiCatalogSource[] {
  const { defaultProvider } = piCatalogFromModelsToml(document);
  const documentRecord = record(document);
  const entries = Array.isArray(documentRecord.models) ? documentRecord.models : [];
  const sources = new Map<string, PiCatalogSource>();
  for (const value of entries) {
    const entry = record(value);
    if (entry.provider !== "pi") continue;
    const pattern = typeof entry.id === "string" ? entry.id : "";
    const parsed = parsePiModelPattern(pattern);
    if (!parsed) continue;
    const provider = parsed.provider ?? defaultProvider;
    if (!provider) continue;
    sources.set(`${provider}/${parsed.id}`, { provider, id: parsed.id });
  }
  return [...sources.values()].sort(
    (left, right) => left.provider.localeCompare(right.provider) || left.id.localeCompare(right.id),
  );
}

/**
 * Build the models.json fragment: one stanza per pi provider, one definition
 * per declared catalog id, sorted deterministically. Ids without declared
 * `[pi.models."<id>"]` metadata produce no definition (see module doc).
 */
export function buildModelsJsonFragment(
  catalog: PiCatalogConfig,
  sources: readonly PiCatalogSource[],
): PiModelsJsonFragment {
  const definitions = new Map<string, PiModelDefinition>();
  for (const source of sources) {
    const metadata = catalog.models[source.id];
    if (!metadata) continue;
    const key = `${source.provider}/${source.id}`;
    const definition: PiModelDefinition = { id: source.id };
    if (metadata.name !== undefined) definition.name = metadata.name;
    if (metadata.reasoning !== undefined) definition.reasoning = metadata.reasoning;
    if (metadata.input !== undefined) definition.input = metadata.input;
    if (metadata.cost !== undefined) definition.cost = metadata.cost;
    if (metadata.compat !== undefined) definition.compat = metadata.compat;
    if (metadata.contextWindow !== undefined) definition.contextWindow = metadata.contextWindow;
    if (metadata.maxTokens !== undefined) definition.maxTokens = metadata.maxTokens;
    const existing = definitions.get(key);
    if (existing) {
      definitions.set(key, { ...existing, ...definition });
    } else {
      definitions.set(key, definition);
    }
  }
  const byProvider = new Map<string, PiModelDefinition[]>();
  for (const [key, definition] of definitions) {
    const provider = key.slice(0, key.indexOf("/"));
    const list = byProvider.get(provider) ?? [];
    list.push(definition);
    byProvider.set(provider, list);
  }
  const providers: Record<string, { models: PiModelDefinition[] }> = {};
  for (const provider of [...byProvider.keys()].sort()) {
    const models = (byProvider.get(provider) ?? []).sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    providers[provider] = { models };
  }
  return { providers };
}

/**
 * Upsert a fragment into an existing models.json document, mirroring pi's
 * merge semantics: everything unrelated is preserved verbatim (including
 * auth placeholders); inside a managed provider, models with fragment ids are
 * replaced and all other models keep their original order, with fragment
 * models appended in fragment order. Returns a new document; never logs.
 */
export function mergeModelsJson(
  existing: unknown,
  fragment: PiModelsJsonFragment,
): Record<string, unknown> {
  const base = record(existing);
  const providers: Record<string, unknown> = { ...record(base.providers) };
  for (const [provider, stanza] of Object.entries(fragment.providers)) {
    const existingStanza = record(providers[provider]);
    const existingModels = Array.isArray(existingStanza.models) ? existingStanza.models : [];
    const fragmentIds = new Set(stanza.models.map((model) => model.id));
    const kept = existingModels.filter((model) => {
      if (!isRecord(model)) return true;
      return typeof model.id !== "string" || !fragmentIds.has(model.id);
    });
    providers[provider] = {
      ...existingStanza,
      models: [...kept, ...stanza.models],
    };
  }
  return { ...base, providers };
}

/**
 * Resolve a Loop model pattern against a concrete catalog the way pi's
 * resolver does for exact matches: full pattern as "provider/id" or bare id
 * (case-insensitive) first, then a trailing valid thinking level split.
 * Exact matches are the no-warning outcome with the correct model; this is
 * the property Loop provisioning must guarantee.
 */
export function findExactCatalogMatch(
  pattern: string,
  catalog: readonly { provider: string; id: string }[],
): PiCatalogMatch | undefined {
  const trimmed = pattern.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  const full = catalog.find(
    (model) =>
      `${model.provider}/${model.id}`.toLowerCase() === lower || model.id.toLowerCase() === lower,
  );
  if (full) return { provider: full.provider, id: full.id };
  const colon = trimmed.lastIndexOf(":");
  if (colon === -1) return undefined;
  const suffix = trimmed.slice(colon + 1);
  if (!(PI_THINKING_LEVELS as readonly string[]).includes(suffix)) return undefined;
  const inner = findExactCatalogMatch(trimmed.slice(0, colon), catalog);
  return inner ? { ...inner, thinking: suffix } : undefined;
}

export interface SyncPiModelsJsonOptions {
  /** Parsed models.toml document (see parseModelsToml). */
  document: unknown;
  /** pi agent directory; defaults to PI_CODING_AGENT_DIR, then ~/.pi/agent. */
  agentDir?: string;
  environment?: Record<string, string | undefined>;
  homeDirectory?: string;
}

export interface PiModelsJsonSyncResult {
  filePath: string;
  changed: boolean;
  /** Provider stanzas managed by Loop, sorted. */
  providers: string[];
  /** Managed catalog ids as "provider/id", sorted. */
  models: string[];
}

/**
 * Sync config/models.toml into `<agentDir>/models.json` (pi merges built-ins
 * with this file at startup, eliminating the custom-model warning for
 * provisioned ids). Writes atomically and only when content differs. With no
 * pi sources or no declared metadata the file is left untouched. Returns a
 * summary of managed ids only; file contents are never logged.
 */
export function syncPiModelsJson(options: SyncPiModelsJsonOptions): PiModelsJsonSyncResult {
  const catalog = piCatalogFromModelsToml(options.document);
  const sources = piCatalogSources(options.document);
  const fragment = buildModelsJsonFragment(catalog, sources);
  const environment = options.environment ?? process.env;
  const agentDir =
    options.agentDir ??
    environment.PI_CODING_AGENT_DIR ??
    join(options.homeDirectory ?? homedir(), ".pi", "agent");
  const filePath = join(agentDir, "models.json");
  const models = Object.entries(fragment.providers).flatMap(([provider, stanza]) =>
    stanza.models.map((model) => `${provider}/${model.id}`),
  );
  if (models.length === 0) {
    return { filePath, changed: false, providers: [], models: [] };
  }
  const existingRaw = existsSync(filePath) ? readFileSync(filePath, "utf8") : undefined;
  if (existingRaw !== undefined) {
    try {
      JSON.parse(existingRaw);
    } catch {
      throw new Error(
        `existing pi models.json at ${filePath} is not valid JSON; fix or remove it before syncing`,
      );
    }
  }
  const merged = mergeModelsJson(existingRaw === undefined ? undefined : JSON.parse(existingRaw), fragment);
  const serialized = `${JSON.stringify(merged, null, 2)}\n`;
  if (serialized === existingRaw) {
    return { filePath, changed: false, providers: Object.keys(fragment.providers).sort(), models };
  }
  mkdirSync(agentDir, { recursive: true });
  const stagedPath = `${filePath}.loop-sync.tmp`;
  writeFileSync(stagedPath, serialized);
  renameSync(stagedPath, filePath);
  return { filePath, changed: true, providers: Object.keys(fragment.providers).sort(), models };
}
