import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  ConfigError,
  loadLoopConfig,
  loadPersonaKindDefaults,
  resolveConfigDirectory,
} from "../src/config";
import { ModelRegistry } from "../src/model-registry";
import { KIND_DEFAULT_PERSONAS } from "../src/persona";

const root = resolve(import.meta.dir, "../../..");

test("loads the repository configuration into typed runtime data", () => {
  const config = loadLoopConfig({
    configDirectory: join(root, "config"),
    databasePath: "/tmp/loop-config-test.sqlite",
  });

  expect(config.databasePath).toBe("/tmp/loop-config-test.sqlite");
  expect(config.scheduler.maxWorkers).toBe(6);
  // Dispatch scaling: the frontier cap no longer serializes frontier-effective
  // tasks behind one worker; it matches max_parallel.
  expect(config.scheduler.maxFrontierWorkers).toBe(6);
  expect(config.routing.defaultComputeClass).toBe("balanced");
  expect(config.routing.computeSelection).toBe("cheapest");
  expect(config.output).toEqual({
    statusLineLimit: 8,
    attentionLineLimit: 6,
    findingsLineLimit: 5,
    listLineLimit: 8,
    lineTextLimit: 160,
    workerVisibility: "off",
    workerActivityLines: 5,
    workerPaneLimit: 4,
    codeMapInjection: "off",
  });
  expect(config.lead).toEqual({
    command: "pi",
    provider: "openai-codex",
    model: "gpt-6.1-sol",
  });
  expect(config.providers.codex?.command).toBe("codex");

  const registry = new ModelRegistry(config.models);
  expect(config.providers.pi?.command).toBe("pi");
  expect(config.providers.pi?.enabled).toBe(true);
  expect(registry.get("zai/glm-5.3-flashx").computeClass).toBe("fast");
  expect(registry.get("glm-5.3-flashx").computeClass).toBe("typed_decision");
  expect(registry.get("zai/glm-5.3-flashx:high").computeClass).toBe("balanced");
  expect(registry.get("zai/glm-5.3-flash").computeClass).toBe("balanced");
  expect(registry.get("zai/glm-5.3-flash:high").computeClass).toBe("strong");
  expect(registry.get("openai-codex/gpt-6-luna:off").computeClass).toBe("tiny");
  expect(registry.get("openai-codex/gpt-6-luna").computeClass).toBe("typed_decision");
  expect(registry.get("openai-codex/gpt-6-luna:low").computeClass).toBe("fast");
  expect(registry.get("openai-codex/gpt-6-luna:high").computeClass).toBe("balanced");
  expect(registry.get("openai-codex/gpt-6.1-sol:minimal").computeClass).toBe("fast");
  expect(registry.get("openai-codex/gpt-6.1-sol:low").computeClass).toBe("balanced");
  expect(registry.get("openai-codex/gpt-6.1-sol:high").computeClass).toBe("strong");
  expect(registry.get("openai-codex/gpt-6.1-sol").computeClass).toBe("frontier");
  // 2026-09-30 final routing decision: balanced/strong primaries are the
  // openai-codex gpt-6.1-sol lane (fast thinking profile :low/:high) with the
  // zai volume lane demoted to fallback; fast/tiny keep their zai primaries
  // (fast's gpt entry is the low-effort "fast option" sol:minimal fallback).
  // routing.default_compute_class stays "balanced". Registry orders by
  // cost_weight + latency, so demoted lanes carry higher sums than the class
  // primaries (antigravity gemini profiles are no longer fallback candidates).
  expect(registry.forComputeClass("tiny").map((model) => model.id)).toEqual([
    "zai/glm-5.3-flashx:off",
    "openai-codex/gpt-6-luna:off",
  ]);
  expect(registry.forComputeClass("fast").map((model) => model.id)).toEqual([
    "zai/glm-5.3-flashx",
    "openai-codex/gpt-6.1-sol:minimal",
    "openai-codex/gpt-6-luna:low",
  ]);
  expect(registry.forComputeClass("typed_decision").map((model) => model.id)).toEqual([
    "glm-5.3-flashx",
    "openai-codex/gpt-6-luna",
  ]);
  expect(registry.forComputeClass("balanced").map((model) => model.id)).toEqual([
    "openai-codex/gpt-6.1-sol:low",
    "zai/glm-5.3-flashx:high",
    "zai/glm-5.3-flash",
    "openai-codex/gpt-6-luna:high",
  ]);
  expect(registry.forComputeClass("strong").map((model) => model.id)).toEqual([
    "openai-codex/gpt-6.1-sol:high",
    "zai/glm-5.3-flash:high",
  ]);
  expect(registry.forComputeClass("frontier").map((model) => model.id)).toEqual([
    "openai-codex/gpt-6.1-sol",
  ]);
});

