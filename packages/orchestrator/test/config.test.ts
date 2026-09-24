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
  expect(config.scheduler.maxFrontierWorkers).toBe(1);
  expect(config.routing.defaultComputeClass).toBe("balanced");
  expect(config.output).toEqual({
    statusLineLimit: 8,
    attentionLineLimit: 6,
    findingsLineLimit: 5,
    listLineLimit: 8,
    lineTextLimit: 160,
    workerVisibility: "off",
    workerActivityLines: 5,
    workerPaneLimit: 4,
  });
  expect(config.lead).toEqual({ command: "pi", provider: "zai", model: "glm-5.3-flashx" });
  expect(config.providers.codex?.command).toBe("codex");

  const registry = new ModelRegistry(config.models);
  expect(config.providers.pi?.command).toBe("pi");
  expect(config.providers.pi?.enabled).toBe(true);
  expect(registry.get("zai/glm-5.3-flashx").computeClass).toBe("fast");
  expect(registry.get("glm-5.3-flashx").computeClass).toBe("typed_decision");
  expect(registry.get("zai/glm-5.3-flashx:high").computeClass).toBe("balanced");
  expect(registry.get("zai/glm-5.3-flash").computeClass).toBe("balanced");
  expect(registry.get("gpt-5.6-luna").computeClass).toBe("balanced");
  expect(registry.get("gpt-5.6-terra").computeClass).toBe("strong");
  expect(registry.get("gpt-5.6-sol").computeClass).toBe("frontier");
  // Registry orders by cost_weight + latency, ties broken by id: all four
  // frontier models tie at 4+3 and sort lexicographically (the restored
  // gpt-6-luna/sol lanes mirror the codex fallback figures).
  expect(registry.forComputeClass("frontier").map((model) => model.id)).toEqual([
    "gemini-3.1-pro-low",
    "gpt-5.6-sol",
    "gpt-6-sol",
    "openai-codex/gpt-6-sol",
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
  expect(
    resolveConfigDirectory({ environment: {}, homeDirectory: "/home/test" }),
  ).toBe("/home/test/.config/loop");
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
  const directory = configurationDirectory(policy(2, 1, {
    statusLineLimit: 9,
    attentionLineLimit: 7,
    findingsLineLimit: 4,
    listLineLimit: 6,
    lineTextLimit: 120,
    workerVisibility: "panes",
    workerActivityLines: 3,
    workerPaneLimit: 2,
  }));

  expect(loadLoopConfig({ configDirectory: directory }).output).toEqual({
    statusLineLimit: 9,
    attentionLineLimit: 7,
    findingsLineLimit: 4,
    listLineLimit: 6,
    lineTextLimit: 120,
    workerVisibility: "panes",
    workerActivityLines: 3,
    workerPaneLimit: 2,
  });
});

test("worker visibility defaults to off and clamps the activity budget to the stored cap", () => {
  const directory = configurationDirectory(policy(2, 1));
  const output = loadLoopConfig({ configDirectory: directory }).output;
  expect(output.workerVisibility).toBe("off");
  expect(output.workerActivityLines).toBe(5);
  expect(output.workerPaneLimit).toBe(4);

  const overclamped = configurationDirectory(policy(2, 1, {
    statusLineLimit: 8,
    attentionLineLimit: 6,
    findingsLineLimit: 5,
    listLineLimit: 8,
    lineTextLimit: 160,
    workerVisibility: "watch",
    workerActivityLines: 99,
    workerPaneLimit: 4,
  }));
  expect(loadLoopConfig({ configDirectory: overclamped }).output.workerActivityLines).toBe(8);
});

 test.each([
  ["worker_visibility", "\"both\""],
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
  const directory = configurationDirectory(`${policy(2, 1).split("[output]")[0]}[output]\n${output.join("\n")}\n`);

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
  const directory = configurationDirectory(`${policy(2, 1).split("[output]")[0]}[output]\n${output.join("\n")}\n`);

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
  writeFileSync(join(directory, "personas", "defaults.toml"), '[kind_defaults]\ndecision = "designer"\n');

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
  writeFileSync(join(directory, "personas", "defaults.toml"), '[kind_defaults]\nplanning = "architect"\n');

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

[output]
status_line_limit = ${output.statusLineLimit}
attention_line_limit = ${output.attentionLineLimit}
findings_line_limit = ${output.findingsLineLimit}
list_line_limit = ${output.listLineLimit}
line_text_limit = ${output.lineTextLimit}
${output.workerVisibility === undefined ? "" : `worker_visibility = "${output.workerVisibility}"
`}${output.workerActivityLines === undefined ? "" : `worker_activity_lines = ${output.workerActivityLines}
`}${output.workerPaneLimit === undefined ? "" : `worker_pane_limit = ${output.workerPaneLimit}
`}`;
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
