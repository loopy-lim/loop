import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

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
