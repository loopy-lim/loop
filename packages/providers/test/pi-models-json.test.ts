import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  buildModelsJsonFragment,
  findExactCatalogMatch,
  mergeModelsJson,
  parseModelsToml,
  parsePiModelPattern,
  piCatalogFromModelsToml,
  piCatalogSources,
  syncPiModelsJson,
} from "../src";

const repoRoot = resolve(import.meta.dir, "../../..");
const modelsTomlPath = join(repoRoot, "config", "models.toml");

function realModelsDocument(): Record<string, unknown> {
  return parseModelsToml(readFileSync(modelsTomlPath, "utf8"));
}

/** pi's built-in zai catalog ids (pi-ai providers/data/zai.json, v0.87.0). */
const BUILT_IN_ZAI_IDS = [
  "glm-4.7",
  "glm-5-turbo",
  "glm-5.2",
  "glm-5.2-highspeed",
  "glm-5.3",
  "glm-5.3-flash",
  "glm-5.3-highspeed",
];

function zaiCatalog(models: string[]): { provider: string; id: string }[] {
  return models.map((id) => ({ provider: "zai", id }));
}

test("pi model patterns split into provider, id, and thinking suffix", () => {
  expect(parsePiModelPattern("zai/glm-5.3-flashx:high")).toEqual({
    provider: "zai",
    id: "glm-5.3-flashx",
    thinking: "high",
  });
  expect(parsePiModelPattern("zai/glm-5.3-flashx:off")).toEqual({
    provider: "zai",
    id: "glm-5.3-flashx",
    thinking: "off",
  });
  expect(parsePiModelPattern("zai/glm-5.3-flashx")).toEqual({
    provider: "zai",
    id: "glm-5.3-flashx",
  });
  // Bare id: the lead stanza resolves without a provider prefix.
  expect(parsePiModelPattern("glm-5.3-flashx")).toEqual({ provider: undefined, id: "glm-5.3-flashx" });
  // Non-level suffixes stay part of the id (pi keeps them too).
  expect(parsePiModelPattern("zai/model:crunchy")).toEqual({
    provider: "zai",
    id: "model:crunchy",
  });
  expect(parsePiModelPattern("  ")).toBeUndefined();
});

test("pi catalog config derives flashx metadata deterministically from config/models.toml", () => {
  const catalog = piCatalogFromModelsToml(realModelsDocument());
  expect(catalog.defaultProvider).toBe("zai");
  // Only ids missing from pi's built-in catalogs declare metadata; the
  // built-in glm-5.3-flash must not be re-provisioned.
  expect(Object.keys(catalog.models)).toEqual(["glm-5.3-flashx"]);
  const flashx = catalog.models["glm-5.3-flashx"];
  expect(flashx.name).toBe("GLM-5.3-FlashX");
  expect(flashx.reasoning).toBe(true);
  expect(flashx.contextWindow).toBe(1000000);
  expect(flashx.maxTokens).toBe(131072);
  expect(flashx.input).toEqual(["text"]);
  // 2.5x the built-in glm-5.3-flash rates (config documents the ratio).
  expect(flashx.cost).toEqual({ input: 0.375, output: 1.25, cacheRead: 0.075, cacheWrite: 0 });
  expect(flashx.compat).toEqual({
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: true,
    maxTokensField: "max_tokens",
    thinkingFormat: "zai",
    supportsStrictMode: true,
    zaiToolStream: true,
  });
});

test("fragment registers exactly the provisioned id for the derived provider", () => {
  const document = realModelsDocument();
  const fragment = buildModelsJsonFragment(
    piCatalogFromModelsToml(document),
    piCatalogSources(document),
  );
  expect(Object.keys(fragment.providers)).toEqual(["zai"]);
  expect(fragment.providers.zai.models).toHaveLength(1);
  const definition = fragment.providers.zai.models[0];
  expect(definition.id).toBe("glm-5.3-flashx");
  expect(definition.contextWindow).toBe(1000000);
  expect(definition.reasoning).toBe(true);
  expect(definition.compat?.thinkingFormat).toBe("zai");
  // Deterministic across runs.
  const again = buildModelsJsonFragment(
    piCatalogFromModelsToml(document),
    piCatalogSources(document),
  );
  expect(again).toEqual(fragment);
});

