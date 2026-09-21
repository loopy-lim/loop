import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

test("loop-core exports only provider-neutral orchestration modules", () => {
  const lib = readFileSync(join(root, "crates/loop-core/src/lib.rs"), "utf8");
  const exports = [...lib.matchAll(/pub mod ([a-z_]+);/g)].map((match) => match[1]).sort();
  expect(exports).toEqual([
    "attention",
    "error",
    "event",
    "graph",
    "policy",
    "run",
    "scheduler",
    "task",
  ]);

  const files = [
    join(root, "crates/loop-core/src/lib.rs"),
    ...rustFiles(join(root, "crates/loop-core/src/attention")),
    ...rustFiles(join(root, "crates/loop-core/src/event")),
    ...rustFiles(join(root, "crates/loop-core/src/graph")),
    ...rustFiles(join(root, "crates/loop-core/src/policy")),
    ...rustFiles(join(root, "crates/loop-core/src/run")),
    ...rustFiles(join(root, "crates/loop-core/src/scheduler")),
    ...rustFiles(join(root, "crates/loop-core/src/task")),
  ];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    expect(source).not.toMatch(/Codex|Herdr|PiRuntime|Antigravity|Z\.AI|Jev/);
    expect(source).not.toMatch(/\bprovider\b/i);
  }
});

test("generated Rustra bindings are the only TypeScript to Rust seam", () => {
  expect(existsSync(join(root, "packages/protocol/src/client.ts"))).toBe(false);
  expect(existsSync(join(root, "crates/loop-bridge/src/bin/loop-bridge.rs"))).toBe(false);

  const protocolIndex = readFileSync(join(root, "packages/protocol/src/index.ts"), "utf8");
  expect(protocolIndex).not.toContain('export * from "./client"');
  expect(protocolIndex).toContain('export * from "./generated/bun"');
});

test("provider, Pi, SQLite, and generated protocol dependencies do not invert", () => {
  for (const file of tsFiles(join(root, "packages/providers/src"))) {
    expect(readFileSync(file, "utf8")).not.toContain("@loop/pi-loop");
  }
  for (const file of tsFiles(join(root, "packages/pi-loop/src"))) {
    expect(readFileSync(file, "utf8")).not.toMatch(/rusqlite|sqlite3|better-sqlite3/);
  }

  const taskTypeDefinitions = tsFiles(join(root, "packages"))
    .filter((file) => /export (?:type|interface) TaskSpecInput/.test(readFileSync(file, "utf8")))
    .map((file) => relative(root, file));
  expect(taskTypeDefinitions).toEqual(["packages/protocol/src/generated/types.ts"]);
});

test("configuration keeps model names and provider endpoints out of business logic", () => {
  for (const file of [
    "config/models.toml",
    "config/policy.toml",
    "config/providers.example.toml",
  ]) {
    expect(statSync(join(root, file)).isFile()).toBe(true);
  }
  const core = rustFiles(join(root, "crates/loop-core/src"))
    .filter((file) => !file.includes("legacy"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  expect(core).not.toMatch(/gpt-|gemini-|glm-|https?:\/\//);

  const orchestration = ["orchestrator", "pi-loop", "herdr"]
    .flatMap((name) => tsFiles(join(root, `packages/${name}/src`)))
    .filter((file) => !file.endsWith("/config.ts"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  expect(orchestration).not.toMatch(/gpt-|gemini-|glm-|https?:\/\//);
});

test("the repository contains no recovered legacy product surfaces", () => {
  for (const path of [
    "apps",
    "plugins",
    "crates/loop-legacy",
    "crates/loop-lock-holder",
    "crates/loop-rustra",
    "crates/loop-tui",
    "packages/pi-extension",
    "packages/provider-agy",
    ".codex-plugin",
    ".mcp.json",
  ]) {
    expect(existsSync(join(root, path))).toBe(false);
  }
});

function rustFiles(directory: string): string[] {
  return files(directory, ".rs");
}

function tsFiles(directory: string): string[] {
  return files(directory, ".ts");
}

function files(directory: string, extension: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path, extension) : path.endsWith(extension) ? [path] : [];
  });
}
