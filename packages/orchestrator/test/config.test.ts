import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { ConfigError, loadLoopConfig, resolveConfigDirectory } from "../src/config";
import { ModelRegistry } from "../src/model-registry";

const root = resolve(import.meta.dir, "../../..");

test("loads the repository configuration into typed runtime data", () => {
  const config = loadLoopConfig({
    configDirectory: join(root, "config"),
    databasePath: "/tmp/loop-config-test.sqlite",
  });

  expect(config.databasePath).toBe("/tmp/loop-config-test.sqlite");
  expect(config.scheduler.maxWorkers).toBe(3);
  expect(config.scheduler.maxFrontierWorkers).toBe(1);
  expect(config.routing.defaultComputeClass).toBe("fast");
  expect(config.output).toEqual({
    statusLineLimit: 8,
    attentionLineLimit: 6,
    findingsLineLimit: 5,
    listLineLimit: 8,
    lineTextLimit: 160,
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
  // Registry orders by cost_weight + latency, ties broken by id: sol (4+3)
  // ties gemini-3.1-pro-low (4+3) and sorts after it lexicographically.
  expect(registry.forComputeClass("frontier").map((model) => model.id)).toEqual([
    "gemini-3.1-pro-low",
    "gpt-5.6-sol",
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
  }));

  expect(loadLoopConfig({ configDirectory: directory }).output).toEqual({
    statusLineLimit: 9,
    attentionLineLimit: 7,
    findingsLineLimit: 4,
    listLineLimit: 6,
    lineTextLimit: 120,
  });
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
  output = {
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
`;
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