test("resolves explicit, environment, XDG, then home configuration directories", () => {
  expect(
    resolveConfigDirectory({
      explicit: "/explicit",
      environment: { LOOP_CONFIG_DIR: "/environment", XDG_CONFIG_HOME: "/xdg" },
      homeDirectory: "/home/test",
    }),
  ).toBe("/explicit");
  expect(
    resolveConfigDirectory({
      environment: { LOOP_CONFIG_DIR: "/environment", XDG_CONFIG_HOME: "/xdg" },
      homeDirectory: "/home/test",
    }),
  ).toBe("/environment");
  expect(
    resolveConfigDirectory({
      environment: { XDG_CONFIG_HOME: "/xdg" },
      homeDirectory: "/home/test",
    }),
  ).toBe("/xdg/loop");
  expect(resolveConfigDirectory({ environment: {}, homeDirectory: "/home/test" })).toBe(
    "/home/test/.config/loop",
  );
});

test.each([
  ["duplicate model id", models({ duplicate: true }), /duplicate model id/],
  ["unknown compute class", models({ computeClass: "magic" }), /unknown compute class/],
  ["invalid concurrency", undefined, /max_frontier_workers/],
  ["literal secret", undefined, /credential values are forbidden/],
  ["invalid credential environment name", undefined, /invalid credential environment variable/],
  ["missing credential environment name", undefined, /requires api_key_env/],
])("rejects %s", (scenario, modelText, expected) => {
  const directory = mkdtempSync(join(tmpdir(), "loop-config-invalid-"));
  writeFileSync(join(directory, "models.toml"), modelText ?? models({}));
  writeFileSync(
    join(directory, "policy.toml"),
    scenario === "invalid concurrency" ? policy(1, 2) : policy(2, 1),
  );
  writeFileSync(join(directory, "providers.toml"), providers(scenario));

  expect(() => loadLoopConfig({ configDirectory: directory })).toThrow(expected);
});