test("missing-provider edge cases leave the fragment empty instead of guessing", () => {
  // pi entries exist, but no [pi] table: bare ids cannot be attributed.
  const noPiTable = parseModelsToml(`
[[models]]
id = "glm-5.3-flashx"
provider = "pi"
compute_class = "typed_decision"
`);
  expect(piCatalogFromModelsToml(noPiTable).defaultProvider).toBeUndefined();
  expect(piCatalogSources(noPiTable)).toEqual([]);

  // Prefixed id survives, but without declared metadata nothing is emitted
  // (an { id }-only upsert could damage a built-in catalog entry).
  const noMetadata = parseModelsToml(`
[pi]
default_provider = "zai"

[[models]]
id = "zai/some-future-model"
provider = "pi"
compute_class = "fast"
`);
  expect(piCatalogSources(noMetadata)).toEqual([{ provider: "zai", id: "some-future-model" }]);
  expect(buildModelsJsonFragment(piCatalogFromModelsToml(noMetadata), piCatalogSources(noMetadata))).toEqual({
    providers: {},
  });

  // Non-pi providers never contribute sources.
  const noPiEntries = parseModelsToml(`
[pi]
default_provider = "zai"

[[models]]
id = "gpt-5.6-luna"
provider = "codex"
compute_class = "balanced"
`);
  expect(piCatalogSources(noPiEntries)).toEqual([]);
});

test("merging preserves unrelated providers and auth placeholders, upserting by id", () => {
  const document = realModelsDocument();
  const fragment = buildModelsJsonFragment(
    piCatalogFromModelsToml(document),
    piCatalogSources(document),
  );
  const existing = {
    providers: {
      // Unrelated provider stanza: preserved verbatim, apiKey placeholder included.
      ollama: {
        baseUrl: "http://localhost:11434/v1",
        api: "openai-completions",
        apiKey: "ollama",
        models: [{ id: "llama3.1:8b" }],
      },
      // Managed provider with existing auth and a custom sibling entry.
      zai: {
        apiKey: "$ZAI_API_KEY",
        models: [{ id: "glm-4.7", contextWindow: 204800 }],
      },
    },
  };
  const merged = mergeModelsJson(existing, fragment);
  const providers = merged.providers as Record<string, unknown>;
  expect(providers.ollama).toEqual(existing.providers.ollama);
  const zai = providers.zai as { apiKey: string; models: Array<{ id: string }> };
  expect(zai.apiKey).toBe("$ZAI_API_KEY");
  expect(zai.models.map((model) => model.id)).toEqual(["glm-4.7", "glm-5.3-flashx"]);
  // Input is not mutated.
  expect(existing.providers.zai.models).toEqual([{ id: "glm-4.7", contextWindow: 204800 }]);
});

