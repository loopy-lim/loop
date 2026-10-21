import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

test("loop-core exports only provider-neutral orchestration modules", () => {
  const lib = readFileSync(join(root, "crates/loop-core/src/lib.rs"), "utf8");
  const exports = [...lib.matchAll(/pub mod ([a-z_]+);/g)].map((match) => match[1]).sort();
  expect(exports).toEqual([
    "attention",
    "benchmark",
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
    ...rustFiles(join(root, "crates/loop-core/src/benchmark")),
    ...rustFiles(join(root, "crates/loop-core/src/event")),
    ...rustFiles(join(root, "crates/loop-core/src/graph")),
    ...rustFiles(join(root, "crates/loop-core/src/policy")),
    ...rustFiles(join(root, "crates/loop-core/src/run")),
    ...rustFiles(join(root, "crates/loop-core/src/scheduler")),
    ...rustFiles(join(root, "crates/loop-core/src/task")),
  ];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    expect(source).not.toMatch(/Codex|Herdr|PiRuntime|Antigravity|Z\.AI/);
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

  for (const file of tsFiles(join(root, "packages/presentation/src"))) {
    const source = readFileSync(file, "utf8");
    expect(source).not.toMatch(/@loop\/(providers|pi-loop|herdr)/);
    expect(source).not.toMatch(/Provider|PiRuntime|Herdr/);
  }

  for (const file of rustFiles(join(root, "crates/loop-core/src"))) {
    expect(readFileSync(file, "utf8")).not.toMatch(/OutputLimits|compactLines|line_text_limit/);
  }
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
  // Approved product surfaces (docs/decisions/2026-xx-app-surfaces-boundary.md):
  // apps/loop-mobile must exist; its absence is a regression.
  for (const path of ["apps/loop-mobile"]) {
    expect(existsSync(join(root, path))).toBe(true);
  }

  // Legacy surfaces stay banned at their specific paths (never as a blanket "apps" ban).
  for (const path of [
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
  expect(existsSync(join(root, "plugins/loop-herdr"))).toBe(false);
  expect(existsSync(join(root, "plugins/loop-agent/herdr-plugin.toml"))).toBe(true);
  expect(existsSync(join(root, "apps"))).toBe(true);
});

test("the interactive Loop Lead never owns Herdr workspace or attachment lifecycle", () => {
  const cli = readFileSync(join(root, "packages/cli/src/main.ts"), "utf8");
  expect(cli).not.toContain("HerdrWorkerRuntime");
  expect(cli).not.toMatch(/agent["']\s*,\s*["']attach/);
  expect(cli).not.toMatch(/workspace["']\s*,\s*["']create/);
});

// ——— App layered layout (decision 2026-xx-tokenless-auth-and-app-layout D-B,
// amended by the herdr-first rebuild: docs/design/rebuild-brief-herdr-first.md
// §5 — state/ collapses into herdr/store, app/ owns composition+navigation,
// design/ owns tokens-based primitives and ANSI) ———

/** The rebuild's layers; arrows point at layers a layer may import. */
const LAYERS = [
  "app",
  "auth",
  "design",
  "features",
  "gateway-client",
  "herdr",
  "screens",
  "ui",
] as const;
type Layer = (typeof LAYERS)[number];

const LAYER_IMPORTS: Record<Layer, readonly Layer[]> = {
  app: ["auth", "design", "features", "gateway-client", "herdr", "screens", "ui"],
  screens: ["app", "auth", "design", "features", "gateway-client", "herdr", "ui"],
  features: ["auth", "design", "gateway-client", "herdr", "ui"],
  design: ["herdr", "ui"],
  herdr: ["auth", "gateway-client"],
  "gateway-client": [],
  ui: [],
  auth: ["gateway-client"],
};

/** The mobile src-root entry file (App.tsx) routes screens;
 * it may import every layer. */
const ENTRY_ALLOWED: readonly Layer[] = [...LAYERS];

const APPS = ["apps/loop-mobile"] as const;

function appSourceFiles(src: string): string[] {
  return files(src, ".ts").concat(files(src, ".tsx"));
}

function layerOf(src: string, file: string): Layer | "entry" {
  const rel = relative(src, file);
  if (!rel.includes("/")) return "entry";
  const layer = rel.split("/")[0] as Layer;
  expect(LAYERS, `unexpected src directory in ${rel}`).toContain(layer);
  return layer;
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/from\s+["']([^"']+)["']/g)].flatMap((match) => {
    const specifier = match[1];
    return specifier === undefined ? [] : [specifier];
  });
}

test("the app follows the decided layered layout with enforced import directions", () => {
  for (const app of APPS) {
    const src = join(root, app, "src");

    // (iii) no top-level src directories beyond the six decided layers.
    const dirs = readdirSync(src, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(dirs, `${app}/src layers`).toEqual([...LAYERS].sort());

    for (const file of appSourceFiles(src)) {
      const from = layerOf(src, file);
      const allowed = from === "entry" ? ENTRY_ALLOWED : LAYER_IMPORTS[from];
      const source = readFileSync(file, "utf8");
      for (const spec of importSpecifiers(source)) {
        if (spec.startsWith(".")) {
          const target = layerOf(src, resolve(dirname(file), spec));
          if (target === "entry" || target === from) continue; // same layer or entry
          expect(
            allowed,
            `${app}: ${relative(root, file)} -> ${spec} (layer "${from}" may not import "${target}")`,
          ).toContain(target);
        } else if (spec === "@loop/protocol") {
          // (i) generated protocol is reachable only through gateway-client.
          expect(
            from,
            `${app}: ${relative(root, file)} imports generated protocol directly (must go through gateway-client)`,
          ).toBe("gateway-client");
        }
      }
    }
  }
});

test("keychain/keyring/credential-store references stay confined to the auth layer", () => {
  // Credential persistence (bearer-fallback only, decision §D-A3) lives in
  // auth/. Any import of a keychain/keyring/credential-store module from
  // outside auth/ is a layer violation — prose mentions are not references.
  for (const app of APPS) {
    const src = join(root, app, "src");
    for (const file of appSourceFiles(src)) {
      const rel = relative(src, file);
      if (rel === basename(rel) || rel.startsWith("auth")) continue;
      const leaking = importSpecifiers(readFileSync(file, "utf8")).filter(
        (spec) => /keychain|keyring|credentialstore/i.test(spec) && !/(^|[\\/])auth[\\/]/.test(spec),
      );
      expect(leaking, `${app}: credential-store import outside auth/: ${rel}`).toEqual([]);
    }
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