test("reports missing required configuration files with a stable error code", () => {
  const directory = mkdtempSync(join(tmpdir(), "loop-config-missing-"));
  try {
    loadLoopConfig({ configDirectory: directory });
    throw new Error("expected configuration loading to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).code).toBe("config.file_missing");
  }
});

test("preserves custom output limits", () => {
  const directory = configurationDirectory(
    policy(2, 1, {
      statusLineLimit: 9,
      attentionLineLimit: 7,
      findingsLineLimit: 4,
      listLineLimit: 6,
      lineTextLimit: 120,
      workerVisibility: "panes",
      workerActivityLines: 3,
      workerPaneLimit: 2,
    }),
  );

  expect(loadLoopConfig({ configDirectory: directory }).output).toEqual({
    statusLineLimit: 9,
    attentionLineLimit: 7,
    findingsLineLimit: 4,
    listLineLimit: 6,
    lineTextLimit: 120,
    workerVisibility: "panes",
    workerActivityLines: 3,
    workerPaneLimit: 2,
    codeMapInjection: "off",
  });
});

test("routing compute selection defaults to cheapest and accepts the strongest bias", () => {
  const omitted = configurationDirectory(policy(2, 1));
  expect(loadLoopConfig({ configDirectory: omitted }).routing.computeSelection).toBe("cheapest");
  const strongest = configurationDirectory(
    policy(2, 1, undefined, { computeSelection: "strongest" }),
  );
  expect(loadLoopConfig({ configDirectory: strongest }).routing.computeSelection).toBe("strongest");
  const invalid = configurationDirectory(policy(2, 1, undefined, { computeSelection: "maximum" }));
  expect(() => loadLoopConfig({ configDirectory: invalid })).toThrow(/compute_selection/);
});

test("worker visibility defaults to watch and clamps the activity budget to the stored cap", () => {
  const directory = configurationDirectory(policy(2, 1));
  const output = loadLoopConfig({ configDirectory: directory }).output;
  // G18 기본값 개선: watch가 기본 (구성이 명시적으로 off를 지정하면 존중됨).
  expect(output.workerVisibility).toBe("watch");
  expect(output.workerActivityLines).toBe(5);
  expect(output.workerPaneLimit).toBe(4);

  const overclamped = configurationDirectory(
    policy(2, 1, {
      statusLineLimit: 8,
      attentionLineLimit: 6,
      findingsLineLimit: 5,
      listLineLimit: 8,
      lineTextLimit: 160,
      workerVisibility: "watch",
      workerActivityLines: 99,
      workerPaneLimit: 4,
    }),
  );
  expect(loadLoopConfig({ configDirectory: overclamped }).output.workerActivityLines).toBe(8);
});

test.each([
  ["worker_visibility", '"both"'],
  ["worker_activity_lines", "0"],
  ["worker_pane_limit", "-3"],
])("rejects invalid worker visibility policy %s=%s", (field, value) => {
  const output = [
    "status_line_limit = 8",
    "attention_line_limit = 6",
    "findings_line_limit = 5",
    "list_line_limit = 8",
    "line_text_limit = 160",
    `${field} = ${value}`,
  ];
  const directory = configurationDirectory(
    `${policy(2, 1).split("[output]")[0]}[output]\n${output.join("\n")}\n`,
  );

  expect(() => loadLoopConfig({ configDirectory: directory })).toThrow();
});

test.each([
  ["status_line_limit", "0"],
  ["attention_line_limit", "-1"],
  ["findings_line_limit", "0"],
  ["list_line_limit", "-2"],
  ["line_text_limit", "0"],
  ["line_text_limit", undefined],
])("rejects invalid output policy %s=%s", (field, value) => {
  const output = [
    "status_line_limit = 8",
    "attention_line_limit = 6",
    "findings_line_limit = 5",
    "list_line_limit = 8",
    "line_text_limit = 160",
  ].filter((line) => !line.startsWith(`${field} =`));
  if (value !== undefined) output.push(`${field} = ${value}`);
  const directory = configurationDirectory(
    `${policy(2, 1).split("[output]")[0]}[output]\n${output.join("\n")}\n`,
  );

  expect(() => loadLoopConfig({ configDirectory: directory })).toThrow(/positive integer/);
});

test("persona kind defaults stay at the compile-time floor without the optional file", () => {
  const directory = configurationDirectory(policy(2, 1));
  expect(loadPersonaKindDefaults(directory)).toEqual({});
  expect(loadLoopConfig({ configDirectory: directory }).personaKindDefaults).toEqual(
    KIND_DEFAULT_PERSONAS,
  );
});

test("persona kind defaults merge per key over the compile-time floor", () => {
  const directory = configurationDirectory(policy(2, 1));
  mkdirSync(join(directory, "personas"), { recursive: true });
  writeFileSync(
    join(directory, "personas", "defaults.toml"),
    '[kind_defaults]\ndecision = "designer"\n',
  );

  expect(loadPersonaKindDefaults(directory)).toEqual({ decision: "designer" });
  expect(loadLoopConfig({ configDirectory: directory }).personaKindDefaults).toEqual({
    ...KIND_DEFAULT_PERSONAS,
    decision: "designer",
  });
});

test("a defaults.toml without a kind_defaults table yields no overrides", () => {
  const directory = configurationDirectory(policy(2, 1));
  mkdirSync(join(directory, "personas"), { recursive: true });
  writeFileSync(join(directory, "personas", "defaults.toml"), "# intentional\n");

  expect(loadPersonaKindDefaults(directory)).toEqual({});
});

test("rejects unknown task kinds in personas/defaults.toml with a stable error code", () => {
  const directory = configurationDirectory(policy(2, 1));
  mkdirSync(join(directory, "personas"), { recursive: true });
  writeFileSync(
    join(directory, "personas", "defaults.toml"),
    '[kind_defaults]\nplanning = "architect"\n',
  );

  try {
    loadLoopConfig({ configDirectory: directory });
    throw new Error("expected configuration loading to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).code).toBe("config.unknown_task_kind");
    expect((error as ConfigError).message).toContain("unknown task kind");
  }
});

test("rejects invalid persona kind default values", () => {
  const directory = configurationDirectory(policy(2, 1));
  mkdirSync(join(directory, "personas"), { recursive: true });
  writeFileSync(join(directory, "personas", "defaults.toml"), '[kind_defaults]\ndecision = ""\n');

  expect(() => loadPersonaKindDefaults(directory)).toThrow(/non-empty string/);
});

test("repository personas/defaults.toml mirrors the compile-time floor (drift alarm)", () => {
  // Either side drifting (file or constant) fails this equality: a default
  // install must behave identically with or without the file.
  expect(loadPersonaKindDefaults(join(root, "config"))).toEqual(KIND_DEFAULT_PERSONAS);
});

function models(options: { duplicate?: boolean; computeClass?: string }): string {
  const entry = `
[[models]]
id = "fast-model"
provider = "test"
compute_class = "${options.computeClass ?? "fast"}"
capabilities = { coding = 1, reasoning = 1, tools = 1, vision = 0, long_context = 1 }
latency = 1
cost_weight = 1
`;
  return options.duplicate ? `${entry}${entry}` : entry;
}

function policy(
  maxWorkers: number,
  maxFrontierWorkers: number,
  output: {
    statusLineLimit: number;
    attentionLineLimit: number;
    findingsLineLimit: number;
    listLineLimit: number;
    lineTextLimit: number;
    workerVisibility?: "off" | "watch" | "panes";
    workerActivityLines?: number;
    workerPaneLimit?: number;
  } = {
    statusLineLimit: 8,
    attentionLineLimit: 6,
    findingsLineLimit: 5,
    listLineLimit: 8,
    lineTextLimit: 160,
  },
  routing: { computeSelection?: string } = {},
): string {
  return `
[scheduler]
max_parallel = ${maxWorkers}
max_frontier_workers = ${maxFrontierWorkers}

[routing]
default_compute_class = "fast"
high_risk_floor = "strong"
critical_risk_floor = "frontier"
escalation = ["deterministic", "typed_decision", "tiny", "fast", "balanced", "strong", "frontier"]
${
  routing.computeSelection === undefined
    ? ""
    : `compute_selection = "${routing.computeSelection}"
`
}

[output]
status_line_limit = ${output.statusLineLimit}
attention_line_limit = ${output.attentionLineLimit}
findings_line_limit = ${output.findingsLineLimit}
list_line_limit = ${output.listLineLimit}
line_text_limit = ${output.lineTextLimit}
${
  output.workerVisibility === undefined
    ? ""
    : `worker_visibility = "${output.workerVisibility}"
`
}${
    output.workerActivityLines === undefined
      ? ""
      : `worker_activity_lines = ${output.workerActivityLines}
`
  }${
    output.workerPaneLimit === undefined
      ? ""
      : `worker_pane_limit = ${output.workerPaneLimit}
`
  }`;
}

function configurationDirectory(policyText: string): string {
  const directory = mkdtempSync(join(tmpdir(), "loop-config-output-"));
  writeFileSync(join(directory, "models.toml"), models({}));
  writeFileSync(join(directory, "policy.toml"), policyText);
  writeFileSync(join(directory, "providers.toml"), providers("valid"));
  return directory;
}

function providers(scenario: string): string {
  const lead = `[lead]\ncommand = "pi"\nprovider = "zai"\nmodel = "glm-5.3-flashx"\n`;
  if (scenario === "literal secret") {
    return `${lead}[providers.zai]\nenabled = true\nauth = "api_key"\napi_key_env = "ZAI_API_KEY"\napi_key = "do-not-store-me"\n`;
  }
  if (scenario === "invalid credential environment name") {
    return `${lead}[providers.zai]\nenabled = true\nauth = "api_key"\napi_key_env = "not valid"\n`;
  }
  if (scenario === "missing credential environment name") {
    return `${lead}[providers.zai]\nenabled = true\nauth = "api_key"\n`;
  }
  return `${lead}[providers.test]\nenabled = true\ncommand = "test-agent"\n`;
}