test("sync writes the fragment once, idempotently, into the pi agent directory", () => {
  const agentDir = join(tmpdir(), `loop-models-json-test-${Date.now()}-${Math.random()}`);
  const document = realModelsDocument();
  try {
    const first = syncPiModelsJson({ document, agentDir });
    expect(first.changed).toBe(true);
    expect(first.providers).toEqual(["zai"]);
    expect(first.models).toEqual(["zai/glm-5.3-flashx"]);
    expect(existsSync(join(agentDir, "models.json"))).toBe(true);

    const written = readFileSync(join(agentDir, "models.json"), "utf8");
    const parsed = JSON.parse(written) as { providers: Record<string, unknown> };
    expect(Object.keys(parsed.providers)).toContain("zai");

    // Second sync is a no-op: byte-identical content, no rewrite.
    const second = syncPiModelsJson({ document, agentDir });
    expect(second.changed).toBe(false);
    expect(readFileSync(join(agentDir, "models.json"), "utf8")).toBe(written);

    // Syncing into a fresh directory that also does not exist yet works.
    const nested = join(agentDir, "nested", "agent");
    const third = syncPiModelsJson({ document, agentDir: nested });
    expect(third.changed).toBe(true);
    expect(existsSync(join(nested, "models.json"))).toBe(true);
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("sync refuses to clobber a corrupt models.json", () => {
  const agentDir = join(tmpdir(), `loop-models-json-corrupt-${Date.now()}-${Math.random()}`);
  mkdirSync(agentDir, { recursive: true });
  try {
    const filePath = join(agentDir, "models.json");
    writeFileSync(filePath, "{ not json");
    expect(() => syncPiModelsJson({ document: realModelsDocument(), agentDir })).toThrow(
      /not valid JSON/,
    );
    expect(readFileSync(filePath, "utf8")).toBe("{ not json");
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("regression: provisioned patterns resolve exactly instead of pi's custom-model fallback", () => {
  const document = realModelsDocument();
  const patterns = [
    "glm-5.3-flashx", // typed_decision (bare id, lead provider)
    "zai/glm-5.3-flashx:off", // tiny
    "zai/glm-5.3-flashx", // fast
    "zai/glm-5.3-flashx:high", // balanced
    "zai/glm-5.3-flash", // built-in balanced fallback
  ];
  const builtInOnly = zaiCatalog(BUILT_IN_ZAI_IDS);
  // Pre-fix behavior: flashx patterns miss the built-in catalog, so pi's
  // resolver emitted "Model ... not found for provider "zai". Using custom
  // model id." with glm-5.3's metadata.
  for (const pattern of patterns.filter((candidate) => candidate.includes("flashx"))) {
    expect(findExactCatalogMatch(pattern, builtInOnly)).toBeUndefined();
  }
  expect(findExactCatalogMatch("zai/glm-5.3-flash", builtInOnly)).toEqual({
    provider: "zai",
    id: "glm-5.3-flash",
  });

  // Post-fix behavior: the synced fragment closes every Loop pattern.
  const fragment = buildModelsJsonFragment(
    piCatalogFromModelsToml(document),
    piCatalogSources(document),
  );
  const mergedIds = [
    ...BUILT_IN_ZAI_IDS,
    ...fragment.providers.zai.models.map((model) => model.id),
  ];
  const merged = zaiCatalog(mergedIds);
  expect(findExactCatalogMatch("glm-5.3-flashx", merged)).toEqual({
    provider: "zai",
    id: "glm-5.3-flashx",
  });
  expect(findExactCatalogMatch("zai/glm-5.3-flashx:off", merged)).toEqual({
    provider: "zai",
    id: "glm-5.3-flashx",
    thinking: "off",
  });
  expect(findExactCatalogMatch("zai/glm-5.3-flashx", merged)).toEqual({
    provider: "zai",
    id: "glm-5.3-flashx",
  });
  expect(findExactCatalogMatch("zai/glm-5.3-flashx:high", merged)).toEqual({
    provider: "zai",
    id: "glm-5.3-flashx",
    thinking: "high",
  });
  // Built-in entries stay exact-matched through the merge.
  expect(findExactCatalogMatch("zai/glm-5.3-flash", merged)).toEqual({
    provider: "zai",
    id: "glm-5.3-flash",
  });
  // Every pi pattern declared in models.toml resolves against the merged catalog.
  for (const source of piCatalogSources(document)) {
    const pattern = source.provider === "zai" ? `${source.provider}/${source.id}` : source.id;
    expect(findExactCatalogMatch(pattern, merged)).toBeDefined();
  }
});
