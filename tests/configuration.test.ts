import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { ConfigError, loadLoopConfig } from "../packages/orchestrator/src/config";

const root = resolve(import.meta.dir, "..");

function parseToml(path: string): Record<string, unknown> {
  return Bun.TOML.parse(readFileSync(join(root, path), "utf8")) as Record<string, unknown>;
}

test("model and policy examples are valid TOML with bounded routing", () => {
  const models = parseToml("config/models.toml") as { models?: unknown[] };
  const policy = parseToml("config/policy.toml") as {
    scheduler?: { max_parallel?: number; max_frontier_workers?: number };
    routing?: { escalation?: string[] };
  };
  expect(models.models?.length).toBeGreaterThan(0);
  expect(policy.scheduler?.max_parallel).toBeGreaterThan(0);
  expect(policy.scheduler?.max_frontier_workers).toBeLessThanOrEqual(
    policy.scheduler?.max_parallel ?? 0,
  );
  expect(policy.routing?.escalation).toEqual([
    "deterministic",
    "typed_decision",
    "tiny",
    "fast",
    "balanced",
    "strong",
    "frontier",
  ]);
});

test("provider example references a credential environment variable, never a value", () => {
  const config = parseToml("config/providers.example.toml") as {
    providers?: { zai?: Record<string, unknown> };
  };
  expect(config.providers?.zai?.api_key_env).toBe("ZAI_API_KEY");
  expect(config.providers?.zai).not.toHaveProperty("api_key");
  expect(config.providers?.zai).not.toHaveProperty("authorization");
});

test("enabled legacy Jev configuration fails with an unsupported-provider error", () => {
  const directory = legacyJevConfig(true);

  try {
    loadLoopConfig({ configDirectory: directory });
    throw new Error("expected enabled Jev configuration to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).code).toBe("config.unsupported_provider");
    expect((error as Error).message).toContain("provider jev is no longer supported");
  }
});

test("disabled legacy Jev configuration is ignored during migration", () => {
  const config = loadLoopConfig({ configDirectory: legacyJevConfig(false) });

  expect(config.providers.jev).toBeUndefined();
  expect(config.providers.pi?.enabled).toBe(true);
});

function legacyJevConfig(enabled: boolean): string {
  const directory = mkdtempSync(join(tmpdir(), "loop-config-legacy-jev-"));
  writeFileSync(join(directory, "models.toml"), readFileSync(join(root, "config/models.toml")));
  writeFileSync(join(directory, "policy.toml"), readFileSync(join(root, "config/policy.toml")));
  writeFileSync(join(directory, "providers.toml"), `
[lead]
command = "pi"
provider = "zai"
model = "glm-5.3-flash"

[providers.pi]
command = "pi"
enabled = true
auth = "native"
mode = "interactive"

[providers.jev]
endpoint = "http://127.0.0.1:8089"
enabled = ${enabled}
auth = "none"
mode = "api"
`);
  return directory;
}
