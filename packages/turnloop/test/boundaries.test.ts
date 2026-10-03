import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const packageRoot = join(import.meta.dir, "..");
const srcRoot = join(packageRoot, "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

function sources(): Array<{ path: string; text: string }> {
  return sourceFiles(srcRoot).map((path) => ({ path, text: readFileSync(path, "utf8") }));
}

test("turnloop imports only the adapter contract, generated protocol, and node builtins", () => {
  const allowed = new Set(["@loop/providers", "@loop/protocol"]);
  for (const file of sources()) {
    const specifiers = [...file.text.matchAll(/from\s+"([^"]+)"/g)].flatMap((match) => {
      const specifier = match[1];
      return specifier === undefined ? [] : [specifier];
    });
    for (const specifier of specifiers) {
      if (specifier.startsWith("./") || specifier.startsWith("node:")) continue;
      // The whitelist itself bans loop-core/loop-store/loop-bridge/orchestrator
      // and every other workspace package (decision TL1 금지 목록 1번).
      expect(allowed.has(specifier), `${file.path} imports ${specifier}`).toBe(true);
    }
    // No dynamic imports and no CommonJS require anywhere in the adapter.
    expect(file.text, file.path).not.toMatch(/import\s*\(/);
    expect(file.text, file.path).not.toMatch(/[^#]require\s*\(/);
  }
});

test("turnloop never appends events or reads projections", () => {
  for (const file of sources()) {
    // Recording is the orchestrator's job: no event-append or projection
    // vocabulary anywhere in the adapter, comments included.
    expect(file.text, file.path).not.toMatch(
      /appendEvent|append_event|recordWorkerResult|recordActivity|recordWorkerStopped|getSnapshot|claimExecution|prepareRun|renewExecution/,
    );
    expect(file.text, file.path).not.toMatch(/rusqlite|better-sqlite3|sqlite3/);
  }
});

test("turnloop owns no graph scheduling, run-state, or attention concepts", () => {
  for (const file of sources()) {
    expect(file.text, file.path).not.toMatch(
      /\bGraphScheduler\b|\bRunState\b|\brequestAttention\b|\bOrchestrationControl\b|\bOrchestrator\b/,
    );
  }
});

test("turnloop keeps model ids, endpoints, and credentials out of source code", () => {
  for (const file of sources()) {
    expect(file.text, file.path).not.toMatch(/https?:\/\//);
    expect(file.text, file.path).not.toMatch(/gpt-|glm-|gemini-|claude-|kimi-|deepseek-/);
    expect(file.text, file.path).not.toMatch(/apiKey|api_key|Bearer\s|password|token\s*=/i);
    // Nothing in the adapter logs; credential hygiene has no counterexample.
    expect(file.text, file.path).not.toMatch(/console\./);
  }
});
