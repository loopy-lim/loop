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
  expect(config.lead).toEqual({ command: "pi", provider: "zai", model: "glm-5.3-flash" });
  expect(config.providers.codex?.command).toBe("codex");

  const registry = new ModelRegistry(config.models);
  expect(registry.get("glm-5.3-flash").computeClass).toBe("fast");
  expect(registry.forComputeClass("frontier").map((model) => model.id)).toEqual([
    "gpt-6-astra",
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

function policy(maxWorkers: number, maxFrontierWorkers: number): string {
  return `
[scheduler]
max_parallel = ${maxWorkers}
max_frontier_workers = ${maxFrontierWorkers}

[routing]
default_compute_class = "fast"
high_risk_floor = "strong"
critical_risk_floor = "frontier"
escalation = ["deterministic", "typed_decision", "tiny", "fast", "balanced", "strong", "frontier"]

[attention]
maximum_findings = 5
status_line_limit = 8
attention_line_limit = 6
`;
}

function providers(scenario: string): string {
  const lead = `[lead]\ncommand = "pi"\nprovider = "zai"\nmodel = "glm-5.3-flash"\n`;
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
